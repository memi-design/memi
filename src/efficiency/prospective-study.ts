import { createHash } from "node:crypto";
import { z } from "zod";
import {
  benchmarkConditionSchema,
  benchmarkRunRecordSchema,
  type BenchmarkRunRecord,
} from "./contracts.js";
import {
  nativeCaptureKindSchema,
  nativePlatformSchema,
} from "./prospective-evidence-v2.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const revisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
const candidateVersionSchema = z.string().regex(/^2\.7\.\d+$/, {
  message: "must be a Memi 2.7 patch version",
});
const studyIdSchema = z.string().regex(
  /^memi-2\.7-prospective-(?:40|v[0-9]+(?:-[a-z0-9-]+)?)$/,
);
const timestampSchema = z.string().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  { message: "must be an ISO-8601 timestamp" },
);

const scoreBudgetItemSchema = z.object({
  dimension: z.string().min(1),
  currentCredit: z.number().int().nonnegative(),
  targetCredit: z.number().int().nonnegative(),
  maximumCredit: z.number().int().positive().optional(),
  unlock: z.string().min(1).optional(),
}).strict();

const prospectiveTaskSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  platformFamily: z.string().min(1),
  nativePlatform: nativePlatformSchema.optional(),
  revision: revisionSchema,
  pairs: z.number().int().positive(),
  interimCredit: z.number().int().positive(),
  risk: z.string().min(1),
}).strict();

const evidenceV2ContractSchema = z.object({
  required: z.literal(true),
  requiredCaptureKinds: z.array(nativeCaptureKindSchema).min(3),
  // Native quality and resource claims can be evaluated from their own sealed
  // evidence. A USD claim is separately gated on provider billing artifacts.
  measuredBillingRequired: z.boolean(),
  structuredStopReasonsRequired: z.literal(true),
}).strict().superRefine((contract, context) => {
  const required = new Set(contract.requiredCaptureKinds);
  for (const kind of ["screenshot", "interaction-trace", "accessibility-tree"] as const) {
    if (!required.has(kind)) {
      context.addIssue({
        code: "custom",
        path: ["requiredCaptureKinds"],
        message: `must include ${kind}`,
      });
    }
  }
  if (required.size !== contract.requiredCaptureKinds.length) {
    context.addIssue({
      code: "custom",
      path: ["requiredCaptureKinds"],
      message: "capture kinds must be unique",
    });
  }
});

export const prospectiveStudyPlanSchema = z.object({
  schemaVersion: z.literal(1),
  studyId: studyIdSchema.optional(),
  planId: z.string().min(1),
  status: z.literal("draft"),
  currentScore: z.number().int().min(0).max(100),
  targetScore: z.number().int().min(0).max(100),
  claimBoundary: z.string().min(1),
  scoreBudget: z.array(scoreBudgetItemSchema).min(3),
  tasks: z.array(prospectiveTaskSchema).min(1),
  runContract: z.object({
    seed: z.number().int(),
    matchedPairs: z.number().int().positive(),
    trials: z.number().int().positive(),
    conditions: z.tuple([
      z.literal("baseline"),
      z.literal("memi"),
    ]),
    freshClonePerTrial: z.literal(true),
    counterbalancedOrder: z.literal(true),
    requiredArtifacts: z.array(z.string().min(1)).min(3),
    evidenceV2: evidenceV2ContractSchema.optional(),
    acceptance: z.object({
      requiredValidPairsPerTask: z.number().int().positive(),
      requiredPassingPairsPerTask: z.number().int().positive(),
      fixtureMutationAllowed: z.literal(false),
      providerErrorAllowed: z.literal(false),
      missingOrDuplicateConditionAllowed: z.literal(false),
      postPatchIsolatedVerificationRequired: z.literal(true),
    }).strict(),
  }).strict(),
  creditPolicy: z.object({
    planningEarnsCredit: z.literal(false),
    manualCreditEditsAllowed: z.literal(false),
    prospectiveRegistrationCredit: z.literal("all-or-none"),
    independentRepeatInterimCreditPerQualifiedPlatform: z.number().int().positive(),
    independentRepeatInterimCreditCap: z.number().int().positive(),
    fullRepeatCreditRequiresAllReleaseCriticalTasks: z.literal(true),
  }).strict(),
}).strict().superRefine((plan, context) => {
  const taskIds = plan.tasks.map((task) => task.id);
  if (new Set(taskIds).size !== taskIds.length) {
    context.addIssue({
      code: "custom",
      message: "task ids must be unique",
      path: ["tasks"],
    });
  }
  const pairs = plan.tasks.reduce((total, task) => total + task.pairs, 0);
  if (pairs !== plan.runContract.matchedPairs) {
    context.addIssue({
      code: "custom",
      message: "matched pair count must equal the sum of task pairs",
      path: ["runContract", "matchedPairs"],
    });
  }
  if (plan.runContract.trials !== pairs * plan.runContract.conditions.length) {
    context.addIssue({
      code: "custom",
      message: "trial count must equal pairs times conditions",
      path: ["runContract", "trials"],
    });
  }
  const interimCredit = plan.tasks.reduce(
    (total, task) => total + task.interimCredit,
    0,
  );
  if (interimCredit !== plan.creditPolicy.independentRepeatInterimCreditCap) {
    context.addIssue({
      code: "custom",
      message: "task interim credit must equal the repeat credit cap",
      path: ["creditPolicy", "independentRepeatInterimCreditCap"],
    });
  }
  if (plan.runContract.evidenceV2) {
    plan.tasks.forEach((task, index) => {
      if (!task.nativePlatform) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "nativePlatform"],
          message: "is required when evidenceV2 is enabled",
        });
      }
    });
    if (!plan.runContract.requiredArtifacts.includes("prospective-evidence-v2.json")) {
      context.addIssue({
        code: "custom",
        path: ["runContract", "requiredArtifacts"],
        message: "must include prospective-evidence-v2.json when evidenceV2 is enabled",
      });
    }
  }
});
export type ProspectiveStudyPlan = z.infer<typeof prospectiveStudyPlanSchema>;

const prospectiveTrialSchema = z.object({
  trialId: z.string().min(1),
  taskId: z.string().min(1),
  repeat: z.number().int().positive(),
  condition: benchmarkConditionSchema,
  sequence: z.number().int().nonnegative(),
}).strict();

const freezeContentSchema = z.object({
  schemaVersion: z.literal(1),
  studyId: studyIdSchema,
  planId: z.string().min(1),
  planHash: sha256Schema,
  frozenAt: timestampSchema,
  candidate: z.object({
    version: candidateVersionSchema,
    revision: revisionSchema,
    sourceState: z.enum(["clean", "content-addressed-dirty-snapshot"]),
    dirtyFileCount: z.number().int().nonnegative(),
    sourceTreeSha256: sha256Schema,
    artifactSha256: sha256Schema,
  }).strict(),
  harness: z.object({
    provider: z.enum(["codex", "claude"]),
    modelId: z.string().min(1),
    reasoningEffort: z.string().min(1),
    harnessVersion: z.string().min(1),
    permissionPolicy: z.string().min(1),
    maximumSkills: z.number().int().positive(),
    maximumContextBytes: z.number().int().positive(),
  }).strict(),
  environment: z.object({
    machine: z.string().min(1),
    os: z.string().min(1),
    arch: z.string().min(1),
    node: z.string().min(1),
    xcode: z.string().min(1),
    simulator: z.string().min(1),
    workspaceVolume: z.string().min(1),
    temporaryRoot: z.string().min(1),
  }).strict(),
  taskRevisions: z.record(z.string(), revisionSchema),
  taskManifestHashes: z.record(z.string(), sha256Schema),
  taskNativePlatforms: z.record(z.string(), nativePlatformSchema).optional(),
  evidenceV2: evidenceV2ContractSchema.optional(),
  requiredArtifacts: z.array(z.string().min(1)).min(3),
  trials: z.array(prospectiveTrialSchema).min(2),
}).strict();

export const prospectiveFreezeSchema = freezeContentSchema.extend({
  freezeHash: sha256Schema,
}).strict();
export type ProspectiveFreeze = z.infer<typeof prospectiveFreezeSchema>;

export interface BuildProspectiveFreezeInput {
  readonly plan: ProspectiveStudyPlan;
  readonly frozenAt: string;
  readonly candidate: ProspectiveFreeze["candidate"];
  readonly harness: ProspectiveFreeze["harness"];
  readonly environment: ProspectiveFreeze["environment"];
  readonly taskManifestHashes: Readonly<Record<string, string>>;
}

export function buildProspectiveFreeze(
  input: BuildProspectiveFreezeInput,
): Readonly<ProspectiveFreeze> {
  const plan = prospectiveStudyPlanSchema.parse(input.plan);
  const taskManifestHashes = normalizeTaskHashes(
    plan,
    input.taskManifestHashes,
  );
  const trials = createTrialMatrix(plan);
  const content = freezeContentSchema.parse({
    schemaVersion: 1,
    studyId: plan.studyId ?? "memi-2.7-prospective-40",
    planId: plan.planId,
    planHash: hashValue(plan),
    frozenAt: input.frozenAt,
    candidate: input.candidate,
    harness: input.harness,
    environment: input.environment,
    taskRevisions: Object.fromEntries(
      plan.tasks.map((task) => [task.id, task.revision]),
    ),
    taskManifestHashes,
    ...(plan.runContract.evidenceV2
      ? {
        taskNativePlatforms: Object.fromEntries(plan.tasks.map((task) => [
          task.id,
          task.nativePlatform,
        ])),
        evidenceV2: plan.runContract.evidenceV2,
      }
      : {}),
    requiredArtifacts: plan.runContract.requiredArtifacts,
    trials,
  });
  return deepFreeze(prospectiveFreezeSchema.parse({
    ...content,
    freezeHash: hashValue(content),
  }));
}

export function selectProspectiveTrial(input: {
  readonly freeze: ProspectiveFreeze;
  readonly trialId: string;
  readonly taskId: string;
  readonly condition: "baseline" | "memi";
  readonly repeat: number;
  readonly provider: "codex" | "claude";
  readonly modelId: string;
  readonly reasoningEffort: string;
  readonly repositoryRevision: string;
  readonly taskManifestSha256: string;
}): Readonly<ProspectiveFreeze["trials"][number]> {
  const freeze = prospectiveFreezeSchema.parse(input.freeze);
  const verification = verifyProspectiveFreeze(freeze);
  if (!verification.valid) {
    throw new Error(`prospective freeze is invalid: ${verification.reasons.join(", ")}`);
  }
  const trial = freeze.trials.find((candidate) =>
    candidate.trialId === input.trialId);
  if (!trial) throw new Error(`unknown prospective trial: ${input.trialId}`);
  if (
    trial.taskId !== input.taskId
    || trial.condition !== input.condition
    || trial.repeat !== input.repeat
  ) {
    throw new Error("prospective trial metadata drift");
  }
  if (freeze.harness.provider !== input.provider) {
    throw new Error("prospective provider drift");
  }
  if (freeze.harness.modelId !== input.modelId) {
    throw new Error("prospective model drift");
  }
  if (freeze.harness.reasoningEffort !== input.reasoningEffort) {
    throw new Error("prospective reasoning effort drift");
  }
  if (freeze.taskRevisions[input.taskId] !== input.repositoryRevision) {
    throw new Error("prospective repository revision drift");
  }
  if (
    freeze.taskManifestHashes[input.taskId] !== input.taskManifestSha256
  ) {
    throw new Error("prospective task manifest drift");
  }
  return deepFreeze(trial);
}

export function selectProspectiveBatch(input: {
  readonly freeze: ProspectiveFreeze;
  readonly completedTrialIds: readonly string[];
  readonly maximumTrials: number;
}): readonly Readonly<ProspectiveFreeze["trials"][number]>[] {
  const freeze = prospectiveFreezeSchema.parse(input.freeze);
  const verification = verifyProspectiveFreeze(freeze);
  if (!verification.valid) {
    throw new Error(`prospective freeze is invalid: ${verification.reasons.join(", ")}`);
  }
  if (!Number.isInteger(input.maximumTrials) || input.maximumTrials < 2) {
    throw new Error("maximum trials must include at least one complete matched pair");
  }
  if (input.maximumTrials % 2 !== 0) {
    throw new Error("maximum trials must include complete matched pairs");
  }
  const knownTrialIds = new Set(freeze.trials.map((trial) => trial.trialId));
  const completedTrialIds = new Set(input.completedTrialIds);
  for (const trialId of completedTrialIds) {
    if (!knownTrialIds.has(trialId)) {
      throw new Error(`completed trial is not part of the prospective freeze: ${trialId}`);
    }
  }
  const orderedTrials = [...freeze.trials]
    .sort((left, right) => left.sequence - right.sequence);
  const selected: ProspectiveFreeze["trials"][number][] = [];
  const visitedPairs = new Set<string>();
  for (const trial of orderedTrials) {
    const pairId = `${trial.taskId}:r${trial.repeat}`;
    if (visitedPairs.has(pairId)) continue;
    visitedPairs.add(pairId);
    const pendingPair = orderedTrials.filter((candidate) =>
      candidate.taskId === trial.taskId
      && candidate.repeat === trial.repeat
      && !completedTrialIds.has(candidate.trialId));
    if (pendingPair.length === 0) continue;
    if (selected.length + pendingPair.length > input.maximumTrials) break;
    selected.push(...pendingPair);
  }
  return deepFreeze(selected);
}

export function verifyProspectiveFreeze(
  input: ProspectiveFreeze,
): Readonly<{ valid: boolean; reasons: readonly string[] }> {
  const parsed = prospectiveFreezeSchema.safeParse(input);
  if (!parsed.success) {
    return deepFreeze({
      valid: false,
      reasons: parsed.error.issues.map((issue) =>
        `schema:${issue.path.join(".")}:${issue.message}`),
    });
  }
  const { freezeHash, ...content } = parsed.data;
  const reasons = freezeHash === hashValue(content)
    ? []
    : ["freeze-hash-mismatch"];
  return deepFreeze({ valid: reasons.length === 0, reasons });
}

export interface ProspectiveStudyEvaluation {
  readonly score: number;
  readonly registrationCredit: number;
  readonly repeatCredit: number;
  readonly qualifiedTasks: readonly string[];
  readonly validPairs: number;
  readonly missingTrials: readonly string[];
  readonly invalidTrials: readonly {
    trialId: string;
    reason: string;
  }[];
  readonly reachedTarget: boolean;
}

export function evaluateProspectiveStudy(input: {
  readonly plan: ProspectiveStudyPlan;
  readonly freeze: ProspectiveFreeze;
  readonly runs: readonly BenchmarkRunRecord[];
}): Readonly<ProspectiveStudyEvaluation> {
  const plan = prospectiveStudyPlanSchema.parse(input.plan);
  const freeze = prospectiveFreezeSchema.parse(input.freeze);
  const freezeVerification = verifyProspectiveFreeze(freeze);
  const planMatches = freeze.planHash === hashValue(plan)
    && freeze.planId === plan.planId;
  const registrationCredit = freezeVerification.valid && planMatches ? 5 : 0;
  const expectedTrials = new Map(
    freeze.trials.map((trial) => [trial.trialId, trial]),
  );
  const taskById = new Map(plan.tasks.map((task) => [task.id, task]));
  const invalidTrials: Array<{ trialId: string; reason: string }> = [];
  const validTrialIds = new Set<string>();
  const seenTrialIds = new Set<string>();

  for (const rawRun of input.runs) {
    const parsed = benchmarkRunRecordSchema.safeParse(rawRun);
    const fallbackId = typeof rawRun.runId === "string"
      ? rawRun.runId
      : "unknown-run";
    if (!parsed.success) {
      invalidTrials.push({ trialId: fallbackId, reason: "run-schema-invalid" });
      continue;
    }
    const run = parsed.data;
    const trialId = run.prospective?.trialId ?? run.runId;
    if (seenTrialIds.has(trialId)) {
      invalidTrials.push({ trialId, reason: "duplicate-trial" });
      validTrialIds.delete(trialId);
      continue;
    }
    seenTrialIds.add(trialId);
    const expected = expectedTrials.get(trialId);
    if (!expected) {
      invalidTrials.push({ trialId, reason: "unexpected-trial" });
      continue;
    }
    const reason = validateRun({
      run,
      expected,
      task: taskById.get(expected.taskId),
      freeze,
    });
    if (reason) {
      invalidTrials.push({ trialId, reason });
      continue;
    }
    validTrialIds.add(trialId);
  }

  const missingTrials = freeze.trials
    .filter((trial) => !seenTrialIds.has(trial.trialId))
    .map((trial) => trial.trialId);
  const qualifiedTasks: string[] = [];
  let validPairs = 0;
  for (const task of plan.tasks) {
    let taskPairs = 0;
    for (let repeat = 1; repeat <= task.pairs; repeat += 1) {
      const pairTrials = freeze.trials.filter((trial) =>
        trial.taskId === task.id && trial.repeat === repeat);
      if (
        pairTrials.length === 2
        && pairTrials.every((trial) => validTrialIds.has(trial.trialId))
      ) {
        taskPairs += 1;
        validPairs += 1;
      }
    }
    if (
      taskPairs >= plan.runContract.acceptance.requiredValidPairsPerTask
      && taskPairs >= plan.runContract.acceptance.requiredPassingPairsPerTask
    ) {
      qualifiedTasks.push(task.id);
    }
  }
  const repeatCredit = Math.min(
    plan.creditPolicy.independentRepeatInterimCreditCap,
    qualifiedTasks.reduce((total, taskId) =>
      total + (taskById.get(taskId)?.interimCredit ?? 0), 0),
  );
  const score = plan.currentScore + registrationCredit + repeatCredit;
  return deepFreeze({
    score,
    registrationCredit,
    repeatCredit,
    qualifiedTasks,
    validPairs,
    missingTrials,
    invalidTrials,
    reachedTarget: score >= plan.targetScore,
  });
}

function createTrialMatrix(
  plan: ProspectiveStudyPlan,
): ProspectiveFreeze["trials"] {
  const trials: ProspectiveFreeze["trials"][number][] = [];
  let sequence = 0;
  const maximumRepeats = Math.max(...plan.tasks.map((task) => task.pairs));
  for (let repeat = 1; repeat <= maximumRepeats; repeat += 1) {
    plan.tasks.forEach((task, taskIndex) => {
      if (repeat > task.pairs) return;
      const baselineFirst = (
        plan.runContract.seed + taskIndex + repeat
      ) % 2 === 0;
      const conditions = baselineFirst
        ? ["baseline", "memi"] as const
        : ["memi", "baseline"] as const;
      for (const condition of conditions) {
        trials.push({
          trialId: `${plan.planId}:${task.id}:r${repeat}:${condition}`,
          taskId: task.id,
          repeat,
          condition,
          sequence,
        });
        sequence += 1;
      }
    });
  }
  return trials;
}

function validateRun(input: {
  run: BenchmarkRunRecord;
  expected: ProspectiveFreeze["trials"][number];
  task: ProspectiveStudyPlan["tasks"][number] | undefined;
  freeze: ProspectiveFreeze;
}): string | null {
  const { run, expected, task, freeze } = input;
  if (!task) return "unknown-task";
  if (Date.parse(run.timing.startedAt) <= Date.parse(freeze.frozenAt)) {
    return "run-started-before-freeze";
  }
  if (
    run.taskId !== expected.taskId
    || run.repeat !== expected.repeat
    || run.condition !== expected.condition
  ) {
    return "trial-metadata-mismatch";
  }
  if (run.repository.dirty || run.repository.revision !== task.revision) {
    return "repository-revision-mismatch";
  }
  if (
    run.harness.id !== freeze.harness.provider
    || run.harness.modelId !== freeze.harness.modelId
    || run.harness.reasoningEffort !== freeze.harness.reasoningEffort
  ) {
    return "harness-mismatch";
  }
  if (
    !run.prospective
    || run.prospective.planHash !== freeze.planHash
    || run.prospective.freezeHash !== freeze.freezeHash
    || run.prospective.candidateArtifactSha256
      !== freeze.candidate.artifactSha256
    || run.prospective.taskManifestSha256
      !== freeze.taskManifestHashes[expected.taskId]
    || run.prospective.trialId !== expected.trialId
    || run.prospective.sequence !== expected.sequence
  ) {
    return "prospective-receipt-mismatch";
  }
  if (
    !run.outcome.accepted
    || !run.outcome.testsPassed
    || run.outcome.qualityScore < 80
    || run.outcome.qualityEvidence !== "automated_acceptance"
    || (run.outcome.qualityCeiling ?? 0) < 80
    || run.outcome.defects !== 0
    || run.outcome.humanInterventions !== 0
  ) {
    return "acceptance-failed";
  }
  const referenceNames = new Set(
    run.evidenceRefs.map((reference) =>
      reference.split("/").at(-1) ?? reference),
  );
  if (!freeze.requiredArtifacts.every((artifact) =>
    referenceNames.has(artifact))) {
    return "required-artifact-missing";
  }
  return null;
}

function normalizeTaskHashes(
  plan: ProspectiveStudyPlan,
  input: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const taskIds = plan.tasks.map((task) => task.id);
  const inputKeys = Object.keys(input).sort();
  const expectedKeys = [...taskIds].sort();
  if (JSON.stringify(inputKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error("task manifest hashes must match the frozen task set");
  }
  return deepFreeze(Object.fromEntries(taskIds.map((taskId) => [
    taskId,
    sha256Schema.parse(input[taskId]),
  ])));
}

export function hashValue(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
