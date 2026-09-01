import {
  constants,
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
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
  withSkillFitnessProcessQueue,
  type SkillFitnessEvent,
  type SkillFitnessRouteIdentity,
} from "../skill-fitness.js";
import {
  privateAppendFlags,
  requireStableLockPathIdentity,
  withSkillFitnessFileLock,
} from "../skill-fitness-lock.js";
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
  it("fails closed when a filesystem cannot expose stable lock identity", () => {
    expect(() => requireStableLockPathIdentity(0n, 0n)).toThrow(
      /stable filesystem identity/i,
    );
    expect(() => requireStableLockPathIdentity(1n, 0n)).toThrow(
      /stable filesystem identity/i,
    );
    expect(() => requireStableLockPathIdentity(0n, 1n)).not.toThrow();
  });

  it("omits unsupported O_NOFOLLOW on Windows secure appends", () => {
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    expect(privateAppendFlags("win32") & noFollow).toBe(0);
  });

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
    const fulfilled = writes.filter((result) => result.status === "fulfilled");
    const rejected = writes.filter((result) => result.status === "rejected");
    const rejectionReasons = rejected.map(({ reason }) =>
      reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason));

    expect(fulfilled, `concurrent write rejections: ${JSON.stringify(rejectionReasons)}`).toHaveLength(1);
    expect(rejected).toHaveLength(11);
    const content = await import("../skill-fitness.js").then(({ loadSkillFitnessEvents }) =>
      loadSkillFitnessEvents(store));
    expect(content).toHaveLength(1);
  });

  it("serializes same-process file-lock acquisition without filesystem polling races", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-fitness-process-queue-"));
    tempDirectories.push(root);
    const store = path.join(root, "skill-fitness.jsonl");
    let active = 0;
    let maximumActive = 0;
    const admissionOrder: number[] = [];

    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      withSkillFitnessProcessQueue(store, async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setImmediate(resolve));
        admissionOrder.push(index);
        active -= 1;
      })));

    expect(maximumActive).toBe(1);
    expect(admissionOrder).toEqual(Array.from({ length: 12 }, (_, index) => index));
  });

  it("collides process-queue keys reached through real and symlinked parent paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-fitness-process-alias-"));
    tempDirectories.push(root);
    const realParent = path.join(root, "real-parent");
    const aliasParent = path.join(root, "alias-parent");
    await mkdir(realParent);
    await symlink(realParent, aliasParent, process.platform === "win32" ? "junction" : "dir");
    let active = 0;
    let maximumActive = 0;

    await Promise.all([
      path.join(realParent, "future", "skill-fitness.jsonl"),
      path.join(aliasParent, "future", "skill-fitness.jsonl"),
    ].map((store) => withSkillFitnessProcessQueue(store, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
    })));

    expect(maximumActive).toBe(1);
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
    const mode = (await lstat(store)).mode & 0o777;
    if (process.platform !== "win32") expect(mode).toBe(0o600);
  });

  it("vacates an owned lock atomically before preserving unexpected cleanup entries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-fitness-release-"));
    tempDirectories.push(root);
    const store = path.join(root, "skill-fitness.jsonl");
    const lock = `${store}.lock`;
    const lockOptions = { lockWaitMs: 50, lockRetryMs: 5, staleLockMs: 30_000 };

    await expect(withSkillFitnessFileLock(store, lockOptions, async () => {
      await writeFile(path.join(lock, "unexpected-entry"), "preserve\n");
    })).rejects.toThrow();

    await expect(access(lock)).rejects.toMatchObject({ code: "ENOENT" });
    const releasedLocks = (await readdir(root))
      .filter((entry) => entry.startsWith("skill-fitness.jsonl.lock.released-"));
    expect(releasedLocks).toHaveLength(1);
    await expect(readFile(
      path.join(root, releasedLocks[0], "unexpected-entry"),
      "utf8",
    )).resolves.toBe("preserve\n");
    await expect(withSkillFitnessFileLock(store, lockOptions, async () => undefined))
      .resolves.toBeUndefined();
  });

  it("rejects a substituted canonical lock directory without deleting either identity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-fitness-substitution-"));
    tempDirectories.push(root);
    const store = path.join(root, "skill-fitness.jsonl");
    const lock = `${store}.lock`;
    const displacedLock = `${lock}.original`;

    await expect(withSkillFitnessFileLock(store, {}, async () => {
      const copiedOwner = await readFile(path.join(lock, "owner.json"), "utf8");
      await rename(lock, displacedLock);
      await mkdir(lock);
      await writeFile(path.join(lock, "owner.json"), copiedOwner);
    })).rejects.toThrow(/lock directory identity changed before release/i);

    await expect(readFile(path.join(lock, "owner.json"), "utf8")).resolves.toContain(
      '"schemaVersion":1',
    );
    await expect(readFile(path.join(displacedLock, "owner.json"), "utf8")).resolves.toContain(
      '"schemaVersion":1',
    );
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
