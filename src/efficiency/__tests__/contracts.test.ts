import { describe, expect, it } from "vitest";
import {
  benchmarkRunRecordSchema,
  benchmarkSuiteSchema,
} from "../contracts.js";

describe("efficiency contracts", () => {
  it("accepts a metadata-only paired benchmark run", () => {
    const run = benchmarkRunRecordSchema.parse({
      schemaVersion: 1,
      runId: "run-baseline-1",
      experimentId: "nate-efficiency-v1",
      suiteId: "ios-product-design-v1",
      taskId: "nate-design-audit",
      repeat: 1,
      condition: "baseline",
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
        wallTimeMs: 60_000,
        toolTimeMs: 20_000,
      },
      usage: {
        inputTokens: 1_000,
        cachedInputTokens: 400,
        outputTokens: 200,
        reasoningTokens: 100,
        estimatedCostUsd: 0.15,
      },
      tools: {
        calls: 8,
        errors: 0,
        retries: 0,
      },
      outcome: {
        accepted: true,
        testsPassed: true,
        qualityScore: 91,
        defects: 0,
        humanInterventions: 1,
      },
      evidenceRefs: ["sha256:trace", "sha256:result"],
    });

    expect(run.condition).toBe("baseline");
    expect(run.usage.cachedInputTokens).toBe(400);
    expect(JSON.stringify(run)).not.toContain("prompt");
  });

  it("rejects raw prompts and source content at the durable boundary", () => {
    const result = benchmarkRunRecordSchema.safeParse({
      schemaVersion: 1,
      runId: "run-unsafe",
      experimentId: "exp",
      suiteId: "suite",
      taskId: "task",
      repeat: 1,
      condition: "memi",
      repository: { pathHash: "sha256:repo", revision: "abc", dirty: false },
      harness: { id: "codex", modelId: "gpt", reasoningEffort: "high" },
      timing: {
        startedAt: "2026-07-29T12:00:00.000Z",
        completedAt: "2026-07-29T12:01:00.000Z",
        wallTimeMs: 60_000,
        toolTimeMs: 20_000,
      },
      usage: {
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        reasoningTokens: 0,
        estimatedCostUsd: 0,
      },
      tools: { calls: 1, errors: 0, retries: 0 },
      outcome: {
        accepted: true,
        testsPassed: true,
        qualityScore: 100,
        defects: 0,
        humanInterventions: 0,
      },
      evidenceRefs: [],
      prompt: "private product request",
    });

    expect(result.success).toBe(false);
  });

  it("requires both baseline and Memi conditions in a benchmark suite", () => {
    const result = benchmarkSuiteSchema.safeParse({
      schemaVersion: 1,
      suiteId: "ios-product-design-v1",
      experimentId: "nate-efficiency-v1",
      seed: 42,
      repeats: 3,
      conditions: ["baseline"],
      tasks: [{ id: "audit", intent: "Audit product design" }],
    });

    expect(result.success).toBe(false);
  });
});
