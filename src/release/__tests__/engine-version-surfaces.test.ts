import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const publishedVersion = "2.7.9";
const publishedActionVersion = "2.7.9";
const publishedSourceCommit = "5fcbf39e1255af0c14c5a17ba6bde8cf1206e525";
const publishedReleaseRecord = {
  path: "release-artifacts/npm/2.7.9.release.json",
  sha256: "a04c63335fae7c7a1a2ac57d387a8647471742024c42e486159db4c0f1e78d0c",
};

async function readJson(path: string) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

describe("2.7.9 published stabilization surfaces", () => {
  it("binds the published release to its immutable npm receipt", async () => {
    const manifest = await readJson("release-manifest.json");
    expect(manifest.releaseGroups.engine).toMatchObject({
      version: publishedVersion,
      state: "published",
      sourceCommit: publishedSourceCommit,
      releaseRecord: publishedReleaseRecord,
      supersededPartialReleases: [{
        version: "2.7.8",
        scope: "npm-only",
        sourceCommit: "d290484535198c1f328c57986f600af544cc867a",
        releaseRecord: {
          path: "release-artifacts/npm/2.7.8.release.json",
          sha256: "8b1adb07d57f71eccf372444539b7b61841547d47c255593d66af9eebe7eb3de",
        },
        supersededBy: publishedVersion,
      }],
    });
    expect(manifest.surfaces.githubRelease.url.endsWith(`/v${publishedVersion}`)).toBe(true);
  });

  it("aligns every executable and packaged version surface", async () => {
    const [
      packageJson,
      packageLock,
      server,
      mcpb,
      codexPlugin,
      claudePlugin,
      widget,
      skillRegistry,
      agentMirror,
    ] = await Promise.all([
      readJson("package.json"),
      readJson("npm-shrinkwrap.json"),
      readJson("server.json"),
      readJson("mcpb/manifest.json"),
      readJson("plugins/memoire/.codex-plugin/plugin.json"),
      readJson("plugins/memi-claude/.claude-plugin/plugin.json"),
      readJson("plugin/widget-meta.json"),
      readJson("skills/registry.json"),
      readJson("agent-kits/mirror/manifest.json"),
    ]);

    expect([
      packageJson.version,
      packageLock.version,
      packageLock.packages[""].version,
      server.version,
      ...server.packages.map((entry: { version: string }) => entry.version),
      server._meta["io.modelcontextprotocol.registry/publisher-provided"].version,
      mcpb.version,
      codexPlugin.version,
      claudePlugin.version,
      widget.packageVersion,
      skillRegistry.version,
      agentMirror.version,
    ]).toEqual(Array(12).fill(publishedVersion));
    expect(packageJson.scripts["build:mcpb"]).toContain(`memi-${publishedVersion}.mcpb`);
    expect(packageJson.scripts["publish:smithery"]).toContain(`memi-${publishedVersion}.mcpb`);
    expect(packageJson.mcpName).toBe("io.github.memi-design/memi");
    expect(server.name).toBe("io.github.memi-design/memi");
    expect(await readFile(join(root, "mcpb/server/index.cjs"), "utf8"))
      .toContain(`@memi-design/cli@${publishedVersion}`);
    const action = await readFile(join(root, "action.yml"), "utf8");
    expect(action).toContain(`default: "${publishedActionVersion}"`);
    expect(action).toContain(`reviewed ${publishedActionVersion} pin`);
    expect(await readFile(join(root, "llms.txt"), "utf8"))
      .toContain(`version: "${publishedVersion}"`);
  });

  it("keeps packaged skills, generated examples, and changelog aligned", async () => {
    const skillPaths = [
      "skills/audit-frontend-design/SKILL.md",
      "skills/remember-design-system/SKILL.md",
      "skills/enforce-design-ci/SKILL.md",
      "skills/build-swiftui-interface/SKILL.md",
      "skills/memoire-design-tooling/SKILL.md",
      "plugins/memoire/skills/audit-frontend-design/SKILL.md",
      "plugins/memi-claude/skills/audit-frontend-design/SKILL.md",
      "agent-kits/codex/memoire-design-tooling/SKILL.md",
      "agent-kits/hermes/memoire-design-tooling/SKILL.md",
      "agent-kits/openclaw/memoire-design-tooling/SKILL.md",
      "agent-kits/opencode/memoire-design-tooling/SKILL.md",
      "agent-kits/grok-build/memoire-design-tooling/SKILL.md",
    ];
    for (const path of skillPaths) {
      expect(await readFile(join(root, path), "utf8"), path)
        .toContain(`@memi-design/cli@${publishedVersion}`);
    }

    const preset = await readJson("examples/presets/starter/registry.json");
    expect(preset.meta.memoireVersion).toBe(publishedVersion);
    expect(await readFile(join(root, "examples/presets/starter/README.md"), "utf8"))
      .toContain(`Memoire v${publishedVersion}`);
    const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
    expect(changelog.match(/^## v(\d+\.\d+\.\d+)/m)?.[1]).toBe(publishedVersion);
  });

  it("keeps the public activation path on the published parity-pending release", async () => {
    const currentRelease = await readFile(join(root, "docs/CURRENT_RELEASE.md"), "utf8");
    expect(currentRelease).toContain("Release state: `published`");
    expect(currentRelease).toContain("| Engine published (parity pending) | `2.7.9` |");
    expect(currentRelease).toContain("npx -y @memi-design/cli@2.7.9");
    expect(currentRelease).toContain("Do not announce parity until npm, GitHub, MCP, the Action, Studio, and the deployed website match their release groups.");
  });
});
