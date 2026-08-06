import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { hashValue } from "../frontend/foundation.js";

export async function hashPackedPackageSurface(packageDirectory: string): Promise<string> {
  const root = await realpath(path.resolve(packageDirectory));
  const manifestPath = path.join(root, "package.json");
  const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Package manifest must be an object");
  }
  const declared = (manifest as { files?: unknown }).files;
  if (!Array.isArray(declared) || !declared.every((entry) => typeof entry === "string")) {
    throw new Error("Package manifest must declare a string files array");
  }
  const exclusions = declared
    .filter((entry) => entry.startsWith("!"))
    .map((entry) => compilePackageGlob(entry.slice(1)));
  const files = new Set<string>(["package.json"]);
  for (const entry of declared.filter((value) => !value.startsWith("!"))) {
    const normalized = normalizePackagePath(entry);
    await collectPackageFiles(root, normalized, files);
  }
  const identities = await Promise.all([...files]
    .filter((file) => !exclusions.some((pattern) => pattern.test(file)))
    .sort((left, right) => left.localeCompare(right))
    .map(async (file) => {
      const content = await readFile(path.join(root, file));
      return {
        path: file,
        sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
        byteLength: content.byteLength,
      };
    }));
  return hashValue(identities);
}

async function collectPackageFiles(
  root: string,
  relativePath: string,
  files: Set<string>,
): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  const entry = await lstat(absolutePath);
  if (entry.isSymbolicLink()) {
    throw new Error(`Packed package surface cannot contain a symlink: ${relativePath}`);
  }
  if (entry.isFile()) {
    files.add(relativePath);
    return;
  }
  if (!entry.isDirectory()) {
    throw new Error(`Packed package surface entry must be a file or directory: ${relativePath}`);
  }
  for (const child of (await readdir(absolutePath)).sort()) {
    await collectPackageFiles(root, `${relativePath}/${child}`, files);
  }
}

function normalizePackagePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Invalid package surface path: ${value}`);
  }
  return normalized;
}

function compilePackageGlob(value: string): RegExp {
  const normalized = normalizePackagePath(value);
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;
    if (char === "*" && normalized[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    }
  }
  return new RegExp(`^${source}(?:/.*)?$`, "u");
}
