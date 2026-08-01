import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerBenchmarkCommand } from "../benchmark.js";
import type { BenchmarkRunRecord } from "../../efficiency/contracts.js";
import { createSkillFitnessQualityEvidence } from "../../notes/skill-fitness.js";
import { captureLogs, lastLog } from "./test-helpers.js";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "memi-benchmark-command-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("benchmark command", () => {
  it("creates a deterministic paired plan", async () => {
    const tasksPath = join(projectRoot, "tasks.json");
    const outPath = join(projectRoot, "plan.json");
    await writeFile(tasksPath, JSON.stringify([
      { id: "audit", intent: "Audit Nate product design" },
      { id: "tokens", intent: "Find token drift" },
    ]));
    const logs = captureLogs();
    const program = new Command();
    registerBenchmarkCommand(program, engine() as never);

    await program.parseAsync([
      "benchmark",
      "plan",
      tasksPath,
      "--suite",
      "ios-product-design-v1",
      "--experiment",
      "nate-efficiency-v1",
      "--repeats",
      "3",
      "--seed",
      "42",
      "--out",
      outPath,
      "--json",
    ], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload.status).toBe("planned");
    expect(payload.plan.trials).toHaveLength(12);
    await expect(readFile(outPath, "utf-8")).resolves.toContain("nate-efficiency-v1");
  });

  it("records runs and reports an evidence-qualified result", async () => {
    const program = new Command();
    registerBenchmarkCommand(program, engine() as never);
    for (const record of [
      run("baseline", 1, 1_000, 100_000),
      run("memi", 1, 500, 50_000),
    ]) {
      const path = join(projectRoot, `${record.runId}.json`);
      await writeFile(path, JSON.stringify(record));
      await program.parseAsync(["benchmark", "record", path, "--json"], { from: "user" });
    }

    const logs = captureLogs();
    await program.parseAsync([
      "benchmark",
      "report",
      "--suite",
      "ios-product-design-v1",
      "--minimum-pairs",
      "1",
      "--bootstrap-samples",
      "100",
      "--json",
    ], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload.report).toMatchObject({
      status: "verified",
      claim: "verified_gt_25",
      pairs: { included: 1 },
    });
  });

  it("records and projects routed skill fitness from an exact paired run", async () => {
    const program = new Command();
    registerBenchmarkCommand(program, engine() as never);
    const routePath = join(projectRoot, "skill-route.json");
    const repository = {
      pathHash: `sha256:${"c".repeat(64)}`,
      revision: "9cde918",
      dirty: false,
    };
    const baseline = { ...run("baseline", 1, 1_000, 100_000), repository };
    const memi = {
      ...run("memi", 1, 500, 50_000),
      repository,
      evidenceRefs: [routePath],
    };
    for (const record of [baseline, memi]) {
      const path = join(projectRoot, `${record.runId}.json`);
      await writeFile(path, JSON.stringify(record));
      await program.parseAsync(["benchmark", "record", path, "--json"], { from: "user" });
    }
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
        schemaVersion: 2,
        routerVersion: "skill-router-v2",
        decision: "single",
        intentHash: `sha256:${"d".repeat(64)}`,
        repositoryFingerprintHash: `sha256:${"b".repeat(64)}`,
        selected: [{
          id: "expo-router-navigation",
          skillName: "expo-router-navigation",
          file: "/skills/expo-router-navigation/SKILL.md",
          score: 120,
          matchedTerms: ["bottom-tab-badge"],
          contentHash: `sha256:${"a".repeat(64)}`,
          contextBytes: 1_920,
          explanation: {
            intentEvidence: ["bottom-tab-badge"],
            repositoryEvidence: ["dependency:expo-router"],
          },
        }],
        excluded: [],
        candidates: [],
        contextBytes: 1_920,
        maximumContextBytes: 8_000,
      },
    }));

    const logs = captureLogs();
    await program.parseAsync([
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
    ], { from: "user" });
    expect(JSON.parse(lastLog(logs))).toMatchObject({
      status: "recorded",
      event: {
        pair: {
          baselineRunId: baseline.runId,
          memiRunId: memi.runId,
        },
        tokenSavingsRatio: 0.5,
      },
      projection: {
        events: 1,
        skills: [{
          skillId: "expo-router-navigation",
          recommendation: "observe",
        }],
      },
    });

    await program.parseAsync([
      "benchmark",
      "fitness",
      "--store-root",
      projectRoot,
      "--json",
    ], { from: "user" });
    expect(JSON.parse(lastLog(logs)).projection.events).toBe(1);
  });

  it("records hash-verified v2 quality evidence and emits a stable no-look-ahead backtest", async () => {
    const program = new Command();
    program.exitOverride();
    registerBenchmarkCommand(program, engine() as never);
    const routePath = join(projectRoot, "bound-skill-route.json");
    const qualityPath = join(projectRoot, "quality-evidence.json");
    const repositoryPathHash = `sha256:${"c".repeat(64)}`;
    const baseline = {
      ...run("baseline", 2, 1_000, 100_000),
      repository: {
        pathHash: repositoryPathHash,
        revision: "9cde918",
        dirty: false,
      },
    };
    const memi = {
      ...run("memi", 2, 500, 50_000),
      repository: {
        pathHash: repositoryPathHash,
        revision: "9cde918",
        dirty: false,
      },
      evidenceRefs: [routePath],
    };
    for (const record of [baseline, memi]) {
      const path = join(projectRoot, `${record.runId}.json`);
      await writeFile(path, JSON.stringify(record));
      await program.parseAsync(["benchmark", "record", path, "--json"], { from: "user" });
    }
    const route = {
      routerVersion: "skill-router-v2",
      repositoryFingerprintHash: `sha256:${"b".repeat(64)}`,
      selected: [{
        id: "expo-router-navigation",
        contentHash: `sha256:${"a".repeat(64)}`,
      }],
    };
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
      route,
    }));
    await writeFile(qualityPath, JSON.stringify(createSkillFitnessQualityEvidence({
      pair: {
        baselineRunId: baseline.runId,
        memiRunId: memi.runId,
      },
      rubricVersion: "memi-design-quality-v1",
      blinded: true,
      graderCount: 3,
      baseline: { score: 90, criticalDefects: 0 },
      memi: { score: 92, criticalDefects: 0 },
    })));

    const logs = captureLogs();
    await program.parseAsync([
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
      "--quality-evidence",
      qualityPath,
      "--store-root",
      projectRoot,
      "--json",
    ], { from: "user" });
    expect(JSON.parse(lastLog(logs))).toMatchObject({
      status: "recorded",
      event: {
        schemaVersion: 2,
        qualityEvidence: {
          rubricVersion: "memi-design-quality-v1",
          graderCount: 3,
          evidenceSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
      },
    });

    await program.parseAsync([
      "benchmark",
      "fitness-backtest",
      "--store-root",
      projectRoot,
      "--as-of",
      memi.timing.completedAt,
      "--json",
    ], { from: "user" });
    const first = lastLog(logs);
    await program.parseAsync([
      "benchmark",
      "fitness-backtest",
      "--store-root",
      projectRoot,
      "--as-of",
      memi.timing.completedAt,
      "--json",
    ], { from: "user" });
    expect(lastLog(logs)).toBe(first);
    expect(JSON.parse(first)).toMatchObject({
      status: "backtested",
      backtest: {
        eventsAvailable: 1,
        eventsReplayed: 1,
        routes: [{ finalDecision: "allow", finalState: "healthy" }],
      },
    });
  });

  it("rejects a route receipt that is not bound to the selected Memi run", async () => {
    const program = new Command();
    program.exitOverride();
    registerBenchmarkCommand(program, engine() as never);
    const routePath = join(projectRoot, "unbound-route.json");
    const baseline = run("baseline", 3, 1_000, 100_000);
    const memi = {
      ...run("memi", 3, 500, 50_000),
      evidenceRefs: [routePath],
    };
    for (const record of [baseline, memi]) {
      const path = join(projectRoot, `${record.runId}.json`);
      await writeFile(path, JSON.stringify(record));
      await program.parseAsync(["benchmark", "record", path, "--json"], { from: "user" });
    }
    await writeFile(routePath, JSON.stringify({
      routerVersion: "skill-router-v2",
      repositoryFingerprintHash: `sha256:${"b".repeat(64)}`,
      selected: [{
        id: "expo-router-navigation",
        contentHash: `sha256:${"a".repeat(64)}`,
      }],
    }));

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
    ], { from: "user" })).rejects.toThrow(/requires a bound v2 route receipt/);
  });

  it("validates bound v2 receipt metadata even without quality evidence", async () => {
    const program = new Command();
    program.exitOverride();
    registerBenchmarkCommand(program, engine() as never);
    const routePath = join(projectRoot, "stale-bound-route.json");
    const baseline = run("baseline", 4, 1_000, 100_000);
    const memi = {
      ...run("memi", 4, 500, 50_000),
      evidenceRefs: [routePath],
    };
    for (const record of [baseline, memi]) {
      const path = join(projectRoot, `${record.runId}.json`);
      await writeFile(path, JSON.stringify(record));
      await program.parseAsync(["benchmark", "record", path, "--json"], { from: "user" });
    }
    await writeFile(routePath, JSON.stringify({
      schemaVersion: 2,
      runId: "wrong-run",
      taskId: memi.taskId,
      repeat: memi.repeat,
      repository: {
        pathHash: `sha256:${"c".repeat(64)}`,
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
          id: "expo-router-navigation",
          contentHash: `sha256:${"a".repeat(64)}`,
        }],
      },
    }));

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
    ], { from: "user" })).rejects.toThrow(/bound route run id mismatch/);
  });

  it("creates a deterministic multi-provider workflow plan", async () => {
    const taskPath = join(projectRoot, "workflow-task.json");
    const outPath = join(projectRoot, "workflow-plan.json");
    await writeFile(taskPath, JSON.stringify(workflowTask()));
    const logs = captureLogs();
    const program = new Command();
    registerBenchmarkCommand(program, engine() as never);

    await program.parseAsync([
      "benchmark",
      "workflow-plan",
      taskPath,
      "--suite",
      "product-flow-v1",
      "--experiment",
      "checkout-flow",
      "--providers",
      "codex,claude",
      "--repeats",
      "3",
      "--out",
      outPath,
      "--json",
    ], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload.status).toBe("planned");
    expect(payload.plan.trials).toHaveLength(12);
    expect(payload.plan.providers).toEqual(["codex", "claude"]);
  });

  it("refuses to invoke a workflow provider without explicit execution consent", async () => {
    const taskPath = join(projectRoot, "workflow-task.json");
    await writeFile(taskPath, JSON.stringify(workflowTask()));
    const program = new Command();
    program.exitOverride();
    registerBenchmarkCommand(program, engine() as never);

    await expect(program.parseAsync([
      "benchmark",
      "workflow-run",
      taskPath,
      "--condition",
      "baseline",
      "--provider",
      "codex",
      "--repository",
      projectRoot,
      "--evidence-root",
      join(projectRoot, "evidence"),
      "--store-root",
      join(projectRoot, "store"),
      "--suite",
      "product-flow-v1",
      "--experiment",
      "checkout-flow",
      "--repeat",
      "1",
    ], { from: "user" })).rejects.toThrow(
      "workflow-run requires --execute",
    );
  });

  it("freezes the prospective 40-point study before any scored run", async () => {
    const planPath = join(projectRoot, "empirical-40-plan.json");
    const environmentPath = join(projectRoot, "environment.json");
    const artifactPath = join(projectRoot, "memi-2.7.1.tgz");
    const taskRoot = join(projectRoot, "tasks");
    const outPath = join(projectRoot, "freeze.json");
    const plan = prospectivePlan();
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(taskRoot, { recursive: true }));
    await writeFile(planPath, JSON.stringify(plan));
    await writeFile(environmentPath, JSON.stringify({
      machine: "test-mac",
      os: "macOS 26.0",
      arch: "arm64",
      node: "v22.22.3",
      xcode: "26.6",
      simulator: "iPhone 17 / iOS 26.5",
      workspaceVolume: "external-ssd",
      temporaryRoot: "/Volumes/External/evidence/tmp",
    }));
    await writeFile(artifactPath, "candidate");
    for (const task of plan.tasks) {
      await writeFile(join(taskRoot, `${task.id}.json`), JSON.stringify({
        id: task.id,
      }));
    }
    const logs = captureLogs();
    const program = new Command();
    registerBenchmarkCommand(program, engine() as never);

    await program.parseAsync([
      "benchmark",
      "prospective-freeze",
      planPath,
      "--candidate-artifact",
      artifactPath,
      "--candidate-version",
      "2.7.1",
      "--candidate-revision",
      "d".repeat(40),
      "--candidate-source-hash",
      `sha256:${"e".repeat(64)}`,
      "--candidate-source-state",
      "content-addressed-dirty-snapshot",
      "--candidate-dirty-files",
      "12",
      "--environment",
      environmentPath,
      "--task-root",
      taskRoot,
      "--out",
      outPath,
      "--frozen-at",
      "2026-07-30T12:00:00.000Z",
      "--json",
    ], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload.status).toBe("frozen");
    expect(payload.freeze.freezeHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(payload.freeze.candidate.version).toBe("2.7.1");
    expect(payload.freeze.trials).toHaveLength(18);
    expect(payload.path).toBe(outPath);
  });
});

function engine() {
  return {
    config: { projectRoot },
    async init() {},
  };
}

function run(
  condition: "baseline" | "memi",
  repeat: number,
  tokens: number,
  wallTimeMs: number,
): BenchmarkRunRecord {
  return {
    schemaVersion: 1,
    runId: `run-${condition}-${repeat}`,
    experimentId: "nate-efficiency-v1",
    suiteId: "ios-product-design-v1",
    taskId: "audit",
    repeat,
    condition,
    repository: { pathHash: "sha256:repo", revision: "9cde918", dirty: false },
    harness: { id: "codex", modelId: "gpt-5.6", reasoningEffort: "high" },
    timing: {
      startedAt: "2026-07-29T12:00:00.000Z",
      completedAt: "2026-07-29T12:01:00.000Z",
      wallTimeMs,
      toolTimeMs: 10_000,
    },
    usage: {
      inputTokens: tokens - 200,
      cachedInputTokens: 100,
      outputTokens: 150,
      reasoningTokens: 50,
      estimatedCostUsd: condition === "baseline" ? 1 : 0.5,
    },
    tools: { calls: condition === "baseline" ? 10 : 5, errors: 0, retries: 0 },
    outcome: {
      accepted: true,
      testsPassed: true,
      qualityScore: 95,
      defects: 0,
      humanInterventions: 0,
    },
    evidenceRefs: [`sha256:${condition}`],
  };
}

function workflowTask() {
  return {
    schemaVersion: 1,
    id: "checkout-flow",
    intent: "Repair and verify the complete rendered checkout flow",
    maximumDurationMs: 10 * 60_000,
    steps: ["inspect", "implement", "build", "launch", "verify"],
    preparation: [],
    fixtures: [],
    verification: [
      {
        kind: "build",
        command: "npm",
        args: ["run", "build"],
        timeoutMs: 300_000,
      },
      {
        kind: "rendered-flow",
        command: "npm",
        args: ["run", "test:e2e"],
        timeoutMs: 600_000,
      },
    ],
    requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
  };
}

function prospectivePlan() {
  const tasks = [
    ["expo-task", "react-native-expo", "a"],
    ["swift-task", "native-swiftui", "b"],
    ["web-task", "web-design-engineering", "c"],
  ].map(([id, platformFamily, revision]) => ({
    id,
    platformFamily,
    revision: revision.repeat(40),
    pairs: 3,
    interimCredit: 2,
    risk: "representative risk",
  }));
  return {
    schemaVersion: 1,
    planId: "memi-2.7-empirical-readiness-40",
    status: "draft",
    currentScore: 29,
    targetScore: 40,
    claimBoundary: "Interim evidence milestone only.",
    scoreBudget: [
      { dimension: "existing-evidence", currentCredit: 29, targetCredit: 29 },
      {
        dimension: "prospective-registration",
        currentCredit: 0,
        targetCredit: 5,
        unlock: "Frozen before runs",
      },
      {
        dimension: "independent-repeats",
        currentCredit: 0,
        targetCredit: 6,
        maximumCredit: 12,
        unlock: "Three platforms pass",
      },
    ],
    tasks,
    runContract: {
      seed: 41,
      matchedPairs: 9,
      trials: 18,
      conditions: ["baseline", "memi"],
      freshClonePerTrial: true,
      counterbalancedOrder: true,
      requiredArtifacts: [
        "git.patch",
        "events.jsonl",
        "verification.json",
        "environment.json",
        "run.json",
      ],
      acceptance: {
        requiredValidPairsPerTask: 3,
        requiredPassingPairsPerTask: 3,
        fixtureMutationAllowed: false,
        providerErrorAllowed: false,
        missingOrDuplicateConditionAllowed: false,
        postPatchIsolatedVerificationRequired: true,
      },
    },
    creditPolicy: {
      planningEarnsCredit: false,
      manualCreditEditsAllowed: false,
      prospectiveRegistrationCredit: "all-or-none",
      independentRepeatInterimCreditPerQualifiedPlatform: 2,
      independentRepeatInterimCreditCap: 6,
      fullRepeatCreditRequiresAllReleaseCriticalTasks: true,
    },
  };
}
