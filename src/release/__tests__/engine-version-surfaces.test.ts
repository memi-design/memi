import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const publicVersion = "2.7.4";
const publicSourceCommit = "8aa4649f412bbcaaf2af4ee209bf79016566f035";

async function readJson(path: string) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

describe("2.7.4 published release surfaces", () => {
  it("binds the published release to immutable npm evidence", async () => {
    const manifest = await readJson("release-manifest.json");
    expect(manifest.releaseGroups.engine).toEqual({
      version: publicVersion,
      state: "published",
      sourceCommit: publicSourceCommit,
      releaseRecord: {
        path: "release-artifacts/npm/2.7.4.release.json",
        sha256: "6ea111d391429761ccd38ff648869131138ee276934d0914699bba26f64d055d",
      },
      verification: {
        eligibleForParity: true,
        reason: "independent public-release gate passed on 2026-08-01 across npm, GitHub release, Action v2, MCP Registry, Studio, website artifact, and fresh install",
        publicGate: {
          path: "release-artifacts/public-gate/2.7.4.parity.json",
          sha256: "ca45f11fc42ceeb2c7653f0aba6b4b4ff2291b36a4f6b8183bd47d4dd388209a",
        },
      },
    });
    expect(manifest.surfaces.githubRelease.url.endsWith(`/v${publicVersion}`)).toBe(true);
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
    ]).toEqual(Array(12).fill(publicVersion));
    expect(packageJson.scripts["build:mcpb"]).toContain(`memi-${publicVersion}.mcpb`);
    expect(packageJson.scripts["publish:smithery"]).toContain(`memi-${publicVersion}.mcpb`);
    expect(await readFile(join(root, "mcpb/server/index.cjs"), "utf8"))
      .toContain(`@memi-design/cli@${publicVersion}`);
    const action = await readFile(join(root, "action.yml"), "utf8");
    expect(action).toContain(`default: "${publicVersion}"`);
    expect(action).toContain(`reviewed ${publicVersion} pin`);
    expect(await readFile(join(root, "llms.txt"), "utf8"))
      .toContain(`version: "${publicVersion}"`);
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
        .toContain(`@memi-design/cli@${publicVersion}`);
    }

    const preset = await readJson("examples/presets/starter/registry.json");
    expect(preset.meta.memoireVersion).toBe(publicVersion);
    expect(await readFile(join(root, "examples/presets/starter/README.md"), "utf8"))
      .toContain(`Memoire v${publicVersion}`);
    const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
    expect(changelog.match(/^## v(\d+\.\d+\.\d+)/m)?.[1]).toBe(publicVersion);
  });

  it("labels the published release after independent public parity verification", async () => {
    const currentRelease = await readFile(join(root, "docs/CURRENT_RELEASE.md"), "utf8");
    expect(currentRelease).toContain("Release state: `published`");
    expect(currentRelease).toContain("CLI, npm, MCP, and Action");
    expect(currentRelease).toContain(`Source commit: \`${publicSourceCommit}\``);
    expect(currentRelease).toContain(`npx -y @memi-design/cli@${publicVersion}`);
    expect(currentRelease).not.toContain("Engine candidate (unreleased)");
    expect(currentRelease).not.toContain("Engine published (parity pending)");
  });
});
