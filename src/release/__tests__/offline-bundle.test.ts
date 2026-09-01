// @ts-nocheck
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { list as listTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";

import {
  OFFLINE_TARGETS,
  buildOfflineBundle,
  isPortableRuntimeName,
  resolveOfflineTarget,
} from "../../../scripts/lib/offline-bundle.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Trust Core offline bundle", () => {
  it("uses an explicit five-platform contract and fails closed for unknown targets", () => {
    expect(Object.keys(OFFLINE_TARGETS)).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
      "windows-x64",
    ]);
    expect(resolveOfflineTarget("windows-x64")).toMatchObject({
      os: "windows",
      arch: "x64",
      binary: "memi.exe",
      binaryStageTarget: "win-x64",
    });
    expect(() => resolveOfflineTarget("linux-armv7")).toThrow(
      "Unsupported offline target: linux-armv7",
    );
  });

  it("builds a deterministic, self-describing archive without dev or secret content", async () => {
    const fixture = await createFixture("linux-arm64");
    const firstOutput = join(fixture.root, "output-a");
    const secondOutput = join(fixture.root, "output-b");

    const first = await buildOfflineBundle({
      root: fixture.root,
      target: "linux-arm64",
      binaryStageDir: fixture.binaryStageDir,
      outputDir: firstOutput,
      sourceDateEpoch: 0,
    });
    const second = await buildOfflineBundle({
      root: fixture.root,
      target: "linux-arm64",
      binaryStageDir: fixture.binaryStageDir,
      outputDir: secondOutput,
      sourceDateEpoch: 0,
    });

    expect(await readFile(first.archivePath)).toEqual(await readFile(second.archivePath));
    expect(await readFile(first.checksumPath, "utf8")).toBe(
      await readFile(second.checksumPath, "utf8"),
    );

    const entries = await archiveEntries(first.archivePath);
    const prefix = "memi-offline-9.8.7-linux-arm64/";
    expect(entries).toEqual(expect.arrayContaining([
      `${prefix}memi`,
      `${prefix}LICENSE`,
      `${prefix}NOTICE`,
      `${prefix}OFFLINE.md`,
      `${prefix}THIRD_PARTY_NOTICES.txt`,
      `${prefix}sbom.cdx.json`,
      `${prefix}offline-bundle.json`,
      `${prefix}SHA256SUMS.txt`,
      `${prefix}skills/SAFE.md`,
    ]));
    expect(entries.join("\n")).not.toMatch(/(?:^|\/)(?:\.env|src|node_modules|__tests__)(?:\/|$)/);

    const runtimePackage = JSON.parse(await readFile(join(first.stageDir, "package.json"), "utf8"));
    expect(runtimePackage).toEqual({
      name: "@memi-design/cli",
      version: "9.8.7",
      description: "fixture",
      license: "MIT",
      type: "module",
      bin: { memi: "./memi" },
    });
    expect(runtimePackage).not.toHaveProperty("scripts");
    expect(runtimePackage).not.toHaveProperty("devDependencies");

    const sbom = JSON.parse(await readFile(join(first.stageDir, "sbom.cdx.json"), "utf8"));
    expect(sbom).toMatchObject({ bomFormat: "CycloneDX", specVersion: "1.5", version: 1 });
    expect(sbom.components.map((component: { name: string }) => component.name)).toEqual([
      "optional-runtime",
      "runtime-dep",
    ]);
    expect(JSON.stringify(sbom)).not.toContain("dev-secret-package");

    const thirdPartyNotices = await readFile(
      join(first.stageDir, "THIRD_PARTY_NOTICES.txt"),
      "utf8",
    );
    expect(thirdPartyNotices).toContain("optional-runtime@2.3.4 — Apache-2.0");
    expect(thirdPartyNotices).toContain("runtime-dep@1.2.3 — MIT");
    expect(thirdPartyNotices).not.toContain("dev-secret-package");

    const bundleManifest = JSON.parse(
      await readFile(join(first.stageDir, "offline-bundle.json"), "utf8"),
    );
    expect(bundleManifest).toMatchObject({
      schemaVersion: 1,
      product: "@memi-design/cli",
      version: "9.8.7",
      target: { id: "linux-arm64", os: "linux", arch: "arm64", binary: "memi" },
      runtime: { standalone: true, requiresFirstRunDependencyFetch: false },
    });
    expect(JSON.stringify(bundleManifest)).not.toContain(fixture.root);

    const checksumLine = await readFile(first.checksumPath, "utf8");
    const expectedArchiveDigest = createHash("sha256")
      .update(await readFile(first.archivePath))
      .digest("hex");
    expect(checksumLine).toBe(`${expectedArchiveDigest}  ${first.archiveName}\n`);

    const internalChecksums = await readFile(join(first.stageDir, "SHA256SUMS.txt"), "utf8");
    expect(internalChecksums).toContain("  offline-bundle.json\n");
    expect(internalChecksums).toContain("  sbom.cdx.json\n");
    expect(internalChecksums).not.toContain("SHA256SUMS.txt");
  });

  it("rejects symlinks inside runtime sidecars", async () => {
    const fixture = await createFixture("darwin-arm64");
    await symlink(join(fixture.root, "LICENSE"), join(fixture.binaryStageDir, "skills", "linked-secret"));

    await expect(buildOfflineBundle({
      root: fixture.root,
      target: "darwin-arm64",
      binaryStageDir: fixture.binaryStageDir,
      outputDir: join(fixture.root, "output"),
      sourceDateEpoch: 0,
    })).rejects.toThrow("symbolic link");
  });

  it("rejects traversal-capable versions before archiving", async () => {
    const invalidVersionFixture = await createFixture("linux-x64");
    await writeFile(join(invalidVersionFixture.root, "package.json"), `${JSON.stringify({
      name: "@memi-design/cli",
      version: "../../../escape",
      description: "fixture",
      license: "MIT",
    })}\n`);
    await expect(buildOfflineBundle({
      root: invalidVersionFixture.root,
      target: "linux-x64",
      binaryStageDir: invalidVersionFixture.binaryStageDir,
      outputDir: join(invalidVersionFixture.root, "output"),
      sourceDateEpoch: 0,
    })).rejects.toThrow("valid semantic version");

  });

  it("rejects non-portable sidecar names on every host", () => {
    for (const filename of ["unsafe\nchecksum.md", "aux.md", "trailing-dot."]) {
      expect(isPortableRuntimeName(filename)).toBe(false);
    }
    expect(isPortableRuntimeName("quote-' unicode-雪.tsx")).toBe(true);
  });
});

async function createFixture(target: keyof typeof OFFLINE_TARGETS) {
  const root = await mkdtemp(join(tmpdir(), "memi-offline-bundle-"));
  temporaryRoots.push(root);
  const contract = OFFLINE_TARGETS[target];
  const binaryStageDir = join(root, "dist-bin", `memi-${contract.binaryStageTarget}`);
  await mkdir(join(binaryStageDir, "skills"), { recursive: true });
  await mkdir(join(binaryStageDir, "src"), { recursive: true });
  await mkdir(join(binaryStageDir, "node_modules", "dev-secret-package"), { recursive: true });
  await writeFile(join(binaryStageDir, contract.binary), "standalone executable", { mode: 0o755 });
  await writeFile(join(binaryStageDir, "skills", "SAFE.md"), "safe runtime skill\n");
  await writeFile(join(binaryStageDir, "src", "should-not-ship.ts"), "development source\n");
  await writeFile(join(binaryStageDir, ".env"), "MEMI_SECRET=do-not-ship\n");
  await writeFile(
    join(binaryStageDir, "node_modules", "dev-secret-package", "index.js"),
    "development dependency\n",
  );
  await writeFile(join(root, "LICENSE"), "MIT fixture license\n");
  await writeFile(join(root, "NOTICE"), "Memi fixture notice\n");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "@memi-design/cli",
    version: "9.8.7",
    description: "fixture",
    license: "MIT",
    scripts: { postinstall: "download something" },
    devDependencies: { "dev-secret-package": "4.5.6" },
  }, null, 2)}\n`);
  await writeFile(join(root, "npm-shrinkwrap.json"), `${JSON.stringify({
    name: "@memi-design/cli",
    version: "9.8.7",
    lockfileVersion: 3,
    packages: {
      "": { name: "@memi-design/cli", version: "9.8.7", license: "MIT" },
      "node_modules/runtime-dep": {
        version: "1.2.3",
        license: "MIT",
        integrity: "sha512-runtime",
      },
      "node_modules/optional-runtime": {
        version: "2.3.4",
        license: "Apache-2.0",
        integrity: "sha512-optional",
        optional: true,
      },
      "node_modules/dev-secret-package": {
        version: "4.5.6",
        license: "MIT",
        integrity: "sha512-dev",
        dev: true,
      },
    },
  }, null, 2)}\n`);
  return { root, binaryStageDir };
}

async function archiveEntries(archivePath: string): Promise<string[]> {
  const entries: string[] = [];
  await listTar({
    file: archivePath,
    onReadEntry(entry) {
      entries.push(entry.path.replace(/\/$/, ""));
      entry.resume();
    },
  });
  return entries;
}
