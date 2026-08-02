import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveReleaseRecordPath } from "./release-manifest.mjs";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BRAND_MANIFEST_PATH = "brand/brand-manifest.v1.json";
const BRAND_SCHEMA_PATH = "brand/brand-manifest.v1.schema.json";
const BRAND_MANIFEST_SHA256 = "98cd5224d31466a86d3f2d102bf6f160a195aed9c393d29a7f09eb75ecc90ff3";
const BRAND_SCHEMA_SHA256 = "6968bf5e5884530b47ecf31702f020d4d957b6aa4f4d1e82d9b8cd3fd44a2d0d";

export async function loadAndValidateEcosystemIdentity(root) {
  const [packageJson, releaseManifest, brandManifestBytes, brandSchemaBytes] = await Promise.all([
    readJson(join(root, "package.json")),
    readJson(join(root, "release-manifest.json")),
    readFile(join(root, BRAND_MANIFEST_PATH)),
    readFile(join(root, BRAND_SCHEMA_PATH)),
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
    brandManifest: JSON.parse(brandManifestBytes.toString("utf8")),
    brandManifestBytes,
    brandSchemaBytes,
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
  brandManifest,
  brandManifestBytes,
  brandSchemaBytes,
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
  validateBrandContract({
    brandManifest,
    brandManifestBytes,
    brandSchemaBytes,
    failures,
    identity,
    packageJson,
  });
  return failures;
}

function validateBrandContract({
  brandManifest,
  brandManifestBytes,
  brandSchemaBytes,
  failures,
  identity,
  packageJson,
}) {
  if (sha256(brandManifestBytes) !== BRAND_MANIFEST_SHA256) {
    failures.push("vendored organization brand manifest must match canonical revision-2 bytes");
  }
  if (sha256(brandSchemaBytes) !== BRAND_SCHEMA_SHA256) {
    failures.push("vendored organization brand schema must match canonical revision-2 bytes");
  }
  if (brandManifest?.schemaVersion !== 1 || brandManifest?.brandRevision !== 2) {
    failures.push("organization brand contract must use schemaVersion 1 and brandRevision 2");
  }
  for (const path of [BRAND_MANIFEST_PATH, BRAND_SCHEMA_PATH]) {
    if (!packageJson?.files?.includes(path)) {
      failures.push(`package.json must package the pinned brand contract file ${path}`);
    }
  }

  const cli = brandManifest?.products?.find(({ id }) => id === "cli");
  const expectedCliLicense = {
    spdx: "MIT",
    name: "MIT License",
    url: "https://github.com/memi-design/memi/blob/main/LICENSE",
  };
  if (cli?.name !== "memi CLI"
    || cli?.status !== "available"
    || cli?.urls?.repository !== "https://github.com/memi-design/memi"
    || cli?.urls?.package !== "https://www.npmjs.com/package/@memi-design/cli"
    || !sameJson(cli?.license, expectedCliLicense)) {
    failures.push("brand CLI name, status, repository, package, and license must match revision-2 truth");
  }
  if (cli?.urls?.repository !== identity?.publisher?.repository
    || cli?.urls?.package !== `https://www.npmjs.com/package/${packageJson?.name}`
    || cli?.license?.spdx !== packageJson?.license
    || packageJson?.repository?.url !== "git+https://github.com/memi-design/memi.git") {
    failures.push("package and release identity surfaces must agree with the pinned CLI brand product");
  }

  const canvas = brandManifest?.products?.find(({ id }) => id === "canvas");
  const expectedCanvasIcons = [{
    id: "canvas-single-heart",
    purpose: "app",
    url: "https://raw.githubusercontent.com/memi-design/memi-canvas/main/apps/macos/src-tauri/icons/icon.png",
    sourceUrl: "https://raw.githubusercontent.com/memi-design/memi-canvas/main/apps/macos/src-tauri/icons/source/MemiCanvas-Iteration-02.icon/icon.json",
    sha256: "da068f20ba9e0e43f59ebde8602b43342f8c77fef2c080155a18d5a8fd0e25c2",
    alt: "Ruby single pixel-heart memi Canvas icon",
  }];
  if (canvas?.status !== "development"
    || canvas?.statusNote !== "Open-source M0 development snapshot; not yet a production importer or source editor."
    || !sameJson(canvas?.icons, expectedCanvasIcons)) {
    failures.push("brand Canvas development status and canonical icon must match revision-2 truth");
  }
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

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes ?? "").digest("hex");
}
