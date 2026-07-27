#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_README_PHRASE,
  assertRegistryAttestationUrl,
  validateProvenanceAttestations,
  validateRegistryVersion,
} from "./lib/npm-release-verification.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));

const packageName = process.env.PACKAGE_NAME || pkg.name;
const expectedVersion = process.env.EXPECTED_VERSION || pkg.version;
const expectedPhrase = process.env.EXPECTED_README_PHRASE || DEFAULT_README_PHRASE;
const expectedInstall = process.env.EXPECTED_INSTALL_COMMAND || `npm i -g ${packageName}`;
const requireProvenance = process.env.REQUIRE_PROVENANCE !== "false";
const expectedRepository = process.env.EXPECTED_SOURCE_REPOSITORY
  || String(pkg.repository?.url || "")
    .replace(/^git\+/, "")
    .replace(/\.git$/, "");
const expectedWorkflowPath = process.env.EXPECTED_SOURCE_WORKFLOW
  || ".github/workflows/publish.yml";
const expectedWorkflowRef = process.env.EXPECTED_SOURCE_REF || "refs/heads/main";
const expectedSourceCommit = process.env.EXPECTED_SOURCE_COMMIT
  || process.env.GITHUB_SHA
  || "";
const attempts = Number.parseInt(process.env.NPM_VERIFY_ATTEMPTS || "12", 10);
const delayMs = Number.parseInt(process.env.NPM_VERIFY_DELAY_MS || "10000", 10);

const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName).replace(/^%40/, "%40")}`;

if (requireProvenance && !/^[0-9a-f]{40}$/.test(expectedSourceCommit)) {
  fail("EXPECTED_SOURCE_COMMIT or GITHUB_SHA must be an exact commit when provenance is required");
}

let lastError = "";
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const response = await fetch(registryUrl, {
      headers: { "User-Agent": "memoire-release-verifier" },
    });
    if (!response.ok) {
      throw new Error(`registry returned ${response.status}`);
    }

    const metadata = await response.json();
    const registry = validateRegistryVersion({
      metadata,
      packageName,
      expectedVersion,
      expectedPhrase,
      expectedInstall,
      requireProvenance,
    });

    let provenance = null;
    if (requireProvenance) {
      const attestationUrl = assertRegistryAttestationUrl(registry.attestationUrl);
      const attestationResponse = await fetch(attestationUrl, {
        headers: { "User-Agent": "memoire-release-verifier" },
      });
      if (!attestationResponse.ok) {
        throw new Error(`attestation registry returned ${attestationResponse.status}`);
      }
      provenance = validateProvenanceAttestations({
        payload: await attestationResponse.json(),
        packageName,
        expectedVersion,
        expectedIntegrity: registry.integrity,
        expectedRepository,
        expectedWorkflowPath,
        expectedWorkflowRef,
        expectedSourceCommit,
      });
    }

    console.log(JSON.stringify({
      status: "verified",
      packageName,
      latest: registry.latest,
      expectedPhrase,
      expectedInstall,
      integrity: registry.integrity,
      shasum: registry.shasum,
      signatureCount: registry.signatureCount,
      provenance,
      attempts: attempt,
    }, null, 2));
    process.exit(0);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

console.error(JSON.stringify({
  status: "failed",
  packageName,
  expectedVersion,
  expectedPhrase,
  expectedInstall,
  registryUrl,
  attempts,
  error: lastError,
}, null, 2));
process.exit(1);

function fail(message) {
  console.error(JSON.stringify({
    status: "failed",
    packageName,
    expectedVersion,
    registryUrl,
    error: message,
  }, null, 2));
  process.exit(1);
}
