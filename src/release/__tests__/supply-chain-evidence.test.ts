import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const evidencePath = join(root, "docs", "audits", "memi-supply-chain-evidence-2026-07-26.json");
const sbomPath = join(root, "docs", "audits", "memi-supply-chain-sbom-2026-07-26.cdx.json");
const scorecardPath = join(root, "docs", "audits", "memi-100-scorecard.json");

describe("supply-chain proof evidence", () => {
  it("ships a machine-readable SBOM-backed evidence artifact and marks the criterion passed", async () => {
    expect(existsSync(evidencePath)).toBe(true);
    expect(existsSync(sbomPath)).toBe(true);

    const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as {
      schemaVersion: number;
      evidenceId: string;
      publishedPackage: {
        version: string;
        gitHead: string;
        mcpName: string;
        distIntegrity: string;
        distShasum: string;
        tarballSha256: string;
      };
      sbom: {
        path: string;
        format: string;
        sha256: string;
        specVersion: string;
        componentCount: number;
      };
      advisoryPolicy: {
        command: string;
        result: {
          high: number;
          critical: number;
        };
      };
      independentReview: {
        reviewer: string;
        verdict: string;
        scope: string[];
      };
    };
    const scorecard = JSON.parse(await readFile(scorecardPath, "utf8")) as {
      evidence: Array<{ id: string; artifact: { location: string } }>;
      dimensions: Array<{
        id: string;
        criteria: Array<{ id: string; assessment: string; evidenceIds: string[] }>;
      }>;
    };

    expect(evidence.schemaVersion).toBe(1);
    expect(evidence.evidenceId).toBe("supply-chain-proof-2026-07-26");
    expect(evidence.publishedPackage).toMatchObject({
      version: "2.6.2",
      gitHead: "ee3f3f00731a7a08c7616d4dfb14440165a86354",
      mcpName: "io.github.sarveshsea/memi",
    });
    expect(evidence.publishedPackage.distIntegrity).toMatch(/^sha512-/);
    expect(evidence.publishedPackage.distShasum).toMatch(/^[a-f0-9]{40}$/);
    expect(evidence.publishedPackage.tarballSha256).toMatch(/^[a-f0-9]{64}$/);

    expect(evidence.sbom).toMatchObject({
      path: "memi-supply-chain-sbom-2026-07-26.cdx.json",
      format: "CycloneDX",
      specVersion: "1.5",
    });
    expect(evidence.sbom.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.sbom.componentCount).toBeGreaterThan(0);

    expect(evidence.advisoryPolicy.command).toBe("npm audit --omit=dev --audit-level=high --json");
    expect(evidence.advisoryPolicy.result).toMatchObject({
      high: 0,
      critical: 0,
    });

    expect(evidence.independentReview.reviewer).toMatch(/^agent:/);
    expect(evidence.independentReview.verdict).toBe("approve");
    expect(evidence.independentReview.scope).toEqual(expect.arrayContaining([
      "archive-boundary",
      "publisher-boundary",
      "least-privilege-workflows",
      "licensing-boundary",
    ]));

    expect(scorecard.evidence.some((entry) =>
      entry.id === "supply-chain-proof"
      && entry.artifact.location === "memi-supply-chain-evidence-2026-07-26.json"
    )).toBe(true);

    const criterion = scorecard.dimensions
      .find((dimension) => dimension.id === "security-privacy-licensing")
      ?.criteria.find((entry) => entry.id === "complete-supply-chain-proof");

    expect(criterion).toBeDefined();
    expect(criterion?.assessment).toBe("passed");
    expect(criterion?.evidenceIds).toContain("supply-chain-proof");
  });
});
