import { describe, expect, it } from "vitest";
import type { AppQualityIssue } from "../../app-quality/engine.js";
import { toSarif } from "../sarif.js";
import { renderStepSummary } from "../step-summary.js";

function makeIssue(overrides: Partial<AppQualityIssue> = {}): AppQualityIssue {
  return {
    id: "color.raw-hex",
    category: "visual-consistency",
    severity: "high",
    title: "Raw hex colors",
    detail: "5 unique hex values bypass the token system.",
    evidence: ["#ff0000 in page.tsx"],
    recommendation: "Replace raw hex values with theme tokens.",
    affectedFiles: ["src/app/page.tsx"],
    evidenceLocations: [
      { file: "src/app/page.tsx", line: 12, excerpt: "#ff0000" },
      { file: "src/app/page.tsx", line: 30, excerpt: "#00ff00" },
    ],
    ...overrides,
  };
}

describe("toSarif", () => {
  it("emits valid SARIF 2.1.0 with one result per evidence location", () => {
    const sarif = toSarif([makeIssue()], { toolVersion: "9.9.9-test", failOn: "high" }) as any;
    expect(sarif.version).toBe("2.1.0");
    const run = sarif.runs[0];
    expect(run.tool.driver.name).toBe("memi");
    expect(run.tool.driver.version).toBe("9.9.9-test");
    expect(run.tool.driver.rules).toHaveLength(1);
    expect(run.tool.driver.rules[0].id).toBe("color.raw-hex");
    expect(run.results).toHaveLength(2);
    expect(run.results[0].locations[0].physicalLocation.artifactLocation.uri).toBe("src/app/page.tsx");
    expect(run.results[0].locations[0].physicalLocation.region.startLine).toBe(12);
  });

  it("maps only gate-eligible severities to error", () => {
    const sarif = toSarif([
      makeIssue({ id: "a", severity: "high" }),
      makeIssue({ id: "b", severity: "medium" }),
      makeIssue({ id: "c", severity: "low" }),
    ], { toolVersion: "0.0.0", failOn: "high" }) as any;
    const levels = sarif.runs[0].results.map((result: any) => result.level);
    // high → error (gate-eligible); medium/low → note (below gate, not high/critical)
    expect(levels.filter((level: string) => level === "error")).toHaveLength(2);
    expect(levels.filter((level: string) => level === "note")).toHaveLength(4);
  });

  it("anchors aggregate issues (no evidence locations) to the first affected file at line 1", () => {
    const sarif = toSarif([
      makeIssue({ evidenceLocations: [], affectedFiles: ["src/styles/globals.css"] }),
    ], { toolVersion: "0.0.0" }) as any;
    expect(sarif.runs[0].results).toHaveLength(1);
    const location = sarif.runs[0].results[0].locations[0].physicalLocation;
    expect(location.artifactLocation.uri).toBe("src/styles/globals.css");
    expect(location.region.startLine).toBe(1);
  });

  it("caps evidence locations at 20 results per issue", () => {
    const locations = Array.from({ length: 40 }, (_, index) => ({ file: "src/app/page.tsx", line: index + 1 }));
    const sarif = toSarif([makeIssue({ evidenceLocations: locations })], { toolVersion: "0.0.0" }) as any;
    expect(sarif.runs[0].results).toHaveLength(20);
  });
});

describe("renderStepSummary", () => {
  it("renders the gate verdict, scope, and baseline suppression", () => {
    const markdown = renderStepSummary({
      score: 82,
      verdict: "needs-attention",
      policyHash: "abc123def456",
      failOn: "high",
      failed: true,
      gatingIssues: [makeIssue()],
      suppressedByBaseline: 3,
      scopedFiles: 4,
    });
    expect(markdown).toContain("**82/100**");
    expect(markdown).toContain("❌ failed");
    expect(markdown).toContain("`abc123def456`");
    expect(markdown).toContain("4 changed file(s)");
    expect(markdown).toContain("3 accepted finding(s) suppressed");
    expect(markdown).toContain("[HIGH] Raw hex colors");
    expect(markdown).toContain("src/app/page.tsx:12");
  });

  it("celebrates a clean gate and renders the regression trend", () => {
    const markdown = renderStepSummary({
      score: 95,
      verdict: "healthy",
      failOn: "high",
      failed: false,
      gatingIssues: [],
      suppressedByBaseline: 0,
      regression: {
        comparable: true,
        previous: { at: "2026-07-01T00:00:00.000Z", sha: "abc1234", scope: "full", score: 93, categoryScores: {}, severityCounts: { critical: 0, high: 0, medium: 0, low: 0 } },
        delta: 2,
        regressed: false,
      },
    });
    expect(markdown).toContain("✅ passed");
    expect(markdown).toContain("No new gating findings");
    expect(markdown).toContain("▲ +2 vs abc1234 (93)");
    expect(markdown).not.toContain("over budget");
  });

  it("does not celebrate a finding-free gate when dimensions remain unassessed", () => {
    const markdown = renderStepSummary({
      score: 0,
      verdict: "unassessed — SwiftUI coverage is partial",
      failOn: "none",
      failed: false,
      gatingIssues: [],
      suppressedByBaseline: 0,
      unassessedDimensions: ["accessibility", "color", "components"],
    });

    expect(markdown).toContain("No gating findings from assessed checks");
    expect(markdown).toContain("Unassessed dimensions remain unverified");
    expect(markdown).toContain("accessibility, color, components");
    expect(markdown).not.toContain("🎉");
  });

  it("truncates gating findings past 15 with an explicit count", () => {
    const markdown = renderStepSummary({
      score: 40,
      verdict: "critical",
      failOn: "medium",
      failed: true,
      gatingIssues: Array.from({ length: 18 }, (_, index) => makeIssue({ id: `rule-${index}`, title: `Issue ${index}` })),
      suppressedByBaseline: 0,
    });
    expect(markdown).toContain("Gating findings (18)");
    expect(markdown).toContain("…and 3 more");
  });

  it("neutralizes repository-controlled Markdown and control characters in paths", () => {
    const markdown = renderStepSummary({
      score: 20,
      verdict: "needs attention",
      failOn: "medium",
      failed: true,
      gatingIssues: [makeIssue({
        affectedFiles: ["src/`spoof`\n## Fake pass\u001b[2J\u202eftiwS.swift"],
        evidenceLocations: [{
          file: "src/`spoof`\n## Fake pass\u001b[2J\u202eftiwS.swift",
          line: 7,
        }],
      })],
      suppressedByBaseline: 0,
    });

    expect(markdown).not.toContain("\n## Fake pass");
    expect(markdown).not.toContain("\u001b");
    expect(markdown).not.toContain("\u202e");
    expect(markdown).toContain("\\n## Fake pass");
    expect(markdown).toContain("\\u202e");
  });
});
