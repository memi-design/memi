import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const manifest = JSON.parse(
  await readFile(join(root, "release-manifest.json"), "utf8"),
) as {
  releaseGroups: {
    engine: {
      version: string;
      state?: string;
      sourceCommit?: string | null;
      previousPublicRelease?: { version: string; sourceCommit: string };
    };
    studio: { version: string };
  };
};

const candidateVersion = manifest.releaseGroups.engine.version;
const publicEngineVersion = manifest.releaseGroups.engine.state === "candidate"
  ? manifest.releaseGroups.engine.previousPublicRelease?.version
  : candidateVersion;
if (!publicEngineVersion) {
  throw new Error("Candidate manifest must identify its previous public release");
}
const studioVersion = manifest.releaseGroups.studio.version;
const publicEngineSourceCommit = manifest.releaseGroups.engine.state === "candidate"
  ? manifest.releaseGroups.engine.previousPublicRelease?.sourceCommit
  : manifest.releaseGroups.engine.sourceCommit;
if (!publicEngineSourceCommit) {
  throw new Error("Published manifest must identify its immutable source commit");
}
const primaryStory = "the design layer for agentic ai";

const engineDocs = [
  "docs/RELEASE_GATES.md",
  "docs/GITHUB_ACTION_MARKETPLACE.md",
  "docs/CI_RECIPES.md",
  "docs/SOCIAL.md",
  "docs/SEO.md",
  "docs/METRICS.md",
] as const;

const historicalDocs = [
  "docs/GITHUB_ACHIEVEMENTS.md",
  "docs/GROWTH_TO_1M_NPM.md",
  "docs/HANDOFF_PUBLIC_SURFACES_2026-07-14.md",
  "docs/LAUNCH.md",
  "docs/MARKETPLACE_LAUNCH.md",
  "docs/PRODUCT_HUNT_V2_5_COPY.md",
  "docs/SITE_HANDOFF.md",
  "docs/STARSTRUCK.md",
  "docs/SUBMISSIONS.md",
] as const;

const currentWorkflowDocs = [
  "docs/CI_RECIPES.md",
  "docs/GITHUB_ACTION_MARKETPLACE.md",
  "docs/TEAM_ROLLOUT.md",
] as const;

const expectedDocRefs = [
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "github/codeql-action/upload-sarif@1b168cd39490f61582a9beae412bb7057a6b2c4e",
  `memi-design/memi@${publicEngineSourceCommit}`,
] as const;

const trustCoreDocs = [
  "docs/trust/README.md",
  "docs/trust/THREAT_MODEL.md",
  "docs/trust/EGRESS_MAP.md",
  "docs/trust/DATA_RETENTION.md",
  "docs/trust/UNINSTALL_RECOVERY.md",
  "docs/trust/DEPENDENCY_LICENSE_REVIEW.md",
  "docs/trust/SUPPORTED_PLATFORMS.md",
  "docs/trust/EMPLOYER_REVIEW_PACKET.md",
  "docs/trust/KNOWN_LIMITATIONS.md",
  "docs/trust/RELEASE_TRUTH.md",
  "docs/trust/ORG_COMPATIBILITY.md",
] as const;

describe("public documentation release truth", () => {
  it("derives verified public engine and Studio guidance from release-manifest.json", async () => {
    for (const path of engineDocs) {
      const source = await readFile(join(root, path), "utf8");
      expect(source, `${path} should contain public engine ${publicEngineVersion}`)
        .toContain(publicEngineVersion);
      expect(source, `${path} should not recommend the old engine package`).not.toMatch(
        /@memi-design\/cli@(?:2\.4\.\d+|2\.5\.\d+)/,
      );
    }

    const releaseGates = await readFile(join(root, "docs/RELEASE_GATES.md"), "utf8");
    expect(releaseGates).toContain(`EXPECTED_STUDIO_VERSION=${studioVersion}`);
    expect(releaseGates).toContain("[current release truth](./CURRENT_RELEASE.md)");

    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain(
      "[current versions](https://github.com/memi-design/memi/blob/main/docs/CURRENT_RELEASE.md)",
    );
  });

  it("keeps the primary product story aligned across current public guidance", async () => {
    for (const path of [
      "README.md",
      "docs/CURRENT_RELEASE.md",
      "docs/METRICS.md",
      "docs/PUBLIC_REPOS.md",
      "docs/RELEASE_GATES.md",
      "docs/SOCIAL.md",
      "docs/SEO.md",
      "docs/V2_PACKAGE_POSITIONING.md",
    ]) {
      const source = (await readFile(join(root, path), "utf8")).toLowerCase();
      expect(source, `${path} should contain the primary public story`).toContain(primaryStory);
    }

    for (const path of [
      "scripts/check-release.mjs",
      "scripts/check-public-release-gate.mjs",
    ]) {
      const source = (await readFile(join(root, path), "utf8")).toLowerCase();
      expect(source, `${path} should enforce the primary public story`).toContain(primaryStory);
    }

    for (const path of [
      "package.json",
      "server.json",
      "mcpb/manifest.json",
      "plugins/memoire/.codex-plugin/plugin.json",
      "plugins/memi-claude/.claude-plugin/plugin.json",
    ]) {
      const metadata = JSON.parse(await readFile(join(root, path), "utf8")) as {
        description?: string;
      };
      expect(
        metadata.description?.toLowerCase(),
        `${path} should carry the primary public story`,
      ).toContain(primaryStory);
    }
  });

  it("keeps the README focused on a clear first-run path and honest product previews", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    const lines = readme.split("\n");
    const quickstartIndex = readme.indexOf("## Quickstart");
    const deeperPathsIndex = readme.indexOf("## Choose your integration");

    expect(readme).toContain(
      "https://raw.githubusercontent.com/memi-design/memi/main/assets/memi-brand-banner.png",
    );
    expect(readme).toContain("img.shields.io/npm/dw/@memi-design/cli");
    expect(readme).toContain(
      "npx -y @memi-design/cli@latest diagnose . --json --no-write --fail-on none",
    );
    expect(readme).toContain("If Memi catches a real interface issue");
    expect(readme).toContain("Memi Studio");
    expect(readme).toContain("Memi Canvas");
    expect(readme).toContain("currently in development");
    expect(readme).toContain("studio-real-01-workbench.png");
    expect(readme).toContain("memi-canvas-workspace.png");
    expect(readme.toLowerCase()).not.toContain("read-only");
    expect(readme).toContain("## Research, stated plainly");
    expect(readme).toContain("36 / 36 frozen receipts admitted");
    expect(readme).toContain("No superiority, speed, or dollar-savings claim is made.");
    expect(readme).toContain(
      "docs/research/memi-2.7-prospective-study/v15-2.7.3-confirmatory/memi-2.7.3-confirmatory-audit.pdf",
    );
    expect(quickstartIndex).toBeGreaterThan(-1);
    expect(deeperPathsIndex).toBeGreaterThan(quickstartIndex);
    expect(lines.length).toBeLessThanOrEqual(300);
    expect(readme).not.toContain("## Grok Build (Grok 4.5) — recommended setup");
  });

  it("marks every retained launch snapshot as historical before its old guidance", async () => {
    for (const path of historicalDocs) {
      const source = await readFile(join(root, path), "utf8");
      const preamble = source.split("\n").slice(0, 12).join("\n");

      expect(source, `${path} should start with a historical heading`).toMatch(
        /^# Historical\b/,
      );
      expect(preamble, `${path} should link current truth in its preamble`).toContain(
        "CURRENT_RELEASE.md",
      );
      expect(source, `${path} should not contain checkout-specific links`).not.toMatch(
        /\]\(\/(?:Users|Volumes)\//,
      );
    }
  });

  it("does not teach mutable third-party action refs in current workflow recipes", async () => {
    for (const path of currentWorkflowDocs) {
      const source = await readFile(join(root, path), "utf8");
      expect(source, `${path} contains a mutable GitHub-maintained action ref`).not.toMatch(
        /uses:\s+(?:actions\/[^@\s]+|github\/codeql-action\/[^@\s]+)@v\d+/,
      );
      expect(source, `${path} contains a mutable Memi action ref`).not.toMatch(
        /uses:\s+sarveshsea\/memi@v(?:\d+(?:\.\d+){0,2})\b/,
      );
    }

    const ciRecipes = await readFile(join(root, "docs/CI_RECIPES.md"), "utf8");
    for (const ref of expectedDocRefs) {
      expect(ciRecipes, `docs/CI_RECIPES.md should contain ${ref}`).toContain(ref);
    }

    const actionMarketplace = await readFile(join(root, "docs/GITHUB_ACTION_MARKETPLACE.md"), "utf8");
    expect(actionMarketplace).toContain(expectedDocRefs[0]);
    expect(actionMarketplace).toContain(expectedDocRefs[3]);

    const teamRollout = await readFile(join(root, "docs/TEAM_ROLLOUT.md"), "utf8");
    expect(teamRollout).toContain(expectedDocRefs[0]);
    expect(teamRollout).toContain(expectedDocRefs[3]);

    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain(expectedDocRefs[0]);
    expect(readme).toContain(expectedDocRefs[3]);
  });

  it("publishes a complete, evidence-bounded Trust Core review surface", async () => {
    const trustSources = await Promise.all(
      trustCoreDocs.map(async (path) => [path, await readFile(join(root, path), "utf8")] as const),
    );
    const combined = trustSources.map(([, source]) => source).join("\n");
    const readme = await readFile(join(root, "README.md"), "utf8");
    const security = await readFile(join(root, "SECURITY.md"), "utf8");

    for (const path of trustCoreDocs) {
      expect(readme, `README.md should link ${path}`).toContain(`(${path})`);
    }

    expect(combined).toContain(
      "Verified claims are bound to version, source SHA, artifact digest, platform, profile, and verification date.",
    );
    expect(combined).toContain("Locked is the default profile.");
    expect(combined).toContain(
      "DualEntry and other internal repositories require written employer approval before Memi is installed or run.",
    );
    expect(combined).toContain(
      "The managed Codex Deep Security Scan is pending because this host does not provide a managed filesystem permission profile.",
    );
    expect(combined).toContain("Memi Canvas and Memi Studio remain independently gated.");
    expect(combined.toLowerCase()).not.toContain("100% safe");

    for (const heading of [
      "## System and Scope",
      "## Threat Model and Trust Boundaries",
      "## Security Invariants",
      "## Reportable Findings and Severity Context",
      "## Out of Scope, Exclusions, and Accepted Risk",
      "## Known Limitations and Compensating Controls",
    ]) {
      expect(security).toContain(heading);
    }
  });
});
