import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  buildWebReleaseArtifact,
  serializeJson,
} from "../../../scripts/lib/release-manifest.mjs";

const root = join(import.meta.dirname, "..", "..", "..");
const manifestPath = join(root, "release-manifest.json");
const webArtifactPath = join(root, "release-artifacts", "memoire-web.release.json");
const publicEngineSourceCommit = "5c694ba7a64ab395bdf5bfe7aedc0f6b3e81612f";

describe("release manifest", () => {
  it("is the canonical source for every public release surface", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      releaseGroups: {
        engine: {
          version: "2.7.2",
          state: "candidate",
          sourceCommit: null,
          releaseRecord: null,
          previousPublicRelease: {
            version: "2.7.1",
            sourceCommit: publicEngineSourceCommit,
          },
          verification: {
            eligibleForParity: false,
            reason: "2.7.1 remains public while 2.7.2 is an unpublished candidate",
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
          url: "https://github.com/memi-design/memi/releases/tag/v2.7.2",
        },
        githubAction: { releaseGroup: "engine", majorTag: "v2" },
        mcp: { releaseGroup: "engine", serverName: "io.github.sarveshsea/memi" },
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
    expect(artifact.publicTruth).toEqual({
      source: "previousPublicRelease",
      engine: {
        version: "2.7.1",
        sourceCommit: publicEngineSourceCommit,
        packageName: "@memi-design/cli",
        npmUrl: "https://www.npmjs.com/package/@memi-design/cli",
        githubReleaseUrl: "https://github.com/memi-design/memi/releases/tag/v2.7.1",
      },
    });
    expect(artifact.release).toMatchObject({
      schemaVersion: 1,
      releaseGroups: {
        engine: {
          version: "2.7.1",
          state: "historical",
          sourceCommit: publicEngineSourceCommit,
          releaseRecord: null,
          verification: {
            eligibleForParity: false,
            reason: "2.7.1 remains public while 2.7.2 is an unpublished candidate",
          },
        },
      },
      surfaces: {
        githubRelease: {
          url: "https://github.com/memi-design/memi/releases/tag/v2.7.1",
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

  it("passes the release-manifest drift gate", () => {
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "sync-release-manifest.mjs"), "--check"],
      { cwd: root, encoding: "utf8" },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
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
