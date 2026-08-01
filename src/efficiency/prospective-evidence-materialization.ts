import { copyFile, chmod, lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  nativeCaptureKindSchema,
  prospectiveEvidenceV2Schema,
  validateProspectiveEvidenceV2,
  type ProspectiveEvidenceV2,
  type ProspectiveEvidenceV2Expectation,
} from "./prospective-evidence-v2.js";
import { hashFile } from "./prospective-files.js";

const artifactNameSchema = z.string()
  .min(1)
  .refine((value) => !value.includes("/") && !value.includes("\\"), {
    message: "must be a single evidence-directory filename",
  });
const sourcePathSchema = z.string().min(1).refine((value) => {
  const normalized = value.replace(/\\/g, "/");
  return !path.isAbsolute(value) && !normalized.split("/").includes("..");
}, { message: "must be a relative path contained by artifact root" });
const draftArtifactSchema = z.object({
  name: artifactNameSchema,
  source: sourcePathSchema,
}).strict();

const draftBillingSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.enum(["provider-usage-export", "invoice-allocation"]),
    currency: z.literal("USD"),
    amount: z.number().nonnegative(),
    sourceArtifact: draftArtifactSchema,
    priceCardArtifact: draftArtifactSchema,
  }).strict(),
  z.object({
    source: z.literal("unavailable"),
    currency: z.literal("USD"),
    amount: z.literal(null),
  }).strict(),
]);

export const prospectiveEvidenceDraftSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("memi-prospective-evidence-draft-v1"),
  native: z.object({
    captures: z.array(z.object({
      kind: nativeCaptureKindSchema,
      name: artifactNameSchema,
      source: sourcePathSchema,
    }).strict()).min(1),
  }).strict(),
  billing: draftBillingSchema,
  execution: z.object({
    retryReasons: z.array(z.string().min(1)).max(16),
  }).strict(),
}).strict().superRefine((draft, context) => {
  const names = [
    ...draft.native.captures.map((capture) => capture.name),
    ...(draft.billing.source === "unavailable" ? [] : [
      draft.billing.sourceArtifact.name,
      draft.billing.priceCardArtifact.name,
    ]),
  ];
  if (new Set(names).size !== names.length) {
    context.addIssue({
      code: "custom",
      path: ["native", "captures"],
      message: "evidence artifact filenames must be unique",
    });
  }
});
export type ProspectiveEvidenceDraft = z.infer<typeof prospectiveEvidenceDraftSchema>;

const executionSchema = z.object({
  stopReason: z.enum([
    "verification-passed",
    "verification-failed",
    "provider-failed",
    "token-budget-exhausted",
    "time-budget-exhausted",
    "preflight-failed",
  ]),
  agentWallTimeMs: z.number().int().nonnegative(),
  verifierWallTimeMs: z.number().int().nonnegative(),
}).strict();

export async function materializeProspectiveEvidenceV2(input: {
  readonly artifactRoot: string;
  readonly evidenceDirectory: string;
  readonly draft: ProspectiveEvidenceDraft;
  readonly expected: ProspectiveEvidenceV2Expectation;
  readonly execution: z.infer<typeof executionSchema>;
}): Promise<Readonly<ProspectiveEvidenceV2>> {
  const draft = prospectiveEvidenceDraftSchema.parse(input.draft);
  const expected = input.expected;
  const execution = executionSchema.parse(input.execution);
  const artifactRoot = await realpath(path.resolve(input.artifactRoot));
  const evidenceDirectory = path.resolve(input.evidenceDirectory);
  const artifacts = draftArtifacts(draft);
  const sources = await Promise.all(artifacts.map(async (artifact) => ({
    artifact,
    source: await resolveRegularArtifactSource({
      artifactRoot,
      source: artifact.source,
    }),
  })));

  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await Promise.all(sources.map(async ({ artifact, source }) => {
    const target = path.join(evidenceDirectory, artifact.name);
    await assertAbsent(target, artifact.name);
    await copyFile(source, target);
    await chmod(target, 0o600);
  }));

  const copied = await Promise.all(sources.map(async ({ artifact }) => ({
    ...artifact,
    sha256: await hashFile(path.join(evidenceDirectory, artifact.name)),
  })));
  const copiedByName = new Map(copied.map((artifact) => [artifact.name, artifact]));
  const capture = (name: string) => {
    const artifact = copiedByName.get(name);
    if (!artifact) throw new Error(`copied capture missing: ${name}`);
    return artifact;
  };
  const receipt = prospectiveEvidenceV2Schema.parse({
    schemaVersion: 2,
    kind: "memi-prospective-evidence-v2",
    runId: expected.runId,
    trial: {
      trialId: expected.trialId,
      taskId: expected.taskId,
      repeat: expected.repeat,
      condition: expected.condition,
      repositoryRevision: expected.repositoryRevision,
      candidateArtifactSha256: expected.candidateArtifactSha256,
    },
    native: {
      platform: expected.platform,
      captures: draft.native.captures.map((item) => ({
        kind: item.kind,
        name: item.name,
        sha256: capture(item.name).sha256,
      })),
    },
    billing: draft.billing.source === "unavailable"
      ? {
        source: "unavailable",
        currency: "USD",
        amount: null,
        sourceSha256: null,
        priceCardSha256: null,
        sourceArtifact: null,
        priceCardArtifact: null,
      }
      : {
        source: draft.billing.source,
        currency: "USD",
        amount: draft.billing.amount,
        sourceSha256: capture(draft.billing.sourceArtifact.name).sha256,
        priceCardSha256: capture(draft.billing.priceCardArtifact.name).sha256,
        sourceArtifact: {
          name: draft.billing.sourceArtifact.name,
          sha256: capture(draft.billing.sourceArtifact.name).sha256,
        },
        priceCardArtifact: {
          name: draft.billing.priceCardArtifact.name,
          sha256: capture(draft.billing.priceCardArtifact.name).sha256,
        },
      },
    execution: {
      stopReason: execution.stopReason,
      retryReasons: draft.execution.retryReasons,
      agentWallTimeMs: execution.agentWallTimeMs,
      verifierWallTimeMs: execution.verifierWallTimeMs,
    },
  });
  const validation = validateProspectiveEvidenceV2({ receipt, expected });
  if (!validation.valid) {
    throw new Error(`prospective evidence draft is not admissible: ${validation.reasons.join(", ")}`);
  }
  const receiptPath = path.join(evidenceDirectory, "prospective-evidence-v2.json");
  await assertAbsent(receiptPath, "prospective-evidence-v2.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  return deepFreeze(receipt);
}

function draftArtifacts(
  draft: ProspectiveEvidenceDraft,
): readonly Readonly<{ name: string; source: string }>[] {
  return [
    ...draft.native.captures.map(({ name, source }) => ({ name, source })),
    ...(draft.billing.source === "unavailable" ? [] : [
      draft.billing.sourceArtifact,
      draft.billing.priceCardArtifact,
    ]),
  ];
}

async function resolveRegularArtifactSource(input: {
  readonly artifactRoot: string;
  readonly source: string;
}): Promise<string> {
  const candidate = path.resolve(input.artifactRoot, input.source);
  assertContained(input.artifactRoot, candidate, "artifact source");
  const stats = await lstat(candidate).catch(() => null);
  if (!stats?.isFile()) {
    throw new Error(`evidence artifact source must be a regular file: ${input.source}`);
  }
  const resolved = await realpath(candidate);
  assertContained(input.artifactRoot, resolved, "artifact source");
  return resolved;
}

async function assertAbsent(target: string, name: string): Promise<void> {
  const stats = await lstat(target).catch(() => null);
  if (stats) throw new Error(`evidence artifact already exists: ${name}`);
}

function assertContained(root: string, candidate: string, label: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes artifact root`);
  }
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
