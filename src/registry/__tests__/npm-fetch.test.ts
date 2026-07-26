import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assertSafeNpmArchiveEntries, fetchNpmPackageToCache } from "../npm-fetch.js";

describe("npm registry cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads, verifies, extracts, and reuses a cached registry package", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "memoire-npm-cache-"));
    try {
      const tarball = await makePackageTarball(cwd, "@acme/ds");
      const fetchMock = mockNpmFetch("@acme/ds", tarball.bytes, tarball.integrity);

      const first = await fetchNpmPackageToCache("@acme/ds", cwd);
      const second = await fetchNpmPackageToCache("@acme/ds", cwd);

      expect(first.packageDir).toBe(second.packageDir);
      expect(await readFile(join(first.packageDir, "registry.json"), "utf8")).toContain("@acme/ds");
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("package.tgz"))).toHaveLength(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("refreshes a cached package when requested", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "memoire-npm-refresh-"));
    try {
      const tarball = await makePackageTarball(cwd, "@acme/ds");
      const fetchMock = mockNpmFetch("@acme/ds", tarball.bytes, tarball.integrity);

      await fetchNpmPackageToCache("@acme/ds", cwd);
      await fetchNpmPackageToCache("@acme/ds", cwd, "latest", { refresh: true });

      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("package.tgz"))).toHaveLength(2);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects invalid tarball integrity", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "memoire-npm-integrity-"));
    try {
      const tarball = await makePackageTarball(cwd, "@acme/ds");
      mockNpmFetch("@acme/ds", tarball.bytes, "sha512-invalid");

      await expect(fetchNpmPackageToCache("@acme/ds", cwd)).rejects.toThrow(/integrity/i);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects traversal, absolute, link, and oversized npm archive entries", () => {
    expect(() => assertSafeNpmArchiveEntries([{ path: "../escape", type: "File", size: 1 }]))
      .toThrow(/path traversal/i);
    expect(() => assertSafeNpmArchiveEntries([{ path: "/tmp/escape", type: "File", size: 1 }]))
      .toThrow(/absolute path/i);
    expect(() => assertSafeNpmArchiveEntries([{ path: "package/link", type: "SymbolicLink", size: 0 }]))
      .toThrow(/link/i);
    expect(() => assertSafeNpmArchiveEntries([{ path: "package/huge", type: "File", size: 51 * 1024 * 1024 }]))
      .toThrow(/size limit/i);
  });
});

async function makePackageTarball(cwd: string, packageName: string): Promise<{ bytes: Buffer; integrity: string }> {
  const sourceRoot = await mkdtemp(join(cwd, "pkg-src-"));
  const packageDir = join(sourceRoot, "package");
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(packageDir, "registry.json"), JSON.stringify({
    name: packageName,
    version: "1.0.0",
    components: [],
    meta: { extractedAt: "2026-04-26T00:00:00.000Z", memoireVersion: "0.14.1" },
  }));
  const tarballPath = join(cwd, "package.tgz");
  const tar = spawnSync("tar", ["-czf", tarballPath, "-C", sourceRoot, "package"], { encoding: "utf8" });
  if (tar.status !== 0) throw new Error(tar.stderr);
  const bytes = await readFile(tarballPath);
  return {
    bytes,
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

function mockNpmFetch(packageName: string, tarballBytes: Buffer, integrity: string) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const href = String(url);
    if (href.includes("registry.npmjs.org")) {
      return new Response(JSON.stringify({
        name: packageName,
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": {
            name: packageName,
            version: "1.0.0",
            dist: {
              tarball: "https://registry.example.test/package.tgz",
              integrity,
            },
          },
        },
      }), { status: 200 });
    }
    if (href === "https://registry.example.test/package.tgz") {
      return new Response(tarballBytes, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
