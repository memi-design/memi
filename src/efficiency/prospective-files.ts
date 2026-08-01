import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hashValue } from "./prospective-study.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const EVIDENCE_MANIFEST_HASH_PLACEHOLDER =
  `sha256:${"0".repeat(64)}` as const;
const evidenceManifestContentSchema = z.object({
  schemaVersion: z.literal(1),
  trialId: z.string().min(1),
  files: z.array(z.object({
    name: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    sha256: sha256Schema,
  }).strict()),
}).strict();

const evidenceManifestSchema = evidenceManifestContentSchema.extend({
  manifestSha256: sha256Schema,
}).strict();

export async function hashFile(file: string): Promise<`sha256:${string}`> {
  const bytes = await readFile(file);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function createEvidenceManifest(input: {
  readonly evidenceDirectory: string;
  readonly trialId: string;
  readonly artifactNames: readonly string[];
}): Promise<Readonly<z.infer<typeof evidenceManifestSchema>>> {
  const evidenceDirectory = path.resolve(input.evidenceDirectory);
  const artifactNames = [...new Set(input.artifactNames)].sort();
  const files = await Promise.all(artifactNames.map(async (name) => {
    validateArtifactName(name);
    const file = path.join(evidenceDirectory, name);
    const stats = await lstat(file);
    if (!stats.isFile()) throw new Error(`evidence artifact is not a file: ${name}`);
    return {
      name,
      bytes: stats.size,
      sha256: await hashEvidenceArtifact(file, name),
    };
  }));
  const content = evidenceManifestContentSchema.parse({
    schemaVersion: 1,
    trialId: input.trialId,
    files,
  });
  const receipt = evidenceManifestSchema.parse({
    ...content,
    manifestSha256: hashValue(content),
  });
  await writeFile(
    path.join(evidenceDirectory, "evidence-manifest.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { mode: 0o600 },
  );
  return deepFreeze(receipt);
}

export async function verifyEvidenceManifest(input: {
  readonly evidenceDirectory: string;
  readonly expectedManifestSha256: string;
  readonly requiredArtifacts: readonly string[];
}): Promise<Readonly<{ valid: boolean; reasons: readonly string[] }>> {
  const evidenceDirectory = path.resolve(input.evidenceDirectory);
  const reasons: string[] = [];
  let manifest: z.infer<typeof evidenceManifestSchema>;
  try {
    manifest = evidenceManifestSchema.parse(JSON.parse(await readFile(
      path.join(evidenceDirectory, "evidence-manifest.json"),
      "utf8",
    )));
  } catch {
    return deepFreeze({
      valid: false,
      reasons: ["evidence-manifest-invalid"],
    });
  }
  const { manifestSha256, ...content } = manifest;
  if (
    manifestSha256 !== input.expectedManifestSha256
    || manifestSha256 !== hashValue(content)
  ) {
    reasons.push("evidence-manifest-hash-mismatch");
  }
  const filesByName = new Map(manifest.files.map((file) => [file.name, file]));
  const artifacts = new Set([
    ...input.requiredArtifacts,
    ...manifest.files.map((file) => file.name),
  ]);
  for (const artifact of artifacts) {
    validateArtifactName(artifact);
    const target = path.join(evidenceDirectory, artifact);
    const exists = await lstat(target).then(
      (stats) => stats.isFile(),
      () => false,
    );
    if (!exists) {
      reasons.push(`required-artifact-missing:${artifact}`);
      continue;
    }
    if (artifact === "evidence-manifest.json") {
      continue;
    }
    const recorded = filesByName.get(artifact);
    if (!recorded) {
      // Older prospective manifests treated run.json as a presence-only receipt.
      // New manifests list it and bind its canonical content below.
      if (artifact === "run.json") continue;
      reasons.push(`artifact-not-in-manifest:${artifact}`);
      continue;
    }
    const currentHash = await hashEvidenceArtifact(target, artifact).catch(
      () => null,
    );
    if (currentHash === null || currentHash !== recorded.sha256) {
      reasons.push(`artifact-hash-mismatch:${artifact}`);
    }
    if (artifact === "run.json") {
      const embeddedManifestSha256 = await readRunManifestSha256(target).catch(
        () => null,
      );
      if (
        embeddedManifestSha256 !== null
        && embeddedManifestSha256 !== input.expectedManifestSha256
      ) {
        reasons.push("run-manifest-hash-mismatch");
      }
    }
  }
  return deepFreeze({ valid: reasons.length === 0, reasons });
}

async function hashEvidenceArtifact(
  file: string,
  artifactName: string,
): Promise<`sha256:${string}`> {
  if (artifactName !== "run.json") return hashFile(file);
  const content = await readFile(file, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("run.json is not valid JSON");
  }
  const manifestSha256 = prospectiveManifestSha256(parsed);
  if (manifestSha256 === null) {
    return `sha256:${createHash("sha256").update(content).digest("hex")}`;
  }
  const propertyPattern = /(\"evidenceManifestSha256\"\s*:\s*)\"sha256:[a-f0-9]{64}\"/g;
  const matches = [...content.matchAll(propertyPattern)];
  if (matches.length !== 1) {
    throw new Error("run.json must contain one evidenceManifestSha256 property");
  }
  const canonicalContent = content.replace(
    propertyPattern,
    `$1"${EVIDENCE_MANIFEST_HASH_PLACEHOLDER}"`,
  );
  return `sha256:${createHash("sha256").update(canonicalContent).digest("hex")}`;
}

async function readRunManifestSha256(file: string): Promise<string | null> {
  return prospectiveManifestSha256(JSON.parse(await readFile(file, "utf8")));
}

function prospectiveManifestSha256(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const prospective = (value as Record<string, unknown>).prospective;
  if (!prospective || typeof prospective !== "object") return null;
  const manifestSha256 = (prospective as Record<string, unknown>)
    .evidenceManifestSha256;
  if (manifestSha256 === undefined) return null;
  return sha256Schema.parse(manifestSha256);
}

function validateArtifactName(name: string): void {
  if (
    !name
    || name === "."
    || name === ".."
    || name.includes("/")
    || name.includes("\\")
  ) {
    throw new Error(`invalid evidence artifact name: ${name}`);
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
