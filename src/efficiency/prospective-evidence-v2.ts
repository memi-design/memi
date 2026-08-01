import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const revisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
const artifactNameSchema = z.string()
  .min(1)
  .refine((value) => !value.includes("/") && !value.includes("\\"), {
    message: "must be a single evidence-directory filename",
  });

export const nativePlatformSchema = z.enum(["web", "expo", "swiftui"]);
export type NativePlatform = z.infer<typeof nativePlatformSchema>;

export const nativeCaptureKindSchema = z.enum([
  "screenshot",
  "interaction-trace",
  "accessibility-tree",
  "reduced-motion-trace",
  "verification-log",
]);
export type NativeCaptureKind = z.infer<typeof nativeCaptureKindSchema>;

const nativeCaptureSchema = z.object({
  kind: nativeCaptureKindSchema,
  name: artifactNameSchema,
  sha256: sha256Schema,
}).strict();

const evidenceArtifactSchema = z.object({
  name: artifactNameSchema,
  sha256: sha256Schema,
}).strict();

const billingSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.enum(["provider-usage-export", "invoice-allocation"]),
    currency: z.literal("USD"),
    amount: z.number().nonnegative(),
    sourceSha256: sha256Schema,
    priceCardSha256: sha256Schema,
    sourceArtifact: evidenceArtifactSchema,
    priceCardArtifact: evidenceArtifactSchema,
  }).strict(),
  z.object({
    source: z.literal("unavailable"),
    currency: z.literal("USD"),
    amount: z.literal(null),
    sourceSha256: z.literal(null),
    priceCardSha256: z.literal(null),
    sourceArtifact: z.literal(null),
    priceCardArtifact: z.literal(null),
  }).strict(),
]);

const evidenceContentSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal("memi-prospective-evidence-v2"),
  runId: z.string().min(1),
  trial: z.object({
    trialId: z.string().min(1),
    taskId: z.string().min(1),
    repeat: z.number().int().positive(),
    condition: z.enum(["baseline", "memi"]),
    repositoryRevision: revisionSchema,
    candidateArtifactSha256: sha256Schema,
  }).strict(),
  native: z.object({
    platform: nativePlatformSchema,
    captures: z.array(nativeCaptureSchema).min(1),
  }).strict(),
  billing: billingSchema,
  execution: z.object({
    stopReason: z.enum([
      "verification-passed",
      "verification-failed",
      "provider-failed",
      "token-budget-exhausted",
      "time-budget-exhausted",
      "preflight-failed",
    ]),
    retryReasons: z.array(z.string().min(1)).max(16),
    agentWallTimeMs: z.number().int().nonnegative(),
    verifierWallTimeMs: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export const prospectiveEvidenceV2Schema = evidenceContentSchema.superRefine(
  (receipt, context) => {
    const identities = receipt.native.captures.map((capture) =>
      `${capture.kind}:${capture.name}`);
  if (new Set(identities).size !== identities.length) {
      context.addIssue({
        code: "custom",
        path: ["native", "captures"],
        message: "capture kind and filename identities must be unique",
      });
  }
    if (
      receipt.billing.source !== "unavailable"
      && (
        receipt.billing.sourceSha256 !== receipt.billing.sourceArtifact.sha256
        || receipt.billing.priceCardSha256 !== receipt.billing.priceCardArtifact.sha256
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["billing"],
        message: "billing artifact hashes must match their declared source hashes",
      });
    }
  },
);
export type ProspectiveEvidenceV2 = z.infer<typeof prospectiveEvidenceV2Schema>;

export interface ProspectiveEvidenceV2Expectation {
  readonly runId: string;
  readonly trialId: string;
  readonly taskId: string;
  readonly repeat: number;
  readonly condition: "baseline" | "memi";
  readonly repositoryRevision: string;
  readonly candidateArtifactSha256: string;
  readonly platform: NativePlatform;
  readonly requiredCaptureKinds: readonly NativeCaptureKind[];
}

export function validateProspectiveEvidenceV2(input: {
  readonly receipt: ProspectiveEvidenceV2;
  readonly expected: ProspectiveEvidenceV2Expectation;
}): Readonly<{ valid: boolean; reasons: readonly string[] }> {
  const receipt = prospectiveEvidenceV2Schema.parse(input.receipt);
  const expected = expectationSchema.parse(input.expected);
  const reasons: string[] = [];

  compare("runId", receipt.runId, expected.runId, reasons);
  compare("trialId", receipt.trial.trialId, expected.trialId, reasons);
  compare("taskId", receipt.trial.taskId, expected.taskId, reasons);
  compare("repeat", receipt.trial.repeat, expected.repeat, reasons);
  compare("condition", receipt.trial.condition, expected.condition, reasons);
  compare(
    "repositoryRevision",
    receipt.trial.repositoryRevision,
    expected.repositoryRevision,
    reasons,
  );
  compare(
    "candidateArtifactSha256",
    receipt.trial.candidateArtifactSha256,
    expected.candidateArtifactSha256,
    reasons,
  );
  compare("platform", receipt.native.platform, expected.platform, reasons);

  const availableCaptureKinds = new Set(
    receipt.native.captures.map((capture) => capture.kind),
  );
  for (const kind of expected.requiredCaptureKinds) {
    if (!availableCaptureKinds.has(kind)) {
      reasons.push(`native-capture-missing:${kind}`);
    }
  }
  if (receipt.billing.source === "unavailable") {
    reasons.push("billing-unmeasured");
  }
  return deepFreeze({ valid: reasons.length === 0, reasons });
}

const expectationSchema = z.object({
  runId: z.string().min(1),
  trialId: z.string().min(1),
  taskId: z.string().min(1),
  repeat: z.number().int().positive(),
  condition: z.enum(["baseline", "memi"]),
  repositoryRevision: revisionSchema,
  candidateArtifactSha256: sha256Schema,
  platform: nativePlatformSchema,
  requiredCaptureKinds: z.array(nativeCaptureKindSchema).min(1),
}).strict();

function compare(
  field: string,
  actual: unknown,
  expected: unknown,
  reasons: string[],
): void {
  if (actual !== expected) reasons.push(`trial-binding-mismatch:${field}`);
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
