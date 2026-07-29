import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ratioSchema = z.number().finite().min(-100).max(1);

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
