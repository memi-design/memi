import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const manifestPath = join(root, "release-manifest.json");
const webArtifactPath = join(root, "release-artifacts", "memoire-web.release.json");

describe("release manifest", () => {
  it("is the canonical source for every public release surface", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      releaseGroups: {
        engine: {
          version: "2.6.2",
          state: "historical",
          sourceCommit: "ee3f3f00731a7a08c7616d4dfb14440165a86354",
          releaseRecord: null,
          verification: {
            eligibleForParity: false,
          },
          plannedSuccessor: "2.6.3",
        },
        studio: { version: "2.5.0" },
        site: { version: "1.0.4" },
      },
      surfaces: {
        npm: { releaseGroup: "engine", packageName: "@memi-design/cli" },
        githubRelease: {
          releaseGroup: "engine",
          repository: "sarveshsea/memi",
          tagPrefix: "v",
          url: "https://github.com/sarveshsea/memi/releases/tag/v2.6.2",
        },
        githubAction: { releaseGroup: "engine", majorTag: "v2" },
        mcp: { releaseGroup: "engine", serverName: "io.github.sarveshsea/memi" },
        studio: { releaseGroup: "studio", repository: "sarveshsea/memi-studio" },
        website: { releaseGroup: "site", repository: "sarveshsea/memoire-web" },
      },
    });
  });

  it("exports a deterministic, integrity-checked website artifact", async () => {
    const manifestText = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestText);
    const artifact = JSON.parse(await readFile(webArtifactPath, "utf8"));
    const canonicalText = `${JSON.stringify(manifest, null, 2)}\n`;
    const sha256 = createHash("sha256").update(canonicalText).digest("hex");

    expect(artifact.release).toEqual(manifest);
    expect(artifact.provenance).toEqual({
      repository: "https://github.com/sarveshsea/memi",
      path: "release-manifest.json",
      sourceCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
      sourceUrl: expect.stringMatching(
        /^https:\/\/raw\.githubusercontent\.com\/sarveshsea\/memi\/[a-f0-9]{40}\/release-manifest\.json$/,
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

  it("validates a committed artifact from a depth-1 checkout", async () => {
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
