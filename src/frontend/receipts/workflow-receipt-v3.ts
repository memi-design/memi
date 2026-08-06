import { z } from "zod";
import { FrontendTaskClassSchema } from "../task-contract.js";
import {
  IdentifierSchema,
  RepositoryRelativePathSchema,
  Sha256Schema,
  TimestampSchema,
  deepFreeze,
  hashValue,
  timestampMillis,
} from "./foundation.js";

const RuntimeSchema = z.object({
  provider: IdentifierSchema,
  model: z.string().min(1).max(256),
  effort: z.string().min(1).max(64),
}).strict();

const StableFieldsSchema = z.object({
  protocolSha256: Sha256Schema,
  suiteId: IdentifierSchema,
  experimentId: IdentifierSchema,
  pairId: IdentifierSchema,
  taskId: IdentifierSchema,
  repeat: z.number().int().positive().max(10_000),
  taskClass: FrontendTaskClassSchema,
  taskContractSha256: Sha256Schema,
  repository: z.object({
    fingerprintSha256: Sha256Schema,
    revision: z.string().regex(/^[a-f0-9]{40}$/u),
    fixtureSha256: Sha256Schema,
  }).strict(),
  runtime: RuntimeSchema,
}).strict();

const CandidateSchema = z.object({
  condition: z.enum(["baseline", "memi"]),
  candidateId: IdentifierSchema,
  artifactSha256: Sha256Schema,
}).strict();

const RouteBindingSchema = z.object({
  routerVersion: IdentifierSchema,
  taskClass: FrontendTaskClassSchema,
  repositoryFingerprintSha256: Sha256Schema,
  provider: IdentifierSchema,
  model: z.string().min(1).max(256),
  effort: z.string().min(1).max(64),
}).strict();

const SkillBindingSchema = z.object({
  id: IdentifierSchema,
  file: RepositoryRelativePathSchema,
  contentSha256: Sha256Schema,
}).strict();

const SelectedRouteInputSchema = RouteBindingSchema.extend({
  decision: z.literal("selected"),
  skill: SkillBindingSchema,
  additionalSkills: z.array(SkillBindingSchema).max(1).default([]),
}).strict();

const RepositoryOnlyRouteInputSchema = RouteBindingSchema.extend({
  decision: z.literal("repository-only"),
  skill: z.null(),
  abstentionReason: z.enum([
    "incomplete-evidence",
    "ambiguous-classification",
    "suppressed-route",
    "unsupported-route",
  ]),
}).strict();

const RouteInputSchema = z.discriminatedUnion("decision", [
  SelectedRouteInputSchema,
  RepositoryOnlyRouteInputSchema,
]);

const RouteSchema = z.discriminatedUnion("decision", [
  SelectedRouteInputSchema.extend({ identitySha256: Sha256Schema }).strict(),
  RepositoryOnlyRouteInputSchema.extend({ identitySha256: Sha256Schema }).strict(),
]);

const CapsuleHashSchema = z.object({
  identitySha256: Sha256Schema,
  taskRouteSha256: Sha256Schema,
  skillsSha256: Sha256Schema,
  repositoryEvidenceSha256: Sha256Schema,
  verificationSha256: Sha256Schema,
}).strict();

const ContextExpansionSchema = z.object({
  expansionId: IdentifierSchema,
  requestedAt: TimestampSchema,
  reason: z.enum([
    "missing-task-route-evidence",
    "missing-skill-evidence",
    "missing-repository-evidence",
    "missing-verification-evidence",
  ]),
  evidenceMissSha256: Sha256Schema,
  fromCapsuleSha256: Sha256Schema,
  toCapsuleSha256: Sha256Schema,
}).strict();

const ContextCapsulesSchema = z.object({
  initial: CapsuleHashSchema,
  expansions: z.array(ContextExpansionSchema).max(1),
}).strict();

const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  toolErrors: z.number().int().nonnegative(),
  toolOutputBytes: z.number().int().nonnegative(),
  agentWallTimeMs: z.number().int().nonnegative(),
  toolWallTimeMs: z.number().int().nonnegative(),
}).strict().superRefine((usage, context) => {
  if (usage.cachedInputTokens > usage.inputTokens) {
    context.addIssue({
      code: "custom",
      path: ["cachedInputTokens"],
      message: "cached input tokens cannot exceed input tokens",
    });
  }
  if (usage.toolErrors > usage.toolCalls) {
    context.addIssue({
      code: "custom",
      path: ["toolErrors"],
      message: "tool errors cannot exceed tool calls",
    });
  }
});

const AttemptSchema = z.object({
  attemptId: IdentifierSchema,
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
  outcome: z.enum(["completed", "retryable-failure", "fatal-failure", "timed-out"]),
  usage: UsageSchema,
}).strict();

const RetrySchema = z.object({
  retryId: IdentifierSchema,
  afterAttemptId: IdentifierSchema,
  requestedAt: TimestampSchema,
  reason: z.enum([
    "provider-transient",
    "tool-transient",
    "verification-actionable",
    "missing-skill-context",
    "harness-recovery",
  ]),
  evidenceSha256: Sha256Schema,
}).strict();

const BillingSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("measured"),
    currency: z.literal("USD"),
    amount: z.number().finite().nonnegative(),
    usageArtifactSha256: Sha256Schema,
    priceCardSha256: Sha256Schema,
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    currency: z.literal("USD"),
    amount: z.null(),
    usageArtifactSha256: z.null(),
    priceCardSha256: z.null(),
    reason: z.enum(["subscription-backed", "provider-unsupported", "preflight-failed"]),
  }).strict(),
]);

const BudgetStopReasonSchema = z.enum([
  "token-budget-exhausted",
  "tool-budget-exhausted",
  "time-budget-exhausted",
  "attempt-limit-reached",
]);

const BudgetEnforcementSchema = z.object({
  ceilings: z.object({
    inputTokens: z.number().int().positive(),
    outputTokens: z.number().int().positive(),
    reasoningTokens: z.number().int().nonnegative(),
    wallTimeMs: z.number().int().positive(),
    toolCalls: z.number().int().positive(),
    implementationAttempts: z.union([z.literal(1), z.literal(2)]),
  }).strict(),
  observed: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    wallTimeMs: z.number().int().nonnegative(),
  }).strict(),
  measurement: z.object({
    inputTokens: z.enum(["measured", "unavailable"]),
    outputTokens: z.enum(["measured", "unavailable"]),
    reasoningTokens: z.enum(["measured", "unavailable"]),
    toolCalls: z.enum(["measured", "unavailable"]),
  }).strict(),
  implementationAttempts: z.number().int().nonnegative().max(2),
  exceededDimensions: z.array(z.enum([
    "input-tokens",
    "output-tokens",
    "reasoning-tokens",
    "tool-calls",
    "wall-time",
  ])).max(5),
  stopReason: BudgetStopReasonSchema.nullable(),
  limitations: z.array(z.enum([
    "provider-request-cancellation-unavailable",
    "reasoning-token-usage-unavailable",
    "tool-call-usage-unavailable",
  ])).max(3),
}).strict().superRefine((budget, context) => {
  const expected: Array<"input-tokens" | "output-tokens" | "reasoning-tokens" | "tool-calls" | "wall-time"> = [];
  if (budget.observed.inputTokens > budget.ceilings.inputTokens) expected.push("input-tokens");
  if (budget.observed.outputTokens > budget.ceilings.outputTokens) expected.push("output-tokens");
  if (
    budget.measurement.reasoningTokens === "measured"
    && budget.observed.reasoningTokens > budget.ceilings.reasoningTokens
  ) expected.push("reasoning-tokens");
  if (
    budget.measurement.toolCalls === "measured"
    && budget.observed.toolCalls > budget.ceilings.toolCalls
  ) expected.push("tool-calls");
  if (
    budget.observed.wallTimeMs > budget.ceilings.wallTimeMs
    || (
      budget.stopReason === "time-budget-exhausted"
      && budget.observed.wallTimeMs >= budget.ceilings.wallTimeMs
    )
  ) expected.push("wall-time");
  if (JSON.stringify(expected) !== JSON.stringify(budget.exceededDimensions)) {
    context.addIssue({
      code: "custom",
      path: ["exceededDimensions"],
      message: "budget exceeded dimensions do not match measured usage",
    });
  }
  if (budget.implementationAttempts > budget.ceilings.implementationAttempts) {
    context.addIssue({
      code: "custom",
      path: ["implementationAttempts"],
      message: "budget implementation attempts exceed the contracted ceiling",
    });
  }
  const expectedStopReason = expected.some((dimension) => dimension.endsWith("tokens"))
    ? "token-budget-exhausted"
    : expected.includes("tool-calls")
      ? "tool-budget-exhausted"
      : expected.includes("wall-time")
        ? "time-budget-exhausted"
        : budget.stopReason === "attempt-limit-reached"
          ? "attempt-limit-reached"
          : null;
  if (budget.stopReason !== expectedStopReason) {
    context.addIssue({
      code: "custom",
      path: ["stopReason"],
      message: "budget stop reason does not match measured usage",
    });
  }
});

const ExecutionSchema = z.object({
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
  stopReason: z.enum([
    "verification-passed",
    "verification-failed",
    "provider-failed",
    "tool-failed",
    "token-budget-exhausted",
    "tool-budget-exhausted",
    "time-budget-exhausted",
    "attempt-limit-reached",
    "preflight-failed",
  ]),
  attempts: z.array(AttemptSchema).max(2),
  retries: z.array(RetrySchema).max(1),
  usage: UsageSchema,
  billing: BillingSchema,
  budgetEnforcement: BudgetEnforcementSchema.optional(),
}).strict();

const NativeEvidenceArtifactSchema = z.object({
  evidenceId: IdentifierSchema,
  kind: z.enum([
    "screenshot",
    "interaction-trace",
    "accessibility-tree",
    "reduced-motion-trace",
    "verification-log",
  ]),
  file: RepositoryRelativePathSchema,
  sha256: Sha256Schema,
  capturedAt: TimestampSchema,
  verifiedAt: TimestampSchema,
  freshUntil: TimestampSchema,
  freshnessWindowMs: z.number().int().positive().max(24 * 60 * 60 * 1_000),
}).strict();

const NativeEvidenceSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("admitted"),
    platform: z.enum(["web", "expo", "swiftui"]),
    artifacts: z.array(NativeEvidenceArtifactSchema).min(1).max(32),
  }).strict(),
  z.object({
    status: z.literal("excluded"),
    platform: z.enum(["web", "expo", "swiftui"]),
    artifacts: z.tuple([]),
    reason: z.enum([
      "missing-native-artifact",
      "preflight-failed",
      "driver-failed",
      "stale-artifact",
      "corrupt-artifact",
    ]),
  }).strict(),
]);

const VerificationResultSchema = z.object({
  verificationId: IdentifierSchema,
  kind: z.enum([
    "build",
    "unit",
    "integration",
    "rendered-flow",
    "ios-simulator",
    "accessibility",
  ]),
  commandSha256: Sha256Schema,
  status: z.enum(["passed", "failed", "timed-out", "skipped"]),
  exitCode: z.number().int().min(0).max(255).nullable(),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
  durationMs: z.number().int().nonnegative(),
  outputSha256: Sha256Schema,
}).strict();

export const WorkflowReceiptV3InputSchema = z.object({
  receiptId: IdentifierSchema,
  recordedAt: TimestampSchema,
  sequence: z.number().int().nonnegative(),
  stable: StableFieldsSchema,
  candidate: CandidateSchema,
  route: RouteInputSchema,
  contextCapsules: ContextCapsulesSchema,
  execution: ExecutionSchema,
  nativeEvidence: NativeEvidenceSchema,
  verification: z.array(VerificationResultSchema).min(1).max(64),
}).strict();

const ReceiptContentSchema = z.object({
  schemaVersion: z.literal("workflow-receipt.v3"),
  receiptId: IdentifierSchema,
  recordedAt: TimestampSchema,
  sequence: z.number().int().nonnegative(),
  stable: StableFieldsSchema,
  stableFieldsSha256: Sha256Schema,
  candidate: CandidateSchema,
  route: RouteSchema,
  contextCapsules: ContextCapsulesSchema,
  execution: ExecutionSchema,
  nativeEvidence: NativeEvidenceSchema,
  verification: z.array(VerificationResultSchema).min(1).max(64),
}).strict();

export const WorkflowReceiptV3Schema = ReceiptContentSchema.extend({
  receiptSha256: Sha256Schema,
}).strict().superRefine(validateReceipt);

export type WorkflowReceiptV3Input = z.infer<typeof WorkflowReceiptV3InputSchema>;
export type WorkflowReceiptV3 = z.infer<typeof WorkflowReceiptV3Schema>;

export function createWorkflowReceiptV3(input: unknown): Readonly<WorkflowReceiptV3> {
  const parsed = WorkflowReceiptV3InputSchema.parse(input);
  const route = RouteSchema.parse({
    ...parsed.route,
    identitySha256: hashValue(parsed.route),
  });
  const content = ReceiptContentSchema.parse({
    ...parsed,
    schemaVersion: "workflow-receipt.v3",
    stableFieldsSha256: hashValue(parsed.stable),
    route,
  });
  return deepFreeze(WorkflowReceiptV3Schema.parse({
    ...content,
    receiptSha256: hashValue(content),
  }));
}

export function verifyWorkflowReceiptV3(input: unknown): Readonly<{
  valid: boolean;
  reasons: readonly string[];
}> {
  const result = WorkflowReceiptV3Schema.safeParse(input);
  if (result.success) return deepFreeze({ valid: true, reasons: [] });
  return deepFreeze({
    valid: false,
    reasons: result.error.issues.map((issue) =>
      `${issue.path.length > 0 ? issue.path.join(".") : "receipt"}: ${issue.message}`),
  });
}

export function assertCandidateIndependentReceiptFields(input: unknown): Readonly<{
  stableFieldsSha256: string;
  receiptIds: readonly string[];
}> {
  const receipts = z.array(WorkflowReceiptV3Schema).min(2).parse(input);
  assertUniqueIds(receipts.map((receipt) => receipt.receiptId), "receipt");
  const expected = receipts[0]!.stableFieldsSha256;
  if (receipts.some((receipt) => receipt.stableFieldsSha256 !== expected)) {
    throw new Error("Candidate-independent receipt fields do not match");
  }
  return deepFreeze({
    stableFieldsSha256: expected,
    receiptIds: receipts.map((receipt) => receipt.receiptId),
  });
}

export function assertExactRouteReceiptFields(input: unknown): Readonly<{
  routeIdentitySha256: string;
  receiptIds: readonly string[];
}> {
  const receipts = z.array(WorkflowReceiptV3Schema).min(2).parse(input);
  assertUniqueIds(receipts.map((receipt) => receipt.receiptId), "receipt");
  const expected = receipts[0]!.route.identitySha256;
  if (receipts.some((receipt) => receipt.route.identitySha256 !== expected)) {
    throw new Error("Exact route receipt identity does not match");
  }
  return deepFreeze({
    routeIdentitySha256: expected,
    receiptIds: receipts.map((receipt) => receipt.receiptId),
  });
}

function validateReceipt(
  receipt: z.infer<typeof ReceiptContentSchema> & { receiptSha256: string },
  context: z.RefinementCtx,
): void {
  validateHashes(receipt, context);
  validateRouteBinding(receipt, context);
  validateExecution(receipt, context);
  validateContextExpansion(receipt, context);
  validateNativeEvidence(receipt, context);
  validateVerification(receipt, context);
}

function validateHashes(
  receipt: z.infer<typeof ReceiptContentSchema> & { receiptSha256: string },
  context: z.RefinementCtx,
): void {
  if (hashValue(receipt.stable) !== receipt.stableFieldsSha256) {
    issue(context, ["stableFieldsSha256"], "stable fields hash does not match content");
  }
  const { identitySha256, ...routeContent } = receipt.route;
  if (hashValue(routeContent) !== identitySha256) {
    issue(context, ["route", "identitySha256"], "route identity hash does not match content");
  }
  const { receiptSha256, ...content } = receipt;
  if (hashValue(content) !== receiptSha256) {
    issue(context, ["receiptSha256"], "receipt hash does not match canonical content");
  }
}

function validateRouteBinding(
  receipt: z.infer<typeof ReceiptContentSchema>,
  context: z.RefinementCtx,
): void {
  const bindings = [
    ["taskClass", receipt.route.taskClass, receipt.stable.taskClass],
    [
      "repositoryFingerprintSha256",
      receipt.route.repositoryFingerprintSha256,
      receipt.stable.repository.fingerprintSha256,
    ],
    ["provider", receipt.route.provider, receipt.stable.runtime.provider],
    ["model", receipt.route.model, receipt.stable.runtime.model],
    ["effort", receipt.route.effort, receipt.stable.runtime.effort],
  ] as const;
  for (const [field, actual, expected] of bindings) {
    if (actual !== expected) {
      issue(context, ["route", field], `route ${field} does not match stable binding`);
    }
  }
  if (receipt.route.decision === "selected") {
    const skills = [receipt.route.skill, ...receipt.route.additionalSkills];
    uniqueIssues(skills.map((skill) => skill.id), "skill", ["route", "additionalSkills"], context);
    uniqueIssues(
      skills.map((skill) => skill.contentSha256),
      "skill content",
      ["route", "additionalSkills"],
      context,
    );
  }
}

function validateExecution(
  receipt: z.infer<typeof ReceiptContentSchema>,
  context: z.RefinementCtx,
): void {
  const execution = receipt.execution;
  const executionStart = timestampMillis(execution.startedAt);
  const executionEnd = timestampMillis(execution.completedAt);
  const recordedAt = timestampMillis(receipt.recordedAt);
  if (executionStart > executionEnd || executionEnd > recordedAt) {
    issue(context, ["execution"], "execution chronology must finish before receipt recording");
  }
  uniqueIssues(execution.attempts.map((attempt) => attempt.attemptId), "attempt", ["execution", "attempts"], context);
  uniqueIssues(execution.retries.map((retry) => retry.retryId), "retry", ["execution", "retries"], context);
  if (execution.attempts.length === 0 && execution.stopReason !== "preflight-failed") {
    issue(context, ["execution", "attempts"], "only preflight-failed execution may have zero attempts");
  }
  const expectedRetryCount = Math.max(0, execution.attempts.length - 1);
  if (execution.retries.length !== expectedRetryCount) {
    issue(context, ["execution", "retries"], "retry count must equal attempts after the first");
  }
  for (let index = 0; index < execution.attempts.length; index += 1) {
    const attempt = execution.attempts[index]!;
    const start = timestampMillis(attempt.startedAt);
    const end = timestampMillis(attempt.completedAt);
    if (start > end || start < executionStart || end > executionEnd) {
      issue(context, ["execution", "attempts", index], "attempt chronology falls outside execution");
    }
    if (index > 0) {
      const prior = execution.attempts[index - 1]!;
      const retry = execution.retries[index - 1];
      if (start < timestampMillis(prior.completedAt)) {
        issue(context, ["execution", "attempts", index], "attempts must be chronological and non-overlapping");
      }
      if (!retry || retry.afterAttemptId !== prior.attemptId) {
        issue(context, ["execution", "retries", index - 1], "retry must reference the immediately preceding attempt");
      } else {
        const requested = timestampMillis(retry.requestedAt);
        if (requested < timestampMillis(prior.completedAt) || requested > start) {
          issue(context, ["execution", "retries", index - 1], "retry request must fall between attempts");
        }
      }
      if (prior.outcome !== "retryable-failure") {
        issue(context, ["execution", "attempts", index - 1, "outcome"], "a retried attempt must be a retryable failure");
      }
    }
  }
  const expectedUsage = sumUsage(execution.attempts.map((attempt) => attempt.usage));
  for (const key of Object.keys(expectedUsage) as (keyof typeof expectedUsage)[]) {
    if (execution.usage[key] !== expectedUsage[key]) {
      issue(context, ["execution", "usage", key], "aggregate usage does not equal attempt usage");
    }
  }
  const budget = execution.budgetEnforcement;
  if (budget) {
    if (budget.stopReason !== null && budget.stopReason !== execution.stopReason) {
      issue(context, ["execution", "stopReason"], "execution stop reason does not match budget evidence");
    }
    const observedUsage = budget.observed;
    for (const key of ["inputTokens", "outputTokens", "reasoningTokens", "toolCalls"] as const) {
      if (execution.usage[key] !== observedUsage[key]) {
        issue(context, ["execution", "usage", key], "execution usage does not match budget evidence");
      }
    }
    if (execution.usage.agentWallTimeMs !== observedUsage.wallTimeMs) {
      issue(context, ["execution", "usage", "agentWallTimeMs"], "execution wall time does not match budget evidence");
    }
  }
}

function validateContextExpansion(
  receipt: z.infer<typeof ReceiptContentSchema>,
  context: z.RefinementCtx,
): void {
  const expansion = receipt.contextCapsules.expansions[0];
  if (!expansion) return;
  if (expansion.fromCapsuleSha256 !== receipt.contextCapsules.initial.identitySha256) {
    issue(context, ["contextCapsules", "expansions", 0], "context expansion must bind the initial capsule");
  }
  if (expansion.toCapsuleSha256 === expansion.fromCapsuleSha256) {
    issue(context, ["contextCapsules", "expansions", 0], "context expansion must produce a new capsule");
  }
  const requested = timestampMillis(expansion.requestedAt);
  if (
    requested < timestampMillis(receipt.execution.startedAt)
    || requested > timestampMillis(receipt.execution.completedAt)
  ) {
    issue(context, ["contextCapsules", "expansions", 0, "requestedAt"], "context expansion must occur during execution");
  }
}

function validateNativeEvidence(
  receipt: z.infer<typeof ReceiptContentSchema>,
  context: z.RefinementCtx,
): void {
  if (
    receipt.nativeEvidence.status === "excluded"
    && receipt.execution.stopReason === "verification-passed"
  ) {
    issue(context, ["nativeEvidence", "status"], "excluded native evidence cannot pass verification");
  }
  const artifacts = receipt.nativeEvidence.artifacts;
  uniqueIssues(artifacts.map((artifact) => artifact.evidenceId), "native evidence", ["nativeEvidence", "artifacts"], context);
  uniqueIssues(artifacts.map((artifact) => artifact.file), "native evidence file", ["nativeEvidence", "artifacts"], context);
  const recordedAt = timestampMillis(receipt.recordedAt);
  const executionStart = timestampMillis(receipt.execution.startedAt);
  const executionEnd = timestampMillis(receipt.execution.completedAt);
  artifacts.forEach((artifact, index) => {
    const captured = timestampMillis(artifact.capturedAt);
    const verified = timestampMillis(artifact.verifiedAt);
    const freshUntil = timestampMillis(artifact.freshUntil);
    if (captured > verified) {
      issue(context, ["nativeEvidence", "artifacts", index], "native evidence must be captured before verification");
    }
    if (captured < executionStart || verified > executionEnd) {
      issue(context, ["nativeEvidence", "artifacts", index], "native evidence falls outside execution");
    }
    if (freshUntil - verified !== artifact.freshnessWindowMs) {
      issue(context, ["nativeEvidence", "artifacts", index, "freshnessWindowMs"], "native evidence freshness window does not match timestamps");
    }
    if (verified > recordedAt || recordedAt > freshUntil) {
      issue(context, ["nativeEvidence", "artifacts", index], "native evidence is not fresh when the receipt is recorded");
    }
  });
}

function validateVerification(
  receipt: z.infer<typeof ReceiptContentSchema>,
  context: z.RefinementCtx,
): void {
  uniqueIssues(receipt.verification.map((entry) => entry.verificationId), "verification", ["verification"], context);
  const executionStart = timestampMillis(receipt.execution.startedAt);
  const executionEnd = timestampMillis(receipt.execution.completedAt);
  receipt.verification.forEach((entry, index) => {
    const start = timestampMillis(entry.startedAt);
    const end = timestampMillis(entry.completedAt);
    if (start > end || start < executionStart || end > executionEnd) {
      issue(context, ["verification", index], "verification chronology falls outside execution");
    }
    if (end - start !== entry.durationMs) {
      issue(context, ["verification", index, "durationMs"], "verification duration does not match timestamps");
    }
    if (entry.status === "passed" && entry.exitCode !== 0) {
      issue(context, ["verification", index, "exitCode"], "passed verification requires exit code zero");
    }
    if (entry.status === "failed" && (entry.exitCode === null || entry.exitCode === 0)) {
      issue(context, ["verification", index, "exitCode"], "failed verification requires a non-zero exit code");
    }
    if ((entry.status === "timed-out" || entry.status === "skipped") && entry.exitCode !== null) {
      issue(context, ["verification", index, "exitCode"], `${entry.status} verification requires a null exit code`);
    }
  });
  if (
    receipt.execution.stopReason === "verification-passed"
    && receipt.verification.some((entry) => entry.status !== "passed")
  ) {
    issue(context, ["execution", "stopReason"], "verification-passed requires every verification result to pass");
  }
}

function sumUsage(usages: readonly z.infer<typeof UsageSchema>[]): z.infer<typeof UsageSchema> {
  const total: z.infer<typeof UsageSchema> = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    toolCalls: 0,
    toolErrors: 0,
    toolOutputBytes: 0,
    agentWallTimeMs: 0,
    toolWallTimeMs: 0,
  };
  for (const usage of usages) {
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += usage[key];
  }
  return total;
}

function assertUniqueIds(ids: readonly string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} id`);
}

function uniqueIssues(
  ids: readonly string[],
  label: string,
  path: (string | number)[],
  context: z.RefinementCtx,
): void {
  if (new Set(ids).size !== ids.length) issue(context, path, `duplicate ${label} id`);
}

function issue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}
