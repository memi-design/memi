import { describe, expect, it } from "vitest";
import { checkRegression, entryFromDiagnosis, renderTrend, type HistoryEntry } from "../history.js";
import type { AppQualityDiagnosis } from "../engine.js";

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    at: "2026-07-26T00:00:00.000Z",
    scope: "full",
    policyHash: "policy-a",
    coverageFingerprint: "web-ruleset:v1",
    score: 90,
    categoryScores: {},
    severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
    ...overrides,
  };
}

describe("app-quality score history comparability", () => {
  it("does not compare scores produced from different source-analysis coverage", () => {
    const result = checkRegression(
      entry({
        at: "2026-07-27T00:00:00.000Z",
        coverageFingerprint: "swiftui-partial:v1",
        score: 0,
      }),
      [entry()],
      0,
    );

    expect(result).toEqual({
      comparable: false,
      reason: "no prior full-scan entry with the same policy hash and source coverage",
    });
  });

  it("filters trend output to the current coverage fingerprint", () => {
    const trend = renderTrend([
      entry({ at: "2026-07-25T00:00:00.000Z", coverageFingerprint: "swiftui-partial:v1", score: 0 }),
      entry({ at: "2026-07-26T00:00:00.000Z", coverageFingerprint: "web-ruleset:v1", score: 90 }),
    ], "policy-a", "swiftui-partial:v1");

    expect(trend).toHaveLength(1);
    expect(trend[0]).toContain("2026-07-25");
    expect(trend[0]).not.toContain("90/100");
  });

  it("includes the target and configured scan extent in coverage comparability", () => {
    const base = {
      generatedAt: "2026-07-26T00:00:00.000Z",
      target: ".",
      scope: undefined,
      summary: { score: 80, scanTarget: ".", scanLimit: 500 },
      scores: {},
      issues: [],
      sourceCoverage: {
        web: {
          scannedFiles: 1,
          analysis: "ruleset",
          assessedDimensions: ["spacing"],
          assessedChecks: [],
        },
      },
    } as unknown as AppQualityDiagnosis;

    const rootEntry = entryFromDiagnosis(base);
    const scopedEntry = entryFromDiagnosis({
      ...base,
      target: "src/app",
      summary: { ...base.summary, scanTarget: "src/app" },
    } as AppQualityDiagnosis);
    const truncatedEntry = entryFromDiagnosis({
      ...base,
      summary: { ...base.summary, scanLimit: 10 },
    } as AppQualityDiagnosis);

    expect(rootEntry.coverageFingerprint).not.toBe(scopedEntry.coverageFingerprint);
    expect(rootEntry.coverageFingerprint).not.toBe(truncatedEntry.coverageFingerprint);

    const absoluteAlias = entryFromDiagnosis({
      ...base,
      target: "/tmp/example-project",
    } as AppQualityDiagnosis);
    expect(rootEntry.coverageFingerprint).toBe(absoluteAlias.coverageFingerprint);
  });
});
