// @ts-nocheck
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_README_PHRASE,
  SLSA_PROVENANCE_V1,
  assertRegistryAttestationUrl,
  validateProvenanceAttestations,
  validateRegistryVersion,
} from "../../../scripts/lib/npm-release-verification.mjs";

const packageName = "@memi-design/cli";
const expectedVersion = "2.6.3";
const releaseDigest = Buffer.alloc(64, 0xab);
const expectedIntegrity = `sha512-${releaseDigest.toString("base64")}`;
const expectedSourceCommit = "a".repeat(40);
const expectedRepository = "https://github.com/sarveshsea/memi";
const expectedWorkflowPath = ".github/workflows/publish.yml";

function provenancePayload(overrides: Record<string, unknown> = {}) {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{
      name: "pkg:npm/%40memi-design/cli@2.6.3",
      digest: {
        sha512: releaseDigest.toString("hex"),
      },
    }],
    predicateType: SLSA_PROVENANCE_V1,
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: expectedRepository,
            path: `/${expectedWorkflowPath}`,
            ref: "refs/heads/main",
          },
        },
        resolvedDependencies: [{
          uri: `git+${expectedRepository}@refs/heads/main`,
          digest: { gitCommit: expectedSourceCommit },
        }],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
      },
    },
    ...overrides,
  };

  return {
    attestations: [{
      predicateType: SLSA_PROVENANCE_V1,
      bundle: {
        dsseEnvelope: {
          payloadType: "application/vnd.in-toto+json",
          payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
          signatures: [{ sig: "fixture-signature", keyid: "" }],
        },
      },
    }],
  };
}

describe("npm publish workflow provenance contract", () => {
  it("publishes only an explicit main-branch version with deterministic dependencies", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "publish.yml"),
      "utf8",
    );

    expect(workflow).toContain("required: true");
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("group: npm-publish");
    expect(workflow).toContain("npm ci --ignore-scripts");
    expect(workflow).not.toMatch(/^\s+- run: npm install --ignore-scripts\s*$/m);
    expect(workflow).toContain("EXPECTED_VERSION: ${{ inputs.expected_version }}");
    expect(workflow).toContain("mode:");
    expect(workflow).toContain("source_run_id:");
    expect(workflow).toContain("source_run_attempt:");
    expect(workflow).toContain("/attempts/${SOURCE_RUN_ATTEMPT}");
    expect(workflow).toContain("node scripts/verify-npm-release.mjs --prepublish");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("github.sha");
  });

  it("generates and uploads a CycloneDX SBOM before publishing with provenance", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "publish.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "npm sbom --package-lock-only --sbom-format cyclonedx",
    );
    expect(workflow).toContain(
      "actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f",
    );
    expect(workflow).toContain("path: release-evidence/");
    expect(workflow).toContain("npm publish --access public --provenance");
    expect(workflow).toContain("if: inputs.mode == 'publish'");
  });

  it("verifies the published package signatures and attestations in a clean consumer", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "publish.yml"),
      "utf8",
    );

    expect(workflow).toContain("EXPECTED_SOURCE_COMMIT: ${{ github.sha }}");
    expect(workflow).toContain("EXPECTED_SOURCE_REF: refs/heads/main");
    expect(workflow).toContain("npm audit signatures --include-attestations");
    expect(workflow).toContain('npm install --ignore-scripts "${PACKAGE_SPEC}"');
    expect(workflow).toContain("RELEASE_RECORD_OUTPUT:");
    expect(workflow).toContain("GITHUB_RUN_ATTEMPT");
    expect(workflow).toContain("release-artifacts/npm/");
  });

  it("supports evidence recovery without republishing an existing version", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "publish.yml"),
      "utf8",
    );

    expect(workflow).toContain("inputs.mode == 'recover'");
    expect(workflow).toContain("source_run_id");
    expect(workflow).toContain("actions/download-artifact@");
    expect(workflow).toContain("RECOVERY_SOURCE_COMMIT");
    expect(workflow).not.toMatch(/inputs\.mode == 'recover'[\s\S]{0,400}npm publish/);
  });

  it("documents the trusted-publisher path without a manual token publish bypass", async () => {
    const guide = await readFile(
      join(process.cwd(), "docs", "RELEASE_GATES.md"),
      "utf8",
    );

    expect(guide).toContain("npm trusted publisher");
    expect(guide).toContain("Publish to npm");
    expect(guide).toContain("expected_version");
    expect(guide).toContain("SLSA");
    expect(guide).toContain("candidate");
    expect(guide).toContain("sourceCommit: null");
    expect(guide).toContain("--stage-published");
    expect(guide).toContain("recovery");
    expect(guide).toContain("never republish");
    expect(guide).not.toContain("npm publish --access public --auth-type=web");
    expect(guide).not.toContain("npm login --auth-type=web");
  });
});

describe("npm release verification", () => {
  it("accepts complete registry integrity and provenance metadata", () => {
    const result = validateRegistryVersion({
      metadata: {
        "dist-tags": { latest: expectedVersion },
        readme: `${DEFAULT_README_PHRASE}\nnpm i -g ${packageName}`,
        versions: {
          [expectedVersion]: {
            dist: {
              integrity: expectedIntegrity,
              shasum: "b".repeat(40),
              signatures: [{ keyid: "fixture-key", sig: "fixture-signature" }],
              attestations: {
                url: `https://registry.npmjs.org/-/npm/v1/attestations/%40memi-design%2fcli@${expectedVersion}`,
                provenance: { predicateType: SLSA_PROVENANCE_V1 },
              },
            },
          },
        },
      },
      packageName,
      expectedVersion,
      expectedPhrase: DEFAULT_README_PHRASE,
      expectedInstall: `npm i -g ${packageName}`,
      requireProvenance: true,
    });

    expect(result.integrity).toBe(expectedIntegrity);
    expect(result.attestationUrl).toContain("/-/npm/v1/attestations/");
  });

  it("rejects incomplete package integrity or provenance metadata", () => {
    expect(() => validateRegistryVersion({
      metadata: {
        "dist-tags": { latest: expectedVersion },
        readme: `${DEFAULT_README_PHRASE}\nnpm i -g ${packageName}`,
        versions: { [expectedVersion]: { dist: {} } },
      },
      packageName,
      expectedVersion,
      expectedPhrase: DEFAULT_README_PHRASE,
      expectedInstall: `npm i -g ${packageName}`,
      requireProvenance: true,
    })).toThrow("integrity");
  });

  it("allows only npm registry attestation endpoints", () => {
    expect(() => assertRegistryAttestationUrl("https://example.com/attestation"))
      .toThrow("registry.npmjs.org");
    expect(assertRegistryAttestationUrl(
      `https://registry.npmjs.org/-/npm/v1/attestations/%40memi-design%2fcli@${expectedVersion}`,
    )).toContain("registry.npmjs.org");
  });

  it("binds SLSA provenance to the package, digest, repository, workflow, and source commit", () => {
    const result = validateProvenanceAttestations({
      payload: provenancePayload(),
      packageName,
      expectedVersion,
      expectedIntegrity,
      expectedRepository,
      expectedWorkflowPath,
      expectedSourceCommit,
    });

    expect(result).toMatchObject({
      sourceCommit: expectedSourceCommit,
      repository: expectedRepository,
      workflowPath: expectedWorkflowPath,
      workflowRef: "refs/heads/main",
    });
  });

  it("rejects provenance from another source commit", () => {
    expect(() => validateProvenanceAttestations({
      payload: provenancePayload(),
      packageName,
      expectedVersion,
      expectedIntegrity,
      expectedRepository,
      expectedWorkflowPath,
      expectedSourceCommit: "c".repeat(40),
    })).toThrow("source commit");
  });
});
