/**
 * CLI self-update plumbing.
 *
 * Two responsibilities:
 *   1. A throttled, non-blocking "update available" notice shown on startup
 *      (reads a cached result; refreshes it in a detached background process so
 *      the hot path never waits on the network).
 *   2. Shared helpers for the `memi self-update` command.
 *
 * Behaviour is opt-out via MEMOIRE_NO_UPDATE_CHECK=1 and opt-in auto-apply via
 * MEMOIRE_AUTO_UPDATE=1. The notifier must NEVER throw or block the CLI.
 */

import { readFileSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { basename } from "node:path";
import { spawn } from "node:child_process";
import { isStandaloneBinary } from "./runtime.js";
import { ui } from "../tui/format.js";
import { getExecutionPolicy, type MemiExecutionPolicy } from "../security/execution-policy.js";

export const PKG_NAME = "@memi-design/cli";
const REGISTRY_URL = `https://registry.npmjs.org/${PKG_NAME}/latest`;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const FETCH_TIMEOUT_MS = 7000;

export type InstallChannel = "npm" | "binary";

export interface UpdateCache {
  lastCheckAt: string;
  latestVersion: string | null;
  channel: InstallChannel;
}

export function formatUpdateFailureGuidance(version: string): string {
  return `npm i -g ${PKG_NAME}@${version}`;
}

export function resolveUpdateSubcommand(argv: readonly string[]): string | undefined {
  const executable = basename(argv[0] ?? "").toLowerCase();
  const runtimeInvocation = /^(?:node|bun|deno)(?:\.exe)?$/.test(executable);
  const valueOptions = new Set(["--profile", "--allow", "--receipt"]);

  for (let index = runtimeInvocation ? 2 : 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (valueOptions.has(arg)) {
      index += 1;
      continue;
    }
    if (arg === "--offline" || arg.startsWith("--profile=") || arg.startsWith("--allow=") || arg.startsWith("--receipt=")) {
      continue;
    }
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return undefined;
}

export function getInstallChannel(): InstallChannel {
  return isStandaloneBinary() ? "binary" : "npm";
}

export function updateCachePath(policy: MemiExecutionPolicy = getExecutionPolicy()): string {
  if (!policy.homeDir) {
    throw new Error("Cannot resolve the update cache because HOME/USERPROFILE is not set.");
  }
  return join(policy.homeDir, ".memoire", "update-check.json");
}

export function readUpdateCache(policy: MemiExecutionPolicy = getExecutionPolicy()): UpdateCache | null {
  try {
    return JSON.parse(readFileSync(updateCachePath(policy), "utf-8")) as UpdateCache;
  } catch {
    return null;
  }
}

export async function writeUpdateCache(
  cache: UpdateCache,
  policy: MemiExecutionPolicy = getExecutionPolicy(),
): Promise<void> {
  let tmp: string | undefined;
  try {
    const path = updateCachePath(policy);
    await policy.runHomeWrite(path, "persist the update cache", async (safePath) => {
      const safeTmp = `${safePath}.${process.pid}.${Date.now()}.tmp`;
      tmp = safeTmp;
      await writeFile(safeTmp, JSON.stringify(cache, null, 2), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(safeTmp, safePath);
      tmp = undefined;
    });
  } catch {
    // Cache writes are best-effort — never surface an error.
  } finally {
    if (tmp) await rm(tmp, { force: true }).catch(() => undefined);
  }
}

/**
 * Semver precedence comparison. Returns -1, 0, or 1.
 * Handles a leading `v`, the X.Y.Z core, and prerelease tags (a release
 * outranks a prerelease of the same core; numeric identifiers compare
 * numerically). Build metadata (`+...`) is ignored, per semver.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const clean = v.trim().replace(/^v/, "").split("+")[0];
    const dash = clean.indexOf("-");
    const core = dash === -1 ? clean : clean.slice(0, dash);
    const pre = dash === -1 ? "" : clean.slice(dash + 1);
    const nums = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
    return { nums: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0], pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1; // release > prerelease
  if (!pb.pre) return -1;
  const ai = pa.pre.split(".");
  const bi = pb.pre.split(".");
  for (let i = 0; i < Math.max(ai.length, bi.length); i++) {
    const x = ai[i];
    const y = bi[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number.parseInt(x, 10) - Number.parseInt(y, 10);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export function isNewer(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

/** Fetch the latest published version from npm. Returns null on any failure. */
export async function fetchLatestVersion(
  timeoutMs = FETCH_TIMEOUT_MS,
  policy: MemiExecutionPolicy = getExecutionPolicy(),
): Promise<string | null> {
  policy.assert("network", "check npm for updates");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/** Refresh and persist the update cache from the network. */
export async function refreshUpdateCache(
  policy: MemiExecutionPolicy = getExecutionPolicy(),
): Promise<UpdateCache> {
  const latestVersion = await fetchLatestVersion(FETCH_TIMEOUT_MS, policy);
  const cache: UpdateCache = {
    lastCheckAt: new Date().toISOString(),
    latestVersion,
    channel: getInstallChannel(),
  };
  if (policy.allows("home-write")) {
    await writeUpdateCache(cache, policy);
  }
  return cache;
}

function cacheIsStale(cache: UpdateCache | null): boolean {
  if (!cache) return true;
  const last = new Date(cache.lastCheckAt).getTime();
  if (Number.isNaN(last)) return true;
  return Date.now() - last > CHECK_INTERVAL_MS;
}

/** Spawn a detached process that refreshes the cache, then return immediately. */
function spawnBackgroundRefresh(policy: MemiExecutionPolicy): void {
  try {
    const policyArgs = ["--profile", "connected", "--allow", "network"];
    if (policy.allows("home-write")) policyArgs.push("--allow", "home-write");
    const args = isStandaloneBinary()
      ? [...policyArgs, "self-update", "--check", "--silent"]
      : [process.argv[1], ...policyArgs, "self-update", "--check", "--silent"];
    const child = spawn(process.execPath, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // ignore — the next foreground `self-update --check` will refresh instead
  }
}

function shouldSkipNotify(argv: string[]): boolean {
  if (process.env.MEMOIRE_NO_UPDATE_CHECK === "1") return true;
  if (process.env.CI) return true;
  if (!process.stderr.isTTY) return true; // don't pollute piped/redirected output
  const sub = resolveUpdateSubcommand(argv);
  // Avoid noise (and recursion) on update-related and server commands.
  if (sub === "self-update" || sub === "upgrade" || sub === "mcp") return true;
  return false;
}

/**
 * Show an "update available" notice on startup, refreshing the cache in the
 * background when stale. With MEMOIRE_AUTO_UPDATE=1 (npm installs only) it
 * applies the update synchronously instead of just notifying.
 *
 * Writes to stderr so stdout (and `--json`) stays clean. Never throws.
 */
export async function maybeNotifyUpdate(opts: {
  currentVersion: string;
  mcpMode: boolean;
  jsonOutput: boolean;
  policy?: MemiExecutionPolicy;
}): Promise<void> {
  try {
    const policy = opts.policy ?? getExecutionPolicy();
    if (!policy.allows("network")) return;
    if (opts.mcpMode || opts.jsonOutput) return;
    if (shouldSkipNotify(process.argv)) return;

    const cache = readUpdateCache(policy);
    if (cacheIsStale(cache) && policy.allows("shell")) spawnBackgroundRefresh(policy);

    const latest = cache?.latestVersion ?? null;
    if (!latest || !isNewer(latest, opts.currentVersion)) return;

    const channel = getInstallChannel();

    if (
      process.env.MEMOIRE_AUTO_UPDATE === "1" &&
      channel === "npm" &&
      policy.allows("dynamic-install") &&
      policy.allows("shell") &&
      policy.allows("home-write")
    ) {
      process.stderr.write(`\n${ui.active(`Auto-updating memi ${opts.currentVersion} → ${latest}…`)}\n`);
      const { spawnSync } = await import("node:child_process");
      const r = spawnSync("npm", ["install", "-g", `${PKG_NAME}@${latest}`], { stdio: "inherit" });
      if (r.status === 0) {
        process.stderr.write(`${ui.ok(`Updated to ${latest} — takes effect on your next command.`)}\n\n`);
      } else {
        process.stderr.write(`${ui.warn(`Auto-update failed — run:  ${formatUpdateFailureGuidance(latest)}`)}\n\n`);
      }
      return;
    }

    const cmd = channel === "binary" ? "memi upgrade" : "memi self-update";
    process.stderr.write(
      `\n${ui.active(`memi ${latest} available`)} ${ui.dim(`(you have ${opts.currentVersion})`)}\n` +
        `${ui.dim(`  Update:  ${cmd}`)}\n\n`,
    );
  } catch {
    // The notifier must never break the CLI.
  }
}
