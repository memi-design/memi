import { z } from "zod";

const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "must be an ISO-8601 timestamp",
});

export const benchmarkConditionSchema = z.enum(["baseline", "memi"]);
export type BenchmarkCondition = z.infer<typeof benchmarkConditionSchema>;

export const benchmarkRunRecordSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  graderVersion: z.string().min(1).optional(),
  amendsRunId: z.string().min(1).optional(),
  experimentId: z.string().min(1),
  suiteId: z.string().min(1),
  taskId: z.string().min(1),
  repeat: z.number().int().positive(),
  condition: benchmarkConditionSchema,
  invocation: z.enum(["interactive", "ci"]).optional(),
  repository: z.object({
    pathHash: z.string().startsWith("sha256:"),
    revision: z.string().min(1),
    dirty: z.boolean(),
  }).strict(),
  harness: z.object({
    id: z.string().min(1),
    modelId: z.string().min(1),
    reasoningEffort: z.string().min(1),
  }).strict(),
  timing: z.object({
    startedAt: timestampSchema,
    completedAt: timestampSchema,
    wallTimeMs: z.number().nonnegative(),
    toolTimeMs: z.number().nonnegative(),
  }).strict(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative().nullable(),
  }).strict(),
  tools: z.object({
    calls: z.number().int().nonnegative(),
    outputBytes: z.number().int().nonnegative().optional(),
    errors: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(),
  }).strict(),
  outcome: z.object({
    accepted: z.boolean(),
    testsPassed: z.boolean(),
    qualityScore: z.number().min(0).max(100),
    qualityEvidence: z.enum(["automated_acceptance", "practitioner_rubric"]).optional(),
    qualityCeiling: z.number().min(0).max(100).optional(),
    defects: z.number().int().nonnegative(),
    humanInterventions: z.number().int().nonnegative(),
  }).strict(),
  evidenceRefs: z.array(z.string().min(1)),
  prospective: z.object({
    planHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    freezeHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    candidateArtifactSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    taskManifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    evidenceManifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    trialId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
  }).strict().optional(),
}).strict();

export type BenchmarkRunRecord = z.infer<typeof benchmarkRunRecordSchema>;

export const benchmarkTaskSchema = z.object({
  id: z.string().min(1),
  intent: z.string().min(1),
}).strict();

export type BenchmarkTask = z.infer<typeof benchmarkTaskSchema>;

export const codexCaseStudyTaskSchema = benchmarkTaskSchema.extend({
  rubric: z.object({
    minimumValidCitations: z.number().int().positive(),
    requiredTerms: z.array(z.string().min(1)).min(1),
  }).strict(),
}).strict();

export type CodexCaseStudyTask = z.infer<typeof codexCaseStudyTaskSchema>;

export const benchmarkSuiteSchema = z.object({
  schemaVersion: z.literal(1),
  suiteId: z.string().min(1),
  experimentId: z.string().min(1),
  seed: z.number().int(),
  repeats: z.number().int().positive().max(100),
  conditions: z.array(benchmarkConditionSchema).length(2)
    .refine((conditions) => new Set(conditions).size === 2, {
      message: "suite must contain baseline and memi exactly once",
    }),
  tasks: z.array(benchmarkTaskSchema).min(1),
}).strict();

export type BenchmarkSuite = z.infer<typeof benchmarkSuiteSchema>;

export const benchmarkTrialSchema = z.object({
  trialId: z.string().min(1),
  suiteId: z.string().min(1),
  experimentId: z.string().min(1),
  taskId: z.string().min(1),
  repeat: z.number().int().positive(),
  condition: benchmarkConditionSchema,
  sequence: z.number().int().nonnegative(),
}).strict();

export type BenchmarkTrial = z.infer<typeof benchmarkTrialSchema>;

export const benchmarkPlanSchema = benchmarkSuiteSchema.extend({
  trials: z.array(benchmarkTrialSchema),
}).strict();

export type BenchmarkPlan = z.infer<typeof benchmarkPlanSchema>;
