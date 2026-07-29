import { describe, expect, it } from "vitest";
import type { BenchmarkRunRecord } from "../contracts.js";
import { buildEfficiencyReport } from "../evaluation.js";

describe("efficiency evaluation", () => {
  it("verifies a greater-than-25-percent claim only when paired confidence and quality gates pass", () => {
    const runs = Array.from({ length: 8 }, (_, index) => [
      run("baseline", index + 1, {
        tokens: 1_000 + index * 10,
        cost: 1,
        wallTimeMs: 100_000 + index * 100,
      }),
      run("memi", index + 1, {
        tokens: 600 + index * 5,
        cost: 0.6,
        wallTimeMs: 60_000 + index * 50,
      }),
    ]).flat();

    const report = buildEfficiencyReport({
      suiteId: "ios-product-design-v1",
      runs,
      minimumPairs: 5,
      bootstrapSamples: 1_000,
      seed: 7,
      targetImprovement: 0.25,
    });

    expect(report.status).toBe("verified");
    expect(report.claim).toBe("verified_gt_25");
    expect(report.pairs.included).toBe(8);
    expect(report.metrics.tokenSavings.lower95).toBeGreaterThan(0.25);
    expect(report.metrics.latencySavings.lower95).toBeGreaterThan(0.25);
    expect(report.quality.passRateDelta).toBeGreaterThanOrEqual(-0.02);
  });

  it("refuses the claim when quality regresses even if token savings are large", () => {
    const baseline = run("baseline", 1, { tokens: 1_000, cost: 1, wallTimeMs: 100_000 });
    const memi = {
      ...run("memi", 1, { tokens: 400, cost: 0.4, wallTimeMs: 40_000 }),
      outcome: {
        accepted: false,
        testsPassed: false,
        qualityScore: 50,
        defects: 2,
        humanInterventions: 3,
      },
    };

    const report = buildEfficiencyReport({
      suiteId: "ios-product-design-v1",
      runs: [baseline, memi],
      minimumPairs: 1,
      bootstrapSamples: 100,
      seed: 7,
      targetImprovement: 0.25,
    });

    expect(report.status).toBe("verified");
    expect(report.claim).toBe("not_verified");
    expect(report.quality.passed).toBe(false);
  });

  it("excludes pairs whose model, harness, effort, or revision does not match", () => {
    const baseline = run("baseline", 1, { tokens: 1_000, cost: 1, wallTimeMs: 100_000 });
    const memi = {
      ...run("memi", 1, { tokens: 500, cost: 0.5, wallTimeMs: 50_000 }),
      harness: {
        id: "claude-code",
        modelId: "different-model",
        reasoningEffort: "medium",
      },
    };

    const report = buildEfficiencyReport({
      suiteId: "ios-product-design-v1",
      runs: [baseline, memi],
      minimumPairs: 1,
      bootstrapSamples: 100,
      seed: 7,
      targetImprovement: 0.25,
    });

    expect(report.status).toBe("insufficient_evidence");
    expect(report.pairs.included).toBe(0);
    expect(report.pairs.excluded[0].reason).toContain("harness");
  });

  it("uses an immutable grader amendment without double-counting its original run", () => {
    const original = {
      ...run("baseline", 1, {
        tokens: 1_000,
        cost: 1,
        wallTimeMs: 100_000,
      }),
      outcome: {
        accepted: false,
        testsPassed: false,
        qualityScore: 70,
        defects: 6,
        humanInterventions: 0,
      },
    };
    const amendment: BenchmarkRunRecord = {
      ...original,
      runId: `${original.runId}-regrade-source-citations-v2`,
      graderVersion: "source-citations-v2",
      amendsRunId: original.runId,
      outcome: {
        accepted: true,
        testsPassed: true,
        qualityScore: 100,
        defects: 0,
        humanInterventions: 0,
      },
      evidenceRefs: [...original.evidenceRefs, "sha256:regrade-receipt"],
    };
    const memi = run("memi", 1, {
      tokens: 600,
      cost: 0.6,
      wallTimeMs: 60_000,
    });

    const report = buildEfficiencyReport({
      suiteId: "ios-product-design-v1",
      runs: [original, amendment, memi],
      minimumPairs: 1,
      bootstrapSamples: 100,
      seed: 7,
      targetImprovement: 0.25,
    });

    expect(report.pairs.included).toBe(1);
    expect(report.pairs.excluded).toEqual([]);
    expect(report.quality.baselinePassRate).toBe(1);
    expect(report.quality.baselineDefects).toBe(0);
  });

  it("reports cost as unassessed when the harness exposes no price evidence", () => {
    const baseline = run("baseline", 1, {
      tokens: 1_000,
      cost: null,
      wallTimeMs: 100_000,
    });
    const memi = run("memi", 1, {
      tokens: 600,
      cost: null,
      wallTimeMs: 60_000,
    });

    const report = buildEfficiencyReport({
      suiteId: "ios-product-design-v1",
      runs: [baseline, memi],
      minimumPairs: 1,
      bootstrapSamples: 100,
      seed: 7,
      targetImprovement: 0.25,
    });

    expect(report.metrics.costSavings).toEqual({
      status: "unassessed",
      includedPairs: 0,
      reason: "No paired run exposed defensible USD cost evidence",
    });
  });

  it("pairs the same task and repeat independently for each provider harness", () => {
    const codexBaseline = run("baseline", 1, {
      tokens: 1_000,
      cost: null,
      wallTimeMs: 100_000,
    });
    const codexMemi = run("memi", 1, {
      tokens: 600,
      cost: null,
      wallTimeMs: 60_000,
    });
    const claudeBaseline = {
      ...run("baseline", 1, {
        tokens: 900,
        cost: 0.9,
        wallTimeMs: 90_000,
      }),
      runId: "claude-baseline-1",
      harness: {
        id: "claude",
        modelId: "claude-sonnet-4-6",
        reasoningEffort: "high",
      },
    };
    const claudeMemi = {
      ...run("memi", 1, {
        tokens: 500,
        cost: 0.5,
        wallTimeMs: 50_000,
      }),
      runId: "claude-memi-1",
      harness: {
        id: "claude",
        modelId: "claude-sonnet-4-6",
        reasoningEffort: "high",
      },
    };

    const report = buildEfficiencyReport({
      suiteId: "ios-product-design-v1",
      runs: [codexBaseline, codexMemi, claudeBaseline, claudeMemi],
      minimumPairs: 2,
      bootstrapSamples: 100,
      seed: 7,
      targetImprovement: 0.25,
    });

    expect(report.pairs.included).toBe(2);
    expect(report.pairs.excluded).toEqual([]);
  });
});

function run(
  condition: "baseline" | "memi",
  repeat: number,
  metrics: { tokens: number; cost: number | null; wallTimeMs: number },
): BenchmarkRunRecord {
  return {
    schemaVersion: 1,
    runId: `run-${condition}-${repeat}`,
    experimentId: "nate-efficiency-v1",
    suiteId: "ios-product-design-v1",
    taskId: "nate-design-audit",
    repeat,
    condition,
    repository: {
      pathHash: "sha256:repo",
      revision: "9cde918",
      dirty: false,
    },
    harness: {
      id: "codex",
      modelId: "gpt-5.6",
      reasoningEffort: "high",
    },
    timing: {
      startedAt: "2026-07-29T12:00:00.000Z",
      completedAt: "2026-07-29T12:01:00.000Z",
      wallTimeMs: metrics.wallTimeMs,
      toolTimeMs: Math.floor(metrics.wallTimeMs / 3),
    },
    usage: {
      inputTokens: metrics.tokens - 200,
      cachedInputTokens: 100,
      outputTokens: 150,
      reasoningTokens: 50,
      estimatedCostUsd: metrics.cost,
    },
    tools: {
      calls: condition === "baseline" ? 10 : 6,
      errors: 0,
      retries: 0,
    },
    outcome: {
      accepted: true,
      testsPassed: true,
      qualityScore: 95,
      defects: 0,
      humanInterventions: 0,
    },
    evidenceRefs: [`sha256:${condition}-${repeat}`],
  };
}
