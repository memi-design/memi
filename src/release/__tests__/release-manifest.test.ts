import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
          sourceCommit: "ee3f3f00731a7a08c7616d4dfb14440165a86354",
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
        studio: {
          releaseGroup: "studio",
          repository: "sarveshsea/memi-studio",
          homebrewCask: "sarveshsea/memi/memi-studio",
          homebrewCaskUrl:
            "https://raw.githubusercontent.com/sarveshsea/homebrew-memi/main/Casks/memi-studio.rb",
        },
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

    const committedManifest = spawnSync(
      "git",
      ["show", `${artifact.provenance.sourceCommit}:release-manifest.json`],
      { cwd: root, encoding: "utf8" },
    );
    expect(committedManifest.status, committedManifest.stderr).toBe(0);
    expect(JSON.parse(committedManifest.stdout)).toEqual(manifest);
  });

  it("passes the release-manifest drift gate", () => {
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "sync-release-manifest.mjs"), "--check"],
      { cwd: root, encoding: "utf8" },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
