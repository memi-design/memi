import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendSkillFitnessEvent,
  assessSkillRouteFitness,
  buildSkillFitnessEvent,
  createSkillFitnessQualityEvidence,
  type SkillFitnessEvent,
  type SkillFitnessRouteIdentity,
} from "../skill-fitness.js";
import type { BenchmarkRunRecord } from "../../efficiency/contracts.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("skill fitness empirical identity security", () => {
  it("rejects a second event for the same exact-route run pair despite a new event and quality hash", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-fitness-pair-security-"));
    tempDirectories.push(root);
    const store = path.join(root, "skill-fitness.jsonl");
    const first = event({ eventId: "first", baselineScore: 90, memiScore: 92 });
    const rewritten = event({
      eventId: "rewritten",
      baselineScore: 80,
      memiScore: 99,
    });

    await appendSkillFitnessEvent(store, first);
    await expect(appendSkillFitnessEvent(store, rewritten)).rejects.toThrow(
      /duplicate exact-route empirical pair/i,
    );
    expect(() => assessSkillRouteFitness({
      events: [first, rewritten],
      route: identity(),
    })).toThrow(/duplicate exact-route empirical pair/i);
  });

  it("rejects reused prospective trial identities even when run ids are changed", async () => {
    const first = event({ eventId: "first" });
    const rewritten = event({
      eventId: "rewritten",
      baselineRunId: "different-baseline-run",
      memiRunId: "different-memi-run",
    });

    expect(() => assessSkillRouteFitness({
      events: [first, rewritten],
      route: identity(),
    })).toThrow(/duplicate exact-route prospective pair/i);
  });

  it("content-addresses the prospective execution mode in generated v2 event ids", () => {
    const baseline = run("baseline");
    const memi = run("memi");
    const qualityEvidence = createSkillFitnessQualityEvidence({
      pair: { baselineRunId: baseline.runId, memiRunId: memi.runId },
      rubricVersion: "memi-design-quality-v1",
      blinded: true,
      graderCount: 3,
      baseline: { score: 90, criticalDefects: 0 },
      memi: { score: 92, criticalDefects: 0 },
    });
    const common = {
      baseline,
      memi,
      route: {
        routerVersion: "skill-router-v2",
        repositoryFingerprintHash: HASH_B,
        selected: [{ id: "atomic-design", contentHash: HASH_A }],
      },
      taskClass: "web-design-repair",
      qualityEvidence,
    } as const;

    const production = buildSkillFitnessEvent({
      ...common,
      evidenceMode: "production",
    });
    const recoveryProbe = buildSkillFitnessEvent({
      ...common,
      evidenceMode: "recovery-probe",
    });

    expect(production.eventId).not.toBe(recoveryProbe.eventId);
  });

  it("serializes concurrent writers and admits an exact-route pair only once", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-fitness-lock-race-"));
    tempDirectories.push(root);
    const store = path.join(root, "skill-fitness.jsonl");
    const writes = await Promise.allSettled(Array.from({ length: 12 }, (_, index) =>
      appendSkillFitnessEvent(store, event({
        eventId: `concurrent-${index}`,
        baselineScore: 80 + index,
        memiScore: 92,
      }))));

    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((result) => result.status === "rejected")).toHaveLength(11);
    const content = await import("../skill-fitness.js").then(({ loadSkillFitnessEvents }) =>
      loadSkillFitnessEvents(store));
    expect(content).toHaveLength(1);
  });

  it("recovers only an old dead-owner lock and preserves private permissions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-fitness-stale-lock-"));
    tempDirectories.push(root);
    const store = path.join(root, "skill-fitness.jsonl");
    const lock = `${store}.lock`;
    await mkdir(lock, { mode: 0o700 });
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({
      schemaVersion: 1,
      token: "stale-owner",
      pid: 2_147_483_647,
      createdAt: "2000-01-01T00:00:00.000Z",
    }), { mode: 0o600 });

    await appendSkillFitnessEvent(store, event({ eventId: "after-stale" }), {
      lockWaitMs: 250,
      lockRetryMs: 5,
      staleLockMs: 10,
    });

    await expect(access(lock)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await lstat(store)).mode & 0o777).toBe(0o600);
  });

  it("fails closed on a symlinked lock without touching its target", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-fitness-symlink-lock-"));
    tempDirectories.push(root);
    const store = path.join(root, "skill-fitness.jsonl");
    const target = path.join(root, "attacker-target");
    await mkdir(target);
    await writeFile(path.join(target, "sentinel"), "keep");
    await symlink(target, `${store}.lock`);

    await expect(appendSkillFitnessEvent(store, event({ eventId: "blocked" }), {
      lockWaitMs: 50,
      lockRetryMs: 5,
      staleLockMs: 10,
    })).rejects.toThrow(/lock.*non-symlink/i);
    await expect(access(path.join(target, "sentinel"))).resolves.toBeUndefined();
  });

  it("bounds waiting for a live lock owner", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-fitness-live-lock-"));
    tempDirectories.push(root);
    const store = path.join(root, "skill-fitness.jsonl");
    const lock = `${store}.lock`;
    await mkdir(lock, { mode: 0o700 });
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({
      schemaVersion: 1,
      token: "live-owner",
      pid: process.pid,
      createdAt: "2000-01-01T00:00:00.000Z",
    }), { mode: 0o600 });
    const startedAt = Date.now();

    await expect(appendSkillFitnessEvent(store, event({ eventId: "times-out" }), {
      lockWaitMs: 40,
      lockRetryMs: 5,
      staleLockMs: 1,
    })).rejects.toThrow(/timed out waiting for skill fitness lock/i);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});

function identity(): SkillFitnessRouteIdentity {
  return {
    routerVersion: "skill-router-v2",
    repositoryFingerprintHash: HASH_B,
    taskClass: "web-design-repair",
    harness: {
      provider: "codex",
      modelId: "gpt-5.6-luna",
      reasoningEffort: "low",
    },
    skills: [{ skillId: "atomic-design", contentHash: HASH_A }],
  };
}

function event(input: {
  readonly eventId: string;
  readonly baselineRunId?: string;
  readonly memiRunId?: string;
  readonly baselineScore?: number;
  readonly memiScore?: number;
}): SkillFitnessEvent {
  const baselineRunId = input.baselineRunId ?? "baseline-run";
  const memiRunId = input.memiRunId ?? "memi-run";
  const qualityEvidence = createSkillFitnessQualityEvidence({
    pair: { baselineRunId, memiRunId },
    rubricVersion: "memi-design-quality-v1",
    blinded: true,
    graderCount: 3,
    baseline: { score: input.baselineScore ?? 90, criticalDefects: 0 },
    memi: { score: input.memiScore ?? 92, criticalDefects: 0 },
  });
  return {
    schemaVersion: 2,
    eventId: input.eventId,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...identity(),
    pair: { baselineRunId, memiRunId },
    tokenSavingsRatio: 0.2,
    latencySavingsRatio: 0.1,
    toolCallSavingsRatio: 0.1,
    functionalAcceptance: true,
    qualityEvidence,
    prospective: {
      freezeHash: HASH_C,
      baselineTrialId: "study:task:r1:baseline",
      memiTrialId: "study:task:r1:memi",
    },
  } as SkillFitnessEvent;
}

function run(condition: "baseline" | "memi"): BenchmarkRunRecord {
  return {
    schemaVersion: 1,
    runId: `${condition}-sealed-run`,
    experimentId: "fitness-security-v1",
    suiteId: "fitness-security-v1",
    taskId: "web-design-repair",
    repeat: 1,
    condition,
    repository: { pathHash: HASH_C, revision: "abc123", dirty: false },
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
    prospective: {
      planHash: HASH_A,
      freezeHash: HASH_B,
      candidateArtifactSha256: HASH_C,
      taskManifestSha256: HASH_A,
      evidenceManifestSha256: HASH_B,
      trialId: `study:task:r1:${condition}`,
      sequence: condition === "baseline" ? 1 : 2,
    },
  };
}
