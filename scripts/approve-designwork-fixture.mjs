#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  approvePublicFixtureCandidate,
} from "./lib/designwork-fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidatePath = resolveArgument("--candidate");
const reviewPath = resolveArgument("--review");
const outputPath = resolveOptionalArgument("--output")
  ?? defaultApprovalPath(candidatePath);
if (outputPath === candidatePath || outputPath === reviewPath) {
  throw new Error("--output must not overwrite the candidate or review");
}
const check = process.argv.includes("--check");
const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
const review = JSON.parse(await readFile(reviewPath, "utf8"));
const approval = approvePublicFixtureCandidate(candidate, review);
const output = `${JSON.stringify(approval, null, 2)}\n`;

if (check) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== output) {
    console.error(`Fixture approval is stale or missing: ${path.relative(root, outputPath)}`);
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, output, { encoding: "utf8", mode: 0o600 });
}

console.log(JSON.stringify(approval, null, 2));

function resolveArgument(name) {
  const resolved = resolveOptionalArgument(name);
  if (!resolved) throw new Error(`${name} is required`);
  return resolved;
}

function resolveOptionalArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  const resolved = path.resolve(root, value);
  if (!insideRoot(root, resolved)) throw new Error(`${name} must stay inside the checkout`);
  return resolved;
}

function insideRoot(projectRoot, candidate) {
  const relative = path.relative(projectRoot, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function defaultApprovalPath(candidate) {
  return candidate.toLowerCase().endsWith(".json")
    ? `${candidate.slice(0, -5)}.approval.json`
    : `${candidate}.approval.json`;
}
