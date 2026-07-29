import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BenchmarkRunRecord } from "../efficiency/contracts.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ratioSchema = z.number().finite().min(-100).max(1);

export const SkillFitnessRouteSchema = z.object({
  routerVersion: z.string().min(1),
  repositoryFingerprintHash: sha256Schema.nullable(),
  selected: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    contentHash: sha256Schema,
  }).passthrough()).min(1).max(4),
}).passthrough();
export type SkillFitnessRoute = z.infer<typeof SkillFitnessRouteSchema>;

export const SkillFitnessEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().regex(/^[a-z0-9][a-z0-9:_-]*$/),
  createdAt: z.string().datetime(),
  routerVersion: z.string().min(1),
  repositoryFingerprintHash: sha256Schema,
  taskClass: z.string().regex(/^[a-z][a-z0-9-]*$/),
  harness: z.object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
    reasoningEffort: z.string().min(1),
  }).strict(),
  pair: z.object({
    baselineRunId: z.string().min(1),
    memiRunId: z.string().min(1),
  }).strict(),
  skills: z.array(z.object({
    skillId: z.string().regex(/^[a-z][a-z0-9-]*$/),
    contentHash: sha256Schema,
  }).strict()).min(1).max(4),
  qualityParity: z.boolean(),
  tokenSavingsRatio: ratioSchema,
  latencySavingsRatio: ratioSchema,
  toolCallSavingsRatio: ratioSchema,
}).strict();
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

export interface BuildSkillFitnessEventInput {
  readonly baseline: BenchmarkRunRecord;
  readonly memi: BenchmarkRunRecord;
  readonly route: SkillFitnessRoute;
  readonly taskClass: string;
}

export function buildSkillFitnessEvent(
  input: BuildSkillFitnessEventInput,
): Readonly<SkillFitnessEvent> {
  const route = SkillFitnessRouteSchema.parse(input.route);
  validatePair(input.baseline, input.memi);
  if (!route.repositoryFingerprintHash) {
    throw new Error("skill route is missing a repository fingerprint hash");
  }
  const identity = JSON.stringify({
    baselineRunId: input.baseline.runId,
    memiRunId: input.memi.runId,
    repositoryFingerprintHash: route.repositoryFingerprintHash,
    routerVersion: route.routerVersion,
    skills: route.selected.map(({ id, contentHash }) => ({ id, contentHash })),
  });
  return deepFreeze(SkillFitnessEventSchema.parse({
    schemaVersion: 1,
    eventId: `fitness:${createHash("sha256").update(identity).digest("hex")}`,
    createdAt: input.memi.timing.completedAt,
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
    skills: route.selected.map(({ id, contentHash }) => ({
      skillId: id,
      contentHash,
    })),
    qualityParity: passed(input.baseline)
      && passed(input.memi)
      && input.memi.outcome.qualityScore >= input.baseline.outcome.qualityScore
      && input.memi.outcome.defects <= input.baseline.outcome.defects
      && input.memi.outcome.humanInterventions
        <= input.baseline.outcome.humanInterventions,
    tokenSavingsRatio: saving(
      totalTokens(input.baseline),
      totalTokens(input.memi),
    ),
    latencySavingsRatio: saving(
      input.baseline.timing.wallTimeMs,
      input.memi.timing.wallTimeMs,
    ),
    toolCallSavingsRatio: saving(
      input.baseline.tools.calls,
      input.memi.tools.calls,
    ),
  }));
}

export async function appendSkillFitnessEvent(
  file: string,
  input: SkillFitnessEvent,
): Promise<void> {
  const event = SkillFitnessEventSchema.parse(input);
  const existing = await loadSkillFitnessEvents(file);
  if (existing.some((candidate) => candidate.eventId === event.eventId)) {
    throw new Error(`Skill fitness event ${event.eventId} already exists`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(event)}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}

export async function loadSkillFitnessEvents(
  file: string,
): Promise<readonly SkillFitnessEvent[]> {
  const content = await readFile(file, "utf8").catch((error: unknown) => {
    if (isMissingFile(error)) return "";
    throw error;
  });
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
  return deepFreeze(events);
}

export function projectSkillFitness(
  input: readonly SkillFitnessEvent[],
): Readonly<SkillFitnessProjection> {
  const events = input.map((event) => SkillFitnessEventSchema.parse(event));
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
      const qualityParityRate =
        group.events.filter((event) => event.qualityParity).length / samples;
      const medianTokenSavingsRatio = median(
        group.events.map((event) => event.tokenSavingsRatio),
      );
      const medianLatencySavingsRatio = median(
        group.events.map((event) => event.latencySavingsRatio),
      );
      const medianToolCallSavingsRatio = median(
        group.events.map((event) => event.toolCallSavingsRatio),
      );
      const recommendation = samples >= 6 && (
        qualityParityRate < 1
        || (medianTokenSavingsRatio <= 0 && medianLatencySavingsRatio <= 0)
      )
        ? "quarantine" as const
        : samples >= 3
          && qualityParityRate === 1
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

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[midpoint] ?? 0;
  return ((ordered[midpoint - 1] ?? 0) + (ordered[midpoint] ?? 0)) / 2;
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
