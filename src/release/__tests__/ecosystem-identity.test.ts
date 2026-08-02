import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

async function readJson(path: string) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

describe("current ecosystem identity", () => {
  it("derives the receipt from current package and release metadata", async () => {
    const [packageJson, releaseManifest] = await Promise.all([
      readJson("package.json"),
      readJson("release-manifest.json"),
    ]);
    const engine = releaseManifest.releaseGroups.engine;
    const publicRelease = engine.state === "candidate" ? engine.previousPublicRelease : engine;
    const version = publicRelease.version;
    const identityPath = `release-artifacts/identity/${version}.identity.json`;
    const identity = await readJson(identityPath);
    const npmReceiptPath = publicRelease.releaseRecord.path;
    const npmReceipt = await readFile(join(root, npmReceiptPath));
    const npmReceiptSha256 = createHash("sha256").update(npmReceipt).digest("hex");

    expect(releaseManifest.releaseGroups.engine.version).toBe(packageJson.version);
    expect(identity.release).toMatchObject({
      version,
      npmReceipt: npmReceiptPath,
      npmReceiptSha256,
    });
    expect(packageJson.files.filter((path: string) => path.startsWith("release-artifacts/identity/")))
      .toEqual([identityPath]);
  });

  it("separates deprecated policy from active legacy MCP registry observations", async () => {
    const [packageJson, releaseManifest] = await Promise.all([
      readJson("package.json"),
      readJson("release-manifest.json"),
    ]);
    const engine = releaseManifest.releaseGroups.engine;
    const publicRelease = engine.state === "candidate" ? engine.previousPublicRelease : engine;
    const identity = await readJson(
      `release-artifacts/identity/${publicRelease.version}.identity.json`,
    );

    expect(identity.surfaces.mcpRegistry).toMatchObject({
      identifier: "io.github.memi-design/memi",
      status: "published",
      version: publicRelease.version,
      legacy: {
        identifier: "io.github.sarveshsea/memi",
        policyStatus: "deprecated",
        observedStatus: "active",
        latestObservedVersion: "2.7.4",
        observedAt: "2026-08-02",
      },
    });
    expect(identity.surfaces.mcpRegistry.legacy.observedVersions).toEqual([
      "1.0.1",
      "1.1.0",
      "1.1.1",
      "2.3.1",
      "2.4.0",
      "2.4.1",
      "2.5.0",
      "2.6.0",
      "2.6.1",
      "2.6.3",
      "2.7.3",
      "2.7.4",
    ]);
    expect(identity.surfaces.mcpRegistry.legacy).not.toHaveProperty("provenanceOnly");
    expect(identity.verification.mcpRegistryLegacyRecord).toMatchObject({
      httpStatus: 200,
      observedStatus: "active",
      resultCount: 12,
      latestObservedVersion: "2.7.4",
    });
  });

  it("targets organization metadata and the working legal route", async () => {
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
    expect(codexPlugin.repository).toBe("https://github.com/memi-design/memi");
    expect(codexPlugin.privacyPolicyURL).toBe("https://www.memoire.cv/legal");
    expect(codexPlugin.termsOfServiceURL).toBe("https://www.memoire.cv/legal");
    expect(codexPlugin.interface.privacyPolicyURL).toBe("https://www.memoire.cv/legal");
    expect(codexPlugin.interface.termsOfServiceURL).toBe("https://www.memoire.cv/legal");
    expect(claudePlugin.repository).toBe("https://github.com/memi-design/memi");
    expect(glama.homepage).toBe("https://www.memoire.cv");
    expect(glama.author).toBe("memi-design");
  });

  it("blocks personal owner references from operational automation", async () => {
    const paths = [
      ".github/workflows/promote-release.yml",
      ".github/workflows/release-binaries.yml",
      "scripts/lib/growth-status.mjs",
      "scripts/publish-ready.mjs",
    ];
    const sources = await Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));
    const combined = sources.join("\n");

    for (const legacy of [
      "sarveshsea/homebrew-memi",
      "sarveshsea-bot",
      "from sarveshsea/memi",
      "@sarveshsea scope",
    ]) {
      expect(combined).not.toContain(legacy);
    }
    expect(sources[0]).toContain("github.com/memi-design/homebrew-memi.git");
    expect(sources[1]).toContain("github.com/memi-design/homebrew-memi.git");
    expect(sources[2]).toContain("raw.githubusercontent.com/memi-design/homebrew-memi");
    expect(sources[3]).toContain("@memi-design scope");
  });

  it("documents observed legacy registry activity without making it supported policy", async () => {
    const [readme, officialMcp, identityGuide] = await Promise.all([
      readFile(join(root, "README.md"), "utf8"),
      readFile(join(root, "docs", "OFFICIAL_MCP_REGISTRY.md"), "utf8"),
      readFile(join(root, "docs", "ECOSYSTEM_IDENTITY.md"), "utf8"),
    ]);

    expect(readme).toContain("Smithery migration pending");
    expect(officialMcp).toContain("policy is deprecated");
    expect(officialMcp).toMatch(/registry still reports[\s\S]*`active`[\s\S]*`2\.7\.4`/);
    expect(identityGuide).toContain("`memi-design/memi` is the intended Smithery publish target");
    expect(identityGuide).toContain("`sarveshsea/memi` remains operational only as a deprecated compatibility alias");
  });
});
