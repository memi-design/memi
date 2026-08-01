import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendSkillFitnessEvent,
  assessSkillRouteFitness,
  createSkillFitnessQualityEvidence,
  type SkillFitnessEvent,
  type SkillFitnessRouteIdentity,
} from "../skill-fitness.js";

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
