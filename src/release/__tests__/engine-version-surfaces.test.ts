import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const releasedVersion = "2.7.7";
const publishedSourceCommit = "74fc6ce8c66182b4aa06e1250cb169da8b1fc54c";
const publishedReleaseRecord = {
  path: "release-artifacts/npm/2.7.7.release.json",
  sha256: "d51394797e3848984231c0687b10cfb1ac282a9ebb17a3c90bde7b6092afb12c",
};

async function readJson(path: string) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

describe("2.7.7 MCP Registry ownership release surfaces", () => {
  it("binds the corrective release to its immutable npm receipt", async () => {
    const manifest = await readJson("release-manifest.json");
    expect(manifest.releaseGroups.engine).toMatchObject({
      version: releasedVersion,
      state: "published",
      sourceCommit: publishedSourceCommit,
      releaseRecord: publishedReleaseRecord,
    });
    expect(manifest.surfaces.githubRelease.url.endsWith(`/v${releasedVersion}`)).toBe(true);
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
      readJson("package-lock.json"),
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
    ]).toEqual(Array(12).fill(releasedVersion));
    expect(packageJson.scripts["build:mcpb"]).toContain(`memi-${releasedVersion}.mcpb`);
    expect(packageJson.scripts["publish:smithery"]).toContain(`memi-${releasedVersion}.mcpb`);
    expect(packageJson.mcpName).toBe("io.github.memi-design/memi");
    expect(server.name).toBe("io.github.memi-design/memi");
    expect(await readFile(join(root, "mcpb/server/index.cjs"), "utf8"))
      .toContain(`@memi-design/cli@${releasedVersion}`);
    const action = await readFile(join(root, "action.yml"), "utf8");
    expect(action).toContain(`default: "${releasedVersion}"`);
    expect(action).toContain(`reviewed ${releasedVersion} pin`);
    expect(await readFile(join(root, "llms.txt"), "utf8"))
      .toContain(`version: "${releasedVersion}"`);
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
        .toContain(`@memi-design/cli@${releasedVersion}`);
    }

    const preset = await readJson("examples/presets/starter/registry.json");
    expect(preset.meta.memoireVersion).toBe(releasedVersion);
    expect(await readFile(join(root, "examples/presets/starter/README.md"), "utf8"))
      .toContain(`Memoire v${releasedVersion}`);
    const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
    expect(changelog.match(/^## v(\d+\.\d+\.\d+)/m)?.[1]).toBe(releasedVersion);
  });

  it("uses the published activation path while retaining the parity boundary", async () => {
    const currentRelease = await readFile(join(root, "docs/CURRENT_RELEASE.md"), "utf8");
    expect(currentRelease).toContain("Release state: `published`");
    expect(currentRelease).toContain("Engine published (parity pending)");
    expect(currentRelease).toContain("npx -y @memi-design/cli@2.7.7");
    expect(currentRelease).toContain("Do not announce parity until npm, GitHub, MCP, the Action, Studio, and the deployed website match their release groups.");
  });
});
