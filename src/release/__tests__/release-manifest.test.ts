import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  buildWebReleaseArtifact,
  serializeJson,
  validateWebReleaseArtifactSourceBytes,
  verifyCoreReleaseSurfaces,
} from "../../../scripts/lib/release-manifest.mjs";

const root = join(import.meta.dirname, "..", "..", "..");
const manifestPath = join(root, "release-manifest.json");
const webArtifactPath = join(root, "release-artifacts", "memoire-web.release.json");
const publishedEngineSourceCommit = "74fc6ce8c66182b4aa06e1250cb169da8b1fc54c";
const publishedReleaseRecord = {
  path: "release-artifacts/npm/2.7.7.release.json",
  sha256: "d51394797e3848984231c0687b10cfb1ac282a9ebb17a3c90bde7b6092afb12c",
};

describe("release manifest", () => {
  it("is the canonical source for every public release surface", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      releaseGroups: {
        engine: {
          version: "2.7.8",
          state: "candidate",
          sourceCommit: null,
          releaseRecord: null,
          previousPublicRelease: {
            version: "2.7.7",
            sourceCommit: publishedEngineSourceCommit,
            releaseRecord: publishedReleaseRecord,
          },
        },
        studio: { version: "2.5.0" },
        site: { version: "1.0.4" },
      },
      surfaces: {
        npm: { releaseGroup: "engine", packageName: "@memi-design/cli" },
        githubRelease: {
          releaseGroup: "engine",
          repository: "memi-design/memi",
          tagPrefix: "v",
          url: "https://github.com/memi-design/memi/releases/tag/v2.7.8",
        },
        githubAction: { releaseGroup: "engine", majorTag: "v2" },
        mcp: { releaseGroup: "engine", serverName: "io.github.memi-design/memi" },
        studio: { releaseGroup: "studio", repository: "memi-design/memi-studio" },
        website: {
          releaseGroup: "site",
          repository: "memi-design/memoire-web",
          releaseArtifactUrl: "https://www.memoire.cv/release/memi-release.json",
        },
      },
    });
  });

  it("exports a deterministic, integrity-checked website artifact", async () => {
    const manifestText = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestText);
    const artifact = JSON.parse(await readFile(webArtifactPath, "utf8"));
    const canonicalText = `${JSON.stringify(manifest, null, 2)}\n`;
    const sha256 = createHash("sha256").update(canonicalText).digest("hex");

    expect(artifact.schemaVersion).toBe(2);
    expect(artifact.orchestration).toEqual(manifest);
    const publicEngine = manifest.releaseGroups.engine.state === "candidate"
      ? manifest.releaseGroups.engine.previousPublicRelease
      : manifest.releaseGroups.engine;
    expect(artifact.publicTruth).toEqual({
      source: manifest.releaseGroups.engine.state === "candidate"
        ? "previousPublicRelease"
        : "currentRelease",
      engine: {
        version: publicEngine.version,
        sourceCommit: publicEngine.sourceCommit,
        packageName: "@memi-design/cli",
        npmUrl: "https://www.npmjs.com/package/@memi-design/cli",
        githubReleaseUrl: `https://github.com/memi-design/memi/releases/tag/v${publicEngine.version}`,
      },
    });
    expect(artifact.release).toMatchObject({
      schemaVersion: 1,
      releaseGroups: {
        engine: {
          version: publicEngine.version,
          state: manifest.releaseGroups.engine.state === "candidate" ? "historical" : publicEngine.state,
          sourceCommit: publicEngine.sourceCommit,
          releaseRecord: publicEngine.releaseRecord,
        },
      },
      surfaces: {
        githubRelease: {
          url: `https://github.com/memi-design/memi/releases/tag/v${publicEngine.version}`,
        },
      },
    });
    expect(artifact.provenance).toEqual({
      repository: "https://github.com/memi-design/memi",
      path: "release-manifest.json",
      sourceCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
      sourceUrl: expect.stringMatching(
        /^https:\/\/raw\.githubusercontent\.com\/memi-design\/memi\/[a-f0-9]{40}\/release-manifest\.json$/,
      ),
      manifestSha256: sha256,
    });

  });

  it("accepts a content-identical website artifact from an earlier provenance commit", async () => {
    const manifestText = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestText);
    const artifact = JSON.parse(await readFile(webArtifactPath, "utf8"));

    expect(validateWebReleaseArtifactSourceBytes(manifest, artifact, manifestText)).toEqual([]);
  });

  it("rejects a website artifact whose claimed provenance commit contains different manifest bytes", async () => {
    const manifestText = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestText);
    const artifact = JSON.parse(await readFile(webArtifactPath, "utf8"));
    const sourceManifestText = manifestText.replace(
      "\"updatedAt\": \"2026-08-02\"",
      "\"updatedAt\": \"2099-01-01\"",
    );

    expect(validateWebReleaseArtifactSourceBytes(manifest, artifact, sourceManifestText)).toContain(
      "website release artifact source commit does not contain the canonical manifest bytes",
    );
  });

  it("rejects a website artifact whose claimed provenance commit changes only manifest formatting", async () => {
    const manifestText = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestText);
    const artifact = JSON.parse(await readFile(webArtifactPath, "utf8"));
    const sourceManifestText = JSON.stringify(JSON.parse(manifestText));

    expect(validateWebReleaseArtifactSourceBytes(manifest, artifact, sourceManifestText)).toContain(
      "website release artifact source commit does not contain the canonical manifest bytes",
    );
  });

  it("passes the release-manifest drift gate", () => {
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "sync-release-manifest.mjs"), "--check"],
      { cwd: root, encoding: "utf8" },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it("fails closed when published release evidence is not byte- and identity-bound", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.releaseGroups.engine.state !== "published") return;
    const wrongDigest = structuredClone(manifest);
    wrongDigest.releaseGroups.engine.releaseRecord.sha256 = "f".repeat(64);
    await expect(verifyCoreReleaseSurfaces(root, wrongDigest)).resolves.toContain(
      "published engine release record SHA-256 does not match its committed bytes",
    );

    const wrongSource = structuredClone(manifest);
    wrongSource.releaseGroups.engine.sourceCommit = "a".repeat(40);
    await expect(verifyCoreReleaseSurfaces(root, wrongSource)).resolves.toContain(
      "published engine release record source commit does not match the manifest",
    );
  });

  it("validates a committed candidate artifact from a depth-1 checkout", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "memi-release-fixture-"));
    const cloneParent = await mkdtemp(join(tmpdir(), "memi-release-clone-"));
    const shallowRoot = join(cloneParent, "checkout");
    const fixtureFiles = [
      "release-manifest.json",
      "release-artifacts/memoire-web.release.json",
      "package.json",
      "package-lock.json",
      "server.json",
      "action.yml",
      "mcpb/manifest.json",
      "plugins/memoire/.codex-plugin/plugin.json",
      "plugins/memi-claude/.claude-plugin/plugin.json",
      "plugin/widget-meta.json",
      "scripts/lib/release-manifest.mjs",
      "scripts/sync-release-manifest.mjs",
    ];

    try {
      for (const relativePath of fixtureFiles) {
        const target = join(fixtureRoot, relativePath);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(join(root, relativePath), target);
      }
      const currentManifest = JSON.parse(
        await readFile(join(fixtureRoot, "release-manifest.json"), "utf8"),
      );
      const candidateManifest = {
        ...currentManifest,
        releaseGroups: {
          ...currentManifest.releaseGroups,
          engine: {
            version: currentManifest.releaseGroups.engine.version,
            state: "candidate",
            sourceCommit: null,
            releaseRecord: null,
            previousPublicRelease: {
              version: "2.6.4",
              sourceCommit: "ec4d804220bfbf08be810ceb692a338cf186e794",
            },
            verification: {
              eligibleForParity: false,
              reason:
                "fixture candidate; publish provenance and public parity are pending",
            },
          },
        },
      };
      await writeFile(
        join(fixtureRoot, "release-manifest.json"),
        serializeJson(candidateManifest),
        "utf8",
      );
      await writeFile(
        join(fixtureRoot, "release-artifacts/memoire-web.release.json"),
        serializeJson(buildWebReleaseArtifact(candidateManifest, "a".repeat(40))),
        "utf8",
      );
      for (const args of [
        ["init", "--quiet", "--initial-branch=main"],
        ["config", "user.name", "Memi Test"],
        ["config", "user.email", "test@memoire.invalid"],
        ["add", "."],
        ["commit", "--quiet", "-m", "fixture"],
      ]) {
        const setup = spawnSync("git", args, { cwd: fixtureRoot, encoding: "utf8" });
        expect(setup.status, setup.stderr).toBe(0);
      }

      const clone = spawnSync(
        "git",
        [
          "clone",
          "--quiet",
          "--depth",
          "1",
          "--branch",
          "main",
          `file://${fixtureRoot}`,
          shallowRoot,
        ],
        { encoding: "utf8" },
      );
      expect(clone.status, clone.stderr).toBe(0);

      const result = spawnSync(
        process.execPath,
        [join(shallowRoot, "scripts", "sync-release-manifest.mjs"), "--check"],
        { cwd: shallowRoot, encoding: "utf8" },
      );
      expect(result.status, result.stderr || result.stdout).toBe(0);

      const writeResult = spawnSync(
        process.execPath,
        [join(shallowRoot, "scripts", "sync-release-manifest.mjs")],
        { cwd: shallowRoot, encoding: "utf8" },
      );
      expect(writeResult.status).not.toBe(0);
      expect(writeResult.stderr).toContain("full Git history");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
      await rm(cloneParent, { recursive: true, force: true });
    }
  });
});
