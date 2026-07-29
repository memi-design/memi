import type { BenchmarkRunRecord } from "./contracts.js";
import { z } from "zod";

export interface EfficiencyReportInput {
  readonly suiteId: string;
  readonly runs: readonly BenchmarkRunRecord[];
  readonly minimumPairs: number;
  readonly bootstrapSamples: number;
  readonly seed: number;
  readonly targetImprovement: number;
}

export interface SavingsInterval {
  readonly mean: number;
  readonly lower95: number;
  readonly upper95: number;
}

export interface EfficiencyReport {
  readonly schemaVersion: 1;
  readonly suiteId: string;
  readonly generatedAt: string;
  readonly status: "verified" | "insufficient_evidence";
  readonly claim: "verified_gt_25" | "not_verified" | "insufficient_evidence";
  readonly targetImprovement: number;
  readonly pairs: {
    readonly included: number;
    readonly excluded: readonly {
      readonly key: string;
      readonly reason: string;
    }[];
  };
  readonly metrics: {
    readonly tokenSavings: SavingsInterval;
    readonly costSavings: SavingsInterval;
    readonly latencySavings: SavingsInterval;
    readonly toolCallSavings: SavingsInterval;
  };
  readonly quality: {
    readonly baselinePassRate: number;
    readonly memiPassRate: number;
    readonly passRateDelta: number;
    readonly baselineDefects: number;
    readonly memiDefects: number;
    readonly baselineHumanInterventions: number;
    readonly memiHumanInterventions: number;
    readonly passed: boolean;
  };
}

const savingsIntervalSchema = z.object({
  mean: z.number(),
  lower95: z.number(),
  upper95: z.number(),
}).strict();

export const efficiencyReportSchema = z.object({
  schemaVersion: z.literal(1),
  suiteId: z.string().min(1),
  generatedAt: z.string(),
  status: z.enum(["verified", "insufficient_evidence"]),
  claim: z.enum(["verified_gt_25", "not_verified", "insufficient_evidence"]),
  targetImprovement: z.number().min(0).max(1),
  pairs: z.object({
    included: z.number().int().nonnegative(),
    excluded: z.array(z.object({
      key: z.string(),
      reason: z.string(),
    }).strict()),
  }).strict(),
  metrics: z.object({
    tokenSavings: savingsIntervalSchema,
    costSavings: savingsIntervalSchema,
    latencySavings: savingsIntervalSchema,
    toolCallSavings: savingsIntervalSchema,
  }).strict(),
  quality: z.object({
    baselinePassRate: z.number().min(0).max(1),
    memiPassRate: z.number().min(0).max(1),
    passRateDelta: z.number().min(-1).max(1),
    baselineDefects: z.number().nonnegative(),
    memiDefects: z.number().nonnegative(),
    baselineHumanInterventions: z.number().nonnegative(),
    memiHumanInterventions: z.number().nonnegative(),
    passed: z.boolean(),
  }).strict(),
}).strict();

interface Pair {
  readonly baseline: BenchmarkRunRecord;
  readonly memi: BenchmarkRunRecord;
}

export function buildEfficiencyReport(input: EfficiencyReportInput): Readonly<EfficiencyReport> {
  const grouped = new Map<string, {
    baseline?: BenchmarkRunRecord;
    memi?: BenchmarkRunRecord;
    duplicate?: boolean;
  }>();
  for (const run of input.runs.filter((candidate) => candidate.suiteId === input.suiteId)) {
    const key = `${run.experimentId}:${run.taskId}:${run.repeat}`;
    const group = grouped.get(key) ?? {};
    if (group[run.condition]) group.duplicate = true;
    group[run.condition] = run;
    grouped.set(key, group);
  }

  const pairs: Pair[] = [];
  const excluded: { key: string; reason: string }[] = [];
  for (const [key, group] of grouped) {
    if (group.duplicate) {
      excluded.push({ key, reason: "duplicate condition run" });
      continue;
    }
    if (!group.baseline || !group.memi) {
      excluded.push({ key, reason: "missing baseline or memi condition" });
      continue;
    }
    const mismatch = environmentMismatch(group.baseline, group.memi);
    if (mismatch) {
      excluded.push({ key, reason: mismatch });
      continue;
    }
    pairs.push({ baseline: group.baseline, memi: group.memi });
  }

  const tokenSavings = pairs.map((pair) =>
    saving(totalTokens(pair.baseline), totalTokens(pair.memi)));
  const costSavings = pairs.map((pair) =>
    saving(pair.baseline.usage.estimatedCostUsd, pair.memi.usage.estimatedCostUsd));
  const latencySavings = pairs.map((pair) =>
    saving(pair.baseline.timing.wallTimeMs, pair.memi.timing.wallTimeMs));
  const toolCallSavings = pairs.map((pair) =>
    saving(pair.baseline.tools.calls, pair.memi.tools.calls));

  const baselinePassed = pairs.filter((pair) => passed(pair.baseline)).length;
  const memiPassed = pairs.filter((pair) => passed(pair.memi)).length;
  const baselinePassRate = rate(baselinePassed, pairs.length);
  const memiPassRate = rate(memiPassed, pairs.length);
  const baselineDefects = mean(pairs.map((pair) => pair.baseline.outcome.defects));
  const memiDefects = mean(pairs.map((pair) => pair.memi.outcome.defects));
  const baselineHumanInterventions = mean(
    pairs.map((pair) => pair.baseline.outcome.humanInterventions),
  );
  const memiHumanInterventions = mean(
    pairs.map((pair) => pair.memi.outcome.humanInterventions),
  );
  const qualityPassed = memiPassRate - baselinePassRate >= -0.02
    && memiDefects <= baselineDefects
    && memiHumanInterventions <= baselineHumanInterventions;
  const enoughEvidence = pairs.length >= input.minimumPairs;

  const metrics = {
    tokenSavings: confidenceInterval(tokenSavings, input.bootstrapSamples, input.seed + 1),
    costSavings: confidenceInterval(costSavings, input.bootstrapSamples, input.seed + 2),
    latencySavings: confidenceInterval(latencySavings, input.bootstrapSamples, input.seed + 3),
    toolCallSavings: confidenceInterval(toolCallSavings, input.bootstrapSamples, input.seed + 4),
  };
  const claimPassed = enoughEvidence
    && metrics.tokenSavings.lower95 > input.targetImprovement
    && metrics.latencySavings.lower95 > input.targetImprovement
    && qualityPassed;

  return deepFreeze(efficiencyReportSchema.parse({
    schemaVersion: 1,
    suiteId: input.suiteId,
    generatedAt: new Date().toISOString(),
    status: enoughEvidence ? "verified" : "insufficient_evidence",
    claim: !enoughEvidence
      ? "insufficient_evidence"
      : claimPassed ? "verified_gt_25" : "not_verified",
    targetImprovement: input.targetImprovement,
    pairs: {
      included: pairs.length,
      excluded,
    },
    metrics,
    quality: {
      baselinePassRate,
      memiPassRate,
      passRateDelta: round(memiPassRate - baselinePassRate),
      baselineDefects,
      memiDefects,
      baselineHumanInterventions,
      memiHumanInterventions,
      passed: qualityPassed,
    },
  })) as Readonly<EfficiencyReport>;
}

function environmentMismatch(
  baseline: BenchmarkRunRecord,
  memi: BenchmarkRunRecord,
): string | null {
  if (baseline.repository.revision !== memi.repository.revision) return "repository revision mismatch";
  if (baseline.repository.dirty !== memi.repository.dirty) return "repository dirty-state mismatch";
  if (baseline.harness.id !== memi.harness.id) return "harness mismatch";
  if (baseline.harness.modelId !== memi.harness.modelId) return "model mismatch";
  if (baseline.harness.reasoningEffort !== memi.harness.reasoningEffort) return "reasoning effort mismatch";
  return null;
}

function totalTokens(run: BenchmarkRunRecord): number {
  return run.usage.inputTokens + run.usage.outputTokens + run.usage.reasoningTokens;
}

function passed(run: BenchmarkRunRecord): boolean {
  return run.outcome.accepted && run.outcome.testsPassed;
}

function saving(baseline: number, memi: number): number {
  if (baseline <= 0) return 0;
  return 1 - memi / baseline;
}

function confidenceInterval(
  values: readonly number[],
  samples: number,
  seed: number,
): SavingsInterval {
  if (values.length === 0) return { mean: 0, lower95: 0, upper95: 0 };
  if (values.length === 1) {
    const value = round(values[0]);
    return { mean: value, lower95: value, upper95: value };
  }
  const random = seededRandom(seed);
  const sampleMeans: number[] = [];
  const count = Math.max(100, samples);
  for (let sample = 0; sample < count; sample += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(random() * values.length)];
    }
    sampleMeans.push(total / values.length);
  }
  sampleMeans.sort((a, b) => a - b);
  return {
    mean: round(mean(values)),
    lower95: round(percentile(sampleMeans, 0.025)),
    upper95: round(percentile(sampleMeans, 0.975)),
  };
}

function percentile(values: readonly number[], quantile: number): number {
  const position = (values.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (position - lower);
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
