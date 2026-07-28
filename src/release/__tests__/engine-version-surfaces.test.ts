import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const currentVersion = "2.6.4";
const sourceCommit = "ec4d804220bfbf08be810ceb692a338cf186e794";
const releaseRecordPath = "release-artifacts/npm/2.6.4.release.json";
const releaseRecordSha256 =
  "405cca4d4d1c45f4725d98f4219f22704cc203fd09afca0c82969d78e23b5a0b";

async function readJson(path: string) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

describe("2.6.4 published release surfaces", () => {
  it("binds the published release to its immutable source and release record", async () => {
    const manifest = await readJson("release-manifest.json");
    expect(manifest.releaseGroups.engine).toEqual({
      version: currentVersion,
      state: "published",
      sourceCommit,
      releaseRecord: {
        path: releaseRecordPath,
        sha256: releaseRecordSha256,
      },
      verification: {
        eligibleForParity: false,
        reason: "2.6.4 is published; independent public-surface parity verification is pending",
      },
    });
    expect(manifest.surfaces.githubRelease.url.endsWith("/v2.6.4")).toBe(true);
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
    ]).toEqual(Array(12).fill(currentVersion));
    expect(packageJson.scripts["build:mcpb"]).toContain(`memi-${currentVersion}.mcpb`);
    expect(packageJson.scripts["publish:smithery"]).toContain(`memi-${currentVersion}.mcpb`);
    expect(await readFile(join(root, "mcpb/server/index.cjs"), "utf8"))
      .toContain(`@memi-design/cli@${currentVersion}`);
    const action = await readFile(join(root, "action.yml"), "utf8");
    expect(action).toContain(`default: "${currentVersion}"`);
    expect(action).toContain(`reviewed ${currentVersion} pin`);
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
        .toContain(`@memi-design/cli@${currentVersion}`);
    }

    const preset = await readJson("examples/presets/starter/registry.json");
    expect(preset.meta.memoireVersion).toBe(currentVersion);
    expect(await readFile(join(root, "examples/presets/starter/README.md"), "utf8"))
      .toContain(`Memoire v${currentVersion}`);
    const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
    expect(changelog.match(/^## v(\d+\.\d+\.\d+)/m)?.[1]).toBe(currentVersion);
  });

  it("labels 2.6.4 as published and exposes only its verified activation command", async () => {
    const currentRelease = await readFile(join(root, "docs/CURRENT_RELEASE.md"), "utf8");
    expect(currentRelease).toContain("Release state: `published`");
    expect(currentRelease).toContain(`Source commit: \`${sourceCommit}\``);
    expect(currentRelease).toContain("npx -y @memi-design/cli@2.6.4");
    expect(currentRelease).not.toContain("npx -y @memi-design/cli@2.6.3");
  });
});
