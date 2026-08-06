import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

export type NativePlatform = "expo" | "swiftui";
export type NativeArtifactKind =
  | "screenshot"
  | "accessibility-hierarchy"
  | "navigation-state"
  | "interaction-trace"
  | "reduced-motion"
  | "adaptive-layout";
export type NativeAdaptiveProfile =
  | "standard"
  | "compact"
  | "regular"
  | "accessibility";

export interface NativeJourneyStep {
  readonly id: string;
  readonly ordinal: number;
  readonly action: "launch" | "activate" | "assert";
}

export interface NativeJourney {
  readonly id: string;
  readonly steps: readonly NativeJourneyStep[];
  readonly expectedNavigationStates: readonly string[];
}

export interface NativeVerificationRequirement {
  readonly id: string;
  readonly kind: NativeArtifactKind;
  readonly mimeType: "image/png" | "application/json";
  readonly profile: NativeAdaptiveProfile;
}

export interface NativeVerificationPlan {
  readonly schemaVersion: 1;
  readonly platform: NativePlatform;
  readonly isolation: "exclusive-simulator-lease";
  readonly resetPolicy: "clean-before-capture";
  readonly journey: NativeJourney;
  readonly requirements: readonly NativeVerificationRequirement[];
}

export interface NativeArtifactCandidate {
  readonly requirementId: string;
  /** Relative to evidenceRoot. Absolute paths are never admitted. */
  readonly path: string;
  readonly capturedAt: string;
}

export interface NativeSimulatorLeaseDescriptor {
  readonly leaseId: string;
  readonly simulatorId: string;
  readonly acquiredAt: string;
  readonly exclusive: true;
}

export interface NativeSimulatorResetReceipt {
  readonly leaseId: string;
  readonly simulatorId: string;
  readonly resetAt: string;
  readonly clean: boolean;
}

export interface NativeSimulatorLease {
  readonly descriptor: NativeSimulatorLeaseDescriptor;
  reset(): Promise<NativeSimulatorResetReceipt>;
  capture(
    plan: NativeVerificationPlan,
  ): Promise<readonly NativeArtifactCandidate[]>;
  release(): Promise<void>;
}

/**
 * Host integration boundary. Implementations may wrap simctl, XCTest, Maestro,
 * or another native harness. This module never boots or controls Simulator.
 */
export interface NativeVerificationDriver {
  acquireExclusiveSimulatorLease(input: {
    readonly platform: NativePlatform;
    readonly isolation: "exclusive";
  }): Promise<NativeSimulatorLease>;
}

export interface NativeVerificationInput {
  readonly evidenceRoot: string;
  readonly runStartedAt: string;
  readonly runCompletedAt: string;
}

export interface NativeArtifactReceipt {
  readonly requirementId: string;
  readonly kind: NativeArtifactKind;
  readonly mimeType: NativeVerificationRequirement["mimeType"];
  readonly profile: NativeAdaptiveProfile;
  readonly path: string;
  readonly capturedAt: string;
  readonly bytes: number;
  readonly sha256: `sha256:${string}`;
}

export interface NativeVerificationResult {
  readonly schemaVersion: 1;
  readonly adapter: "expo-native-v1" | "swiftui-native-v1";
  readonly platform: NativePlatform;
  readonly status: "passed" | "failed" | "rejected";
  readonly evidenceRootSha256: `sha256:${string}`;
  readonly simulatorLeaseSha256: `sha256:${string}` | null;
  readonly simulatorIdSha256: `sha256:${string}` | null;
  readonly resetAt: string | null;
  readonly runStartedAt: string;
  readonly runCompletedAt: string;
  readonly reasons: readonly string[];
  readonly artifacts: readonly NativeArtifactReceipt[];
  readonly manifestSha256: `sha256:${string}`;
}

const timestampSchema = z.string().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  { message: "must be an ISO-8601 timestamp" },
);

const inputSchema = z.object({
  evidenceRoot: z.string().min(1),
  runStartedAt: timestampSchema,
  runCompletedAt: timestampSchema,
}).strict().superRefine((input, context) => {
  if (Date.parse(input.runCompletedAt) < Date.parse(input.runStartedAt)) {
    context.addIssue({
      code: "custom",
      path: ["runCompletedAt"],
      message: "must be at or after runStartedAt",
    });
  }
});

const candidateSchema = z.object({
  requirementId: z.string().min(1),
  path: z.string().min(1).refine(
    (value) => !isAbsolute(value) && !value.includes("\0"),
    { message: "must be a relative evidence path" },
  ),
  capturedAt: timestampSchema,
}).strict();

const leaseSchema = z.object({
  leaseId: z.string().min(1),
  simulatorId: z.string().min(1),
  acquiredAt: timestampSchema,
  exclusive: z.literal(true),
}).strict();

const resetSchema = z.object({
  leaseId: z.string().min(1),
  simulatorId: z.string().min(1),
  resetAt: timestampSchema,
  clean: z.boolean(),
}).strict();

const accessibilityNodeSchema: z.ZodType<{
  role: string;
  label?: string;
  children: Array<{ role: string; label?: string; children: unknown[] }>;
}> = z.lazy(() => z.object({
  role: z.string().min(1),
  label: z.string().min(1).optional(),
  children: z.array(accessibilityNodeSchema),
}).strict()) as z.ZodType<{
  role: string;
  label?: string;
  children: Array<{ role: string; label?: string; children: unknown[] }>;
}>;

const accessibilitySchema = z.object({
  schemaVersion: z.literal(1),
  completed: z.literal(true),
  root: accessibilityNodeSchema,
}).strict();

const navigationSchema = z.object({
  schemaVersion: z.literal(1),
  completed: z.literal(true),
  journeyId: z.string().min(1),
  orderedStates: z.array(z.string().min(1)).min(1),
  finalState: z.string().min(1),
}).strict();

const traceSchema = z.object({
  schemaVersion: z.literal(1),
  completed: z.literal(true),
  journeyId: z.string().min(1),
  orderedStepIds: z.array(z.string().min(1)).min(1),
  failures: z.array(z.string().min(1)),
}).strict();

const reducedMotionSchema = z.object({
  schemaVersion: z.literal(1),
  completed: z.literal(true),
  setting: z.literal("reduce"),
  observations: z.array(z.object({
    transition: z.string().min(1),
    animated: z.boolean(),
  }).strict()).min(1),
  failures: z.array(z.string().min(1)),
}).strict();

const adaptiveSchema = z.object({
  schemaVersion: z.literal(1),
  completed: z.literal(true),
  profile: z.enum(["compact", "regular", "accessibility"]),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict(),
  contentSizeCategory: z.string().min(1),
  failures: z.array(z.string().min(1)),
}).strict();

interface Admission {
  readonly receipt?: NativeArtifactReceipt;
  readonly admissionReasons: readonly string[];
  readonly verificationReasons: readonly string[];
}

interface SimulatorContext {
  readonly lease: NativeSimulatorLeaseDescriptor;
  readonly reset: NativeSimulatorResetReceipt;
}

let simulatorQueue: Promise<unknown> = Promise.resolve();

export function freezeNativePlan(
  plan: NativeVerificationPlan,
): NativeVerificationPlan {
  validatePlan(plan);
  return deepFreeze({
    ...plan,
    journey: {
      ...plan.journey,
      steps: plan.journey.steps.map((step) => ({ ...step })),
      expectedNavigationStates: [...plan.journey.expectedNavigationStates],
    },
    requirements: plan.requirements.map((requirement) => ({ ...requirement })),
  });
}

/** Runs one fail-closed native evidence admission under a shared serial lease. */
export async function runNativeVerification(
  rawInput: NativeVerificationInput,
  driver: NativeVerificationDriver,
  plan: NativeVerificationPlan,
): Promise<NativeVerificationResult> {
  const input = inputSchema.parse(rawInput);
  return serializeSimulatorUse(async () => {
    const evidenceRoot = await canonicalEvidenceRoot(input.evidenceRoot);
    if (!evidenceRoot.valid) {
      return buildResult({
        input,
        plan,
        evidenceRoot: resolve(input.evidenceRoot),
        status: "rejected",
        reasons: ["evidence-root-invalid"],
        artifacts: [],
        simulator: null,
      });
    }
    return captureAndAdmit(input, driver, plan, evidenceRoot.path);
  });
}

async function captureAndAdmit(
  input: z.infer<typeof inputSchema>,
  driver: NativeVerificationDriver,
  plan: NativeVerificationPlan,
  evidenceRoot: string,
): Promise<NativeVerificationResult> {
  let lease: NativeSimulatorLease;
  try {
    lease = await driver.acquireExclusiveSimulatorLease({
      platform: plan.platform,
      isolation: "exclusive",
    });
  } catch (error) {
    return rejectedResult(input, plan, evidenceRoot, `simulator-lease-failed:${errorName(error)}`);
  }
  const parsedLease = leaseSchema.safeParse(lease?.descriptor);
  if (!parsedLease.success || !hasLeaseMethods(lease)) {
    return rejectedResult(input, plan, evidenceRoot, "simulator-lease-invalid");
  }

  const leaseDescriptor = parsedLease.data;
  let captured: readonly NativeArtifactCandidate[] | null = null;
  let reset: NativeSimulatorResetReceipt | null = null;
  let rejection: string | null = null;
  try {
    if (!timestampWithinRun(leaseDescriptor.acquiredAt, input)) {
      rejection = "simulator-lease-stale";
    } else {
      const rawReset = await lease.reset();
      const parsedReset = resetSchema.safeParse(rawReset);
      if (!parsedReset.success
        || parsedReset.data.leaseId !== leaseDescriptor.leaseId
        || parsedReset.data.simulatorId !== leaseDescriptor.simulatorId
        || !timestampWithinRun(parsedReset.data.resetAt, input)
        || Date.parse(parsedReset.data.resetAt) < Date.parse(leaseDescriptor.acquiredAt)) {
        rejection = "simulator-reset-invalid";
      } else if (!parsedReset.data.clean) {
        rejection = "simulator-reset-not-clean";
      } else {
        reset = parsedReset.data;
        try {
          captured = await lease.capture(plan);
        } catch (error) {
          rejection = `capture-failed:${errorName(error)}`;
        }
      }
    }
  } catch (error) {
    rejection = `simulator-reset-failed:${errorName(error)}`;
  } finally {
    try {
      await lease.release();
    } catch (error) {
      rejection = `simulator-release-failed:${errorName(error)}`;
      captured = null;
    }
  }
  const simulator = reset ? { lease: leaseDescriptor, reset } : null;
  if (rejection) {
    return rejectedResult(input, plan, evidenceRoot, rejection, simulator);
  }
  if (!Array.isArray(captured)) {
    return rejectedResult(
      input,
      plan,
      evidenceRoot,
      "capture-invalid:candidates-must-be-an-array",
      simulator,
    );
  }
  return admitCandidates(input, plan, evidenceRoot, captured, simulator);
}

async function admitCandidates(
  input: z.infer<typeof inputSchema>,
  plan: NativeVerificationPlan,
  evidenceRoot: string,
  rawCandidates: readonly NativeArtifactCandidate[],
  simulator: SimulatorContext | null,
): Promise<NativeVerificationResult> {
  const parsedCandidates = rawCandidates.map((candidate, index) => ({
    index,
    parsed: candidateSchema.safeParse(candidate),
  }));
  const candidateReasons = parsedCandidates.flatMap(({ index, parsed }) => {
    if (!parsed.success) return [`artifact-candidate-invalid:${index}`];
    if (!requirementById(plan, parsed.data.requirementId)) {
      return [`artifact-unexpected:${parsed.data.requirementId}`];
    }
    return [];
  });
  const validCandidates = parsedCandidates.flatMap(({ parsed }) =>
    parsed.success && requirementById(plan, parsed.data.requirementId)
      ? [parsed.data]
      : []);
  const counts = validCandidates.reduce<Readonly<Record<string, number>>>(
    (current, candidate) => ({
      ...current,
      [candidate.requirementId]: (current[candidate.requirementId] ?? 0) + 1,
    }),
    {},
  );
  const duplicateReasons = Object.entries(counts).flatMap(([id, count]) =>
    count > 1 ? [`artifact-duplicate:${id}`] : []);
  const candidateById = validCandidates.reduce<
  Readonly<Record<string, z.infer<typeof candidateSchema>>>>(
    (current, candidate) => current[candidate.requirementId]
      ? current
      : { ...current, [candidate.requirementId]: candidate },
    {},
  );
  const admissions = await Promise.all(plan.requirements.map(async (requirement) => {
    const candidate = candidateById[requirement.id];
    return candidate
      ? admitArtifact({ evidenceRoot, input, plan, requirement, candidate })
      : rejected(`artifact-missing:${requirement.id}`);
  }));
  const admitted = admissions.flatMap((admission) =>
    admission.receipt ? [admission.receipt] : []);
  const pathCounts = admitted.reduce<Readonly<Record<string, number>>>(
    (current, artifact) => ({
      ...current,
      [artifact.path]: (current[artifact.path] ?? 0) + 1,
    }),
    {},
  );
  const duplicatePathIds = new Set(admitted.flatMap((artifact) =>
    (pathCounts[artifact.path] ?? 0) > 1 ? [artifact.requirementId] : []));
  const pathReasons = [...duplicatePathIds].map((id) =>
    `artifact-path-duplicate:${id}`);
  const artifacts = admitted.filter((artifact) =>
    !duplicatePathIds.has(artifact.requirementId));
  const admissionReasons = [
    ...candidateReasons,
    ...duplicateReasons,
    ...admissions.flatMap((admission) => admission.admissionReasons),
    ...pathReasons,
  ];
  const verificationReasons = admissions.flatMap((admission) =>
    admission.verificationReasons);
  return buildResult({
    input,
    plan,
    evidenceRoot,
    status: admissionReasons.length > 0
      ? "rejected"
      : verificationReasons.length > 0 ? "failed" : "passed",
    reasons: [...admissionReasons, ...verificationReasons],
    artifacts,
    simulator,
  });
}

async function admitArtifact(input: {
  readonly evidenceRoot: string;
  readonly input: z.infer<typeof inputSchema>;
  readonly plan: NativeVerificationPlan;
  readonly requirement: NativeVerificationRequirement;
  readonly candidate: z.infer<typeof candidateSchema>;
}): Promise<Admission> {
  const id = input.requirement.id;
  if (!timestampWithinRun(input.candidate.capturedAt, input.input)) {
    return rejected(`artifact-stale:${id}`);
  }
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(resolve(input.evidenceRoot, input.candidate.path));
  } catch {
    return rejected(`artifact-file-missing:${id}`);
  }
  if (!isWithinRoot(input.evidenceRoot, canonicalPath)) {
    return rejected(`artifact-outside-evidence-root:${id}`);
  }
  try {
    const before = await stat(canonicalPath);
    if (!before.isFile() || before.size === 0 || before.size > 16 * 1024 * 1024) {
      return rejected(`artifact-invalid-file:${id}`);
    }
    if (before.mtimeMs < Date.parse(input.input.runStartedAt)
      || before.mtimeMs > Date.parse(input.input.runCompletedAt) + 1_000) {
      return rejected(`artifact-stale:${id}`);
    }
    const bytes = await readFile(canonicalPath);
    const after = await stat(canonicalPath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      return rejected(`artifact-changed-during-read:${id}`);
    }
    const content = validateContent(input.requirement, input.plan, bytes);
    if (!content.valid) return rejected(`artifact-invalid-content:${id}`);
    return {
      receipt: {
        requirementId: id,
        kind: input.requirement.kind,
        mimeType: input.requirement.mimeType,
        profile: input.requirement.profile,
        path: normalizeRelativePath(relative(input.evidenceRoot, canonicalPath)),
        capturedAt: input.candidate.capturedAt,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      },
      admissionReasons: [],
      verificationReasons: content.verificationReasons,
    };
  } catch {
    return rejected(`artifact-unreadable:${id}`);
  }
}

function validateContent(
  requirement: NativeVerificationRequirement,
  plan: NativeVerificationPlan,
  bytes: Buffer,
): Readonly<{ valid: boolean; verificationReasons: readonly string[] }> {
  if (requirement.kind === "screenshot") {
    return { valid: isPng(bytes), verificationReasons: [] };
  }
  if (bytes.byteLength > 2 * 1024 * 1024) {
    return { valid: false, verificationReasons: [] };
  }
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { valid: false, verificationReasons: [] };
  }
  if (requirement.kind === "accessibility-hierarchy") {
    return validity(accessibilitySchema.safeParse(json).success);
  }
  if (requirement.kind === "navigation-state") {
    const parsed = navigationSchema.safeParse(json);
    const valid = parsed.success
      && parsed.data.journeyId === plan.journey.id
      && arraysEqual(parsed.data.orderedStates, plan.journey.expectedNavigationStates)
      && parsed.data.finalState === plan.journey.expectedNavigationStates.at(-1);
    return validity(valid);
  }
  if (requirement.kind === "interaction-trace") {
    const parsed = traceSchema.safeParse(json);
    const valid = parsed.success
      && parsed.data.journeyId === plan.journey.id
      && arraysEqual(
        parsed.data.orderedStepIds,
        plan.journey.steps.map((step) => step.id),
      );
    return valid
      ? validity(true, parsed.data.failures.length > 0
        ? [`interaction-trace-failures:${parsed.data.failures.length}`]
        : [])
      : validity(false);
  }
  if (requirement.kind === "reduced-motion") {
    const parsed = reducedMotionSchema.safeParse(json);
    if (!parsed.success) return validity(false);
    const animated = parsed.data.observations.filter((entry) => entry.animated).length;
    return validity(true, [
      ...(parsed.data.failures.length > 0
        ? [`reduced-motion-failures:${parsed.data.failures.length}`]
        : []),
      ...(animated > 0 ? [`reduced-motion-animated-transitions:${animated}`] : []),
    ]);
  }
  const parsed = adaptiveSchema.safeParse(json);
  if (!parsed.success || parsed.data.profile !== requirement.profile) {
    return validity(false);
  }
  return validity(true, parsed.data.failures.length > 0
    ? [`adaptive-layout-failures:${requirement.profile}:${parsed.data.failures.length}`]
    : []);
}

function buildResult(input: {
  readonly input: z.infer<typeof inputSchema>;
  readonly plan: NativeVerificationPlan;
  readonly evidenceRoot: string;
  readonly status: NativeVerificationResult["status"];
  readonly reasons: readonly string[];
  readonly artifacts: readonly NativeArtifactReceipt[];
  readonly simulator: SimulatorContext | null;
}): NativeVerificationResult {
  const payload = {
    schemaVersion: 1 as const,
    adapter: `${input.plan.platform}-native-v1` as NativeVerificationResult["adapter"],
    platform: input.plan.platform,
    status: input.status,
    evidenceRootSha256: sha256(Buffer.from(input.evidenceRoot)),
    simulatorLeaseSha256: input.simulator
      ? sha256(Buffer.from(input.simulator.lease.leaseId)) : null,
    simulatorIdSha256: input.simulator
      ? sha256(Buffer.from(input.simulator.lease.simulatorId)) : null,
    resetAt: input.simulator?.reset.resetAt ?? null,
    runStartedAt: input.input.runStartedAt,
    runCompletedAt: input.input.runCompletedAt,
    reasons: [...input.reasons],
    artifacts: input.artifacts.map((artifact) => ({ ...artifact })),
  };
  return deepFreeze({
    ...payload,
    manifestSha256: sha256(Buffer.from(canonicalJson(payload))),
  });
}

function rejectedResult(
  input: z.infer<typeof inputSchema>,
  plan: NativeVerificationPlan,
  evidenceRoot: string,
  reason: string,
  simulator: SimulatorContext | null = null,
): NativeVerificationResult {
  return buildResult({
    input,
    plan,
    evidenceRoot,
    status: "rejected",
    reasons: [reason],
    artifacts: [],
    simulator,
  });
}

function serializeSimulatorUse<T>(operation: () => Promise<T>): Promise<T> {
  const queued = simulatorQueue.then(operation, operation);
  simulatorQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

async function canonicalEvidenceRoot(
  path: string,
): Promise<Readonly<{ valid: true; path: string }> | Readonly<{ valid: false }>> {
  try {
    const canonical = await realpath(path);
    const metadata = await stat(canonical);
    return metadata.isDirectory()
      ? { valid: true, path: canonical }
      : { valid: false };
  } catch {
    return { valid: false };
  }
}

function validatePlan(plan: NativeVerificationPlan): void {
  const stepIds = plan.journey.steps.map((step) => step.id);
  const requirementIds = plan.requirements.map((requirement) => requirement.id);
  const ordered = plan.journey.steps.every((step, index) => step.ordinal === index);
  if (!ordered || new Set(stepIds).size !== stepIds.length) {
    throw new Error("native journey steps must have unique IDs and contiguous ordinals");
  }
  if (new Set(requirementIds).size !== requirementIds.length) {
    throw new Error("native verification requirement IDs must be unique");
  }
}

function hasLeaseMethods(lease: NativeSimulatorLease): boolean {
  return Boolean(lease)
    && typeof lease.reset === "function"
    && typeof lease.capture === "function"
    && typeof lease.release === "function";
}

function requirementById(
  plan: NativeVerificationPlan,
  id: string,
): NativeVerificationRequirement | undefined {
  return plan.requirements.find((requirement) => requirement.id === id);
}

function timestampWithinRun(
  timestamp: string,
  input: Pick<NativeVerificationInput, "runStartedAt" | "runCompletedAt">,
): boolean {
  const value = Date.parse(timestamp);
  return value >= Date.parse(input.runStartedAt)
    && value <= Date.parse(input.runCompletedAt);
}

function isWithinRoot(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot.length > 0
    && pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot);
}

function normalizeRelativePath(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

function isPng(bytes: Buffer): boolean {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00,
    0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);
  return bytes.length >= 45
    && bytes.subarray(0, signature.length).equals(signature)
    && bytes.readUInt32BE(8) === 13
    && bytes.subarray(12, 16).equals(Buffer.from("IHDR"))
    && bytes.subarray(bytes.length - iend.length).equals(iend);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function validity(
  valid: boolean,
  verificationReasons: readonly string[] = [],
): Readonly<{ valid: boolean; verificationReasons: readonly string[] }> {
  return { valid, verificationReasons };
}

function rejected(reason: string): Admission {
  return { admissionReasons: [reason], verificationReasons: [] };
}

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function errorName(error: unknown): string {
  if (!(error instanceof Error)) return "unknown-error";
  const safeName = error.name.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 64);
  return safeName || "Error";
}
