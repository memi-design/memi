#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import {
  AuditScorecardSchema,
  renderAuditScorecardMarkdown,
} from "../src/audit/scorecard.js";

interface CliOptions {
  root: string;
  input: string;
  output: string;
  check: boolean;
}

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

  const source = await readFile(inputPath, "utf8");
  const scorecard = AuditScorecardSchema.parse(JSON.parse(source));
  await verifyEvidenceArtifacts(scorecard, auditsDirectory, inputPath);
  const ledgerHash = createHash("sha256").update(source).digest("hex");
  const rendered = [
    renderAuditScorecardMarkdown(scorecard, { asOf: scorecard.assessedAt }).trimEnd(),
    "",
    `Generated from \`${relative(root, inputPath)}\` · Ledger SHA-256: \`${ledgerHash}\``,
    "",
  ].join("\n");

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

  await writeFile(outputPath, rendered, "utf8");
  process.stdout.write(`Wrote ${relative(root, outputPath)}\n`);
}

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = {
    root: process.cwd(),
    input: "docs/audits/memi-100-scorecard.json",
    output: "docs/audits/memi-100-scorecard.md",
    check: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument === "--root" || argument === "--input" || argument === "--output") {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--root") options.root = value;
      if (argument === "--input") options.input = value;
      if (argument === "--output") options.output = value;
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

async function verifyEvidenceArtifacts(
  scorecard: ReturnType<typeof AuditScorecardSchema.parse>,
  auditsDirectory: string,
  ledgerPath: string,
): Promise<void> {
  for (const evidence of scorecard.evidence) {
    const artifactPath = resolve(auditsDirectory, evidence.artifact.location);
    assertContained(auditsDirectory, artifactPath);
    await assertRealContained(auditsDirectory, artifactPath);
    if (artifactPath === ledgerPath) {
      throw new Error(`Evidence ${evidence.id} cannot use its own scorecard as proof.`);
    }
    const artifact = await readFile(artifactPath);
    const digest = createHash("sha256").update(artifact).digest("hex");
    if (digest !== evidence.artifact.sha256) {
      throw new Error(
        `Artifact digest mismatch for ${evidence.id}: expected ${evidence.artifact.sha256}, received ${digest}`,
      );
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
