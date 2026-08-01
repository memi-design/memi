import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerBenchmarkCommand } from "../benchmark.js";
import type { BenchmarkRunRecord } from "../../efficiency/contracts.js";
import {
  createEvidenceManifest,
  EVIDENCE_MANIFEST_HASH_PLACEHOLDER,
} from "../../efficiency/prospective-files.js";
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
    const { baseline, memi, routePath } = await boundProspectiveRouteFixture(1);
    await recordRuns(program, baseline, memi);

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

  it("binds fitness evidence to an explicit stable task class distinct from task id", async () => {
    const program = new Command();
    program.exitOverride();
    registerBenchmarkCommand(program, engine() as never);
    const { baseline, memi, routePath } = await boundProspectiveRouteFixture(6, {
      taskClass: "web-checkout-repair",
    });
    await recordRuns(program, baseline, memi);

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
      "web-checkout-repair",
      "--store-root",
      projectRoot,
      "--json",
    ], { from: "user" });
    expect(JSON.parse(lastLog(logs))).toMatchObject({
      event: { taskClass: "web-checkout-repair" },
    });

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
      "different-task-class",
      "--store-root",
      projectRoot,
      "--json",
    ], { from: "user" })).rejects.toThrow(/bound route task class mismatch/);
  });

  it("records hash-verified v2 quality evidence and emits a stable no-look-ahead backtest", async () => {
    const program = new Command();
    program.exitOverride();
    registerBenchmarkCommand(program, engine() as never);
    const qualityPath = join(projectRoot, "quality-evidence.json");
    const { baseline, memi, routePath } = await boundProspectiveRouteFixture(2);
    await recordRuns(program, baseline, memi);
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

  it("rejects an unsealed route and pair before considering route binding", async () => {
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
    ], { from: "user" })).rejects.toThrow(/manifest-sealed prospective evidence/);
  });

  it("imports an exact raw 2.7.3 route through its prospective evidence manifest", async () => {
    const program = new Command();
    program.exitOverride();
    registerBenchmarkCommand(program, engine() as never);
    const fixture = await rawProspectiveRouteFixture(5);
    await recordRuns(program, fixture.baseline, fixture.memi);

    const logs = captureLogs();
    await program.parseAsync([
      "benchmark",
      "fitness-record",
      "--baseline",
      fixture.baseline.runId,
      "--memi",
      fixture.memi.runId,
      "--route",
      fixture.routePath,
      "--task-class",
      fixture.memi.taskId,
      "--store-root",
      projectRoot,
      "--json",
    ], { from: "user" });

    expect(JSON.parse(lastLog(logs))).toMatchObject({
      status: "recorded",
      event: {
        pair: {
          baselineRunId: fixture.baseline.runId,
          memiRunId: fixture.memi.runId,
        },
        skills: [{
          skillId: "atomic-design",
          contentHash: `sha256:${"a".repeat(64)}`,
        }],
      },
    });
  });

  it("rejects raw 2.7.3 route tampering not represented by the sealed route artifact", async () => {
    const program = new Command();
    program.exitOverride();
    registerBenchmarkCommand(program, engine() as never);
    const fixture = await rawProspectiveRouteFixture(6);
    await recordRuns(program, fixture.baseline, fixture.memi);
    await writeFile(fixture.routePath, JSON.stringify({
      ...fixture.rawRoute,
      route: {
        ...fixture.rawRoute.route,
        selected: [{
          ...fixture.rawRoute.route.selected[0],
          contentHash: `sha256:${"f".repeat(64)}`,
        }],
      },
    }));

    await expect(recordRawFitness(program, fixture)).rejects.toThrow(
      /raw route does not match the manifest-sealed route artifact/,
    );
  });

  it("rejects a prospective raw route supplied through a symlink", async () => {
    const program = new Command();
    program.exitOverride();
    registerBenchmarkCommand(program, engine() as never);
    const fixture = await rawProspectiveRouteFixture(9);
    await recordRuns(program, fixture.baseline, fixture.memi);
    const targetPath = join(projectRoot, "raw-route-target.json");
    await writeFile(targetPath, JSON.stringify(fixture.rawRoute));
    await rm(fixture.routePath);
    await symlink(targetPath, fixture.routePath);

    await expect(recordRawFitness(program, fixture)).rejects.toThrow(
      /route receipt must be a regular non-symlink file/,
    );
  });

  it("rejects manifest tampering and an evidence run outside the route directory", async () => {
    const program = new Command();
    program.exitOverride();
    registerBenchmarkCommand(program, engine() as never);
    const tampered = await rawProspectiveRouteFixture(7);
    await recordRuns(program, tampered.baseline, tampered.memi);
    await writeFile(tampered.routeArtifactPath, JSON.stringify({
      condition: "memi",
      route: { ...tampered.rawRoute, contextBytes: 999 },
    }));
    await expect(recordRawFitness(program, tampered)).rejects.toThrow(
      /artifact-hash-mismatch:route\.json/,
    );

    const escaped = await rawProspectiveRouteFixture(8);
    const foreignDirectory = join(projectRoot, "foreign-evidence");
    const foreignRunPath = join(foreignDirectory, "run.json");
    await mkdir(foreignDirectory, { recursive: true });
    await writeFile(foreignRunPath, JSON.stringify(escaped.memi));
    const escapedMemi = {
      ...escaped.memi,
      evidenceRefs: escaped.memi.evidenceRefs.map((reference) =>
        reference === escaped.runPath ? foreignRunPath : reference),
    };
    await recordRuns(program, escaped.baseline, escapedMemi);
    await expect(recordRawFitness(program, {
      ...escaped,
      memi: escapedMemi,
    })).rejects.toThrow(/prospective evidence must be sibling artifacts/);
  });

  it("validates bound v2 receipt metadata even without quality evidence", async () => {
    const program = new Command();
    program.exitOverride();
    registerBenchmarkCommand(program, engine() as never);
    const { baseline, memi, routePath } = await boundProspectiveRouteFixture(4, {
      runId: "wrong-run",
    });
    await recordRuns(program, baseline, memi);

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

async function boundProspectiveRouteFixture(
  repeat: number,
  overrides: {
    readonly runId?: string;
    readonly taskClass?: string;
  } = {},
) {
  const baselineDirectory = join(projectRoot, `bound-route-${repeat}-baseline`);
  const memiDirectory = join(projectRoot, `bound-route-${repeat}-memi`);
  const routePath = join(memiDirectory, "skill-route.json");
  await Promise.all([
    mkdir(baselineDirectory, { recursive: true }),
    mkdir(memiDirectory, { recursive: true }),
  ]);
  const repository = {
    pathHash: `sha256:${"c".repeat(64)}`,
    revision: "9cde918",
    dirty: false,
  };
  const baselineBase = { ...run("baseline", repeat, 1_000, 100_000), repository };
  const memiBase = { ...run("memi", repeat, 500, 50_000), repository };
  await writeFile(routePath, JSON.stringify({
    schemaVersion: 2,
    runId: overrides.runId ?? memiBase.runId,
    taskId: memiBase.taskId,
    ...(overrides.taskClass ? { taskClass: overrides.taskClass } : {}),
    executionMode: "production",
    repeat: memiBase.repeat,
    repository: {
      pathHash: memiBase.repository.pathHash,
      revision: memiBase.repository.revision,
    },
    harness: {
      provider: memiBase.harness.id,
      modelId: memiBase.harness.modelId,
      reasoningEffort: memiBase.harness.reasoningEffort,
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
  const baseline = await sealProspectiveRun(
    baselineBase,
    baselineDirectory,
    [],
    repeat * 2 - 1,
  );
  const memi = await sealProspectiveRun(
    memiBase,
    memiDirectory,
    [routePath],
    repeat * 2,
  );
  return { baseline, memi, routePath };
}

async function sealProspectiveRun(
  record: BenchmarkRunRecord,
  evidenceDirectory: string,
  artifactPaths: readonly string[],
  sequence: number,
): Promise<BenchmarkRunRecord> {
  await mkdir(evidenceDirectory, { recursive: true });
  const runPath = join(evidenceDirectory, "run.json");
  const manifestPath = join(evidenceDirectory, "evidence-manifest.json");
  let sealed = {
    ...record,
    evidenceRefs: [manifestPath, runPath, ...artifactPaths],
    prospective: {
      planHash: `sha256:${"1".repeat(64)}`,
      freezeHash: `sha256:${"2".repeat(64)}`,
      candidateArtifactSha256: `sha256:${"3".repeat(64)}`,
      taskManifestSha256: `sha256:${"4".repeat(64)}`,
      evidenceManifestSha256: EVIDENCE_MANIFEST_HASH_PLACEHOLDER,
      trialId: `v15:${record.taskId}:r${record.repeat}:${record.condition}`,
      sequence,
    },
  } satisfies BenchmarkRunRecord;
  await writeFile(runPath, JSON.stringify(sealed));
  const manifest = await createEvidenceManifest({
    evidenceDirectory,
    trialId: sealed.prospective.trialId,
    artifactNames: ["run.json", ...artifactPaths.map((entry) => basename(entry))],
  });
  sealed = {
    ...sealed,
    prospective: {
      ...sealed.prospective,
      evidenceManifestSha256: manifest.manifestSha256,
    },
  };
  await writeFile(runPath, JSON.stringify(sealed));
  return sealed;
}

async function rawProspectiveRouteFixture(repeat: number) {
  const evidenceDirectory = join(projectRoot, `raw-route-${repeat}`);
  const routePath = join(evidenceDirectory, "skill-route.json");
  const routeArtifactPath = join(evidenceDirectory, "route.json");
  const manifestPath = join(evidenceDirectory, "evidence-manifest.json");
  const runPath = join(evidenceDirectory, "run.json");
  await mkdir(evidenceDirectory, { recursive: true });
  const rawRoute = {
    route: {
      schemaVersion: 2,
      routerVersion: "skill-router-v2",
      decision: "single",
      intentHash: `sha256:${"d".repeat(64)}`,
      repositoryFingerprintHash: `sha256:${"b".repeat(64)}`,
      selected: [{
        id: "atomic-design",
        skillName: "Atomic Design",
        file: "/candidate/skills/ATOMIC_DESIGN.md",
        score: 11,
        matchedTerms: ["component", "design"],
        contentHash: `sha256:${"a".repeat(64)}`,
        contextBytes: 2_900,
      }],
      excluded: [],
      candidates: [],
      contextBytes: 2_900,
      maximumContextBytes: 4_096,
    },
    skills: [{
      noteId: "atomic-design",
      skillName: "Atomic Design",
      file: "/candidate/skills/ATOMIC_DESIGN.md",
      content: "# Atomic Design",
      activateOn: "component-creation",
      freedomLevel: "reference",
    }],
    resources: [],
    contextBytes: 2_900,
  };
  const repository = {
    pathHash: `sha256:${"c".repeat(64)}`,
    revision: "9cde918",
    dirty: false,
  };
  const baselineBase = { ...run("baseline", repeat, 1_000, 100_000), repository };
  let memi = {
    ...run("memi", repeat, 500, 50_000),
    repository,
    evidenceRefs: [routePath, routeArtifactPath, manifestPath, runPath],
    prospective: {
      planHash: `sha256:${"1".repeat(64)}`,
      freezeHash: `sha256:${"2".repeat(64)}`,
      candidateArtifactSha256: `sha256:${"3".repeat(64)}`,
      taskManifestSha256: `sha256:${"4".repeat(64)}`,
      evidenceManifestSha256: EVIDENCE_MANIFEST_HASH_PLACEHOLDER,
      trialId: `v15:audit:r${repeat}:memi`,
      sequence: repeat * 2,
    },
  } satisfies BenchmarkRunRecord;
  await writeFile(routePath, JSON.stringify(rawRoute));
  await writeFile(routeArtifactPath, JSON.stringify({
    condition: "memi",
    route: rawRoute,
  }));
  await writeFile(runPath, JSON.stringify(memi));
  const manifest = await createEvidenceManifest({
    evidenceDirectory,
    trialId: memi.prospective.trialId,
    artifactNames: ["route.json", "run.json"],
  });
  memi = {
    ...memi,
    prospective: {
      ...memi.prospective,
      evidenceManifestSha256: manifest.manifestSha256,
    },
  };
  await writeFile(runPath, JSON.stringify(memi));
  const baseline = await sealProspectiveRun(
    baselineBase,
    join(projectRoot, `raw-route-${repeat}-baseline`),
    [],
    repeat * 2 - 1,
  );
  return {
    baseline,
    memi,
    rawRoute,
    routePath,
    routeArtifactPath,
    runPath,
  };
}

async function recordRuns(
  program: Command,
  ...records: readonly BenchmarkRunRecord[]
): Promise<void> {
  for (const record of records) {
    const path = join(projectRoot, `stored-${record.runId}.json`);
    await writeFile(path, JSON.stringify(record));
    await program.parseAsync(["benchmark", "record", path, "--json"], { from: "user" });
  }
}

async function recordRawFitness(
  program: Command,
  fixture: Awaited<ReturnType<typeof rawProspectiveRouteFixture>>,
): Promise<void> {
  await program.parseAsync([
    "benchmark",
    "fitness-record",
    "--baseline",
    fixture.baseline.runId,
    "--memi",
    fixture.memi.runId,
    "--route",
    fixture.routePath,
    "--task-class",
    fixture.memi.taskId,
    "--store-root",
    projectRoot,
    "--json",
  ], { from: "user" });
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
