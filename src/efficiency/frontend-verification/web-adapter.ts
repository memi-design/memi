import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  WEB_VERIFICATION_REQUIREMENTS,
  type WebArtifactKind,
  type WebColorScheme,
  type WebReducedMotion,
  type WebUiState,
  type WebVerificationRequirement,
  type WebViewport,
} from "./web-contract.js";

export { WEB_VERIFICATION_REQUIREMENTS } from "./web-contract.js";

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
  browser: z.literal("chromium"),
  path: z.string().min(1).refine(
    (value) => !isAbsolute(value) && !value.includes("\0"),
    { message: "must be a relative evidence path" },
  ),
  capturedAt: timestampSchema,
}).strict();

const focusEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  completed: z.literal(true),
  interactions: z.number().int().positive(),
  failures: z.array(z.string().min(1)),
}).strict();

const axeEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  completed: z.literal(true),
  violations: z.array(z.object({
    id: z.string().min(1),
    impact: z.enum(["minor", "moderate", "serious", "critical"]),
    nodes: z.number().int().positive(),
  }).strict()),
}).strict();

export interface WebArtifactCandidate {
  readonly requirementId: string;
  readonly browser: "chromium";
  /** Relative to the evidence root. Absolute paths are never admitted. */
  readonly path: string;
  readonly capturedAt: string;
}

export interface WebVerificationDriver {
  capture(
    requirements: readonly WebVerificationRequirement[],
  ): Promise<readonly WebArtifactCandidate[]>;
}

export interface WebVerificationAdapterInput {
  readonly evidenceRoot: string;
  readonly runStartedAt: string;
  readonly runCompletedAt: string;
}

export interface WebArtifactReceipt {
  readonly requirementId: string;
  readonly kind: WebArtifactKind;
  readonly browser: "chromium";
  readonly viewport: WebViewport;
  readonly colorScheme: WebColorScheme;
  readonly reducedMotion: WebReducedMotion;
  readonly state: WebUiState;
  readonly mimeType: WebVerificationRequirement["mimeType"];
  readonly path: string;
  readonly capturedAt: string;
  readonly bytes: number;
  readonly sha256: `sha256:${string}`;
}

export interface WebVerificationResult {
  readonly schemaVersion: 1;
  readonly adapter: "chromium-web-v1";
  readonly status: "passed" | "failed" | "rejected";
  readonly evidenceRoot: string;
  readonly runStartedAt: string;
  readonly runCompletedAt: string;
  readonly reasons: readonly string[];
  readonly artifacts: readonly WebArtifactReceipt[];
  readonly manifestSha256: `sha256:${string}`;
}

interface Admission {
  readonly receipt?: WebArtifactReceipt;
  readonly admissionReasons: readonly string[];
  readonly verificationReasons: readonly string[];
}

/**
 * Runs a Chromium capture driver and admits its evidence fail-closed.
 *
 * This foundation deliberately does not launch a server or browser. The caller
 * owns that lifecycle; the adapter owns the immutable capture plan, evidence
 * boundary, content addressing, and check outcome.
 */
export async function runWebVerificationAdapter(
  rawInput: WebVerificationAdapterInput,
  driver: WebVerificationDriver,
): Promise<WebVerificationResult> {
  const input = inputSchema.parse(rawInput);
  let evidenceRoot: string;
  try {
    evidenceRoot = await realpath(input.evidenceRoot);
  } catch {
    return buildResult({
      input,
      evidenceRoot: resolve(input.evidenceRoot),
      status: "rejected",
      reasons: ["evidence-root-invalid"],
      artifacts: [],
    });
  }

  let rawCandidates: readonly WebArtifactCandidate[];
  try {
    rawCandidates = await driver.capture(WEB_VERIFICATION_REQUIREMENTS);
  } catch (error) {
    return buildResult({
      input,
      evidenceRoot,
      status: "rejected",
      reasons: [`capture-failed:${errorMessage(error)}`],
      artifacts: [],
    });
  }
  if (!Array.isArray(rawCandidates)) {
    return buildResult({
      input,
      evidenceRoot,
      status: "rejected",
      reasons: ["capture-invalid:candidates-must-be-an-array"],
      artifacts: [],
    });
  }

  const admissionReasons: string[] = [];
  const verificationReasons: string[] = [];
  const candidates = new Map<string, WebArtifactCandidate>();
  const candidateCounts = new Map<string, number>();

  for (const [index, rawCandidate] of rawCandidates.entries()) {
    const parsed = candidateSchema.safeParse(rawCandidate);
    if (!parsed.success) {
      admissionReasons.push(`artifact-candidate-invalid:${index}`);
      continue;
    }
    const candidate = parsed.data;
    if (!requirementById(candidate.requirementId)) {
      admissionReasons.push(`artifact-unexpected:${candidate.requirementId}`);
      continue;
    }
    const count = (candidateCounts.get(candidate.requirementId) ?? 0) + 1;
    candidateCounts.set(candidate.requirementId, count);
    if (count > 1) {
      admissionReasons.push(`artifact-duplicate:${candidate.requirementId}`);
      continue;
    }
    candidates.set(candidate.requirementId, candidate);
  }

  const artifacts: WebArtifactReceipt[] = [];
  const admittedPaths = new Set<string>();
  for (const requirement of WEB_VERIFICATION_REQUIREMENTS) {
    const candidate = candidates.get(requirement.id);
    if (!candidate) {
      admissionReasons.push(`artifact-missing:${requirement.id}`);
      continue;
    }
    const admission = await admitArtifact({
      evidenceRoot,
      input,
      requirement,
      candidate,
    });
    admissionReasons.push(...admission.admissionReasons);
    verificationReasons.push(...admission.verificationReasons);
    if (!admission.receipt) continue;
    if (admittedPaths.has(admission.receipt.path)) {
      admissionReasons.push(`artifact-path-duplicate:${requirement.id}`);
      continue;
    }
    admittedPaths.add(admission.receipt.path);
    artifacts.push(admission.receipt);
  }

  const status = admissionReasons.length > 0
    ? "rejected"
    : verificationReasons.length > 0 ? "failed" : "passed";
  return buildResult({
    input,
    evidenceRoot,
    status,
    reasons: [...admissionReasons, ...verificationReasons],
    artifacts,
  });
}

async function admitArtifact(input: {
  readonly evidenceRoot: string;
  readonly input: z.infer<typeof inputSchema>;
  readonly requirement: WebVerificationRequirement;
  readonly candidate: z.infer<typeof candidateSchema>;
}): Promise<Admission> {
  const id = input.requirement.id;
  const startedAt = Date.parse(input.input.runStartedAt);
  const completedAt = Date.parse(input.input.runCompletedAt);
  const capturedAt = Date.parse(input.candidate.capturedAt);
  if (capturedAt < startedAt || capturedAt > completedAt) {
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
    if (!before.isFile() || before.size === 0) {
      return rejected(`artifact-invalid-file:${id}`);
    }
    // Files from before the run or written after its recorded completion are stale.
    if (before.mtimeMs < startedAt || before.mtimeMs > completedAt + 1_000) {
      return rejected(`artifact-stale:${id}`);
    }
    const bytes = await readFile(canonicalPath);
    const after = await stat(canonicalPath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      return rejected(`artifact-changed-during-read:${id}`);
    }
    const content = validateContent(input.requirement.kind, bytes);
    if (!content.valid) {
      return rejected(`artifact-invalid-content:${id}`);
    }
    const receipt: WebArtifactReceipt = {
      requirementId: id,
      kind: input.requirement.kind,
      browser: "chromium",
      viewport: input.requirement.viewport,
      colorScheme: input.requirement.colorScheme,
      reducedMotion: input.requirement.reducedMotion,
      state: input.requirement.state,
      mimeType: input.requirement.mimeType,
      path: normalizeRelativePath(relative(input.evidenceRoot, canonicalPath)),
      capturedAt: input.candidate.capturedAt,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    };
    return {
      receipt,
      admissionReasons: [],
      verificationReasons: content.verificationReasons,
    };
  } catch {
    return rejected(`artifact-unreadable:${id}`);
  }
}

function validateContent(
  kind: WebArtifactKind,
  bytes: Buffer,
): Readonly<{ valid: boolean; verificationReasons: readonly string[] }> {
  if (kind === "screenshot") {
    return { valid: isPng(bytes), verificationReasons: [] };
  }
  if (kind === "interaction-trace") {
    return { valid: isZip(bytes), verificationReasons: [] };
  }
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { valid: false, verificationReasons: [] };
  }
  if (kind === "keyboard-focus") {
    const parsed = focusEvidenceSchema.safeParse(json);
    if (!parsed.success) return { valid: false, verificationReasons: [] };
    return {
      valid: true,
      verificationReasons: parsed.data.failures.length > 0
        ? [`keyboard-focus-failures:${parsed.data.failures.length}`]
        : [],
    };
  }
  const parsed = axeEvidenceSchema.safeParse(json);
  if (!parsed.success) return { valid: false, verificationReasons: [] };
  const serious = parsed.data.violations.filter((violation) =>
    violation.impact === "serious").length;
  const critical = parsed.data.violations.filter((violation) =>
    violation.impact === "critical").length;
  return {
    valid: true,
    verificationReasons: serious + critical > 0
      ? [`axe-blocking-violations:serious=${serious}:critical=${critical}`]
      : [],
  };
}

function buildResult(input: {
  readonly input: z.infer<typeof inputSchema>;
  readonly evidenceRoot: string;
  readonly status: WebVerificationResult["status"];
  readonly reasons: readonly string[];
  readonly artifacts: readonly WebArtifactReceipt[];
}): WebVerificationResult {
  const payload = {
    schemaVersion: 1 as const,
    adapter: "chromium-web-v1" as const,
    status: input.status,
    evidenceRoot: input.evidenceRoot,
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

function requirementById(id: string): WebVerificationRequirement | undefined {
  return WEB_VERIFICATION_REQUIREMENTS.find((requirement) => requirement.id === id);
}

function rejected(reason: string): Admission {
  return { admissionReasons: [reason], verificationReasons: [] };
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
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00,
    0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);
  return bytes.length >= 45
    && signature.every((value, index) => bytes[index] === value)
    && bytes.readUInt32BE(8) === 13
    && bytes.subarray(12, 16).equals(Buffer.from("IHDR"))
    && bytes.subarray(bytes.length - iend.length).equals(iend);
}

function isZip(bytes: Buffer): boolean {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return false;
  }
  const initialSignature = bytes.subarray(0, 4).toString("hex");
  if (!["504b0304", "504b0506", "504b0708"].includes(initialSignature)) {
    return false;
  }
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const endOffset = bytes.lastIndexOf(endSignature);
  if (endOffset < 0 || endOffset + 22 > bytes.length) return false;
  const commentLength = bytes.readUInt16LE(endOffset + 20);
  return endOffset + 22 + commentLength === bytes.length;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown-error";
}
