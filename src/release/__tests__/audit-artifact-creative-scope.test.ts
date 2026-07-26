import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const auditMarkdownPath = join(root, "docs", "audits", "memi-design-engineering-audit-2026-07-26.md");
const auditJsonPath = join(root, "docs", "audits", "memi-design-engineering-audit-2026-07-26.json");
const scorecardPath = join(root, "docs", "audits", "memi-100-scorecard.json");

const creativeSkillIds = [
  "shader-design-engineering",
  "creative-rendering-audit",
] as const;

const missingCreativeSkillIds = creativeSkillIds.filter((skillId) =>
  !existsSync(join(root, "skills", skillId, "SKILL.md"))
);

describe("audit artifact creative-rendering honesty", () => {
  it("does not claim shipped shader-focused skills that are absent from this checkout", async () => {
    if (missingCreativeSkillIds.length === 0) {
      return;
    }

    const auditMarkdown = (await readFile(auditMarkdownPath, "utf8")).toLowerCase();
    const auditJson = (await readFile(auditJsonPath, "utf8")).toLowerCase();
    const scorecard = JSON.parse(await readFile(scorecardPath, "utf8")) as {
      dimensions: Array<{
        id: string;
        criteria: Array<{ id: string; assessment: string }>;
      }>;
    };

    for (const skillId of missingCreativeSkillIds) {
      expect(auditMarkdown).not.toContain(skillId);
      expect(auditJson).not.toContain(skillId);
    }

    const shaderDimension = scorecard.dimensions.find((dimension) => dimension.id === "shader-and-dither");
    const shippedShaderCriterion = shaderDimension?.criteria.find((criterion) => criterion.id === "candidate-webgl-proof");

    expect(shaderDimension).toBeDefined();
    expect(shippedShaderCriterion).toBeDefined();
    expect(shippedShaderCriterion?.assessment).not.toBe("passed");
  });

  it("does not claim a local shader lab route when no local lab source exists", async () => {
    if (existsSync(join(root, "labs", "shaders"))) {
      return;
    }

    const auditMarkdown = (await readFile(auditMarkdownPath, "utf8")).toLowerCase();
    const auditJson = (await readFile(auditJsonPath, "utf8")).toLowerCase();

    expect(auditMarkdown).not.toContain("/labs/shaders");
    expect(auditJson).not.toContain("/labs/shaders");
    expect(auditMarkdown).not.toContain("original webgl2/glsl es 3 rendering");
    expect(auditJson).not.toContain("webgl2 lab");
  });
});
