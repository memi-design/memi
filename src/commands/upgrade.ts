/**
 * `memi upgrade` — self-update the standalone binary.
 *
 * Only meaningful when running the prebuilt binary (not the npm install, which
 * upgrades via `npm i -g @memi-design/cli`). Detects the current platform,
 * downloads the latest release archive from GitHub, verifies SHA256, and
 * swaps the binary + sidecar assets atomically.
 */

import type { Command } from "commander";
import { createHash } from "node:crypto";
import { chmodSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { list as listTar } from "tar";
import type { MemoireEngine } from "../engine/core.js";
import { packageRoot } from "../utils/asset-path.js";
import { isStandaloneBinary } from "../utils/runtime.js";

const REPO = "sarveshsea/memi";
const MAX_RELEASE_ARCHIVE_ENTRIES = 4_096;
const MAX_RELEASE_ARCHIVE_FILE_BYTES = 100 * 1024 * 1024;
const MAX_RELEASE_ARCHIVE_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;

export interface ReleaseArchiveEntry {
  path: string;
  type: string;
  size: number;
}

function detectTarget(): { target: string; ext: string; archive: "tar.gz" | "zip" } | null {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin" && arch === "arm64") return { target: "darwin-arm64", ext: "", archive: "tar.gz" };
  if (platform === "darwin" && arch === "x64")   return { target: "darwin-x64",   ext: "", archive: "tar.gz" };
  if (platform === "linux"  && arch === "x64")   return { target: "linux-x64",    ext: "", archive: "tar.gz" };
  if (platform === "win32"  && arch === "x64")   return { target: "win-x64",      ext: ".exe", archive: "zip" };
  return null;
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} (${url})`);
  if (!res.body) throw new Error("empty response body");
  await mkdir(dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

export function checksumUrlsForArchive(base: string, archiveName: string): string[] {
  return [
    `${base}/SHA256SUMS.txt`,
    `${base}/${archiveName}.sha256`,
  ];
}

function extract(archivePath: string, destDir: string, archive: "tar.gz" | "zip"): void {
  mkdirSync(destDir, { recursive: true });
  const result = archive === "zip"
    ? spawnSync("unzip", ["-o", archivePath, "-d", destDir], { stdio: "inherit" })
    : spawnSync("tar", ["-xzf", archivePath, "-C", destDir], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`extract failed for ${archivePath}`);
}

export function assertSafeReleaseArchiveEntries(entries: ReleaseArchiveEntry[], expectedRoot: string): void {
  if (entries.length === 0) throw new Error("Release archive is empty");
  if (entries.length > MAX_RELEASE_ARCHIVE_ENTRIES) {
    throw new Error(`Release archive exceeds entry limit of ${MAX_RELEASE_ARCHIVE_ENTRIES}`);
  }
  let totalBytes = 0;
  for (const entry of entries) {
    const path = entry.path.trim().replace(/\/+$/, "");
    if (!path) continue;
    if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
      throw new Error(`Release archive contains an absolute path: ${entry.path}`);
    }
    if (path.includes("\\") || path.split("/").includes("..")) {
      throw new Error(`Release archive contains a path traversal entry: ${entry.path}`);
    }
    if (entry.type === "SymbolicLink" || entry.type === "Link") {
      throw new Error(`Release archive contains a link entry: ${entry.path}`);
    }
    if (entry.type !== "File" && entry.type !== "Directory") {
      throw new Error(`Release archive contains unsupported entry type ${entry.type}: ${entry.path}`);
    }
    if (path !== expectedRoot && !path.startsWith(`${expectedRoot}/`)) {
      throw new Error(`Release archive contains an unexpected top-level path: ${entry.path}`);
    }
    if (entry.size > MAX_RELEASE_ARCHIVE_FILE_BYTES) {
      throw new Error(`Release archive entry exceeds size limit: ${entry.path}`);
    }
    totalBytes += entry.size;
    if (totalBytes > MAX_RELEASE_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new Error("Release archive exceeds uncompressed size limit");
    }
  }
}

async function validateReleaseTarball(archivePath: string, expectedRoot: string): Promise<void> {
  const entries: ReleaseArchiveEntry[] = [];
  await listTar({
    file: archivePath,
    strict: true,
    onentry: (entry) => {
      entries.push({ path: entry.path, type: entry.type, size: entry.size });
    },
  });
  assertSafeReleaseArchiveEntries(entries, expectedRoot);
}

export async function verifyArchiveChecksum(options: {
  archiveName: string;
  archivePath: string;
  sumsPath: string;
  allowUnverified?: boolean;
}): Promise<"verified" | "unverified-allowed"> {
  let sums: string;
  try {
    sums = await readFile(options.sumsPath, "utf-8");
  } catch (err) {
    if (options.allowUnverified) return "unverified-allowed";
    throw new Error(`SHA256 verification required but SHA256SUMS.txt is unavailable (${(err as Error).message}). Re-run with --allow-unverified only if you trust the release source.`);
  }

  const actualSha = await sha256File(options.archivePath);
  const expected = sums.split("\n")
    .map((line) => line.trim())
    .find((line) => line.endsWith(options.archiveName))?.split(/\s+/)[0];

  if (!expected) {
    if (options.allowUnverified) return "unverified-allowed";
    throw new Error(`SHA256 verification required but ${options.archiveName} is missing from SHA256SUMS.txt. Re-run with --allow-unverified only if you trust the release source.`);
  }
  if (expected !== actualSha) {
    throw new Error(`SHA256 mismatch — expected ${expected}, got ${actualSha}`);
  }

  return "verified";
}

export function registerUpgradeCommand(program: Command, _engine: MemoireEngine): void {
  program
    .command("upgrade")
    .description("Self-update the standalone memi binary to the latest release")
    .option("--version <tag>", "Install a specific version (e.g. v1.2.3)", "latest")
    .option("--check", "Check for updates without installing")
    .option("--allow-unverified", "Allow upgrade when SHA256SUMS.txt is unavailable or missing this archive")
    .action(async (opts: { version: string; check?: boolean; allowUnverified?: boolean }) => {
      if (!isStandaloneBinary()) {
        console.log("  memi was installed via npm. Upgrade with:");
        console.log("    npm i -g @memi-design/cli@latest");
        return;
      }

      const plat = detectTarget();
      if (!plat) {
        console.error(`  Unsupported platform: ${process.platform}-${process.arch}`);
        process.exit(1);
      }

      const base = opts.version === "latest"
        ? `https://github.com/${REPO}/releases/latest/download`
        : `https://github.com/${REPO}/releases/download/${opts.version}`;

      const archiveName = `memi-${plat.target}.${plat.archive}`;
      const archiveUrl = `${base}/${archiveName}`;
      const checksumUrls = checksumUrlsForArchive(base, archiveName);

      if (opts.check) {
        console.log(`  Checking ${archiveUrl} ...`);
        const head = await fetch(archiveUrl, { method: "HEAD", redirect: "follow" });
        console.log(`  ${head.ok ? "Available" : "Not found"} (HTTP ${head.status})`);
        return;
      }

      const root = packageRoot();
      const stagingDir = join(tmpdir(), `memi-upgrade-${Date.now()}`);
      const archivePath = join(stagingDir, archiveName);
      const sumsPath = join(stagingDir, "SHA256SUMS.txt");

      try {
        console.log(`▸ Downloading ${archiveName}`);
        // Checksum-verified below (verifyArchiveChecksum) against SHA256SUMS.txt
        // before this archive is ever extracted or executed — see line ~156.
        await download(archiveUrl, archivePath);

        let checksumSource: string | null = null;
        let checksumError: unknown = null;
        for (const checksumUrl of checksumUrls) {
          try {
            await download(checksumUrl, sumsPath);
            checksumSource = checksumUrl.endsWith("SHA256SUMS.txt") ? "SHA256SUMS.txt" : `${archiveName}.sha256`;
            break;
          } catch (err) {
            checksumError = err;
          }
        }
        if (!checksumSource) {
          if (!opts.allowUnverified) {
            throw new Error(`SHA256 metadata unavailable (${(checksumError as Error).message}). Re-run with --allow-unverified only if you trust the release source.`);
          }
          console.warn(`  ! SHA256 metadata unavailable (${(checksumError as Error).message}) — continuing because --allow-unverified was set`);
        }

        if (checksumSource) {
          const checksumStatus = await verifyArchiveChecksum({
            archiveName,
            archivePath,
            sumsPath,
            allowUnverified: opts.allowUnverified,
          });
          if (checksumStatus === "verified") {
            console.log(`✓ SHA256 verified (${checksumSource})`);
          } else {
            console.warn(`  ! No SHA256 for ${archiveName} in ${checksumSource} — continuing because --allow-unverified was set`);
          }
        }

        console.log(`▸ Extracting to ${root}`);
        if (plat.archive === "tar.gz") {
          await validateReleaseTarball(archivePath, `memi-${plat.target}`);
        }
        extract(archivePath, stagingDir, plat.archive);

        const extractedRoot = join(stagingDir, `memi-${plat.target}`);
        if (!existsSync(extractedRoot)) throw new Error(`extracted root not found: ${extractedRoot}`);

        const backupDir = `${root}.backup-${Date.now()}`;
        renameSync(root, backupDir);
        try {
          renameSync(extractedRoot, root);
          chmodSync(join(root, `memi${plat.ext}`), 0o755);
          rmSync(backupDir, { recursive: true, force: true });
          console.log(`✓ Upgrade complete. Run:  memi --version`);
        } catch (err) {
          // Roll back on failure
          if (existsSync(root)) rmSync(root, { recursive: true, force: true });
          renameSync(backupDir, root);
          throw err;
        }
      } finally {
        rmSync(stagingDir, { recursive: true, force: true });
      }
    });
}
