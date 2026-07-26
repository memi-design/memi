import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertSafeReleaseArchiveEntries,
  checksumUrlsForArchive,
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
    expect(checksumUrlsForArchive("https://github.com/sarveshsea/memi/releases/latest/download", "memi-darwin-arm64.tar.gz")).toEqual([
      "https://github.com/sarveshsea/memi/releases/latest/download/SHA256SUMS.txt",
      "https://github.com/sarveshsea/memi/releases/latest/download/memi-darwin-arm64.tar.gz.sha256",
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
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
