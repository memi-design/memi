import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertSafeReleaseArchiveEntries,
  checksumUrlsForArchive,
  validateReleaseZipArchive,
  verifyArchiveChecksum,
} from "../upgrade.js";

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `memoire-upgrade-security-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("verifyArchiveChecksum", () => {
  it("tries the combined checksum manifest before the per-archive checksum sidecar", () => {
    expect(checksumUrlsForArchive("https://github.com/memi-design/memi/releases/latest/download", "memi-darwin-arm64.tar.gz")).toEqual([
      "https://github.com/memi-design/memi/releases/latest/download/SHA256SUMS.txt",
      "https://github.com/memi-design/memi/releases/latest/download/memi-darwin-arm64.tar.gz.sha256",
    ]);
  });

  it("verifies a matching SHA256 manifest entry", async () => {
    const archiveName = "memi-darwin-arm64.tar.gz";
    const archivePath = join(root, archiveName);
    const sumsPath = join(root, "SHA256SUMS.txt");
    const payload = "trusted release archive";
    const hash = sha256(payload);

    await writeFile(archivePath, payload, "utf-8");
    await writeFile(sumsPath, `${hash}  ${archiveName}\n`, "utf-8");

    await expect(verifyArchiveChecksum({ archiveName, archivePath, sumsPath })).resolves.toBe("verified");
  });

  it("fails closed when checksum metadata is unavailable", async () => {
    const archiveName = "memi-darwin-arm64.tar.gz";
    const archivePath = join(root, archiveName);
    const sumsPath = join(root, "missing-SHA256SUMS.txt");

    await writeFile(archivePath, "release archive", "utf-8");

    await expect(verifyArchiveChecksum({ archiveName, archivePath, sumsPath })).rejects.toThrow(/SHA256 verification required/);
    await expect(verifyArchiveChecksum({ archiveName, archivePath, sumsPath, allowUnverified: true })).resolves.toBe("unverified-allowed");
  });

  it("does not allow SHA256 mismatches even with the unverified escape hatch", async () => {
    const archiveName = "memi-darwin-arm64.tar.gz";
    const archivePath = join(root, archiveName);
    const sumsPath = join(root, "SHA256SUMS.txt");

    await writeFile(archivePath, "release archive", "utf-8");
    await writeFile(sumsPath, `${sha256("different archive")}  ${archiveName}\n`, "utf-8");

    await expect(verifyArchiveChecksum({
      archiveName,
      archivePath,
      sumsPath,
      allowUnverified: true,
    })).rejects.toThrow(/SHA256 mismatch/);
  });
});

describe("assertSafeReleaseArchiveEntries", () => {
  it("rejects traversal, links, and unexpected top-level paths", () => {
    expect(() => assertSafeReleaseArchiveEntries(
      [{ path: "../escape", type: "File", size: 1 }],
      "memi-darwin-arm64",
    )).toThrow(/path traversal/i);
    expect(() => assertSafeReleaseArchiveEntries(
      [{ path: "memi-darwin-arm64/link", type: "SymbolicLink", size: 0 }],
      "memi-darwin-arm64",
    )).toThrow(/link/i);
    expect(() => assertSafeReleaseArchiveEntries(
      [{ path: "different-root/memi", type: "File", size: 1 }],
      "memi-darwin-arm64",
    )).toThrow(/top-level/i);
  });

  it("rejects a malicious ZIP central directory before extraction", async () => {
    const zipPath = join(root, "malicious.zip");
    await writeStoredZip(zipPath, [{ path: "../escape", unixMode: 0o100644 }]);

    await expect(validateReleaseZipArchive(zipPath, "memi-win-x64")).rejects.toThrow(/path traversal/i);
  });

  it("accepts a bounded ZIP rooted at the expected release directory", async () => {
    const zipPath = join(root, "release.zip");
    await writeStoredZip(zipPath, [{ path: "memi-win-x64/memi.exe", unixMode: 0o100755 }]);

    await expect(validateReleaseZipArchive(zipPath, "memi-win-x64")).resolves.toBeUndefined();
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeStoredZip(
  path: string,
  entries: Array<{ path: string; unixMode: number }>,
): Promise<void> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(0, 18);
    local.writeUInt32LE(0, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(0, 20);
    central.writeUInt32LE(0, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((entry.unixMode << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centrals.push(central);
    localOffset += local.length;
  }

  const centralSize = centrals.reduce((sum, entry) => sum + entry.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  await writeFile(path, Buffer.concat([...locals, ...centrals, end]));
}
