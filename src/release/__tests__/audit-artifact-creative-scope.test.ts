import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const auditMarkdownPath = join(root, "docs", "audits", "memi-design-engineering-audit-2026-07-26.md");
const auditJsonPath = join(root, "docs", "audits", "memi-design-engineering-audit-2026-07-26.json");
const scorecardPath = join(root, "docs", "audits", "memi-100-scorecard.json");

describe("audit artifact creative-rendering honesty", () => {
  it("backs canonical shader-skill claims with immutable cross-repository evidence", async () => {
    const audit = JSON.parse(await readFile(auditJsonPath, "utf8")) as {
      evidenceLedger: {
        relatedRepositories: {
          designSkills: {
            repository: string;
            pullRequest: string;
            commit: string;
            run: string;
            status: string;
            skills: string[];
          };
        };
      };
    };
    const evidence = audit.evidenceLedger.relatedRepositories.designSkills;

    expect(evidence.repository).toBe("https://github.com/sarveshsea/design-skills");
    expect(evidence.pullRequest).toMatch(/\/pull\/\d+$/);
    expect(evidence.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(evidence.run).toMatch(/^https:\/\/github\.com\/sarveshsea\/design-skills\/actions\/runs\/\d+$/);
    expect(evidence.status).toBe("checks-passed");
    expect(evidence.skills).toEqual([
      "shader-design-engineering",
      "creative-rendering-audit",
    ]);
  });

  it("backs the separate shader-lab claim with an immutable commit and hosted proof", async () => {
    const auditMarkdown = (await readFile(auditMarkdownPath, "utf8")).toLowerCase();
    const audit = JSON.parse(await readFile(auditJsonPath, "utf8")) as {
      evidenceLedger: {
        relatedRepositories: {
          designSandbox: {
            repository: string;
            pullRequest: string;
            commit: string;
            route: string;
            run: string;
            job: string;
            status: string;
          };
        };
      };
    };
    const scorecard = JSON.parse(await readFile(scorecardPath, "utf8")) as {
      dimensions: Array<{
        id: string;
        criteria: Array<{ id: string; assessment: string }>;
      }>;
    };
    const evidence = audit.evidenceLedger.relatedRepositories.designSandbox;
    const shaderDimension = scorecard.dimensions.find((dimension) => dimension.id === "shader-and-dither");
    const shaderCriterion = shaderDimension?.criteria.find((criterion) => criterion.id === "candidate-webgl-proof");

    expect(auditMarkdown).toContain("separate `design-sandbox` candidate");
    expect(evidence.repository).toBe("https://github.com/sarveshsea/design-sandbox");
    expect(evidence.pullRequest).toMatch(/\/pull\/\d+$/);
    expect(evidence.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(evidence.route).toBe("/labs/shaders");
    expect(evidence.run).toMatch(/^https:\/\/github\.com\/sarveshsea\/design-sandbox\/actions\/runs\/\d+$/);
    expect(evidence.job).toContain(`/runs/${evidence.run.split("/").at(-1)}/job/`);
    expect(evidence.status).toBe("passed");
    expect(shaderCriterion?.assessment).toBe("passed");
  });
});
