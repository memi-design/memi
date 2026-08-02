import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveReleaseRecordPath } from "./release-manifest.mjs";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;

export async function loadAndValidateEcosystemIdentity(root) {
  const [packageJson, releaseManifest] = await Promise.all([
    readJson(join(root, "package.json")),
    readJson(join(root, "release-manifest.json")),
  ]);
  const version = packageJson.version;
  if (!SEMVER.test(version ?? "")) {
    throw new Error("package.json version must be exact semver before loading ecosystem identity");
  }

  const identityPath = `release-artifacts/identity/${version}.identity.json`;
  const identity = await readJson(join(root, identityPath));
  const npmReceiptPath = await resolveReleaseRecordPath(
    root,
    releaseManifest?.releaseGroups?.engine?.releaseRecord?.path,
  );
  const npmReceiptBytes = await readFile(npmReceiptPath);
  const context = {
    identity,
    identityPath,
    npmReceiptBytes,
    packageJson,
    releaseManifest,
  };
  const failures = validateEcosystemIdentity(context);
  if (failures.length > 0) {
    throw new Error(`Ecosystem identity validation failed:\n- ${failures.join("\n- ")}`);
  }
  return context;
}

export function validateEcosystemIdentity({
  identity,
  identityPath,
  npmReceiptBytes,
  packageJson,
  releaseManifest,
}) {
  const failures = [];
  const version = packageJson?.version;
  const engine = releaseManifest?.releaseGroups?.engine;
  const expectedIdentityPath = `release-artifacts/identity/${version}.identity.json`;
  const expectedNpmReceiptPath = engine?.releaseRecord?.path;
  const npmReceiptSha256 = createHash("sha256").update(npmReceiptBytes ?? "").digest("hex");
  const packagedIdentityPaths = (packageJson?.files ?? [])
    .filter((path) => path.startsWith("release-artifacts/identity/"));

  if (!SEMVER.test(version ?? "")) {
    failures.push("package.json version must be exact semver");
  }
  if (engine?.version !== version) {
    failures.push("release manifest engine version must match package.json");
  }
  if (identityPath !== expectedIdentityPath) {
    failures.push(`identity receipt path must be derived as ${expectedIdentityPath}`);
  }
  if (packagedIdentityPaths.length !== 1 || packagedIdentityPaths[0] !== expectedIdentityPath) {
    failures.push("package.json must package only the current ecosystem identity receipt");
  }
  if (identity?.schemaVersion !== 1) {
    failures.push("ecosystem identity schemaVersion must be 1");
  }
  if (identity?.release?.version !== version) {
    failures.push("identity release version must match package.json");
  }
  if (identity?.release?.sourceCommit !== engine?.sourceCommit) {
    failures.push("identity release source commit must match the release manifest");
  }
  if (identity?.release?.npmReceipt !== expectedNpmReceiptPath) {
    failures.push("identity npm receipt path must match the release manifest pointer");
  }
  if (!SHA256.test(identity?.release?.npmReceiptSha256 ?? "")
    || identity?.release?.npmReceiptSha256 !== npmReceiptSha256) {
    failures.push("identity npm receipt SHA-256 does not match the committed receipt bytes");
  }
  if (engine?.releaseRecord?.sha256 !== npmReceiptSha256) {
    failures.push("release manifest npm receipt SHA-256 does not match the committed receipt bytes");
  }

  validateNpmReceipt({ failures, npmReceiptBytes, version, engine });
  validatePublisherIdentity({ failures, identity, packageJson, releaseManifest });
  return failures;
}

function validateNpmReceipt({ failures, npmReceiptBytes, version, engine }) {
  let npmReceipt;
  try {
    npmReceipt = JSON.parse(Buffer.from(npmReceiptBytes ?? "").toString("utf8"));
  } catch {
    failures.push("identity npm receipt must be valid JSON");
    return;
  }
  if (npmReceipt.version !== version) {
    failures.push("identity npm receipt version must match package.json");
  }
  if (npmReceipt.sourceCommit !== engine?.sourceCommit) {
    failures.push("identity npm receipt source commit must match the release manifest");
  }
}

function validatePublisherIdentity({ failures, identity, packageJson, releaseManifest }) {
  const mcp = identity?.surfaces?.mcpRegistry;
  const legacyMcp = mcp?.legacy;
  const smithery = identity?.surfaces?.smithery;
  const observedVersions = legacyMcp?.observedVersions;
  const legacyVerification = identity?.verification?.mcpRegistryLegacyRecord;

  if (identity?.publisher?.organization !== "memi-design"
    || identity?.publisher?.repository !== "https://github.com/memi-design/memi"
    || identity?.publisher?.npmPackage !== packageJson?.name) {
    failures.push("ecosystem identity publisher must be the canonical memi-design package owner");
  }
  if (mcp?.identifier !== releaseManifest?.surfaces?.mcp?.serverName
    || mcp?.version !== packageJson?.version
    || mcp?.status !== "published") {
    failures.push("ecosystem identity MCP record must match the published release manifest");
  }
  if (legacyMcp?.policyStatus !== "deprecated" || legacyMcp?.observedStatus !== "active") {
    failures.push("legacy MCP identity must separate deprecated policy from active observed status");
  }
  if (!Array.isArray(observedVersions)
    || observedVersions.length === 0
    || observedVersions.some((version) => !SEMVER.test(version))) {
    failures.push("legacy MCP identity must include observed active registry versions");
  } else if (!observedVersions.includes(legacyMcp.latestObservedVersion)) {
    failures.push("legacy MCP latest observed version must appear in observedVersions");
  }
  if (legacyVerification?.httpStatus !== 200
    || legacyVerification?.observedStatus !== legacyMcp?.observedStatus
    || legacyVerification?.resultCount !== observedVersions?.length
    || legacyVerification?.latestObservedVersion !== legacyMcp?.latestObservedVersion) {
    failures.push("legacy MCP live verification must match the recorded observed versions");
  }
  if (smithery?.identifier !== "memi-design/memi"
    || smithery?.publishTarget !== "memi-design/memi"
    || smithery?.status !== "migration_pending") {
    failures.push("Smithery identity must remain organization-targeted and migration_pending");
  }
  if (smithery?.legacy?.status !== "deprecated_compatibility") {
    failures.push("legacy Smithery identity must be explicit deprecated compatibility");
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
