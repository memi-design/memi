import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

async function readJson(path: string) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

describe("2.7.7 ecosystem identity", () => {
  it("records organization-owned registry identities without overstating Smithery migration", async () => {
    const identity = await readJson("release-artifacts/identity/2.7.7.identity.json");

    expect(identity).toMatchObject({
      schemaVersion: 1,
      release: {
        version: "2.7.7",
        sourceCommit: "74fc6ce8c66182b4aa06e1250cb169da8b1fc54c",
        npmReceipt: "release-artifacts/npm/2.7.7.release.json",
      },
      publisher: {
        organization: "memi-design",
        repository: "https://github.com/memi-design/memi",
        npmPackage: "@memi-design/cli",
      },
      surfaces: {
        mcpRegistry: {
          identifier: "io.github.memi-design/memi",
          status: "published",
          version: "2.7.7",
          url: "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.memi-design%2Fmemi",
          legacy: {
            identifier: "io.github.sarveshsea/memi",
            status: "deprecated",
            provenanceOnly: true,
          },
        },
        smithery: {
          identifier: "memi-design/memi",
          status: "migration_pending",
          expectedUrl: "https://smithery.ai/servers/memi-design/memi",
          publishTarget: "memi-design/memi",
          legacy: {
            identifier: "sarveshsea/memi",
            status: "deprecated_compatibility",
            operationalUrl: "https://smithery.ai/servers/sarveshsea/memi",
          },
        },
      },
    });
    expect(identity.surfaces.smithery.legacy.retirementCondition).toMatch(/organization/i);
  });

  it("targets the organization namespace from current package and directory metadata", async () => {
    const [packageJson, mcpb, codexPlugin, claudePlugin, glama] = await Promise.all([
      readJson("package.json"),
      readJson("mcpb/manifest.json"),
      readJson("plugins/memoire/.codex-plugin/plugin.json"),
      readJson("plugins/memi-claude/.claude-plugin/plugin.json"),
      readJson("glama.json"),
    ]);

    expect(packageJson.scripts["publish:smithery"]).toContain("-n memi-design/memi");
    expect(packageJson.scripts["publish:smithery"]).not.toContain("-n sarveshsea/memi");
    expect(mcpb.author).toEqual({
      name: "Memi Design",
      url: "https://github.com/memi-design",
    });
    expect(mcpb.repository.url).toBe("https://github.com/memi-design/memi.git");
    expect(codexPlugin.author.url).toBe("https://github.com/memi-design");
    expect(codexPlugin.repository).toBe("https://github.com/memi-design/memi");
    expect(claudePlugin.author.url).toBe("https://github.com/memi-design");
    expect(claudePlugin.repository).toBe("https://github.com/memi-design/memi");
    expect(glama.homepage).toBe("https://www.memoire.cv");
    expect(glama.author).toBe("memi-design");
  });

  it("documents canonical, pending, and deprecated identities explicitly", async () => {
    const [readme, officialMcp, identityGuide] = await Promise.all([
      readFile(join(root, "README.md"), "utf8"),
      readFile(join(root, "docs", "OFFICIAL_MCP_REGISTRY.md"), "utf8"),
      readFile(join(root, "docs", "ECOSYSTEM_IDENTITY.md"), "utf8"),
    ]);

    expect(readme).toContain("io.github.memi-design/memi");
    expect(readme).toContain("Smithery migration pending");
    expect(officialMcp).toContain("io.github.sarveshsea/memi` is deprecated");
    expect(officialMcp).not.toContain("login must match the `io.github.sarveshsea/*` namespace");
    expect(identityGuide).toContain("`memi-design/memi` is the intended Smithery publish target");
    expect(identityGuide).toContain("`sarveshsea/memi` remains operational only as a deprecated compatibility alias");
  });
});
