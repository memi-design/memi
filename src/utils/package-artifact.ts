import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { hashValue } from "../frontend/foundation.js";

const execFileAsync = promisify(execFile);
const MAX_PACK_OUTPUT_BYTES = 16 * 1024 * 1024;

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
  const args = ["pack", "--dry-run", "--json", "--ignore-scripts"];
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const commandArgs = npmExecPath ? [npmExecPath, ...args] : args;
  const { stdout } = await execFileAsync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_PACK_OUTPUT_BYTES,
    env: { ...process.env, npm_config_update_notifier: "false" },
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
