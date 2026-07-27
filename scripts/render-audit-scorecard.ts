#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { z } from "zod";
import {
  AuditScorecardSchema,
  evaluateAuditScorecard,
  renderAuditScorecardMarkdown,
} from "../src/audit/scorecard.js";

interface CliOptions {
  root: string;
  input: string;
  output: string;
  check: boolean;
  verifyAsOf?: string;
}

const MAX_LEDGER_BYTES = 1_048_576;
const MAX_EVIDENCE_ARTIFACT_BYTES = 10_485_760;

const CandidateAuditSourceSchema = z.object({
  implementationCandidate: z.object({
    score: z.number().int().min(0),
    maximum: z.literal(100),
  }),
  dimensions: z.array(z.object({
    id: z.string().min(1),
    maximum: z.number().int().positive(),
    candidate: z.number().int().min(0),
  })).min(1),
});

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const root = resolve(options.root);
  const auditsDirectory = resolve(root, "docs", "audits");
  const inputPath = resolve(root, options.input);
  const outputPath = resolve(root, options.output);

  assertContained(auditsDirectory, inputPath);
  assertContained(auditsDirectory, outputPath);
  await assertRealContained(auditsDirectory, inputPath);
  await assertRealContained(auditsDirectory, dirname(outputPath));
  await assertExistingRealContained(auditsDirectory, outputPath);
  await assertNotSymlink(outputPath);

  const ledgerStats = await stat(inputPath);
  if (ledgerStats.size > MAX_LEDGER_BYTES) {
    throw new Error(`Audit ledger exceeds ${MAX_LEDGER_BYTES} bytes: ${ledgerStats.size}`);
  }
  const source = await readFile(inputPath, "utf8");
  const scorecard = AuditScorecardSchema.parse(JSON.parse(source));
  const evidenceArtifacts = await verifyEvidenceArtifacts(scorecard, auditsDirectory, inputPath);
  verifyDerivedAudit(scorecard, evidenceArtifacts);
  const ledgerHash = createHash("sha256").update(source).digest("hex");
  const rendered = [
    renderAuditScorecardMarkdown(scorecard, { asOf: scorecard.assessedAt }).trimEnd(),
    "",
    `Generated from \`${relative(root, inputPath)}\` · Ledger SHA-256: \`${ledgerHash}\``,
    "",
  ].join("\n");
  const verifiedAsOf = options.verifyAsOf ?? new Date().toISOString();
  verifyCurrentValidity(scorecard, verifiedAsOf);

  if (options.check) {
    const checkedIn = await readFile(outputPath, "utf8").catch(() => "");
    if (checkedIn !== rendered) {
      throw new Error(
        `Generated audit report is stale: run npm run audit:render-scorecard`,
      );
    }
    process.stdout.write(`${relative(root, outputPath)} is current\n`);
    return;
  }

  await writeAtomically(outputPath, rendered);
  process.stdout.write(`Wrote ${relative(root, outputPath)}\n`);
}

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = {
    root: process.cwd(),
    input: "docs/audits/memi-100-scorecard.json",
    output: "docs/audits/memi-100-scorecard.md",
    check: false,
    verifyAsOf: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (
      argument === "--root"
      || argument === "--input"
      || argument === "--output"
      || argument === "--as-of"
      || argument === "--verify-as-of"
    ) {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--root") options.root = value;
      if (argument === "--input") options.input = value;
      if (argument === "--output") options.output = value;
      if (argument === "--as-of" || argument === "--verify-as-of") {
        options.verifyAsOf = parseTimestamp(value, argument);
      }
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function assertContained(parent: string, candidate: string): void {
  const pathFromParent = relative(parent, candidate);
  if (
    pathFromParent === ""
    || pathFromParent.startsWith("..")
    || resolve(parent, pathFromParent) !== candidate
  ) {
    throw new Error(`Audit scorecard paths must stay inside docs/audits: ${candidate}`);
  }
}

async function assertRealContained(parent: string, candidate: string): Promise<void> {
  const [realParent, realCandidate] = await Promise.all([realpath(parent), realpath(candidate)]);
  if (realParent === realCandidate) return;
  assertContained(realParent, realCandidate);
}

async function assertExistingRealContained(parent: string, candidate: string): Promise<void> {
  try {
    await assertRealContained(parent, candidate);
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
}

async function assertNotSymlink(candidate: string): Promise<void> {
  try {
    const candidateStats = await lstat(candidate);
    if (candidateStats.isSymbolicLink()) {
      throw new Error(`Audit scorecard output must not be a symbolic link: ${candidate}`);
    }
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
}

async function verifyEvidenceArtifacts(
  scorecard: ReturnType<typeof AuditScorecardSchema.parse>,
  auditsDirectory: string,
  ledgerPath: string,
): Promise<Map<string, string>> {
  const artifacts = new Map<string, string>();
  for (const evidence of scorecard.evidence) {
    const artifactPath = resolve(auditsDirectory, evidence.artifact.location);
    assertContained(auditsDirectory, artifactPath);
    await assertRealContained(auditsDirectory, artifactPath);
    if (artifactPath === ledgerPath) {
      throw new Error(`Evidence ${evidence.id} cannot use its own scorecard as proof.`);
    }
    const artifactStats = await stat(artifactPath);
    if (artifactStats.size > MAX_EVIDENCE_ARTIFACT_BYTES) {
      throw new Error(
        `Evidence artifact exceeds ${MAX_EVIDENCE_ARTIFACT_BYTES} bytes for ${evidence.id}: ${artifactStats.size}`,
      );
    }
    const artifact = await readFile(artifactPath);
    const digest = createHash("sha256").update(artifact).digest("hex");
    if (digest !== evidence.artifact.sha256) {
      throw new Error(
        `Artifact digest mismatch for ${evidence.id}: expected ${evidence.artifact.sha256}, received ${digest}`,
      );
    }
    artifacts.set(evidence.id, artifact.toString("utf8"));
  }
  return artifacts;
}

function verifyDerivedAudit(
  scorecard: ReturnType<typeof AuditScorecardSchema.parse>,
  evidenceArtifacts: Map<string, string>,
): void {
  const derived = scorecard.derivedFromAudit;
  if (!derived) return;

  const candidateAuditSource = evidenceArtifacts.get(derived.candidateAuditEvidenceId);
  if (!candidateAuditSource) {
    throw new Error(
      `Derived audit evidence ${derived.candidateAuditEvidenceId} was not loaded for verification.`,
    );
  }

  const candidateAudit = CandidateAuditSourceSchema.parse(JSON.parse(candidateAuditSource));
  const dimensionById = new Map(candidateAudit.dimensions.map((dimension) => [dimension.id, dimension]));
  let derivedRawScore = 0;

  for (const dimension of scorecard.dimensions) {
    const sourceDimension = dimensionById.get(dimension.id);
    if (!sourceDimension) {
      throw new Error(`Derived audit is missing dimension ${dimension.id}.`);
    }
    if (sourceDimension.maximum !== dimension.maximum) {
      throw new Error(
        `Derived audit maximum mismatch for ${dimension.id}: scorecard ${dimension.maximum}, source ${sourceDimension.maximum}.`,
      );
    }

    const sourceBackedPoints = dimension.criteria
      .filter((criterion) =>
        criterion.assessment === "passed"
        && criterion.evidenceIds.includes(derived.candidateAuditEvidenceId),
      )
      .reduce((sum, criterion) => sum + criterion.points, 0);

    if (sourceBackedPoints !== sourceDimension.candidate) {
      throw new Error(
        `Derived audit candidate drift for ${dimension.id}: scorecard ${sourceBackedPoints}, source ${sourceDimension.candidate}.`,
      );
    }
    derivedRawScore += sourceBackedPoints;
  }

  if (derivedRawScore !== candidateAudit.implementationCandidate.score) {
    throw new Error(
      `Derived audit raw score drift: scorecard ${derivedRawScore}, source ${candidateAudit.implementationCandidate.score}.`,
    );
  }
}

function verifyCurrentValidity(
  scorecard: ReturnType<typeof AuditScorecardSchema.parse>,
  verifyAsOf: string,
): void {
  if (Date.parse(scorecard.assessedAt) > Date.parse(verifyAsOf)) {
    throw new Error(`Scorecard assessedAt is in the future at release time: ${scorecard.assessedAt}`);
  }
  const baseline = evaluateAuditScorecard(scorecard, { asOf: scorecard.assessedAt });
  const current = evaluateAuditScorecard(scorecard, { asOf: verifyAsOf });

  if (current.staleEvidenceIds.length > 0) {
    throw new Error(`Evidence is stale at release time: ${current.staleEvidenceIds.join(", ")}`);
  }
  if (current.invalidEvidenceIds.length > 0) {
    throw new Error(`Evidence is invalid at release time: ${current.invalidEvidenceIds.join(", ")}`);
  }
  if (current.unverifiedCriteria.length > 0) {
    throw new Error(`Passed criteria remain unverified: ${current.unverifiedCriteria.join(", ")}`);
  }
  if (
    baseline.rawScore !== current.rawScore
    || baseline.score !== current.score
    || JSON.stringify(baseline.appliedCaps) !== JSON.stringify(current.appliedCaps)
    || JSON.stringify(baseline.unverifiedCriteria) !== JSON.stringify(current.unverifiedCriteria)
  ) {
    throw new Error(
      `Scorecard evidence is no longer current at ${verifyAsOf}: render raw ${baseline.rawScore}/${baseline.score}, current raw ${current.rawScore}/${current.score}.`,
    );
  }
}

async function writeAtomically(outputPath: string, content: string): Promise<void> {
  const temporaryPath = `${outputPath}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function parseTimestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} requires an ISO-8601 timestamp.`);
  }
  return parsed.toISOString();
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
