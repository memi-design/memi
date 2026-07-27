import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA512 = /^[a-f0-9]{128}$/;
const SHASUM = /^[a-f0-9]{40}$/;
const ENGINE_STATES = new Set(["candidate", "published", "historical"]);
const RELEASE_RECORD_PATH = /^release-artifacts\/npm\/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.release\.json$/;

export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function loadReleaseManifest(root) {
  const path = join(root, "release-manifest.json");
  return JSON.parse(await readFile(path, "utf8"));
}

export function validateReleaseManifest(manifest) {
  const failures = [];
  if (manifest?.schemaVersion !== 1) failures.push("release-manifest.json schemaVersion must be 1");

  const groups = manifest?.releaseGroups ?? {};
  for (const name of ["engine", "studio", "site"]) {
    if (!SEMVER.test(groups[name]?.version ?? "")) {
      failures.push(`release-manifest.json releaseGroups.${name}.version must be exact semver`);
    }
  }
  failures.push(...validateEngineManifestState(groups.engine));

  for (const [name, surface] of Object.entries(manifest?.surfaces ?? {})) {
    if (!groups[surface?.releaseGroup]) {
      failures.push(`release-manifest.json surfaces.${name}.releaseGroup does not exist`);
    }
  }

  const expected = {
    npm: "engine",
    githubRelease: "engine",
    githubAction: "engine",
    mcp: "engine",
    studio: "studio",
    website: "site",
  };
  for (const [surface, releaseGroup] of Object.entries(expected)) {
    if (manifest?.surfaces?.[surface]?.releaseGroup !== releaseGroup) {
      failures.push(`release-manifest.json surfaces.${surface}.releaseGroup must be ${releaseGroup}`);
    }
  }

  const engineVersion = groups.engine?.version;
  const githubRelease = manifest?.surfaces?.githubRelease;
  const expectedGithubReleaseUrl =
    `https://github.com/${githubRelease?.repository}/releases/tag/${githubRelease?.tagPrefix}${engineVersion}`;
  if (githubRelease?.url !== expectedGithubReleaseUrl) {
    failures.push(`release-manifest.json GitHub release URL must be ${expectedGithubReleaseUrl}`);
  }
  const engineMajor = engineVersion?.split(".")[0];
  if (manifest?.surfaces?.githubAction?.majorTag !== `v${engineMajor}`) {
    failures.push(`release-manifest.json GitHub Action majorTag must be v${engineMajor}`);
  }
  for (const field of ["arm64Asset", "x64Asset"]) {
    if (!manifest?.surfaces?.studio?.[field]?.includes("{version}")) {
      failures.push(`release-manifest.json Studio ${field} must include {version}`);
    }
  }
  if (!manifest?.surfaces?.studio?.checksumAsset) {
    failures.push("release-manifest.json Studio checksumAsset is required");
  }
  if (groups.engine?.state === "published"
    && !isSameOriginArtifactUrl(
      manifest?.surfaces?.website?.publicUrl,
      manifest?.surfaces?.website?.releaseArtifactUrl,
    )) {
    failures.push("published engine release requires a same-origin website release artifact URL");
  }

  return failures;
}

function validateEngineManifestState(engine) {
  const failures = [];
  const state = engine?.state;
  if (!ENGINE_STATES.has(state)) {
    failures.push("release-manifest.json releaseGroups.engine.state must be candidate, published, or historical");
    return failures;
  }

  if (state === "candidate") {
    if (engine.sourceCommit !== null) {
      failures.push("candidate engine release sourceCommit must be null");
    }
    if (engine.releaseRecord !== null) {
      failures.push("candidate engine release releaseRecord must be null");
    }
    if (engine.previousPublicRelease !== undefined) {
      if (!SEMVER.test(engine.previousPublicRelease?.version ?? "")
        || !COMMIT_SHA.test(engine.previousPublicRelease?.sourceCommit ?? "")) {
        failures.push("candidate previousPublicRelease must include an exact version and source commit");
      }
      if (engine.previousPublicRelease?.version === engine.version) {
        failures.push("candidate previousPublicRelease must differ from the candidate version");
      }
    }
    return failures;
  }

  if (!COMMIT_SHA.test(engine.sourceCommit ?? "")) {
    failures.push("release-manifest.json releaseGroups.engine.sourceCommit must be a 40-character commit SHA");
  }

  if (state === "published") {
    if (!RELEASE_RECORD_PATH.test(engine.releaseRecord?.path ?? "")) {
      failures.push("published engine release record path must be an immutable release-artifacts/npm version path");
    }
    if (!SHA256.test(engine.releaseRecord?.sha256 ?? "")) {
      failures.push("published engine release record must include its SHA-256");
    }
  } else if (engine.releaseRecord !== null) {
    failures.push("historical engine release releaseRecord must be null");
  } else if (engine.verification?.eligibleForParity !== false) {
    failures.push("historical engine release must be explicitly ineligible for parity");
  }

  return failures;
}

export function buildEngineReleaseRecord(input) {
  const record = {
    schemaVersion: 1,
    version: input.version,
    packageName: input.packageName,
    sourceCommit: input.sourceCommit,
    integrity: input.integrity,
    shasum: input.shasum,
    tarball: {
      url: input.tarballUrl,
      sha512: input.tarballSha512,
      sha1: input.tarballSha1,
    },
    signature: {
      count: input.signatureCount,
      npmAuditSignaturesVerified: input.npmAuditSignaturesVerified,
    },
    attestation: {
      ...input.attestation,
    },
    workflow: {
      ...input.workflow,
    },
    sbom: {
      ...input.sbom,
    },
    publishedAt: input.publishedAt,
  };
  const failures = validateEngineReleaseRecord(record);
  if (failures.length > 0) {
    throw new Error(`Invalid engine release record:\n- ${failures.join("\n- ")}`);
  }
  return record;
}

export function validateEngineReleaseRecord(record) {
  const failures = [];
  if (record?.schemaVersion !== 1) failures.push("release record schemaVersion must be 1");
  if (!SEMVER.test(record?.version ?? "")) failures.push("release record version must be exact semver");
  if (record?.packageName !== "@memi-design/cli") {
    failures.push("release record packageName must be @memi-design/cli");
  }
  if (!COMMIT_SHA.test(record?.sourceCommit ?? "")) {
    failures.push("release record sourceCommit must be an exact commit SHA");
  }
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(record?.integrity ?? "")) {
    failures.push("release record integrity must be an npm sha512 integrity value");
  }
  if (!SHASUM.test(record?.shasum ?? "")) failures.push("release record shasum must be SHA-1");
  if (!isNpmTarballUrl(record?.tarball?.url)) {
    failures.push("release record tarball URL must use the npm registry");
  }
  if (!SHA512.test(record?.tarball?.sha512 ?? "")) {
    failures.push("release record tarball SHA-512 is required");
  }
  if (!SHASUM.test(record?.tarball?.sha1 ?? "")) {
    failures.push("release record tarball SHA-1 is required");
  }
  if (record?.tarball?.sha1 !== record?.shasum) {
    failures.push("release record tarball SHA-1 must equal the registry shasum");
  }
  if (!Number.isInteger(record?.signature?.count) || record.signature.count < 1) {
    failures.push("release record must include at least one npm registry signature");
  }
  if (record?.signature?.npmAuditSignaturesVerified !== true) {
    failures.push("release record must prove npm audit signatures completed");
  }
  if (!isNpmAttestationUrl(record?.attestation?.url)) {
    failures.push("release record attestation URL must use the npm registry");
  }
  if (record?.attestation?.predicateType !== "https://slsa.dev/provenance/v1") {
    failures.push("release record attestation must use SLSA provenance v1");
  }
  if (record?.attestation?.repository !== "https://github.com/sarveshsea/memi") {
    failures.push("release record attestation repository is incorrect");
  }
  if (record?.attestation?.workflowPath !== ".github/workflows/publish.yml") {
    failures.push("release record attestation workflow path is incorrect");
  }
  if (record?.attestation?.workflowRef !== "refs/heads/main") {
    failures.push("release record attestation workflow ref must be refs/heads/main");
  }
  failures.push(...validateProvenanceInvocation(
    record?.attestation?.invocationId,
    record?.workflow,
  ));
  if (!SHA512.test(record?.attestation?.sha512 ?? "")) {
    failures.push("release record attestation subject SHA-512 is required");
  }
  const integritySha512 = integrityToHex(record?.integrity);
  if (integritySha512 && record?.tarball?.sha512 !== integritySha512) {
    failures.push("release record tarball SHA-512 must match npm integrity");
  }
  if (integritySha512 && record?.attestation?.sha512 !== integritySha512) {
    failures.push("release record attestation digest must match npm integrity");
  }
  const expectedSubject = `pkg:npm/%40memi-design/cli@${record?.version ?? ""}`;
  if (record?.attestation?.subject !== expectedSubject) {
    failures.push(`release record attestation subject must be ${expectedSubject}`);
  }
  if (record?.workflow?.repository !== "sarveshsea/memi"
    || record?.workflow?.path !== ".github/workflows/publish.yml"
    || record?.workflow?.ref !== "refs/heads/main") {
    failures.push("release record workflow identity is incorrect");
  }
  if (!/^\d+$/.test(String(record?.workflow?.runId ?? ""))) {
    failures.push("release record workflow runId is required");
  }
  if (!Number.isInteger(record?.workflow?.runAttempt) || record.workflow.runAttempt < 1) {
    failures.push("release record workflow runAttempt must be a positive integer");
  }
  if (record?.sbom?.path !== "memi.cdx.json" || !SHA256.test(record?.sbom?.sha256 ?? "")) {
    failures.push("release record must bind the CycloneDX SBOM SHA-256");
  }
  if (!Number.isFinite(Date.parse(record?.publishedAt ?? ""))) {
    failures.push("release record publishedAt must be an ISO timestamp");
  }

  return failures;
}

export function validateProvenanceInvocation(invocationId, workflow) {
  const expected =
    `https://github.com/${workflow?.repository ?? ""}`
    + `/actions/runs/${workflow?.runId ?? ""}`
    + `/attempts/${workflow?.runAttempt ?? ""}`;
  if (invocationId !== expected) {
    return ["SLSA invocation does not match the recorded workflow run and attempt"];
  }
  return [];
}

export function validateEngineReleaseTransition({
  previousManifest,
  currentManifest,
  releaseRecord,
  releaseRecordBytes,
  currentCommit,
  sourceIsAncestor,
  sourceSurfaceFailures = [],
}) {
  const failures = [];
  const previous = previousManifest?.releaseGroups?.engine;
  const current = currentManifest?.releaseGroups?.engine;

  if (previous?.state === "published") {
    if (serializeJson(previous) !== serializeJson(current)) {
      failures.push("published engine release state is immutable");
    }
  } else if (previous?.state !== "candidate") {
    failures.push("published transition requires a prior candidate engine release");
  }
  if (current?.state !== "published") {
    failures.push("engine transition target must be published");
  }
  if (previous?.version !== current?.version) {
    failures.push("published transition must preserve the candidate version");
  }
  if (releaseRecord?.version !== current?.version) {
    failures.push("release record version does not match the published manifest");
  }
  if (releaseRecord?.sourceCommit !== current?.sourceCommit) {
    failures.push("release record source commit does not match the published manifest");
  }
  if (!COMMIT_SHA.test(currentCommit ?? "")) {
    failures.push("transition commit must be an exact commit SHA");
  }
  if (!sourceIsAncestor) {
    failures.push("engine source commit must be an ancestor of the transition commit");
  }
  const actualRecordSha256 = createHash("sha256").update(releaseRecordBytes ?? "").digest("hex");
  if (current?.releaseRecord?.sha256 !== actualRecordSha256) {
    failures.push("release record SHA-256 does not match its committed bytes");
  }
  if (!RELEASE_RECORD_PATH.test(current?.releaseRecord?.path ?? "")) {
    failures.push("published release record path is invalid");
  }
  failures.push(...validateEngineReleaseRecord(releaseRecord));
  failures.push(...sourceSurfaceFailures);

  return failures;
}

export async function verifyPublishedEngineTransitionFromGit(root, manifest) {
  const engine = manifest?.releaseGroups?.engine;
  if (engine?.state !== "published") return [];
  const failures = [];
  const manifestCommits = execFileSync(
    "git",
    ["log", "--format=%H", "--", "release-manifest.json"],
    { cwd: root, encoding: "utf8" },
  ).trim().split(/\r?\n/).filter(Boolean);
  if (manifestCommits.length < 2) {
    return ["published engine release is missing a prior candidate manifest revision"];
  }
  const transitionCommit = manifestCommits[0];
  const previousManifest = JSON.parse(execFileSync(
    "git",
    ["show", `${manifestCommits[1]}:release-manifest.json`],
    { cwd: root, encoding: "utf8" },
  ));
  const sourceCommit = engine.sourceCommit;
  let sourceIsAncestor = false;
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", sourceCommit, transitionCommit],
      { cwd: root, stdio: "ignore" },
    );
    sourceIsAncestor = true;
  } catch {
    sourceIsAncestor = false;
  }
  let sourceSurfaceFailures = [];
  try {
    sourceSurfaceFailures = validateEngineSurfaceSnapshot(
      manifest,
      readSurfaceSnapshotFromGit(root, sourceCommit),
    );
  } catch (error) {
    sourceSurfaceFailures = [
      `unable to verify release surfaces at source commit: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  let recordPath = "";
  try {
    recordPath = await resolveReleaseRecordPath(root, engine.releaseRecord?.path);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  const releaseRecordBytes = recordPath
    ? await readFile(recordPath, "utf8").catch(() => "")
    : "";
  let releaseRecord = null;
  try {
    releaseRecord = JSON.parse(releaseRecordBytes);
  } catch {
    failures.push("published engine release record is missing or invalid JSON");
  }
  if (releaseRecord) {
    failures.push(...validateEngineReleaseTransition({
      previousManifest,
      currentManifest: manifest,
      releaseRecord,
      releaseRecordBytes,
      currentCommit: transitionCommit,
      sourceIsAncestor,
      sourceSurfaceFailures,
    }));
  }
  return failures;
}

export function stagePublishedEngineManifest({
  manifest,
  releaseRecord,
  releaseRecordPath,
  releaseRecordBytes,
  updatedAt,
}) {
  const engine = manifest?.releaseGroups?.engine;
  if (engine?.state !== "candidate") {
    throw new Error("only a candidate engine release can be staged as published");
  }
  const recordFailures = validateEngineReleaseRecord(releaseRecord);
  if (recordFailures.length > 0) {
    throw new Error(`Invalid engine release record:\n- ${recordFailures.join("\n- ")}`);
  }
  if (releaseRecord.version !== engine.version) {
    throw new Error("release record version does not match the candidate");
  }
  if (!RELEASE_RECORD_PATH.test(releaseRecordPath ?? "")) {
    throw new Error("release record path must be an immutable version path");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedAt ?? "")) {
    throw new Error("published manifest updatedAt must use YYYY-MM-DD");
  }
  const { previousPublicRelease: _previous, ...sharedEngine } = engine;
  return {
    ...manifest,
    updatedAt,
    releaseGroups: {
      ...manifest.releaseGroups,
      engine: {
        ...sharedEngine,
        state: "published",
        sourceCommit: releaseRecord.sourceCommit,
        releaseRecord: {
          path: releaseRecordPath,
          sha256: createHash("sha256").update(releaseRecordBytes).digest("hex"),
        },
      },
    },
  };
}

export function validatePublishedStagingPreconditions({
  manifest,
  committedManifest,
  sourceManifest,
  releaseRecord,
  sourceIsAncestor,
  sourceSurfaceFailures = [],
}) {
  const failures = [];
  const candidate = manifest?.releaseGroups?.engine;
  const sourceCandidate = sourceManifest?.releaseGroups?.engine;
  if (candidate?.state !== "candidate") {
    failures.push("published staging requires a candidate engine manifest");
  }
  if (serializeJson(committedManifest) !== serializeJson(manifest)) {
    failures.push("candidate manifest must be committed without working-tree drift before staging");
  }
  if (!sourceIsAncestor) {
    failures.push("release record source commit is not an ancestor of the candidate checkout");
  }
  if (sourceCandidate?.state !== "candidate"
    || sourceCandidate?.version !== candidate?.version
    || releaseRecord?.version !== candidate?.version) {
    failures.push("release record source commit does not contain the same candidate manifest");
  }
  failures.push(...validateEngineReleaseRecord(releaseRecord));
  failures.push(...sourceSurfaceFailures);
  return failures;
}

export function verifyPublishedStagingPreconditionsFromGit(root, manifest, releaseRecord) {
  const failures = [];
  let committedManifest = null;
  let sourceManifest = null;
  let sourceIsAncestor = false;
  let sourceSurfaceFailures = [];
  try {
    committedManifest = JSON.parse(execFileSync(
      "git",
      ["show", "HEAD:release-manifest.json"],
      { cwd: root, encoding: "utf8" },
    ));
  } catch (error) {
    failures.push(
      `unable to read the committed candidate manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    sourceManifest = JSON.parse(execFileSync(
      "git",
      ["show", `${releaseRecord?.sourceCommit}:release-manifest.json`],
      { cwd: root, encoding: "utf8" },
    ));
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", releaseRecord.sourceCommit, "HEAD"],
      { cwd: root, stdio: "ignore" },
    );
    sourceIsAncestor = true;
    sourceSurfaceFailures = validateEngineSurfaceSnapshot(
      sourceManifest,
      readSurfaceSnapshotFromGit(root, releaseRecord.sourceCommit),
    );
  } catch (error) {
    failures.push(
      `unable to verify the release record source commit: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  failures.push(...validatePublishedStagingPreconditions({
    manifest,
    committedManifest,
    sourceManifest,
    releaseRecord,
    sourceIsAncestor,
    sourceSurfaceFailures,
  }));
  return failures;
}

export function canClearPublicParityCap(manifest, evidence) {
  const engine = manifest?.releaseGroups?.engine;
  if (engine?.state !== "published" || !COMMIT_SHA.test(engine.sourceCommit ?? "")) return false;
  if (!RELEASE_RECORD_PATH.test(engine.releaseRecord?.path ?? "")
    || !SHA256.test(engine.releaseRecord?.sha256 ?? "")) return false;

  const required = ["transition", "npm", "githubRelease", "githubAction", "mcp", "studio", "website"];
  if (!required.every((name) => evidence?.[name]?.verified === true)) return false;
  if (evidence.transition?.sourceCommit !== engine.sourceCommit) return false;
  if (evidence.npm?.sourceCommit !== engine.sourceCommit) return false;
  if (evidence.githubRelease?.sourceCommit !== engine.sourceCommit
    || evidence.githubRelease?.checksumsVerified !== true) return false;
  if (evidence.githubAction?.sourceCommit !== engine.sourceCommit) return false;
  if (evidence.mcp?.version !== engine.version) return false;
  if (evidence.studio?.version !== manifest?.releaseGroups?.studio?.version) return false;
  const expectedManifestSha256 = createHash("sha256")
    .update(serializeJson(manifest))
    .digest("hex");
  if (evidence.website?.manifestSha256 !== expectedManifestSha256) return false;
  return true;
}

function integrityToHex(integrity) {
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity ?? "")) return "";
  const digest = Buffer.from(integrity.slice("sha512-".length), "base64");
  return digest.length === 64 ? digest.toString("hex") : "";
}

export function validateNpmPublishPreflight({
  manifest,
  packageVersion,
  expectedVersion,
  gitRef,
  sourceCommit,
  registryMetadata,
}) {
  const failures = validateReleaseManifest(manifest);
  const engine = manifest?.releaseGroups?.engine;
  if (gitRef !== "refs/heads/main") failures.push("npm publish must run from refs/heads/main");
  if (!COMMIT_SHA.test(sourceCommit ?? "")) {
    failures.push("npm publish source commit must be an exact commit SHA");
  }
  if (engine?.state !== "candidate") {
    failures.push("npm publish requires an engine candidate manifest");
  }
  if (engine?.sourceCommit !== null || engine?.releaseRecord !== null) {
    failures.push("npm publish candidate must not claim source or release evidence");
  }
  if (engine?.version !== expectedVersion) {
    failures.push(`release manifest version ${engine?.version ?? "missing"} does not match requested ${expectedVersion}`);
  }
  if (packageVersion !== expectedVersion) {
    failures.push(`package version ${packageVersion ?? "missing"} does not match requested ${expectedVersion}`);
  }
  if (registryMetadata?.versions?.[expectedVersion]) {
    failures.push(`@memi-design/cli@${expectedVersion} already exists; use recovery mode and never republish`);
  }
  return failures;
}

export function validateTarballBytes({ bytes, integrity, shasum }) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity ?? "")) {
    throw new Error("tarball integrity must be a valid SHA-512 SRI value");
  }
  if (!SHASUM.test(shasum ?? "")) throw new Error("tarball shasum must be a SHA-1 digest");
  const expectedSha512 = Buffer.from(integrity.slice("sha512-".length), "base64");
  const actualSha512 = createHash("sha512").update(buffer).digest();
  if (expectedSha512.length !== actualSha512.length
    || !actualSha512.equals(expectedSha512)) {
    throw new Error("tarball SHA-512 does not match npm integrity");
  }
  const actualSha1 = createHash("sha1").update(buffer).digest("hex");
  if (actualSha1 !== shasum) throw new Error("tarball SHA-1 does not match npm shasum");
  return {
    sha512: actualSha512.toString("hex"),
    sha1: actualSha1,
    bytes: buffer.length,
  };
}

export function validateEngineSurfaceSnapshot(manifest, snapshot) {
  const failures = [];
  const version = manifest?.releaseGroups?.engine?.version;
  const npm = manifest?.surfaces?.npm;
  const mcp = manifest?.surfaces?.mcp;
  const packageJson = snapshot?.["package.json"];
  const packageLock = snapshot?.["package-lock.json"];
  const server = snapshot?.["server.json"];
  const mcpb = snapshot?.["mcpb/manifest.json"];
  const codexPlugin = snapshot?.["plugins/memoire/.codex-plugin/plugin.json"];
  const claudePlugin = snapshot?.["plugins/memi-claude/.claude-plugin/plugin.json"];
  const widget = snapshot?.["plugin/widget-meta.json"];
  const action = snapshot?.["action.yml"];

  const exactVersions = [
    ["package.json", packageJson?.version],
    ["package-lock.json", packageLock?.version],
    ["package-lock.json root", packageLock?.packages?.[""]?.version],
    ["server.json", server?.version],
    ["server.json npm package", server?.packages?.find((entry) => entry.registryType === "npm")?.version],
    ["mcpb/manifest.json", mcpb?.version],
    ["Codex plugin", codexPlugin?.version],
    ["Claude plugin", claudePlugin?.version],
    ["Figma widget metadata", widget?.packageVersion],
  ];
  for (const [surface, actual] of exactVersions) {
    if (actual !== version) failures.push(`${surface} version ${actual ?? "missing"} does not match release manifest ${version}`);
  }
  if (packageJson?.name !== npm?.packageName) {
    failures.push(`package.json name ${packageJson?.name ?? "missing"} does not match release manifest ${npm?.packageName}`);
  }
  if (packageJson?.mcpName !== mcp?.serverName || server?.name !== mcp?.serverName) {
    failures.push("package.json and server.json MCP names must match the release manifest");
  }
  if (typeof action !== "string" || !action.includes(`default: "${version}"`)) {
    failures.push(`action.yml default CLI version does not match release manifest ${version}`);
  }
  if (typeof action !== "string" || !action.includes(`reviewed ${version} pin`)) {
    failures.push(`action.yml version description does not match release manifest ${version}`);
  }
  for (const scriptName of ["build:mcpb", "publish:smithery"]) {
    if (!packageJson?.scripts?.[scriptName]?.includes(`memi-${version}.mcpb`)) {
      failures.push(`package.json ${scriptName} does not use release manifest ${version}`);
    }
  }
  return failures;
}

function isNpmTarballUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://registry.npmjs.org"
      && url.pathname.endsWith(".tgz")
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function isNpmAttestationUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://registry.npmjs.org"
      && url.pathname.startsWith("/-/npm/v1/attestations/")
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function isSameOriginArtifactUrl(publicUrl, artifactUrl) {
  try {
    const site = new URL(publicUrl);
    const artifact = new URL(artifactUrl);
    return site.protocol === "https:"
      && site.origin === artifact.origin
      && artifact.pathname.endsWith(".json")
      && !artifact.username
      && !artifact.password;
  } catch {
    return false;
  }
}

function readSurfaceSnapshotFromGit(root, commit) {
  const show = (path) => execFileSync(
    "git",
    ["show", `${commit}:${path}`],
    { cwd: root, encoding: "utf8" },
  );
  const json = (path) => JSON.parse(show(path));
  return {
    "package.json": json("package.json"),
    "package-lock.json": json("package-lock.json"),
    "server.json": json("server.json"),
    "mcpb/manifest.json": json("mcpb/manifest.json"),
    "plugins/memoire/.codex-plugin/plugin.json": json("plugins/memoire/.codex-plugin/plugin.json"),
    "plugins/memi-claude/.claude-plugin/plugin.json": json("plugins/memi-claude/.claude-plugin/plugin.json"),
    "plugin/widget-meta.json": json("plugin/widget-meta.json"),
    "action.yml": show("action.yml"),
  };
}

export async function resolveReleaseRecordPath(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath) {
    throw new Error("release record path is required");
  }
  if (!RELEASE_RECORD_PATH.test(relativePath)) {
    throw new Error("release record path must use the immutable release-artifacts/npm version form");
  }
  const target = resolve(root, relativePath);
  const fromRoot = relative(resolve(root), target);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith("../")) {
    throw new Error("release record path must stay inside the checkout");
  }
  const targetStat = await lstat(target);
  if (targetStat.isSymbolicLink()) {
    throw new Error("release record path must not be a symlink");
  }
  if (!targetStat.isFile()) throw new Error("release record path must be a regular file");
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
  const realFromRoot = relative(realRoot, realTarget);
  if (!realFromRoot || realFromRoot === ".." || realFromRoot.startsWith("../")) {
    throw new Error("release record real path must stay inside the checkout");
  }
  return realTarget;
}

export function buildWebReleaseArtifact(manifest, sourceCommit) {
  const canonical = serializeJson(manifest);
  return {
    schemaVersion: 1,
    provenance: {
      repository: "https://github.com/sarveshsea/memi",
      path: "release-manifest.json",
      sourceCommit,
      sourceUrl:
        `https://raw.githubusercontent.com/sarveshsea/memi/${sourceCommit}/release-manifest.json`,
      manifestSha256: createHash("sha256").update(canonical).digest("hex"),
    },
    release: manifest,
  };
}

export function validateWebReleaseArtifact(manifest, artifact) {
  const failures = [];
  const provenance = artifact?.provenance;
  const canonical = serializeJson(manifest);
  const expectedDigest = createHash("sha256").update(canonical).digest("hex");

  if (artifact?.schemaVersion !== 1) {
    failures.push("release-artifacts/memoire-web.release.json schemaVersion must be 1");
  }
  if (serializeJson(artifact?.release) !== canonical) {
    failures.push("release-artifacts/memoire-web.release.json payload does not match release-manifest.json");
  }
  if (provenance?.repository !== "https://github.com/sarveshsea/memi"
    || provenance?.path !== "release-manifest.json") {
    failures.push("website release artifact provenance must identify the canonical Memi manifest");
  }
  if (!COMMIT_SHA.test(provenance?.sourceCommit ?? "")) {
    failures.push("website release artifact provenance must include an exact source commit");
  }
  const expectedSourceUrl =
    `https://raw.githubusercontent.com/sarveshsea/memi/${provenance?.sourceCommit}/release-manifest.json`;
  if (provenance?.sourceUrl !== expectedSourceUrl) {
    failures.push(`website release artifact source URL must be ${expectedSourceUrl}`);
  }
  if (provenance?.manifestSha256 !== expectedDigest) {
    failures.push("website release artifact SHA-256 does not match release-manifest.json");
  }

  return failures;
}

export function resolveManifestSourceCommit(root, manifest) {
  const isShallow = execFileSync(
    "git",
    ["rev-parse", "--is-shallow-repository"],
    { cwd: root, encoding: "utf8" },
  ).trim() === "true";
  const sourceCommit = execFileSync(
    "git",
    ["log", "-1", "--format=%H", "--", "release-manifest.json"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  if (!COMMIT_SHA.test(sourceCommit)) {
    throw new Error("release-manifest.json must be committed before generating its website artifact");
  }
  if (isShallow) {
    let sourceHasParent = false;
    try {
      execFileSync(
        "git",
        ["rev-parse", "--verify", `${sourceCommit}^`],
        { cwd: root, stdio: "ignore" },
      );
      sourceHasParent = true;
    } catch {
      sourceHasParent = false;
    }
    if (!sourceHasParent) {
      throw new Error("release artifact generation requires full Git history; offline --check remains supported");
    }
  }
  const committed = execFileSync(
    "git",
    ["show", `${sourceCommit}:release-manifest.json`],
    { cwd: root, encoding: "utf8" },
  );
  if (serializeJson(JSON.parse(committed)) !== serializeJson(manifest)) {
    throw new Error("release-manifest.json changed after its source commit; commit it before generating artifacts");
  }
  return sourceCommit;
}

export async function verifyCoreReleaseSurfaces(root, manifest) {
  const failures = validateReleaseManifest(manifest);

  const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
  const snapshot = {
    "package.json": await readJson("package.json"),
    "package-lock.json": await readJson("package-lock.json"),
    "server.json": await readJson("server.json"),
    "mcpb/manifest.json": await readJson("mcpb/manifest.json"),
    "plugins/memoire/.codex-plugin/plugin.json": await readJson("plugins/memoire/.codex-plugin/plugin.json"),
    "plugins/memi-claude/.claude-plugin/plugin.json": await readJson("plugins/memi-claude/.claude-plugin/plugin.json"),
    "plugin/widget-meta.json": await readJson("plugin/widget-meta.json"),
    "action.yml": await readFile(join(root, "action.yml"), "utf8"),
  };
  failures.push(...validateEngineSurfaceSnapshot(manifest, snapshot));

  const artifactPath = join(root, "release-artifacts", "memoire-web.release.json");
  const artifact = await readFile(artifactPath, "utf8")
    .then((content) => JSON.parse(content))
    .catch(() => null);
  failures.push(...validateWebReleaseArtifact(manifest, artifact));

  return failures;
}
