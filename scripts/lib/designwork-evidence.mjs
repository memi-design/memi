import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  validatePublicFixtureCandidates,
} from "./designwork-fixtures.mjs";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RECEIPT_KINDS = new Set(["fixture", "runner"]);

export function sealDesignWorkReceipt(input) {
  const receipt = structuredClone(input);
  delete receipt.receiptSha256;
  return deepFreeze({
    ...receipt,
    receiptSha256: sha256(canonicalJson(receipt)),
  });
}

export async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

export async function validateDesignWorkEvidence(manifest, bundle, options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const failures = [];
  const candidateResult = await validateCandidateFixtures(
    manifest,
    bundle?.candidateFixtures,
    root,
  );
  failures.push(...candidateResult.failures);
  const verifiedFixtureIds = [];
  const verifiedRunnerIds = [];
  const taskIds = new Set((manifest?.tasks ?? []).map((task) => task.id));
  const runnerProfiles = new Map(
    (manifest?.runnerProfiles ?? []).map((runner) => [runner.id, runner]),
  );
  if (bundle?.schemaVersion !== 1) failures.push("evidence bundle schemaVersion must be 1");
  if (bundle?.benchmarkId !== manifest?.benchmarkId) {
    failures.push("evidence bundle benchmarkId does not match");
  }
  const receipts = Array.isArray(bundle?.receipts) ? bundle.receipts : [];
  const seen = new Set();
  for (const receipt of receipts) {
    const localFailures = await validateReceipt(
      manifest,
      receipt,
      root,
      taskIds,
      runnerProfiles,
    );
    const key = `${receipt?.kind}:${receipt?.subjectId}`;
    if (seen.has(key)) localFailures.push(`${key} has duplicate receipts`);
    seen.add(key);
    failures.push(...localFailures);
    if (localFailures.length > 0) continue;
    if (receipt.kind === "fixture") verifiedFixtureIds.push(receipt.subjectId);
    if (receipt.kind === "runner") verifiedRunnerIds.push(receipt.subjectId);
  }
  return deepFreeze({
    passed: failures.length === 0,
    failures,
    preparedFixtureIds: candidateResult.preparedFixtureIds,
    verifiedFixtureIds: [...verifiedFixtureIds].sort(),
    verifiedRunnerIds: [...verifiedRunnerIds].sort(),
    calibrationArtifacts: Array.isArray(bundle?.calibrationArtifacts)
      ? bundle.calibrationArtifacts
      : [],
    results: isRecord(bundle?.results) ? bundle.results : null,
  });
}

async function validateCandidateFixtures(manifest, entries, root) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { preparedFixtureIds: [], failures: [] };
  }
  const failures = [];
  const candidates = [];
  const preparedFixtureIds = [];
  const seen = new Set();
  for (const entry of entries) {
    const label = `candidate:${entry?.taskId ?? "unknown"}`;
    if (seen.has(entry?.taskId)) failures.push(`${label} is duplicated`);
    seen.add(entry?.taskId);
    if (!nonEmpty(entry?.path) || path.isAbsolute(entry.path)) {
      failures.push(`${label} path must be relative`);
      continue;
    }
    const candidatePath = path.resolve(root, entry.path);
    if (!insideRoot(root, candidatePath)) {
      failures.push(`${label} escapes the evidence root`);
      continue;
    }
    if (!HASH_PATTERN.test(entry?.sha256 ?? "")) {
      failures.push(`${label} requires a sha256`);
      continue;
    }
    try {
      if (await sha256File(candidatePath) !== entry.sha256) {
        failures.push(`${label} file hash does not match`);
        continue;
      }
      const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
      if (candidate.taskId !== entry.taskId) {
        failures.push(`${label} file task does not match`);
        continue;
      }
      candidates.push(candidate);
      preparedFixtureIds.push(entry.taskId);
    } catch {
      failures.push(`${label} file is missing or invalid`);
    }
  }
  const validation = validatePublicFixtureCandidates(manifest, candidates);
  failures.push(...validation.failures.map((failure) => `candidate fixtures: ${failure}`));
  return {
    preparedFixtureIds: [...preparedFixtureIds].sort(),
    failures,
  };
}

async function validateReceipt(manifest, receipt, root, taskIds, runnerProfiles) {
  const failures = [];
  const label = `${receipt?.kind ?? "unknown"}:${receipt?.subjectId ?? "unknown"}`;
  validateCommonReceipt(manifest, receipt, label, failures);
  if (receipt?.kind === "fixture") {
    validateFixtureReceipt(receipt, label, taskIds, failures);
  }
  if (receipt?.kind === "runner") {
    validateRunnerReceipt(receipt, label, runnerProfiles, failures);
  }
  await validateArtifacts(receipt?.artifacts, root, label, failures);
  return failures;
}

function validateCommonReceipt(manifest, receipt, label, failures) {
  if (!isRecord(receipt)) {
    failures.push("receipt must be an object");
    return;
  }
  if (receipt.schemaVersion !== 1) failures.push(`${label} schemaVersion must be 1`);
  if (!RECEIPT_KINDS.has(receipt.kind)) failures.push(`${label} kind is unsupported`);
  if (typeof receipt.subjectId !== "string" || receipt.subjectId.length === 0) {
    failures.push(`${label} subjectId is required`);
  }
  if (receipt.status !== "verified") failures.push(`${label} status must be verified`);
  if (receipt.benchmarkId !== manifest?.benchmarkId) {
    failures.push(`${label} benchmark binding does not match`);
  }
  if (receipt.taskBankSha256 !== manifest?.integrity?.taskBankSha256) {
    failures.push(`${label} task-bank binding does not match`);
  }
  if (receipt.frozenCandidateSha256 !== manifest?.integrity?.frozenCandidateSha256) {
    failures.push(`${label} candidate binding does not match`);
  }
  const sealed = { ...receipt };
  delete sealed.receiptSha256;
  if (!HASH_PATTERN.test(receipt.receiptSha256 ?? "")
    || receipt.receiptSha256 !== sha256(canonicalJson(sealed))) {
    failures.push(`${label} receipt hash does not match`);
  }
}

function validateFixtureReceipt(receipt, label, taskIds, failures) {
  if (!taskIds.has(receipt.subjectId)) failures.push(`${label} references an unknown task`);
  if (!Array.isArray(receipt.sourceRefs) || receipt.sourceRefs.length === 0) {
    failures.push(`${label} sourceRefs are required`);
  }
  if (!isRecord(receipt.provenance)
    || !nonEmpty(receipt.provenance.source)
    || !nonEmpty(receipt.provenance.license)
    || !validTimestamp(receipt.provenance.capturedAt)) {
    failures.push(`${label} provenance is incomplete`);
  }
}

function validateRunnerReceipt(receipt, label, runnerProfiles, failures) {
  const profile = runnerProfiles.get(receipt.subjectId);
  if (!profile) {
    failures.push(`${label} references an unknown runner`);
    return;
  }
  if (!isRecord(receipt.environment)
    || !nonEmpty(receipt.environment.os)
    || !nonEmpty(receipt.environment.architecture)
    || !nonEmpty(receipt.environment.runtime)) {
    failures.push(`${label} environment is incomplete`);
  }
  const artifactKinds = new Set(
    (receipt.artifacts ?? []).map((artifact) => artifact.kind),
  );
  for (const kind of profile.requiredEvidence ?? []) {
    if (!artifactKinds.has(kind)) failures.push(`${label} is missing ${kind}`);
  }
}

async function validateArtifacts(artifacts, root, label, failures) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    failures.push(`${label} requires evidence artifacts`);
    return;
  }
  const seenKinds = new Set();
  for (const artifact of artifacts) {
    if (!isRecord(artifact) || !nonEmpty(artifact.kind)) {
      failures.push(`${label} has an artifact without a kind`);
      continue;
    }
    if (seenKinds.has(artifact.kind)) failures.push(`${label} duplicates ${artifact.kind}`);
    seenKinds.add(artifact.kind);
    if (!nonEmpty(artifact.path) || path.isAbsolute(artifact.path)) {
      failures.push(`${label} artifact ${artifact.kind} path must be relative`);
      continue;
    }
    const artifactPath = path.resolve(root, artifact.path);
    if (!insideRoot(root, artifactPath)) {
      failures.push(`${label} artifact ${artifact.kind} escapes the evidence root`);
      continue;
    }
    if (!HASH_PATTERN.test(artifact.sha256 ?? "")) {
      failures.push(`${label} artifact ${artifact.kind} requires a sha256`);
      continue;
    }
    try {
      const digest = await sha256File(artifactPath);
      if (digest !== artifact.sha256) {
        failures.push(`${label} artifact hash mismatch for ${artifact.kind}`);
      }
    } catch {
      failures.push(`${label} artifact is missing for ${artifact.kind}`);
    }
  }
}

function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]),
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validTimestamp(value) {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
  } else if (isRecord(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return Object.freeze(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
