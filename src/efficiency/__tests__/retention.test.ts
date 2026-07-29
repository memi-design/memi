import { describe, expect, it } from "vitest";
import type { BenchmarkRunRecord } from "../contracts.js";
import { calculateAdoptionMetrics } from "../retention.js";

describe("efficiency retention metrics", () => {
  it("tracks successful first audits, repeat projects, and CI reuse instead of npm fetches", () => {
    const runs = [
      run("project-a", "2026-07-01T00:00:00.000Z", "interactive"),
      run("project-a", "2026-07-10T00:00:00.000Z", "interactive"),
      run("project-a", "2026-07-12T00:00:00.000Z", "ci"),
      run("project-b", "2026-07-02T00:00:00.000Z", "interactive"),
    ];

    expect(calculateAdoptionMetrics(runs)).toMatchObject({
      successfulFirstAudits: 2,
      repeatAuditProjects: 1,
      ciReuseProjects: 1,
      repeatRate: 0.5,
    });
  });
});

function run(
  project: string,
  completedAt: string,
  invocation: "interactive" | "ci",
): BenchmarkRunRecord {
  return {
    schemaVersion: 1,
    runId: `${project}-${completedAt}`,
    experimentId: "adoption",
    suiteId: "audit-retention",
    taskId: "audit",
    repeat: 1,
    condition: "memi",
    invocation,
    repository: { pathHash: `sha256:${project}`, revision: "abc", dirty: false },
    harness: { id: "codex", modelId: "gpt", reasoningEffort: "high" },
    timing: {
      startedAt: completedAt,
      completedAt,
      wallTimeMs: 1,
      toolTimeMs: 1,
    },
    usage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 0,
    },
    tools: { calls: 0, errors: 0, retries: 0 },
    outcome: {
      accepted: true,
      testsPassed: true,
      qualityScore: 90,
      defects: 0,
      humanInterventions: 0,
    },
    evidenceRefs: ["sha256:evidence"],
  };
}
