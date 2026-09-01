#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_README_PHRASE,
  assertRegistryAttestationUrl,
  extractProvenanceInvocation,
  resolveReleaseChannel,
  validateProvenanceAttestations,
  validateRegistryVersion,
} from "./lib/npm-release-verification.mjs";
import {
  buildEngineReleaseRecord,
  loadReleaseManifest,
  serializeJson,
  validateEngineSurfaceSnapshot,
  validateNpmPublishPreflight,
  validateReleaseManifest,
  validateTarballBytes,
} from "./lib/release-manifest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const packageName = process.env.PACKAGE_NAME || pkg.name;
const expectedVersion = process.env.EXPECTED_VERSION || pkg.version;
const expectedPhrase = process.env.EXPECTED_README_PHRASE || DEFAULT_README_PHRASE;
const expectedInstall = process.env.EXPECTED_INSTALL_COMMAND || `npm i -g ${packageName}`;
const expectedRepository = process.env.EXPECTED_SOURCE_REPOSITORY
  || String(pkg.repository?.url || "").replace(/^git\+/, "").replace(/\.git$/, "");
const expectedWorkflowPath = process.env.EXPECTED_SOURCE_WORKFLOW
  || ".github/workflows/publish.yml";
const expectedWorkflowRef = process.env.EXPECTED_SOURCE_REF || "refs/heads/main";
const expectedSourceCommit = process.env.EXPECTED_SOURCE_COMMIT || "";
const attempts = positiveInteger(process.env.NPM_VERIFY_ATTEMPTS, 12);
const delayMs = positiveInteger(process.env.NPM_VERIFY_DELAY_MS, 10_000);
const maxTarballBytes = positiveInteger(process.env.MAX_TARBALL_BYTES, 50 * 1024 * 1024);
const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName).replace(/^%40/, "%40")}`;

try {
  if (process.argv.includes("--prepublish")) {
    await runPrepublish();
  } else if (process.argv.includes("--recovery-preflight")) {
    await runRecoveryPreflight();
  } else {
    await runPublishedVerification();
  }
} catch (error) {
  console.error(JSON.stringify({
    status: "failed",
    packageName,
    expectedVersion,
    registryUrl,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}

async function runPrepublish() {
  const manifest = await loadReleaseManifest(root);
  const releaseChannel = releaseChannelForManifest(manifest);
  const metadata = await fetchRegistryMetadata();
  const failures = validateNpmPublishPreflight({
    manifest,
    packageVersion: pkg.version,
    expectedVersion,
    gitRef: process.env.GITHUB_REF || "",
    sourceCommit: expectedSourceCommit,
    registryMetadata: metadata,
  });
  const head = git(["rev-parse", "HEAD"]);
  if (head !== expectedSourceCommit) {
    failures.push(`checked out commit ${head} does not match publish source ${expectedSourceCommit}`);
  }
  failures.push(...validateEngineSurfaceSnapshot(manifest, await readWorkingSurfaceSnapshot()));
  if (failures.length > 0) throw new Error(failures.join("\n"));
  console.log(JSON.stringify({
    status: "candidate-ready",
    version: expectedVersion,
    distTag: releaseChannel.distTag,
    expectedLatest: releaseChannel.expectedLatest,
    sourceCommit: expectedSourceCommit,
    registryVersionAbsent: true,
  }, null, 2));
}

async function runRecoveryPreflight() {
  const manifest = await loadReleaseManifest(root);
  const releaseChannel = releaseChannelForManifest(manifest);
  const manifestFailures = validateReleaseManifest(manifest);
  const engine = manifest?.releaseGroups?.engine;
  if (engine?.state !== "candidate") {
    manifestFailures.push("recovery requires the engine manifest to remain candidate");
  }
  if (engine?.version !== expectedVersion) {
    manifestFailures.push(`candidate version ${engine?.version ?? "missing"} does not match ${expectedVersion}`);
  }
  if (!/^[0-9a-f]{40}$/.test(expectedSourceCommit)) {
    manifestFailures.push("recovery source commit must be exact");
  }
  if (!isAncestor(expectedSourceCommit, git(["rev-parse", "HEAD"]))) {
    manifestFailures.push("recovery source commit is not an ancestor of current main");
  }
  const sourceManifest = readJsonAtCommit(expectedSourceCommit, "release-manifest.json");
  if (sourceManifest?.releaseGroups?.engine?.state !== "candidate"
    || sourceManifest?.releaseGroups?.engine?.version !== expectedVersion) {
    manifestFailures.push("recovery source commit does not contain the same candidate release");
  }
  manifestFailures.push(...validateEngineSurfaceSnapshot(
    sourceManifest,
    readSurfaceSnapshotAtCommit(expectedSourceCommit),
  ));
  const metadata = await fetchRegistryMetadata();
  if (!metadata?.versions?.[expectedVersion]) {
    manifestFailures.push(`${packageName}@${expectedVersion} is not published; recovery cannot invent evidence`);
  }
  if (manifestFailures.length > 0) throw new Error(manifestFailures.join("\n"));
  console.log(JSON.stringify({
    status: "recovery-ready",
    version: expectedVersion,
    distTag: releaseChannel.distTag,
    expectedLatest: releaseChannel.expectedLatest,
    sourceCommit: expectedSourceCommit,
  }, null, 2));
}

async function runPublishedVerification() {
  const manifest = await loadReleaseManifest(root);
  const releaseChannel = releaseChannelForManifest(manifest);
  if (!/^[0-9a-f]{40}$/.test(expectedSourceCommit)) {
    throw new Error("EXPECTED_SOURCE_COMMIT must be an exact commit");
  }
  let verification;
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      verification = await verifyRegistryAndTarball(attempt, releaseChannel);
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) await new Promise((done) => setTimeout(done, delayMs));
    }
  }
  if (!verification) throw new Error(lastError || "npm verification failed");

  const outputPath = process.env.RELEASE_RECORD_OUTPUT;
  let releaseRecord = null;
  if (outputPath) {
    releaseRecord = await writeReleaseRecord(outputPath, verification);
  }
  console.log(JSON.stringify({
    status: "verified",
    packageName,
    distTag: verification.registry.distTag,
    latest: verification.registry.latest,
    expectedPhrase,
    expectedInstall,
    integrity: verification.registry.integrity,
    shasum: verification.registry.shasum,
    signatureCount: verification.registry.signatureCount,
    provenance: verification.provenance,
    invocationId: verification.invocationId,
    tarball: verification.tarball,
    releaseRecord,
    attempts: verification.attempt,
  }, null, 2));
}

function releaseChannelForManifest(manifest) {
  return resolveReleaseChannel({
    version: expectedVersion,
    previousPublicRelease:
      manifest?.releaseGroups?.engine?.previousPublicRelease?.version,
  });
}

async function verifyRegistryAndTarball(attempt, releaseChannel) {
  const metadata = await fetchRegistryMetadata();
  const registry = validateRegistryVersion({
    metadata,
    packageName,
    expectedVersion,
    expectedPhrase,
    expectedInstall,
    expectedDistTag: releaseChannel.distTag,
    expectedLatest: releaseChannel.expectedLatest,
    requireProvenance: true,
  });
  const attestationUrl = assertRegistryAttestationUrl(registry.attestationUrl);
  const attestationPayload = await fetchJson(attestationUrl, "attestation registry");
  const provenance = validateProvenanceAttestations({
    payload: attestationPayload,
    packageName,
    expectedVersion,
    expectedIntegrity: registry.integrity,
    expectedRepository,
    expectedWorkflowPath,
    expectedWorkflowRef,
    expectedSourceCommit,
  });
  const invocationId = extractProvenanceInvocation({
    payload: attestationPayload,
    expectedRepository,
  });

  const version = metadata.versions?.[expectedVersion];
  const tarballUrl = assertNpmTarballUrl(version?.dist?.tarball);
  const response = await fetch(tarballUrl, {
    headers: { "User-Agent": "memoire-release-verifier" },
  });
  if (!response.ok) throw new Error(`tarball registry returned ${response.status}`);
  const bytes = await readBoundedResponse(response, maxTarballBytes);
  const tarball = {
    url: tarballUrl,
    ...validateTarballBytes({
      bytes,
      integrity: registry.integrity,
      shasum: registry.shasum,
    }),
  };
  const publishedAt = metadata.time?.[expectedVersion];
  if (!Number.isFinite(Date.parse(publishedAt ?? ""))) {
    throw new Error("npm registry is missing the immutable version publish timestamp");
  }
  return {
    registry,
    provenance,
    invocationId,
    tarball,
    attestationUrl,
    publishedAt,
    attempt,
  };
}

async function writeReleaseRecord(outputPath, verification) {
  if (process.env.NPM_SIGNATURE_AUDIT_VERIFIED !== "1") {
    throw new Error("release record requires a successful npm audit signatures gate");
  }
  const sbomPath = resolveInsideRoot(process.env.SBOM_PATH || "");
  const sbomBytes = await readFile(sbomPath);
  JSON.parse(sbomBytes.toString("utf8"));
  const runId = process.env.RELEASE_WORKFLOW_RUN_ID || "";
  const runAttempt = Number.parseInt(process.env.RELEASE_WORKFLOW_RUN_ATTEMPT || "", 10);
  const output = resolveInsideRoot(outputPath);
  const record = buildEngineReleaseRecord({
    version: expectedVersion,
    packageName,
    sourceCommit: expectedSourceCommit,
    integrity: verification.registry.integrity,
    shasum: verification.registry.shasum,
    tarballUrl: verification.tarball.url,
    tarballSha512: verification.tarball.sha512,
    tarballSha1: verification.tarball.sha1,
    signatureCount: verification.registry.signatureCount,
    npmAuditSignaturesVerified: true,
    attestation: {
      url: verification.attestationUrl,
      predicateType: "https://slsa.dev/provenance/v1",
      subject: verification.provenance.subject,
      sha512: verification.provenance.sha512,
      repository: verification.provenance.repository,
      workflowPath: verification.provenance.workflowPath,
      workflowRef: verification.provenance.workflowRef,
      invocationId: verification.invocationId,
    },
    workflow: {
      repository: "memi-design/memi",
      path: expectedWorkflowPath,
      ref: expectedWorkflowRef,
      runId,
      runAttempt,
    },
    sbom: {
      path: "memi.cdx.json",
      sha256: createHash("sha256").update(sbomBytes).digest("hex"),
    },
    publishedAt: verification.publishedAt,
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, serializeJson(record), { encoding: "utf8", flag: "wx" });
  return {
    path: relative(root, output),
    sha256: createHash("sha256").update(serializeJson(record)).digest("hex"),
  };
}

async function fetchRegistryMetadata() {
  const response = await fetch(registryUrl, {
    headers: { "User-Agent": "memoire-release-verifier" },
  });
  if (!response.ok) throw new Error(`registry returned ${response.status}`);
  return response.json();
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: { "User-Agent": "memoire-release-verifier" },
  });
  if (!response.ok) throw new Error(`${label} returned ${response.status}`);
  return response.json();
}

async function readBoundedResponse(response, maxBytes) {
  const declared = Number.parseInt(response.headers.get("content-length") || "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`tarball exceeds ${maxBytes} byte limit`);
  }
  if (!response.body) throw new Error("tarball response is missing a body");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`tarball exceeds ${maxBytes} byte limit`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function assertNpmTarballUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("npm tarball URL is invalid");
  }
  if (url.origin !== "https://registry.npmjs.org"
    || !url.pathname.endsWith(".tgz")
    || url.username
    || url.password) {
    throw new Error("npm tarball URL must use the registry tarball endpoint");
  }
  return url.href;
}

async function readWorkingSurfaceSnapshot() {
  const json = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
  return {
    "package.json": await json("package.json"),
    "npm-shrinkwrap.json": await json("npm-shrinkwrap.json"),
    "server.json": await json("server.json"),
    "mcpb/manifest.json": await json("mcpb/manifest.json"),
    "plugins/memoire/.codex-plugin/plugin.json": await json("plugins/memoire/.codex-plugin/plugin.json"),
    "plugins/memi-claude/.claude-plugin/plugin.json": await json("plugins/memi-claude/.claude-plugin/plugin.json"),
    "plugin/widget-meta.json": await json("plugin/widget-meta.json"),
    "action.yml": await readFile(join(root, "action.yml"), "utf8"),
  };
}

function readSurfaceSnapshotAtCommit(commit) {
  const json = (path) => readJsonAtCommit(commit, path);
  return {
    "package.json": json("package.json"),
    "npm-shrinkwrap.json": json("npm-shrinkwrap.json"),
    "server.json": json("server.json"),
    "mcpb/manifest.json": json("mcpb/manifest.json"),
    "plugins/memoire/.codex-plugin/plugin.json": json("plugins/memoire/.codex-plugin/plugin.json"),
    "plugins/memi-claude/.claude-plugin/plugin.json": json("plugins/memi-claude/.claude-plugin/plugin.json"),
    "plugin/widget-meta.json": json("plugin/widget-meta.json"),
    "action.yml": git(["show", `${commit}:action.yml`]),
  };
}

function readJsonAtCommit(commit, path) {
  return JSON.parse(git(["show", `${commit}:${path}`]));
}

function isAncestor(ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function resolveInsideRoot(value) {
  if (!value) throw new Error("release evidence path is required");
  const target = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const pathFromRoot = relative(root, target);
  if (!pathFromRoot || pathFromRoot === ".." || pathFromRoot.startsWith("../")) {
    throw new Error("release evidence path must stay inside the checkout");
  }
  return target;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
