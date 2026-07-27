import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const evidencePath = join(root, "docs", "audits", "memi-supply-chain-evidence-2026-07-27.json");
const sbomPath = join(root, "docs", "audits", "memi-supply-chain-sbom-2026-07-27.cdx.json");
const scorecardPath = join(root, "docs", "audits", "memi-100-scorecard.json");

describe("supply-chain proof evidence honesty", () => {
  it("keeps the scorecard point unassessed until public provenance and approved review exist", async () => {
    expect(existsSync(evidencePath)).toBe(true);
    expect(existsSync(sbomPath)).toBe(true);

    const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as {
      schemaVersion: number;
      evidenceId: string;
      scope: {
        claim: string;
        doesNotClaim: string[];
      };
      sbom: {
        path: string;
        format: string;
        sha256: string;
        specVersion: string;
        componentCount: number;
      };
      publicProvenance?: {
        requiredForPass: boolean;
        status: string;
        workflow: string;
        successorReleaseRequired: boolean;
      };
      independentReview: {
        reviewer: string;
        verdict: string;
        requiredForPass?: boolean;
        scope: string[];
      };
    };
    const scorecard = JSON.parse(await readFile(scorecardPath, "utf8")) as {
      evidence: Array<{ id: string }>;
      dimensions: Array<{
        id: string;
        criteria: Array<{ id: string; title: string; assessment: string; evidenceIds: string[] }>;
      }>;
    };

    expect(evidence.schemaVersion).toBe(1);
    expect(evidence.evidenceId).toBe("supply-chain-proof-2026-07-27");
    expect(evidence.scope.claim).toContain("Candidate supply-chain evidence");
    expect(evidence.scope.doesNotClaim).toEqual(expect.arrayContaining([
      "published successor release parity",
      "reproducibility of the immutable npm 2.6.2 tarball from the current checkout",
    ]));

    expect(evidence.sbom).toMatchObject({
      path: "memi-supply-chain-sbom-2026-07-27.cdx.json",
      format: "CycloneDX",
      specVersion: "1.5",
    });
    expect(evidence.sbom.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.sbom.componentCount).toBeGreaterThan(0);

    expect(evidence.publicProvenance).toMatchObject({
      requiredForPass: true,
      status: "missing-successor-release",
      workflow: ".github/workflows/publish.yml",
      successorReleaseRequired: true,
    });

    expect(evidence.independentReview.reviewer).toMatch(/^agent:/);
    expect(evidence.independentReview.verdict).toBe("pending");
    expect(evidence.independentReview.requiredForPass).toBe(true);
    expect(evidence.independentReview.scope).toEqual(expect.arrayContaining([
      "archive-boundary",
      "publisher-boundary",
      "least-privilege-workflows",
      "licensing-boundary",
    ]));

    expect(scorecard.evidence.some((entry) => entry.id === "supply-chain-proof")).toBe(false);

    const criterion = scorecard.dimensions
      .find((dimension) => dimension.id === "security-privacy-licensing")
      ?.criteria.find((entry) => entry.id === "complete-supply-chain-proof");

    expect(criterion).toBeDefined();
    expect(criterion?.title).toBe(
      "SBOM, public provenance, advisory policy, least privilege, and independent signoff",
    );
    expect(criterion?.assessment).toBe("unassessed");
    expect(criterion?.evidenceIds).toEqual([]);
  });
});
