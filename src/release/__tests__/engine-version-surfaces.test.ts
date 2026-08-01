import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const candidateVersion = "2.7.3";
const publicVersion = "2.7.1";
const publicSourceCommit = "5c694ba7a64ab395bdf5bfe7aedc0f6b3e81612f";
const releaseRecord = {
  path: "release-artifacts/npm/2.7.1.release.json",
  sha256: "9daa1a0008332654ffabec001b432693c09bda4a80a27bec29e272d126386129",
};

async function readJson(path: string) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

describe("2.7.3 candidate release surfaces", () => {
  it("keeps the candidate unpublished until immutable release evidence exists", async () => {
    const manifest = await readJson("release-manifest.json");
    expect(manifest.releaseGroups.engine).toEqual({
      version: candidateVersion,
      state: "candidate",
      sourceCommit: null,
      releaseRecord: null,
      previousPublicRelease: {
        version: publicVersion,
        sourceCommit: publicSourceCommit,
      },
      verification: {
        eligibleForParity: false,
        reason: "2.7.1 remains public while 2.7.3 is an unpublished candidate",
      },
    });
    expect(manifest.surfaces.githubRelease.url.endsWith(`/v${candidateVersion}`)).toBe(true);
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
    ]).toEqual(Array(12).fill(candidateVersion));
    expect(packageJson.scripts["build:mcpb"]).toContain(`memi-${candidateVersion}.mcpb`);
    expect(packageJson.scripts["publish:smithery"]).toContain(`memi-${candidateVersion}.mcpb`);
    expect(await readFile(join(root, "mcpb/server/index.cjs"), "utf8"))
      .toContain(`@memi-design/cli@${candidateVersion}`);
    const action = await readFile(join(root, "action.yml"), "utf8");
    expect(action).toContain(`default: "${candidateVersion}"`);
    expect(action).toContain(`reviewed ${candidateVersion} pin`);
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
        .toContain(`@memi-design/cli@${candidateVersion}`);
    }

    const preset = await readJson("examples/presets/starter/registry.json");
    expect(preset.meta.memoireVersion).toBe(candidateVersion);
    expect(await readFile(join(root, "examples/presets/starter/README.md"), "utf8"))
      .toContain(`Memoire v${candidateVersion}`);
    const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
    expect(changelog.match(/^## v(\d+\.\d+\.\d+)/m)?.[1]).toBe(candidateVersion);
  });

  it("labels the candidate while keeping the public activation path fail closed", async () => {
    const currentRelease = await readFile(join(root, "docs/CURRENT_RELEASE.md"), "utf8");
    expect(currentRelease).toContain("Release state: `candidate`");
    expect(currentRelease).toContain("Engine candidate (unreleased)");
    expect(currentRelease).toContain("Source commit: Not assigned.");
    expect(currentRelease).toContain(`npx -y @memi-design/cli@${publicVersion}`);
    expect(currentRelease).not.toContain("npx -y @memi-design/cli@2.6.3");
  });
});
