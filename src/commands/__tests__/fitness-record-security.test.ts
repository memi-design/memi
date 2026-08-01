import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BenchmarkRunRecord } from "../../efficiency/contracts.js";
import { EfficiencyRunStore } from "../../efficiency/store.js";
import { registerBenchmarkCommand } from "../benchmark.js";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "memi-fitness-ingest-security-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("fitness-record evidence trust boundary", () => {
  it("rejects self-authored stored runs and a bound-v2 route without prospective manifests", async () => {
    const routePath = path.join(projectRoot, "skill-route.json");
    const baseline = run("baseline");
    const memi = { ...run("memi"), evidenceRefs: [routePath] };
    const store = new EfficiencyRunStore(projectRoot);
    await store.append(baseline);
    await store.append(memi);
    await writeFile(routePath, JSON.stringify({
      schemaVersion: 2,
      runId: memi.runId,
      taskId: memi.taskId,
      repeat: memi.repeat,
      repository: {
        pathHash: memi.repository.pathHash,
        revision: memi.repository.revision,
      },
      harness: {
        provider: memi.harness.id,
        modelId: memi.harness.modelId,
        reasoningEffort: memi.harness.reasoningEffort,
      },
      route: {
        routerVersion: "skill-router-v2",
        repositoryFingerprintHash: `sha256:${"b".repeat(64)}`,
        selected: [{
          id: "atomic-design",
          contentHash: `sha256:${"a".repeat(64)}`,
        }],
      },
    }));
    const program = new Command();
    program.exitOverride();
    registerBenchmarkCommand(program, {
      config: { projectRoot },
      async init() {},
    } as never);

    await expect(program.parseAsync([
      "benchmark",
      "fitness-record",
      "--baseline",
      baseline.runId,
      "--memi",
      memi.runId,
      "--route",
      routePath,
      "--task-class",
      memi.taskId,
      "--store-root",
      projectRoot,
      "--json",
    ], { from: "user" })).rejects.toThrow(/manifest-sealed prospective evidence/i);
  });
});

function run(condition: "baseline" | "memi"): BenchmarkRunRecord {
  return {
    schemaVersion: 1,
    runId: `unsealed-${condition}`,
    experimentId: "fitness-security-v1",
    suiteId: "fitness-security-v1",
    taskId: "web-design-repair",
    repeat: 1,
    condition,
    repository: {
      pathHash: `sha256:${"c".repeat(64)}`,
      revision: "abc123",
      dirty: false,
    },
    harness: { id: "codex", modelId: "gpt-5.6-luna", reasoningEffort: "low" },
    timing: {
      startedAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:01:00.000Z",
      wallTimeMs: condition === "baseline" ? 60_000 : 50_000,
      toolTimeMs: 10_000,
    },
    usage: {
      inputTokens: condition === "baseline" ? 1_000 : 800,
      cachedInputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 100,
      estimatedCostUsd: null,
    },
    tools: { calls: 10, errors: 0, retries: 0 },
    outcome: {
      accepted: true,
      testsPassed: true,
      qualityScore: 90,
      defects: 0,
      humanInterventions: 0,
    },
    evidenceRefs: [],
  };
}
