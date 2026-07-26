import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const manifest = JSON.parse(
  await readFile(join(root, "release-manifest.json"), "utf8"),
) as {
  releaseGroups: {
    engine: { version: string };
    studio: { version: string };
  };
};

const engineVersion = manifest.releaseGroups.engine.version;
const studioVersion = manifest.releaseGroups.studio.version;

const engineDocs = [
  "docs/RELEASE_GATES.md",
  "docs/GITHUB_ACTION_MARKETPLACE.md",
  "docs/CI_RECIPES.md",
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
] as const;

describe("public documentation release truth", () => {
  it("derives current engine and Studio guidance from release-manifest.json", async () => {
    for (const path of engineDocs) {
      const source = await readFile(join(root, path), "utf8");
      expect(source, `${path} should contain engine ${engineVersion}`).toContain(engineVersion);
      expect(source, `${path} should not recommend the old engine package`).not.toMatch(
        /@memi-design\/cli@(?:2\.4\.\d+|2\.5\.\d+)/,
      );
    }

    const releaseGates = await readFile(join(root, "docs/RELEASE_GATES.md"), "utf8");
    expect(releaseGates).toContain(`EXPECTED_STUDIO_VERSION=${studioVersion}`);
    expect(releaseGates).toContain("[current release truth](./CURRENT_RELEASE.md)");

    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain("[current versions](docs/CURRENT_RELEASE.md)");
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
    }

    const ciRecipes = await readFile(join(root, "docs/CI_RECIPES.md"), "utf8");
    for (const ref of expectedDocRefs) {
      expect(ciRecipes, `docs/CI_RECIPES.md should contain ${ref}`).toContain(ref);
    }

    const actionMarketplace = await readFile(join(root, "docs/GITHUB_ACTION_MARKETPLACE.md"), "utf8");
    expect(actionMarketplace).toContain(expectedDocRefs[0]);

    const teamRollout = await readFile(join(root, "docs/TEAM_ROLLOUT.md"), "utf8");
    expect(teamRollout).toContain(expectedDocRefs[0]);
  });
});
