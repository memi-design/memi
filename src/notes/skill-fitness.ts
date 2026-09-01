import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BenchmarkRunRecord } from "../efficiency/contracts.js";
import { appendPrivateLine, withSkillFitnessFileLock, type SkillFitnessLockOptions } from "./skill-fitness-lock.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ratioSchema = z.number().finite().min(-100).max(1);
const timestampSchema = z.string().datetime();
const skillIdentitySchema = z.object({
  skillId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  contentHash: sha256Schema,
}).strict();
const harnessIdentitySchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  reasoningEffort: z.string().min(1),
}).strict();
const pairSchema = z.object({
  baselineRunId: z.string().min(1),
  memiRunId: z.string().min(1),
}).strict();

export const SkillFitnessRouteSchema = z.object({
  routerVersion: z.string().min(1),
  repositoryFingerprintHash: sha256Schema.nullable(),
  selected: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    contentHash: sha256Schema,
  }).passthrough()).min(1).max(4),
}).passthrough();
export type SkillFitnessRoute = z.infer<typeof SkillFitnessRouteSchema>;

export const SkillFitnessRouteReceiptSchema = z.union([
  SkillFitnessRouteSchema,
  z.object({ route: SkillFitnessRouteSchema }).passthrough()
    .transform((receipt) => receipt.route),
]);

export const SkillFitnessBoundRouteReceiptSchema = z.object({
  schemaVersion: z.literal(2),
  runId: z.string().min(1),
  taskId: z.string().min(1),
  taskClass: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
  executionMode: z.enum(["production", "recovery-probe"]).optional(),
  repeat: z.number().int().positive(),
  repository: z.object({
    pathHash: sha256Schema,
    revision: z.string().min(1),
  }).strict(),
  harness: harnessIdentitySchema,
  route: SkillFitnessRouteSchema,
}).strict();
export type SkillFitnessBoundRouteReceipt = z.infer<typeof SkillFitnessBoundRouteReceiptSchema>;

export const SkillFitnessRouteIdentitySchema = z.object({
  routerVersion: z.string().min(1),
  repositoryFingerprintHash: sha256Schema,
  taskClass: z.string().regex(/^[a-z][a-z0-9-]*$/),
  harness: harnessIdentitySchema,
  skills: z.array(skillIdentitySchema).min(1).max(4),
}).strict();
export type SkillFitnessRouteIdentity = z.infer<typeof SkillFitnessRouteIdentitySchema>;

const qualityOutcomeSchema = z.object({
  score: z.number().finite().min(0).max(100),
  criticalDefects: z.number().int().nonnegative(),
}).strict();

export const SkillFitnessQualityEvidencePayloadSchema = z.object({
  pair: pairSchema,
  rubricVersion: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  blinded: z.literal(true),
  graderCount: z.number().int().min(3).max(20),
  baseline: qualityOutcomeSchema,
  memi: qualityOutcomeSchema,
}).strict();
export type SkillFitnessQualityEvidencePayload = z.infer<typeof SkillFitnessQualityEvidencePayloadSchema>;

export const SkillFitnessQualityEvidenceSchema = SkillFitnessQualityEvidencePayloadSchema
  .extend({ evidenceSha256: sha256Schema })
  .strict()
  .superRefine((evidence, context) => {
    const { evidenceSha256: _ignored, ...payload } = evidence;
    const expected = hashCanonical(payload);
    if (evidence.evidenceSha256 !== expected) {
      context.addIssue({
        code: "custom",
        path: ["evidenceSha256"],
        message: `quality evidence hash mismatch; expected ${expected}`,
      });
    }
  });
export type SkillFitnessQualityEvidence = z.infer<typeof SkillFitnessQualityEvidenceSchema>;

const sharedEventShape = {
  eventId: z.string().regex(/^[a-z0-9][a-z0-9:_-]*$/),
  createdAt: timestampSchema,
  routerVersion: z.string().min(1),
  repositoryFingerprintHash: sha256Schema,
  taskClass: z.string().regex(/^[a-z][a-z0-9-]*$/),
  harness: harnessIdentitySchema,
  pair: pairSchema,
  skills: z.array(skillIdentitySchema).min(1).max(4),
  tokenSavingsRatio: ratioSchema,
  latencySavingsRatio: ratioSchema,
  toolCallSavingsRatio: ratioSchema,
} as const;

export const SkillFitnessEventV1Schema = z.object({
  schemaVersion: z.literal(1),
  ...sharedEventShape,
  qualityParity: z.boolean(),
}).strict();

const prospectivePairSchema = z.object({
  freezeHash: sha256Schema,
  baselineTrialId: z.string().min(1),
  memiTrialId: z.string().min(1),
}).strict();

export const SkillFitnessEventV2Schema = z.object({
  schemaVersion: z.literal(2),
  ...sharedEventShape,
  functionalAcceptance: z.boolean(),
  qualityEvidence: SkillFitnessQualityEvidenceSchema,
  prospective: prospectivePairSchema.nullable(),
  evidenceMode: z.enum(["production", "recovery-probe"]).optional(),
}).strict().superRefine((event, context) => {
  if (event.qualityEvidence.pair.baselineRunId !== event.pair.baselineRunId) {
    context.addIssue({
      code: "custom",
      path: ["qualityEvidence", "pair", "baselineRunId"],
      message: "quality evidence baseline run id mismatch",
    });
  }
  if (event.qualityEvidence.pair.memiRunId !== event.pair.memiRunId) {
    context.addIssue({
      code: "custom",
      path: ["qualityEvidence", "pair", "memiRunId"],
      message: "quality evidence Memi run id mismatch",
    });
  }
});

export const SkillFitnessEventSchema = z.union([
  SkillFitnessEventV1Schema,
  SkillFitnessEventV2Schema,
]);
export type SkillFitnessEvent = z.infer<typeof SkillFitnessEventSchema>;

export interface SkillFitnessProjection {
  readonly schemaVersion: 1;
  readonly events: number;
  readonly skills: readonly {
    readonly skillId: string;
    readonly contentHash: string;
    readonly samples: number;
    readonly qualityParityRate: number;
    readonly medianTokenSavingsRatio: number;
    readonly medianLatencySavingsRatio: number;
    readonly medianToolCallSavingsRatio: number;
    readonly recommendation: "promote" | "observe" | "quarantine";
  }[];
}

export interface SkillRouteFitnessAssessment {
  readonly decision: "allow" | "repository-only";
  readonly state: "unobserved" | "healthy" | "suppressed" | "recovered";
  readonly matchingEvents: number;
  readonly recoveryEvents: number;
  readonly reasons: readonly string[];
  readonly latestHarmfulEventId: string | null;
}

export interface SkillFitnessBacktest {
  readonly schemaVersion: 1;
  readonly asOf: string | null;
  readonly eventsAvailable: number;
  readonly eventsReplayed: number;
  readonly routes: readonly {
    readonly routeKey: string;
    readonly identity: SkillFitnessRouteIdentity;
    readonly finalDecision: SkillRouteFitnessAssessment["decision"];
    readonly finalState: SkillRouteFitnessAssessment["state"];
    readonly timeline: readonly {
      readonly eventId: string;
      readonly createdAt: string;
      readonly schemaVersion: 1 | 2;
      readonly decisionAfter: SkillRouteFitnessAssessment["decision"];
      readonly stateAfter: SkillRouteFitnessAssessment["state"];
      readonly recoveryEventsAfter: number;
      readonly reasonsAfter: readonly string[];
    }[];
  }[];
}

export interface BuildSkillFitnessEventInput {
  readonly baseline: BenchmarkRunRecord;
  readonly memi: BenchmarkRunRecord;
  readonly route: SkillFitnessRoute;
  readonly taskClass: string;
  readonly qualityEvidence?: SkillFitnessQualityEvidence;
  readonly evidenceMode?: "production" | "recovery-probe";
}

const skillFitnessProcessQueues = new Map<string, Promise<void>>();

export function createSkillFitnessQualityEvidence(
  input: SkillFitnessQualityEvidencePayload,
): Readonly<SkillFitnessQualityEvidence> {
  const payload = SkillFitnessQualityEvidencePayloadSchema.parse(input);
  return deepFreeze(SkillFitnessQualityEvidenceSchema.parse({
    ...payload,
    evidenceSha256: hashCanonical(payload),
  }));
}

export function buildSkillFitnessEvent(
  input: BuildSkillFitnessEventInput,
): Readonly<SkillFitnessEvent> {
  const route = SkillFitnessRouteSchema.parse(input.route);
  validatePair(input.baseline, input.memi);
  if (!route.repositoryFingerprintHash) {
    throw new Error("skill route is missing a repository fingerprint hash");
  }
  const skills = canonicalSkills(route.selected.map(({ id, contentHash }) => ({
    skillId: id,
    contentHash,
  })));
  const common = {
    createdAt: laterTimestamp(
      input.baseline.timing.completedAt,
      input.memi.timing.completedAt,
    ),
    routerVersion: route.routerVersion,
    repositoryFingerprintHash: route.repositoryFingerprintHash,
    taskClass: input.taskClass,
    harness: {
      provider: input.memi.harness.id,
      modelId: input.memi.harness.modelId,
      reasoningEffort: input.memi.harness.reasoningEffort,
    },
    pair: {
      baselineRunId: input.baseline.runId,
      memiRunId: input.memi.runId,
    },
    skills,
    tokenSavingsRatio: saving(totalTokens(input.baseline), totalTokens(input.memi)),
    latencySavingsRatio: saving(
      input.baseline.timing.wallTimeMs,
      input.memi.timing.wallTimeMs,
    ),
    toolCallSavingsRatio: saving(input.baseline.tools.calls, input.memi.tools.calls),
  };
  if (!input.qualityEvidence) {
    return deepFreeze(SkillFitnessEventV1Schema.parse({
      schemaVersion: 1,
      eventId: fitnessEventId({ schemaVersion: 1, ...common }),
      ...common,
      qualityParity: automatedQualityParity(input.baseline, input.memi),
    }));
  }
  const qualityEvidence = SkillFitnessQualityEvidenceSchema.parse(input.qualityEvidence);
  validateQualityEvidencePair(qualityEvidence, input.baseline, input.memi);
  const prospective = prospectivePair(input.baseline, input.memi);
  const evidenceMode = input.evidenceMode ?? "production";
  return deepFreeze(SkillFitnessEventV2Schema.parse({
    schemaVersion: 2,
    eventId: fitnessEventId({
      schemaVersion: 2,
      ...common,
      qualityEvidenceSha256: qualityEvidence.evidenceSha256,
      prospective,
      evidenceMode,
    }),
    ...common,
    functionalAcceptance: passed(input.baseline) && passed(input.memi),
    qualityEvidence,
    prospective,
    evidenceMode,
  }));
}

export function resolveSkillRouteExecutionMode(input: {
  readonly assessment: SkillRouteFitnessAssessment;
  readonly recoveryProbe: boolean;
  readonly prospective: boolean;
}): "production" | "repository-only" | "recovery-probe" {
  if (!input.recoveryProbe) {
    return input.assessment.decision === "repository-only"
      ? "repository-only"
      : "production";
  }
  if (input.assessment.decision !== "repository-only") {
    throw new Error("recovery probe requires an exact route that is currently suppressed");
  }
  if (!input.prospective) {
    throw new Error("recovery probe requires a prospective freeze and frozen trial");
  }
  return "recovery-probe";
}

export async function appendSkillFitnessEvent(
  file: string,
  input: SkillFitnessEvent,
  options: SkillFitnessLockOptions = {},
): Promise<void> {
  const event = SkillFitnessEventSchema.parse(input);
  await withSkillFitnessProcessQueue(file, async () => {
    await withSkillFitnessFileLock(file, options, async () => {
      const existing = await loadSkillFitnessEvents(file);
      if (existing.some((candidate) => candidate.eventId === event.eventId)) {
        throw new Error(`Skill fitness event ${event.eventId} already exists`);
      }
      assertUniqueRouteEvidence([...existing, event]);
      await appendPrivateLine(file, `${JSON.stringify(event)}\n`);
    });
  });
}

export async function withSkillFitnessProcessQueue<T>(
  file: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = skillFitnessProcessQueueKey(file);
  const predecessor = skillFitnessProcessQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const tail = predecessor.then(() => gate);
  skillFitnessProcessQueues.set(key, tail);

  await predecessor;
  try {
    return await operation();
  } finally {
    release();
    if (skillFitnessProcessQueues.get(key) === tail) {
      skillFitnessProcessQueues.delete(key);
    }
  }
}

function skillFitnessProcessQueueKey(file: string): string {
  const absoluteFile = path.resolve(file);
  const absoluteParent = path.dirname(absoluteFile);
  const canonicalParent = canonicalizePotentialParent(absoluteParent);
  const canonicalFile = path.join(canonicalParent, path.basename(absoluteFile));
  return process.platform === "win32" ? canonicalFile.toLowerCase() : canonicalFile;
}

function canonicalizePotentialParent(absoluteParent: string): string {
  const missingSegments: string[] = [];
  let cursor = absoluteParent;
  for (;;) {
    try {
      return path.join(realpathSync.native(cursor), ...missingSegments);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) return absoluteParent;
      missingSegments.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

export async function loadSkillFitnessEvents(
  file: string,
  options: { readonly maxBytes?: number } = {},
): Promise<readonly SkillFitnessEvent[]> {
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer");
  }
  const metadata = await lstat(file).catch((error: unknown) => {
    if (isMissingFile(error)) return null;
    throw error;
  });
  if (!metadata) return Object.freeze([]);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("skill fitness store must be a regular non-symlink file");
  }
  if (metadata.size > maxBytes) {
    throw new Error(`skill fitness store exceeds the ${maxBytes}-byte safety limit`);
  }
  const content = await readFile(file, "utf8");
  if (!content.trim()) return Object.freeze([]);
  const events = content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return SkillFitnessEventSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `Invalid skill fitness event at line ${index + 1}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    });
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.eventId)) {
      throw new Error(`Duplicate skill fitness event ${event.eventId}`);
    }
    ids.add(event.eventId);
  }
  assertUniqueRouteEvidence(events);
  return deepFreeze(events);
}

export function assessSkillRouteFitness(input: {
  readonly events: readonly SkillFitnessEvent[];
  readonly route: SkillFitnessRouteIdentity;
  readonly asOf?: string;
}): Readonly<SkillRouteFitnessAssessment> {
  const route = canonicalRouteIdentity(input.route);
  const asOf = normalizeAsOf(input.asOf);
  const routeKey = skillFitnessRouteKey(route);
  const events = input.events.map((event) => SkillFitnessEventSchema.parse(event));
  assertUniqueRouteEvidence(events);
  const matching = events
    .filter((event) => skillFitnessRouteKey(routeIdentityFromEvent(event)) === routeKey)
    .filter((event) => !asOf || timestampMillis(event.createdAt) <= timestampMillis(asOf))
    .sort(compareEvents);
  let state: SkillRouteFitnessAssessment["state"] = matching.length === 0
    ? "unobserved"
    : "healthy";
  let recoveryEvents = 0;
  let latestHarmfulEventId: string | null = null;
  let reasons: readonly string[] = [];
  for (const event of matching) {
    const harmfulReasons = eventHarmReasons(event);
    if (harmfulReasons.length > 0) {
      state = "suppressed";
      recoveryEvents = 0;
      latestHarmfulEventId = event.eventId;
      reasons = harmfulReasons;
      continue;
    }
    if (state === "suppressed" && isRecoveryEligible(event)) {
      recoveryEvents += 1;
      if (recoveryEvents >= 3) {
        state = "recovered";
        reasons = ["three-prospective-healthy-pairs"];
      }
    }
  }
  return deepFreeze({
    decision: state === "suppressed" ? "repository-only" : "allow",
    state,
    matchingEvents: matching.length,
    recoveryEvents,
    reasons,
    latestHarmfulEventId,
  });
}

export function backtestSkillFitness(input: {
  readonly events: readonly SkillFitnessEvent[];
  readonly asOf?: string;
}): Readonly<SkillFitnessBacktest> {
  const asOf = normalizeAsOf(input.asOf);
  const available = input.events.map((event) => SkillFitnessEventSchema.parse(event));
  assertUniqueRouteEvidence(available);
  const replayed = available
    .filter((event) => !asOf || timestampMillis(event.createdAt) <= timestampMillis(asOf))
    .sort(compareEvents);
  const grouped = new Map<string, {
    identity: SkillFitnessRouteIdentity;
    events: SkillFitnessEvent[];
  }>();
  for (const event of replayed) {
    const identity = routeIdentityFromEvent(event);
    const routeKey = skillFitnessRouteKey(identity);
    const current = grouped.get(routeKey) ?? { identity, events: [] };
    grouped.set(routeKey, { ...current, events: [...current.events, event] });
  }
  const routes = [...grouped.entries()]
    .sort(([, left], [, right]) =>
      JSON.stringify(left.identity).localeCompare(JSON.stringify(right.identity)))
    .map(([routeKey, group]) => {
      const timeline = group.events.map((event, index) => {
        const assessment = assessSkillRouteFitness({
          events: group.events.slice(0, index + 1),
          route: group.identity,
        });
        return {
          eventId: event.eventId,
          createdAt: event.createdAt,
          schemaVersion: event.schemaVersion,
          decisionAfter: assessment.decision,
          stateAfter: assessment.state,
          recoveryEventsAfter: assessment.recoveryEvents,
          reasonsAfter: assessment.reasons,
        };
      });
      const final = assessSkillRouteFitness({
        events: group.events,
        route: group.identity,
      });
      return {
        routeKey,
        identity: group.identity,
        finalDecision: final.decision,
        finalState: final.state,
        timeline,
      };
    });
  return deepFreeze({
    schemaVersion: 1,
    asOf,
    eventsAvailable: available.length,
    eventsReplayed: replayed.length,
    routes,
  });
}

export function projectSkillFitness(
  input: readonly SkillFitnessEvent[],
): Readonly<SkillFitnessProjection> {
  const events = input.map((event) => SkillFitnessEventSchema.parse(event));
  assertUniqueRouteEvidence(events);
  const groups = new Map<string, {
    skillId: string;
    contentHash: string;
    events: SkillFitnessEvent[];
  }>();
  for (const event of events) {
    for (const skill of event.skills) {
      const key = `${skill.skillId}:${skill.contentHash}`;
      const group = groups.get(key) ?? {
        skillId: skill.skillId,
        contentHash: skill.contentHash,
        events: [],
      };
      groups.set(key, { ...group, events: [...group.events, event] });
    }
  }
  const skills = [...groups.values()]
    .map((group) => {
      const samples = group.events.length;
      const qualityParityRate = group.events.filter(isQualityHealthy).length / samples;
      const medianTokenSavingsRatio = median(
        group.events.map((event) => event.tokenSavingsRatio),
      );
      const medianLatencySavingsRatio = median(
        group.events.map((event) => event.latencySavingsRatio),
      );
      const medianToolCallSavingsRatio = median(
        group.events.map((event) => event.toolCallSavingsRatio),
      );
      const routeGroups = new Map<string, {
        identity: SkillFitnessRouteIdentity;
        events: SkillFitnessEvent[];
      }>();
      for (const event of group.events) {
        const identity = routeIdentityFromEvent(event);
        const key = skillFitnessRouteKey(identity);
        const current = routeGroups.get(key) ?? { identity, events: [] };
        routeGroups.set(key, { ...current, events: [...current.events, event] });
      }
      const hasSuppressedRoute = [...routeGroups.values()].some((routeGroup) =>
        assessSkillRouteFitness({
          events: routeGroup.events,
          route: routeGroup.identity,
        }).decision === "repository-only");
      const promotionEligible = group.events.filter(isRecoveryEligible).length;
      const recommendation = hasSuppressedRoute
        ? "quarantine" as const
        : promotionEligible >= 3
          && medianTokenSavingsRatio > 0
          && medianLatencySavingsRatio > 0
          ? "promote" as const
          : "observe" as const;
      return {
        skillId: group.skillId,
        contentHash: group.contentHash,
        samples,
        qualityParityRate,
        medianTokenSavingsRatio,
        medianLatencySavingsRatio,
        medianToolCallSavingsRatio,
        recommendation,
      };
    })
    .sort((left, right) =>
      left.skillId.localeCompare(right.skillId)
      || left.contentHash.localeCompare(right.contentHash));
  return deepFreeze({
    schemaVersion: 1,
    events: events.length,
    skills,
  });
}

export function skillFitnessRouteKey(input: SkillFitnessRouteIdentity): string {
  return hashCanonical(canonicalRouteIdentity(input));
}

function routeIdentityFromEvent(event: SkillFitnessEvent): SkillFitnessRouteIdentity {
  return canonicalRouteIdentity({
    routerVersion: event.routerVersion,
    repositoryFingerprintHash: event.repositoryFingerprintHash,
    taskClass: event.taskClass,
    harness: event.harness,
    skills: event.skills,
  });
}

function assertUniqueRouteEvidence(events: readonly SkillFitnessEvent[]): void {
  const routes = new Map<string, {
    readonly pairs: Set<string>;
    readonly baselineRuns: Set<string>;
    readonly memiRuns: Set<string>;
    readonly prospectivePairs: Set<string>;
    readonly baselineTrials: Set<string>;
    readonly memiTrials: Set<string>;
  }>();
  for (const event of events) {
    const routeKey = skillFitnessRouteKey(routeIdentityFromEvent(event));
    const route = routes.get(routeKey) ?? {
      pairs: new Set<string>(),
      baselineRuns: new Set<string>(),
      memiRuns: new Set<string>(),
      prospectivePairs: new Set<string>(),
      baselineTrials: new Set<string>(),
      memiTrials: new Set<string>(),
    };
    const pairKey = hashCanonical(event.pair);
    if (route.pairs.has(pairKey)) {
      throw new Error(`Duplicate exact-route empirical pair at event ${event.eventId}`);
    }
    if (
      route.baselineRuns.has(event.pair.baselineRunId)
      || route.memiRuns.has(event.pair.memiRunId)
    ) {
      throw new Error(`Duplicate exact-route empirical pair member at event ${event.eventId}`);
    }
    if (event.schemaVersion === 2 && event.prospective !== null) {
      const prospectiveKey = hashCanonical(event.prospective);
      if (route.prospectivePairs.has(prospectiveKey)) {
        throw new Error(`Duplicate exact-route prospective pair at event ${event.eventId}`);
      }
      if (
        route.baselineTrials.has(event.prospective.baselineTrialId)
        || route.memiTrials.has(event.prospective.memiTrialId)
      ) {
        throw new Error(`Duplicate exact-route prospective pair member at event ${event.eventId}`);
      }
      route.prospectivePairs.add(prospectiveKey);
      route.baselineTrials.add(event.prospective.baselineTrialId);
      route.memiTrials.add(event.prospective.memiTrialId);
    }
    route.pairs.add(pairKey);
    route.baselineRuns.add(event.pair.baselineRunId);
    route.memiRuns.add(event.pair.memiRunId);
    routes.set(routeKey, route);
  }
}

function canonicalRouteIdentity(input: SkillFitnessRouteIdentity): SkillFitnessRouteIdentity {
  const route = SkillFitnessRouteIdentitySchema.parse(input);
  return {
    ...route,
    skills: canonicalSkills(route.skills),
  };
}

function canonicalSkills<T extends { skillId: string; contentHash: string }>(
  input: readonly T[],
): T[] {
  return [...input].sort((left, right) =>
    left.skillId.localeCompare(right.skillId)
    || left.contentHash.localeCompare(right.contentHash));
}

function eventHarmReasons(event: SkillFitnessEvent): readonly string[] {
  const reasons = [
    ...(!isQualityHealthy(event) ? ["quality-regression"] : []),
    ...(event.tokenSavingsRatio <= -0.5 && event.latencySavingsRatio <= -0.25
      ? ["catastrophic-efficiency-regression"]
      : []),
  ];
  return Object.freeze(reasons);
}

function isQualityHealthy(event: SkillFitnessEvent): boolean {
  if (event.schemaVersion === 1) return event.qualityParity;
  return event.functionalAcceptance
    && event.qualityEvidence.memi.score >= event.qualityEvidence.baseline.score
    && event.qualityEvidence.memi.criticalDefects
      <= event.qualityEvidence.baseline.criticalDefects;
}

function isRecoveryEligible(event: SkillFitnessEvent): boolean {
  return event.schemaVersion === 2
    && event.evidenceMode === "recovery-probe"
    && event.prospective !== null
    && isQualityHealthy(event)
    && eventHarmReasons(event).length === 0;
}

function prospectivePair(
  baseline: BenchmarkRunRecord,
  memi: BenchmarkRunRecord,
): { freezeHash: string; baselineTrialId: string; memiTrialId: string } | null {
  if (!baseline.prospective && !memi.prospective) return null;
  if (!baseline.prospective || !memi.prospective) {
    throw new Error("prospective metadata must exist on both paired runs");
  }
  if (baseline.prospective.freezeHash !== memi.prospective.freezeHash) {
    throw new Error("prospective freeze mismatch");
  }
  if (baseline.prospective.planHash !== memi.prospective.planHash) {
    throw new Error("prospective plan mismatch");
  }
  if (baseline.prospective.candidateArtifactSha256
    !== memi.prospective.candidateArtifactSha256) {
    throw new Error("prospective candidate artifact mismatch");
  }
  if (baseline.prospective.taskManifestSha256
    !== memi.prospective.taskManifestSha256) {
    throw new Error("prospective task manifest mismatch");
  }
  return {
    freezeHash: baseline.prospective.freezeHash,
    baselineTrialId: baseline.prospective.trialId,
    memiTrialId: memi.prospective.trialId,
  };
}

function validateQualityEvidencePair(
  evidence: SkillFitnessQualityEvidence,
  baseline: BenchmarkRunRecord,
  memi: BenchmarkRunRecord,
): void {
  if (evidence.pair.baselineRunId !== baseline.runId) {
    throw new Error("quality evidence baseline run id mismatch");
  }
  if (evidence.pair.memiRunId !== memi.runId) {
    throw new Error("quality evidence Memi run id mismatch");
  }
}

function automatedQualityParity(
  baseline: BenchmarkRunRecord,
  memi: BenchmarkRunRecord,
): boolean {
  return passed(baseline)
    && passed(memi)
    && memi.outcome.qualityScore >= baseline.outcome.qualityScore
    && memi.outcome.defects <= baseline.outcome.defects
    && memi.outcome.humanInterventions <= baseline.outcome.humanInterventions;
}

function validatePair(
  baseline: BenchmarkRunRecord,
  memi: BenchmarkRunRecord,
): void {
  if (baseline.condition !== "baseline" || memi.condition !== "memi") {
    throw new Error("fitness pair must contain baseline then memi conditions");
  }
  const identityFields = [
    ["suite", baseline.suiteId, memi.suiteId],
    ["experiment", baseline.experimentId, memi.experimentId],
    ["task", baseline.taskId, memi.taskId],
    ["repeat", baseline.repeat, memi.repeat],
  ] as const;
  for (const [label, left, right] of identityFields) {
    if (left !== right) throw new Error(`${label} mismatch`);
  }
  if (baseline.repository.pathHash !== memi.repository.pathHash) {
    throw new Error("repository path mismatch");
  }
  if (baseline.repository.revision !== memi.repository.revision) {
    throw new Error("repository revision mismatch");
  }
  if (baseline.repository.dirty !== memi.repository.dirty) {
    throw new Error("repository dirty-state mismatch");
  }
  if (baseline.harness.id !== memi.harness.id) throw new Error("harness mismatch");
  if (baseline.harness.modelId !== memi.harness.modelId) {
    throw new Error("model mismatch");
  }
  if (baseline.harness.reasoningEffort !== memi.harness.reasoningEffort) {
    throw new Error("reasoning effort mismatch");
  }
}

function totalTokens(run: BenchmarkRunRecord): number {
  return run.usage.inputTokens + run.usage.outputTokens + run.usage.reasoningTokens;
}

function passed(run: BenchmarkRunRecord): boolean {
  return run.outcome.accepted && run.outcome.testsPassed;
}

function saving(baseline: number, memi: number): number {
  return baseline <= 0 ? 0 : 1 - memi / baseline;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[midpoint] ?? 0;
  return ((ordered[midpoint - 1] ?? 0) + (ordered[midpoint] ?? 0)) / 2;
}

function normalizeAsOf(value: string | undefined): string | null {
  if (value === undefined) return null;
  const parsed = timestampSchema.safeParse(value);
  if (!parsed.success) throw new Error("as-of must be an ISO-8601 timestamp");
  return new Date(parsed.data).toISOString();
}

function compareEvents(left: SkillFitnessEvent, right: SkillFitnessEvent): number {
  return timestampMillis(left.createdAt) - timestampMillis(right.createdAt)
    || left.eventId.localeCompare(right.eventId);
}

function timestampMillis(value: string): number {
  return new Date(value).getTime();
}

function laterTimestamp(left: string, right: string): string {
  return timestampMillis(left) >= timestampMillis(right) ? left : right;
}

function fitnessEventId(input: unknown): string {
  return `fitness:${hashCanonical(input).slice("sha256:".length)}`;
}

function hashCanonical(input: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT",
  );
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
