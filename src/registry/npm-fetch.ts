import { mkdir, mkdtemp, rm, rename, access, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { list as listTar } from "tar";
import { fetchPublicResource, fetchPublicText } from "../security/safe-fetch.js";

const NPM_REGISTRY_URL = "https://registry.npmjs.org";
const FETCH_TIMEOUT_MS = 15000;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ARCHIVE_ENTRIES = 4_096;
const MAX_ARCHIVE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_NPM_METADATA_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_COMPRESSED_BYTES = 100 * 1024 * 1024;

export interface NpmArchiveEntry {
  path: string;
  type: string;
  size: number;
}

export interface NpmPackageDist {
  tarball: string;
  shasum?: string;
  integrity?: string;
}

export interface NpmPackageMetadata {
  name: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, { name: string; version: string; dist?: NpmPackageDist }>;
}

export interface CachedNpmPackage {
  packageName: string;
  version: string;
  packageDir: string;
  tarballPath: string;
  dist: NpmPackageDist;
}

export interface FetchNpmPackageOptions {
  refresh?: boolean;
  ttlMs?: number;
}

interface NpmCacheManifest {
  packageName: string;
  version: string;
  tarball: string;
  shasum?: string;
  integrity?: string;
  fetchedAt: string;
}

export async function fetchNpmPackageToCache(
  packageName: string,
  cwd: string,
  versionRange = "latest",
  options: FetchNpmPackageOptions = {},
): Promise<CachedNpmPackage> {
  const metadata = await fetchNpmMetadata(packageName);
  const version = resolveVersion(metadata, versionRange);
  const dist = metadata.versions?.[version]?.dist;
  if (!dist?.tarball) {
    throw new Error(`npm package ${packageName}@${version} has no tarball`);
  }

  const cacheRoot = join(cwd, ".memoire", "cache", "registries", sanitizePackageName(packageName), version);
  const packageDir = join(cacheRoot, "package");
  const tarballPath = join(cacheRoot, "package.tgz");
  const manifestPath = join(cacheRoot, "cache.json");
  if (!options.refresh && await isCacheFresh(packageDir, manifestPath, options.ttlMs ?? DEFAULT_CACHE_TTL_MS)) {
    return { packageName, version, packageDir, tarballPath, dist };
  }

  await mkdir(cacheRoot, { recursive: true });
  await downloadFile(dist.tarball, tarballPath);
  await verifyTarball(tarballPath, dist);

  const tempExtractDir = await mkdtemp(join(tmpdir(), "memoire-npm-registry-"));
  try {
    await extractTarball(tarballPath, tempExtractDir);
    await rm(packageDir, { recursive: true, force: true });
    await rename(join(tempExtractDir, "package"), packageDir);
  } finally {
    await rm(tempExtractDir, { recursive: true, force: true });
  }

  const manifest: NpmCacheManifest = {
    packageName,
    version,
    tarball: dist.tarball,
    shasum: dist.shasum,
    integrity: dist.integrity,
    fetchedAt: new Date().toISOString(),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { packageName, version, packageDir, tarballPath, dist };
}

async function fetchNpmMetadata(packageName: string): Promise<NpmPackageMetadata> {
  const response = await fetchPublicText(`${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}`, {
    maxBytes: MAX_NPM_METADATA_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
    headers: { "User-Agent": "memoire-registry-resolver" },
  });
  if (!response.ok) {
    throw new Error(`npm registry lookup failed for ${packageName}: ${response.status}`);
  }
  return JSON.parse(response.text) as NpmPackageMetadata;
}

function resolveVersion(metadata: NpmPackageMetadata, versionRange: string): string {
  if (versionRange === "latest") {
    const latest = metadata["dist-tags"]?.latest;
    if (!latest) throw new Error(`npm package ${metadata.name} has no latest dist-tag`);
    return latest;
  }
  if (metadata.versions?.[versionRange]) return versionRange;
  throw new Error(`npm package ${metadata.name} does not contain version ${versionRange}`);
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  const response = await fetchPublicResource(url, {
    maxBytes: MAX_ARCHIVE_COMPRESSED_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (!response.ok) {
    throw new Error(`tarball download failed (${response.status}): ${url}`);
  }
  await writeFile(outputPath, response.body);
}

async function verifyTarball(tarballPath: string, dist: NpmPackageDist): Promise<void> {
  const bytes = await readFile(tarballPath);
  if (dist.integrity) {
    const verified = dist.integrity.split(/\s+/).some((entry) => {
      const [algorithm, expected] = entry.split("-");
      if (!algorithm || !expected) return false;
      if (!["sha512", "sha384", "sha256", "sha1"].includes(algorithm)) return false;
      return createHash(algorithm).update(bytes).digest("base64") === expected;
    });
    if (!verified) {
      throw new Error("npm tarball integrity check failed");
    }
    return;
  }

  if (dist.shasum) {
    const actual = createHash("sha1").update(bytes).digest("hex");
    if (actual !== dist.shasum) {
      throw new Error(`npm tarball shasum mismatch: expected ${dist.shasum}, got ${actual}`);
    }
    return;
  }
  throw new Error("npm tarball metadata must provide integrity or shasum");
}

async function extractTarball(tarballPath: string, outDir: string): Promise<void> {
  const entries: NpmArchiveEntry[] = [];
  let totalBytes = 0;
  await listTar({
    file: tarballPath,
    strict: true,
    onentry: (entry) => {
      const candidate = { path: entry.path, type: entry.type, size: entry.size };
      assertSafeNpmArchiveEntries([candidate]);
      if (entries.length >= MAX_ARCHIVE_ENTRIES) {
        throw new Error(`npm archive exceeds entry limit of ${MAX_ARCHIVE_ENTRIES}`);
      }
      totalBytes += entry.size;
      if (totalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
        throw new Error(`npm archive exceeds uncompressed size limit of ${MAX_ARCHIVE_UNCOMPRESSED_BYTES} bytes`);
      }
      entries.push(candidate);
    },
  });
  assertSafeNpmArchiveEntries(entries);
  await run("tar", ["-xzf", tarballPath, "-C", outDir]);
}

export function assertSafeNpmArchiveEntries(entries: NpmArchiveEntry[]): void {
  if (entries.length === 0) throw new Error("npm archive is empty");
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`npm archive exceeds entry limit of ${MAX_ARCHIVE_ENTRIES}`);
  }

  let totalBytes = 0;
  for (const entry of entries) {
    const path = entry.path.trim();
    if (!path) throw new Error("npm archive contains an empty path");
    if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
      throw new Error(`npm archive contains an absolute path: ${entry.path}`);
    }
    if (path.includes("\\")) {
      throw new Error(`npm archive contains an unsupported path separator: ${entry.path}`);
    }
    const segments = path.split("/");
    if (segments.includes("..")) {
      throw new Error(`npm archive contains a path traversal entry: ${entry.path}`);
    }
    if (entry.type === "SymbolicLink" || entry.type === "Link") {
      throw new Error(`npm archive contains a link entry: ${entry.path}`);
    }
    if (entry.type !== "File" && entry.type !== "Directory") {
      throw new Error(`npm archive contains an unsupported entry type ${entry.type}: ${entry.path}`);
    }
    if (entry.size > MAX_ARCHIVE_FILE_BYTES) {
      throw new Error(`npm archive entry exceeds size limit of ${MAX_ARCHIVE_FILE_BYTES} bytes: ${entry.path}`);
    }
    totalBytes += entry.size;
    if (totalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new Error(`npm archive exceeds uncompressed size limit of ${MAX_ARCHIVE_UNCOMPRESSED_BYTES} bytes`);
    }
  }
}

async function run(command: string, args: string[]): Promise<void> {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const code = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${stderr.trim() || code}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isCacheFresh(packageDir: string, manifestPath: string, ttlMs: number): Promise<boolean> {
  if (!await exists(join(packageDir, "registry.json"))) return false;
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as NpmCacheManifest;
    const fetchedAt = Date.parse(manifest.fetchedAt);
    return Number.isFinite(fetchedAt) && Date.now() - fetchedAt <= ttlMs;
  } catch {
    return false;
  }
}

function sanitizePackageName(packageName: string): string {
  return packageName.replace(/^@/, "").replace(/\//g, "__").replace(/[^a-zA-Z0-9_.-]/g, "_");
}
