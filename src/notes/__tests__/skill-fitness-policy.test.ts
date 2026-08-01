import { describe, expect, it } from "vitest";
import {
  assessSkillRouteFitness,
  backtestSkillFitness,
  createSkillFitnessQualityEvidence,
  type SkillFitnessEvent,
  type SkillFitnessRouteIdentity,
} from "../skill-fitness.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

describe("history-aware fail-closed skill routing", () => {
  it("isolates evidence by the complete route identity", () => {
    const harmful = v1Event({
      eventId: "harmful",
      qualityParity: false,
    });
    const variants: readonly SkillFitnessRouteIdentity[] = [
      { ...identity(), taskClass: "swiftui-options-motion" },
      { ...identity(), repositoryFingerprintHash: HASH_C },
      { ...identity(), harness: { ...identity().harness, provider: "claude" } },
      { ...identity(), harness: { ...identity().harness, modelId: "gpt-5.6-sol" } },
      { ...identity(), harness: { ...identity().harness, reasoningEffort: "medium" } },
      { ...identity(), skills: [{ skillId: "expo-router-navigation", contentHash: HASH_C }] },
      { ...identity(), skills: [{ skillId: "swiftui-accessibility", contentHash: HASH_A }] },
    ];

    expect(assessSkillRouteFitness({
      events: [harmful],
      route: identity(),
    }).decision).toBe("repository-only");
    for (const route of variants) {
      expect(assessSkillRouteFitness({
        events: [harmful],
        route,
      })).toMatchObject({
        decision: "allow",
        matchingEvents: 0,
        state: "unobserved",
      });
    }
  });

  it("treats reordered multi-skill routes as the same exact route", () => {
    const skills = [
      { skillId: "expo-router-navigation", contentHash: HASH_A },
      { skillId: "mobile-accessibility", contentHash: HASH_C },
    ] as const;
    const harmful = v1Event({
      eventId: "multi-harmful",
      skills: [...skills].reverse(),
      qualityParity: false,
    });

    expect(assessSkillRouteFitness({
      events: [harmful],
      route: { ...identity(), skills },
    })).toMatchObject({
      decision: "repository-only",
      matchingEvents: 1,
      state: "suppressed",
    });
  });

  it("suppresses immediately on either quality or joint catastrophic regression", () => {
    const qualityRegression = v2Event({
      eventId: "quality-regression",
      baselineScore: 91,
      memiScore: 90,
    });
    const catastrophic = v2Event({
      eventId: "catastrophic",
      tokenSavingsRatio: -0.5,
      latencySavingsRatio: -0.25,
    });

    expect(assessSkillRouteFitness({
      events: [qualityRegression],
      route: identity(),
    })).toMatchObject({
      decision: "repository-only",
      state: "suppressed",
      reasons: ["quality-regression"],
    });
    expect(assessSkillRouteFitness({
      events: [catastrophic],
      route: identity(),
    })).toMatchObject({
      decision: "repository-only",
      state: "suppressed",
      reasons: ["catastrophic-efficiency-regression"],
    });
  });

  it("allows v1 negative evidence to suppress but never v1 positive evidence to recover", () => {
    const history = [
      v1Event({
        eventId: "legacy-negative",
        createdAt: "2026-07-20T00:00:00.000Z",
        qualityParity: false,
      }),
      ...Array.from({ length: 4 }, (_, index) => v1Event({
        eventId: `legacy-positive-${index}`,
        createdAt: `2026-07-21T0${index}:00:00.000Z`,
      })),
    ];

    expect(assessSkillRouteFitness({
      events: history,
      route: identity(),
    })).toMatchObject({
      decision: "repository-only",
      state: "suppressed",
      recoveryEvents: 0,
    });
  });

  it("requires three later healthy exact-match prospective v2 pairs for recovery", () => {
    const suppression = v2Event({
      eventId: "suppression",
      createdAt: "2026-07-20T00:00:00.000Z",
      baselineScore: 95,
      memiScore: 90,
    });
    const recoveries = Array.from({ length: 3 }, (_, index) => v2Event({
      eventId: `recovery-${index}`,
      createdAt: `2026-07-21T0${index}:00:00.000Z`,
      baselineScore: 90,
      memiScore: 92,
      prospective: true,
    }));
    const ineligible = v2Event({
      eventId: "non-prospective",
      createdAt: "2026-07-20T12:00:00.000Z",
      baselineScore: 90,
      memiScore: 92,
      prospective: false,
    });

    expect(assessSkillRouteFitness({
      events: [suppression, ineligible, ...recoveries.slice(0, 2)],
      route: identity(),
    })).toMatchObject({
      decision: "repository-only",
      recoveryEvents: 2,
    });
    expect(assessSkillRouteFitness({
      events: [suppression, ineligible, ...recoveries],
      route: identity(),
    })).toMatchObject({
      decision: "allow",
      state: "recovered",
      recoveryEvents: 3,
      reasons: ["three-prospective-healthy-pairs"],
    });
  });

  it("resets recovery progress when another harmful event arrives", () => {
    const events = [
      v2Event({
        eventId: "first-suppression",
        createdAt: "2026-07-20T00:00:00.000Z",
        baselineScore: 95,
        memiScore: 90,
      }),
      v2Event({
        eventId: "healthy-before-reset",
        createdAt: "2026-07-21T00:00:00.000Z",
        baselineScore: 90,
        memiScore: 92,
      }),
      v2Event({
        eventId: "second-suppression",
        createdAt: "2026-07-22T00:00:00.000Z",
        tokenSavingsRatio: -0.6,
        latencySavingsRatio: -0.3,
      }),
      v2Event({
        eventId: "healthy-after-reset",
        createdAt: "2026-07-23T00:00:00.000Z",
        baselineScore: 90,
        memiScore: 92,
      }),
    ];

    expect(assessSkillRouteFitness({ events, route: identity() })).toMatchObject({
      decision: "repository-only",
      recoveryEvents: 1,
      latestHarmfulEventId: "second-suppression",
    });
  });
});

describe("blinded quality evidence v2", () => {
  it("content-addresses the canonical quality payload", () => {
    const quality = createSkillFitnessQualityEvidence({
      pair: {
        baselineRunId: "baseline-1",
        memiRunId: "memi-1",
      },
      rubricVersion: "memi-design-quality-v1",
      blinded: true,
      graderCount: 3,
      baseline: { score: 90, criticalDefects: 0 },
      memi: { score: 92, criticalDefects: 0 },
    });

    expect(quality.evidenceSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(createSkillFitnessQualityEvidence({
      pair: quality.pair,
      rubricVersion: quality.rubricVersion,
      blinded: true,
      graderCount: quality.graderCount,
      baseline: quality.baseline,
      memi: quality.memi,
    })).toEqual(quality);
  });

  it("rejects unblinded, under-graded, invalid-score, and negative-defect evidence", () => {
    const base = {
      pair: { baselineRunId: "baseline-1", memiRunId: "memi-1" },
      rubricVersion: "memi-design-quality-v1",
      blinded: true as const,
      graderCount: 3,
      baseline: { score: 90, criticalDefects: 0 },
      memi: { score: 92, criticalDefects: 0 },
    };

    expect(() => createSkillFitnessQualityEvidence({
      ...base,
      blinded: false as true,
    })).toThrow();
    expect(() => createSkillFitnessQualityEvidence({ ...base, graderCount: 2 })).toThrow();
    expect(() => createSkillFitnessQualityEvidence({
      ...base,
      memi: { score: 101, criticalDefects: 0 },
    })).toThrow();
    expect(() => createSkillFitnessQualityEvidence({
      ...base,
      memi: { score: 92, criticalDefects: -1 },
    })).toThrow();
  });
});

describe("chronological fitness backtest", () => {
  it("replays without look-ahead and honors an inclusive as-of cutoff", () => {
    const events = [
      v2Event({
        eventId: "harmful",
        createdAt: "2026-07-20T00:00:00.000Z",
        baselineScore: 95,
        memiScore: 90,
      }),
      ...Array.from({ length: 3 }, (_, index) => v2Event({
        eventId: `healthy-${index}`,
        createdAt: `2026-07-21T0${index}:00:00.000Z`,
        baselineScore: 90,
        memiScore: 92,
      })),
    ];
    const early = backtestSkillFitness({
      events,
      asOf: "2026-07-21T01:00:00.000Z",
    });
    const complete = backtestSkillFitness({
      events,
      asOf: "2026-07-21T02:00:00.000Z",
    });

    expect(early).toMatchObject({
      schemaVersion: 1,
      eventsAvailable: 4,
      eventsReplayed: 3,
      routes: [{
        finalDecision: "repository-only",
        finalState: "suppressed",
        timeline: [
          { eventId: "harmful", decisionAfter: "repository-only" },
          { eventId: "healthy-0", recoveryEventsAfter: 1 },
          { eventId: "healthy-1", recoveryEventsAfter: 2 },
        ],
      }],
    });
    expect(complete.routes[0]).toMatchObject({
      finalDecision: "allow",
      finalState: "recovered",
      timeline: [
        { eventId: "harmful" },
        { eventId: "healthy-0" },
        { eventId: "healthy-1" },
        { eventId: "healthy-2", decisionAfter: "allow" },
      ],
    });
    expect(early.routes[0]?.timeline).toEqual(complete.routes[0]?.timeline.slice(0, 3));
  });

  it("returns routes and events in deterministic identity/time order", () => {
    const other = v1Event({
      eventId: "a-other-route",
      taskClass: "paraform-command-menu",
      createdAt: "2026-07-22T00:00:00.000Z",
    });
    const first = v1Event({
      eventId: "z-first-route",
      createdAt: "2026-07-21T00:00:00.000Z",
    });
    const forward = backtestSkillFitness({ events: [other, first] });
    const reverse = backtestSkillFitness({ events: [first, other] });

    expect(reverse).toEqual(forward);
    expect(forward.routes.map((route) => route.identity.taskClass)).toEqual([
      "expo-bottom-tab-badge",
      "paraform-command-menu",
    ]);
  });
});

function identity(): SkillFitnessRouteIdentity {
  return {
    routerVersion: "skill-router-v2",
    repositoryFingerprintHash: HASH_B,
    taskClass: "expo-bottom-tab-badge",
    harness: {
      provider: "codex",
      modelId: "gpt-5.6-luna",
      reasoningEffort: "low",
    },
    skills: [{
      skillId: "expo-router-navigation",
      contentHash: HASH_A,
    }],
  };
}

function v1Event(overrides: Partial<SkillFitnessEvent> = {}): SkillFitnessEvent {
  return {
    schemaVersion: 1,
    eventId: "legacy-event",
    createdAt: "2026-07-29T00:00:00.000Z",
    ...identity(),
    pair: {
      baselineRunId: "baseline-legacy",
      memiRunId: "memi-legacy",
    },
    qualityParity: true,
    tokenSavingsRatio: 0.2,
    latencySavingsRatio: 0.1,
    toolCallSavingsRatio: 0.1,
    ...overrides,
  } as SkillFitnessEvent;
}

function v2Event(input: {
  readonly eventId: string;
  readonly createdAt?: string;
  readonly baselineScore?: number;
  readonly memiScore?: number;
  readonly baselineCriticalDefects?: number;
  readonly memiCriticalDefects?: number;
  readonly tokenSavingsRatio?: number;
  readonly latencySavingsRatio?: number;
  readonly prospective?: boolean;
}): SkillFitnessEvent {
  const baselineRunId = `baseline-${input.eventId}`;
  const memiRunId = `memi-${input.eventId}`;
  const qualityEvidence = createSkillFitnessQualityEvidence({
    pair: { baselineRunId, memiRunId },
    rubricVersion: "memi-design-quality-v1",
    blinded: true,
    graderCount: 3,
    baseline: {
      score: input.baselineScore ?? 90,
      criticalDefects: input.baselineCriticalDefects ?? 0,
    },
    memi: {
      score: input.memiScore ?? 90,
      criticalDefects: input.memiCriticalDefects ?? 0,
    },
  });
  return {
    schemaVersion: 2,
    eventId: input.eventId,
    createdAt: input.createdAt ?? "2026-07-29T00:00:00.000Z",
    ...identity(),
    pair: { baselineRunId, memiRunId },
    qualityEvidence,
    prospective: input.prospective === false
      ? null
      : {
        freezeHash: HASH_C,
        baselineTrialId: `trial-baseline-${input.eventId}`,
        memiTrialId: `trial-memi-${input.eventId}`,
      },
    tokenSavingsRatio: input.tokenSavingsRatio ?? 0.2,
    latencySavingsRatio: input.latencySavingsRatio ?? 0.1,
    toolCallSavingsRatio: 0.1,
  } as SkillFitnessEvent;
}
