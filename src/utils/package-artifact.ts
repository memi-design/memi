import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { hashValue } from "../frontend/foundation.js";

const execFileAsync = promisify(execFile);
const MAX_PACK_OUTPUT_BYTES = 16 * 1024 * 1024;
const PACK_TIMEOUT_MS = 30_000;

interface NpmPackFile {
  readonly path: string;
}

interface NpmPackResult {
  readonly files: readonly NpmPackFile[];
}

/**
 * Hash the exact file surface npm says it will pack, including npm's implicit
 * README, license, and parent-directory metadata rules.
 *
 * Lifecycle scripts are disabled: callers must build first, and evidence
 * collection must never execute package-controlled hooks.
 */
export async function hashPackedPackageSurface(packageDirectory: string): Promise<string> {
  const root = await realpath(path.resolve(packageDirectory));
  const files = await listNpmPackedFiles(root);
  const identities = await Promise.all(files.map(async (file) => {
    const absolutePath = path.join(root, file);
    const entry = await lstat(absolutePath);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`Packed package surface entry must be a regular file: ${file}`);
    }
    const canonicalPath = await realpath(absolutePath);
    if (!isWithinRoot(root, canonicalPath)) {
      throw new Error(`Packed package surface escapes the package root: ${file}`);
    }
    const content = await readFile(canonicalPath);
    return {
      path: file,
      sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      byteLength: content.byteLength,
    };
  }));
  return hashValue(identities);
}

async function listNpmPackedFiles(root: string): Promise<readonly string[]> {
  const { command, args } = await trustedNpmPackInvocation();
  const { stdout } = await execFileAsync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_PACK_OUTPUT_BYTES,
    timeout: PACK_TIMEOUT_MS,
    env: isolatedNpmEnvironment(),
  });
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !isPackResult(parsed[0])) {
    throw new Error("npm pack returned an invalid file manifest");
  }
  const files = parsed[0].files.map((entry) => normalizePackagePath(entry.path));
  if (files.length === 0 || !files.includes("package.json")) {
    throw new Error("npm pack file manifest is empty or missing package.json");
  }
  const unique = [...new Set(files)].sort((left, right) => left.localeCompare(right));
  if (unique.length !== files.length) {
    throw new Error("npm pack file manifest contains duplicate paths");
  }
  return unique;
}

async function trustedNpmPackInvocation(): Promise<{
  readonly command: string;
  readonly args: readonly string[];
}> {
  return {
    command: process.execPath,
    args: [await resolveTrustedNpmCli(), "pack", "--dry-run", "--json", "--ignore-scripts"],
  };
}

async function resolveTrustedNpmCli(): Promise<string> {
  const binDirectory = path.dirname(process.execPath);
  const candidates = [
    path.resolve(binDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(binDirectory, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(binDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    try {
      const resolved = await realpath(candidate);
      const entry = await lstat(resolved);
      if (entry.isFile()) return resolved;
    } catch {
      continue;
    }
  }
  throw new Error("Unable to locate a trusted npm CLI adjacent to the current Node runtime");
}

function isolatedNpmEnvironment(): NodeJS.ProcessEnv {
  const preserve = [
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "SystemRoot",
    "ComSpec",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ] as const;
  const environment: NodeJS.ProcessEnv = {};
  for (const name of preserve) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  const nullConfig = process.platform === "win32" ? "NUL" : "/dev/null";
  return {
    ...environment,
    npm_config_userconfig: nullConfig,
    npm_config_ignore_scripts: "true",
    npm_config_update_notifier: "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
}

function isPackResult(value: unknown): value is NpmPackResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const files = (value as { files?: unknown }).files;
  return Array.isArray(files) && files.every((entry) =>
    entry !== null
    && typeof entry === "object"
    && !Array.isArray(entry)
    && typeof (entry as { path?: unknown }).path === "string");
}

function normalizePackagePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Invalid package surface path: ${value}`);
  }
  return normalized;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
