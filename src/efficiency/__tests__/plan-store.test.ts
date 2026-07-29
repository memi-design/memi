import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPairedBenchmarkPlan } from "../plan.js";
import { EfficiencyRunStore } from "../store.js";
import type { BenchmarkRunRecord } from "../contracts.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("paired benchmark plan and store", () => {
  it("creates a deterministic balanced order for every task and repeat", () => {
    const input = {
      suiteId: "ios-product-design-v1",
      experimentId: "nate-efficiency-v1",
      seed: 42,
      repeats: 3,
      tasks: [
        { id: "audit", intent: "Audit product design" },
        { id: "tokens", intent: "Find design-token drift" },
      ],
    };

    const first = createPairedBenchmarkPlan(input);
    const second = createPairedBenchmarkPlan(input);

    expect(first).toEqual(second);
    expect(first.trials).toHaveLength(12);
    for (const taskId of ["audit", "tokens"]) {
      for (const repeat of [1, 2, 3]) {
        expect(first.trials.filter((trial) => trial.taskId === taskId && trial.repeat === repeat)
          .map((trial) => trial.condition)
          .sort()).toEqual(["baseline", "memi"]);
      }
    }
  });

  it("persists validated metadata-only runs as append-only JSONL and deduplicates run IDs", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-efficiency-store-"));
    roots.push(root);
    const store = new EfficiencyRunStore(root);
    const record = sampleRun();

    await store.append(record);
    await expect(store.append(record)).rejects.toThrow("already exists");
    expect(await store.list()).toEqual([record]);

    const raw = await readFile(join(root, ".memoire", "efficiency", "runs.jsonl"), "utf-8");
    expect(raw.trim().split("\n")).toHaveLength(1);
    expect(raw).not.toContain("prompt");
  });
});

function sampleRun(): BenchmarkRunRecord {
  return {
    schemaVersion: 1,
    runId: "run-1",
    experimentId: "nate-efficiency-v1",
    suiteId: "ios-product-design-v1",
    taskId: "audit",
    repeat: 1,
    condition: "baseline",
    repository: { pathHash: "sha256:repo", revision: "9cde918", dirty: false },
    harness: { id: "codex", modelId: "gpt-5.6", reasoningEffort: "high" },
    timing: {
      startedAt: "2026-07-29T12:00:00.000Z",
      completedAt: "2026-07-29T12:01:00.000Z",
      wallTimeMs: 60_000,
      toolTimeMs: 10_000,
    },
    usage: {
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 30,
      reasoningTokens: 10,
      estimatedCostUsd: 0.1,
    },
    tools: { calls: 2, errors: 0, retries: 0 },
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
