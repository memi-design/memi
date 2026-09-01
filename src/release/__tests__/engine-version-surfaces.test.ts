import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const candidateVersion = "2.8.0-beta.1";
const publicVersion = "2.7.9";
const publicSourceCommit = "5fcbf39e1255af0c14c5a17ba6bde8cf1206e525";
const publicReleaseRecord = {
  path: "release-artifacts/npm/2.7.9.release.json",
  sha256: "a04c63335fae7c7a1a2ac57d387a8647471742024c42e486159db4c0f1e78d0c",
};

async function readJson(path: string) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

describe("2.8.0-beta.1 Trust Core candidate surfaces", () => {
  it("stages an unreleased candidate while retaining the immutable public release", async () => {
    const manifest = await readJson("release-manifest.json");
    expect(manifest.releaseGroups.engine).toMatchObject({
      version: candidateVersion,
      state: "candidate",
      sourceCommit: null,
      releaseRecord: null,
      previousPublicRelease: {
        version: publicVersion,
        sourceCommit: publicSourceCommit,
        releaseRecord: publicReleaseRecord,
      },
    });
    expect(manifest.releaseGroups.engine).not.toHaveProperty("supersededPartialReleases");
    expect(manifest.surfaces.githubRelease.url.endsWith(`/v${candidateVersion}`)).toBe(true);
  });

  it("aligns every executable and packaged version surface", async () => {
    const [
      packageJson,
      packageLock,
      productionLock,
      server,
      mcpb,
      codexPlugin,
      claudePlugin,
      widget,
    ] = await Promise.all([
      readJson("package.json"),
      readJson("npm-shrinkwrap.json"),
      readJson("release/npm-shrinkwrap.production.json"),
      readJson("server.json"),
      readJson("mcpb/manifest.json"),
      readJson("plugins/memoire/.codex-plugin/plugin.json"),
      readJson("plugins/memi-claude/.claude-plugin/plugin.json"),
      readJson("plugin/widget-meta.json"),
    ]);

    expect([
      packageJson.version,
      packageLock.version,
      packageLock.packages[""].version,
      productionLock.version,
      productionLock.packages[""].version,
      server.version,
      ...server.packages.map((entry: { version: string }) => entry.version),
      server._meta["io.modelcontextprotocol.registry/publisher-provided"].version,
      mcpb.version,
      codexPlugin.version,
      claudePlugin.version,
      widget.packageVersion,
    ]).toEqual(Array(12).fill(candidateVersion));
    expect(packageJson.scripts["build:mcpb"]).toContain(`memi-${candidateVersion}.mcpb`);
    expect(packageJson.scripts["publish:smithery"]).toContain(`memi-${candidateVersion}.mcpb`);
    expect(packageJson.mcpName).toBe("io.github.memi-design/memi");
    expect(server.name).toBe("io.github.memi-design/memi");
    expect(await readFile(join(root, "mcpb/server/index.cjs"), "utf8"))
      .toContain(`@memi-design/cli@${candidateVersion}`);
    const action = await readFile(join(root, "action.yml"), "utf8");
    expect(action).toContain(`default: "${publicVersion}"`);
    expect(action).toContain(`reviewed ${publicVersion} pin`);
  });

  it("keeps the candidate unreleased and the public activation path stable", async () => {
    const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("## Trust Core 2.8 development — Unreleased");
    expect(changelog).not.toContain(`## v${candidateVersion} — Published`);
    const currentRelease = await readFile(join(root, "docs/CURRENT_RELEASE.md"), "utf8");
    expect(currentRelease).toContain("Release state: `candidate`");
    expect(currentRelease).toContain(`Engine candidate (unreleased) | \`${candidateVersion}\``);
    expect(currentRelease).toContain("Source commit: Not assigned.");
    expect(currentRelease).toContain(`releases/tag/v${publicVersion}`);
    expect(currentRelease).toContain(`npx -y @memi-design/cli@${publicVersion}`);
    expect(currentRelease).not.toContain(`npx -y @memi-design/cli@${candidateVersion}`);
    expect(currentRelease).toContain("Do not announce parity until npm, GitHub, MCP, the Action, Studio, and the deployed website match their release groups.");
  });
});
