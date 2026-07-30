import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildEngineReleaseRecord,
  canClearPublicParityCap,
  resolveReleaseRecordPath,
  serializeJson,
  stagePublishedEngineManifest,
  validateEngineSurfaceSnapshot,
  validateEngineReleaseRecord,
  validateEngineReleaseTransition,
  validatePublishedStagingPreconditions,
  validateNpmPublishPreflight,
  validateProvenanceInvocation,
  validateTarballBytes,
  validateReleaseManifest,
} from "../../../scripts/lib/release-manifest.mjs";

const sourceCommit = "a".repeat(40);
const transitionCommit = "b".repeat(40);
const recordPath = "release-artifacts/npm/2.6.3.release.json";

function manifestFor(engine: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    updatedAt: "2026-07-27",
    releaseGroups: {
      engine: {
        version: "2.6.3",
        ...engine,
      },
      studio: {
        version: "2.5.0",
        status: "available",
        channel: "stable",
        releaseDate: "July 2026",
        releaseSize: "48 MB",
      },
      site: { version: "1.0.4" },
    },
    surfaces: {
      npm: {
        releaseGroup: "engine",
        packageName: "@memi-design/cli",
        url: "https://www.npmjs.com/package/@memi-design/cli",
      },
      githubRelease: {
        releaseGroup: "engine",
        repository: "memi-design/memi",
        tagPrefix: "v",
        url: "https://github.com/memi-design/memi/releases/tag/v2.6.3",
      },
      githubAction: {
        releaseGroup: "engine",
        repository: "memi-design/memi",
        majorTag: "v2",
      },
      mcp: {
        releaseGroup: "engine",
        serverName: "io.github.sarveshsea/memi",
      },
      studio: {
        releaseGroup: "studio",
        repository: "memi-design/memi-studio",
        tagPrefix: "v",
        arm64Asset: "Memoire.Studio_{version}_aarch64.dmg",
        x64Asset: "Memoire.Studio_{version}_x64.dmg",
        checksumAsset: "SHA256SUMS",
      },
      website: {
        releaseGroup: "site",
        repository: "memi-design/memoire-web",
        publicUrl: "https://www.memoire.cv",
        releaseArtifactUrl: "https://www.memoire.cv/release/memi-release.json",
      },
    },
  };
}

function releaseRecord() {
  return buildEngineReleaseRecord({
    version: "2.6.3",
    packageName: "@memi-design/cli",
    sourceCommit,
    integrity: `sha512-${Buffer.alloc(64, 0xab).toString("base64")}`,
    shasum: "c".repeat(40),
    tarballUrl: "https://registry.npmjs.org/@memi-design/cli/-/cli-2.6.3.tgz",
    tarballSha512: "ab".repeat(64),
    tarballSha1: "c".repeat(40),
    signatureCount: 1,
    npmAuditSignaturesVerified: true,
    attestation: {
      url: "https://registry.npmjs.org/-/npm/v1/attestations/%40memi-design%2fcli@2.6.3",
      predicateType: "https://slsa.dev/provenance/v1",
      subject: "pkg:npm/%40memi-design/cli@2.6.3",
      sha512: "ab".repeat(64),
      repository: "https://github.com/memi-design/memi",
      workflowPath: ".github/workflows/publish.yml",
      workflowRef: "refs/heads/main",
      invocationId: "https://github.com/memi-design/memi/actions/runs/123456789/attempts/1",
    },
    workflow: {
      repository: "memi-design/memi",
      path: ".github/workflows/publish.yml",
      ref: "refs/heads/main",
      runId: "123456789",
      runAttempt: 1,
    },
    sbom: {
      path: "memi.cdx.json",
      sha256: "d".repeat(64),
    },
    publishedAt: "2026-07-27T12:00:00.000Z",
  });
}

describe("verified engine release state machine", () => {
  it("accepts only the pinned historical personal provenance and canonical organization provenance", () => {
    const historical = {
      ...releaseRecord(),
      sourceCommit: "0f89cbf1b9972c779dbf14cc09f6c91485a1182b",
      attestation: {
        ...releaseRecord().attestation,
        repository: "https://github.com/sarveshsea/memi",
        invocationId: "https://github.com/sarveshsea/memi/actions/runs/123456789/attempts/1",
      },
      workflow: {
        ...releaseRecord().workflow,
        repository: "sarveshsea/memi",
      },
    };
    const organization = releaseRecord();
    const futurePersonalRelease = {
      ...historical,
      sourceCommit,
    };

    expect(validateEngineReleaseRecord(historical)).toEqual([]);
    expect(validateEngineReleaseRecord(organization)).toEqual([]);
    expect(validateEngineReleaseRecord(futurePersonalRelease)).toContain(
      "release record workflow identity is incorrect",
    );
  });

  it("requires candidate releases to have null source and release record fields", () => {
    const valid = manifestFor({
      state: "candidate",
      sourceCommit: null,
      releaseRecord: null,
    });
    const invalid = manifestFor({
      state: "candidate",
      sourceCommit,
      releaseRecord: { path: recordPath, sha256: "e".repeat(64) },
    });

    expect(validateReleaseManifest(valid)).toEqual([]);
    expect(validateReleaseManifest(invalid)).toEqual(expect.arrayContaining([
      "candidate engine release sourceCommit must be null",
      "candidate engine release releaseRecord must be null",
    ]));
  });

  it("requires a published website artifact endpoint but not a historical one", () => {
    const record = releaseRecord();
    const published = manifestFor({
      state: "published",
      sourceCommit,
      releaseRecord: {
        path: recordPath,
        sha256: createHash("sha256").update(serializeJson(record)).digest("hex"),
      },
    });
    const withoutArtifactEndpoint = {
      ...published,
      surfaces: {
        ...published.surfaces,
        website: {
          releaseGroup: "site",
          repository: "sarveshsea/memoire-web",
          publicUrl: "https://www.memoire.cv",
        },
      },
    };

    expect(validateReleaseManifest(published)).toEqual([]);
    expect(validateReleaseManifest(withoutArtifactEndpoint)).toContain(
      "published engine release requires a same-origin website release artifact URL",
    );
  });

  it("never lets candidate or historical state clear the public parity cap", () => {
    const evidence = {
      transition: { verified: true },
      npm: { verified: true },
      githubRelease: { verified: true },
      githubAction: { verified: true },
      mcp: { verified: true },
      studio: { verified: true },
      website: { verified: true },
    };

    expect(canClearPublicParityCap(
      manifestFor({ state: "candidate", sourceCommit: null, releaseRecord: null }),
      evidence,
    )).toBe(false);
    expect(canClearPublicParityCap(
      manifestFor({
        state: "historical",
        sourceCommit,
        releaseRecord: null,
        verification: { eligibleForParity: false, reason: "legacy release" },
      }),
      evidence,
    )).toBe(false);
  });

  it("allows publishing only a main-branch candidate absent from npm", () => {
    const candidate = manifestFor({
      state: "candidate",
      sourceCommit: null,
      releaseRecord: null,
    });

    expect(validateNpmPublishPreflight({
      manifest: candidate,
      packageVersion: "2.6.3",
      expectedVersion: "2.6.3",
      gitRef: "refs/heads/main",
      sourceCommit,
      registryMetadata: {
        versions: { "2.6.2": {} },
      },
    })).toEqual([]);
    expect(validateNpmPublishPreflight({
      manifest: candidate,
      packageVersion: "2.6.3",
      expectedVersion: "2.6.3",
      gitRef: "refs/heads/feature",
      sourceCommit,
      registryMetadata: {
        versions: { "2.6.3": {} },
      },
    })).toEqual(expect.arrayContaining([
      "npm publish must run from refs/heads/main",
      "@memi-design/cli@2.6.3 already exists; use recovery mode and never republish",
    ]));
  });

  it("verifies downloaded tarball bytes against both npm digests", () => {
    const bytes = Buffer.from("immutable npm tarball fixture");
    const sha512 = createHash("sha512").update(bytes).digest();
    const sha1 = createHash("sha1").update(bytes).digest("hex");

    expect(validateTarballBytes({
      bytes,
      integrity: `sha512-${sha512.toString("base64")}`,
      shasum: sha1,
    })).toEqual({
      sha512: sha512.toString("hex"),
      sha1,
      bytes: bytes.length,
    });
    expect(() => validateTarballBytes({
      bytes: Buffer.from("tampered"),
      integrity: `sha512-${sha512.toString("base64")}`,
      shasum: sha1,
    })).toThrow("tarball SHA-512 does not match npm integrity");
  });

  it("binds the release record run and attempt to the SLSA invocation", () => {
    const workflow = {
      repository: "memi-design/memi",
      path: ".github/workflows/publish.yml",
      ref: "refs/heads/main",
      runId: "123456789",
      runAttempt: 1,
    };

    expect(validateProvenanceInvocation(
      "https://github.com/memi-design/memi/actions/runs/123456789/attempts/1",
      workflow,
    )).toEqual([]);
    expect(validateProvenanceInvocation(
      "https://github.com/memi-design/memi/actions/runs/123456789/attempts/2",
      workflow,
    )).toContain("SLSA invocation does not match the recorded workflow run and attempt");
  });

  it("verifies every version-bearing surface at the candidate commit", () => {
    const manifest = manifestFor({
      state: "candidate",
      sourceCommit: null,
      releaseRecord: null,
    });
    const snapshot = {
      "package.json": {
        name: "@memi-design/cli",
        version: "2.6.3",
        mcpName: "io.github.sarveshsea/memi",
        scripts: {
          "build:mcpb": "pack .dist/memi-2.6.3.mcpb",
          "publish:smithery": "publish .dist/memi-2.6.3.mcpb",
        },
      },
      "package-lock.json": { version: "2.6.3", packages: { "": { version: "2.6.3" } } },
      "server.json": {
        name: "io.github.sarveshsea/memi",
        version: "2.6.3",
        packages: [{ registryType: "npm", version: "2.6.3" }],
      },
      "mcpb/manifest.json": { version: "2.6.3" },
      "plugins/memoire/.codex-plugin/plugin.json": { version: "2.6.3" },
      "plugins/memi-claude/.claude-plugin/plugin.json": { version: "2.6.3" },
      "plugin/widget-meta.json": { packageVersion: "2.6.3" },
      "action.yml": 'default: "2.6.3"\ndescription: "reviewed 2.6.3 pin"',
    };

    expect(validateEngineSurfaceSnapshot(manifest, snapshot)).toEqual([]);
    expect(validateEngineSurfaceSnapshot(manifest, {
      ...snapshot,
      "server.json": { ...snapshot["server.json"], version: "2.6.2" },
    })).toContain("server.json version 2.6.2 does not match release manifest 2.6.3");
  });

  it("binds a published transition to the exact candidate, source commit, and record bytes", () => {
    const record = releaseRecord();
    const recordSha256 = createHash("sha256")
      .update(serializeJson(record))
      .digest("hex");
    const previous = manifestFor({
      state: "candidate",
      sourceCommit: null,
      releaseRecord: null,
    });
    const current = manifestFor({
      state: "published",
      sourceCommit,
      releaseRecord: { path: recordPath, sha256: recordSha256 },
    });

    expect(validateEngineReleaseTransition({
      previousManifest: previous,
      currentManifest: current,
      releaseRecord: record,
      releaseRecordBytes: serializeJson(record),
      currentCommit: transitionCommit,
      sourceIsAncestor: true,
      sourceSurfaceFailures: [],
    })).toEqual([]);
  });

  it("stages a new immutable published manifest without mutating the candidate", () => {
    const candidate = manifestFor({
      state: "candidate",
      sourceCommit: null,
      releaseRecord: null,
    });
    const record = releaseRecord();
    const recordBytes = serializeJson(record);
    const published = stagePublishedEngineManifest({
      manifest: candidate,
      releaseRecord: record,
      releaseRecordPath: recordPath,
      releaseRecordBytes: recordBytes,
      updatedAt: "2026-07-28",
    });

    expect(candidate.releaseGroups.engine).toMatchObject({
      state: "candidate",
      sourceCommit: null,
      releaseRecord: null,
    });
    expect(published.releaseGroups.engine).toEqual({
      version: "2.6.3",
      state: "published",
      sourceCommit,
      releaseRecord: {
        path: recordPath,
        sha256: createHash("sha256").update(recordBytes).digest("hex"),
      },
      verification: {
        eligibleForParity: false,
        reason:
          "npm publish provenance is recorded; independent public-surface parity verification is pending",
      },
    });
    expect(published.updatedAt).toBe("2026-07-28");
  });

  it("refuses to stage a record from an arbitrary or drifted source commit", () => {
    const candidate = manifestFor({
      state: "candidate",
      sourceCommit: null,
      releaseRecord: null,
    });
    const record = releaseRecord();

    expect(validatePublishedStagingPreconditions({
      manifest: candidate,
      committedManifest: candidate,
      sourceManifest: candidate,
      releaseRecord: record,
      sourceIsAncestor: true,
      sourceSurfaceFailures: [],
    })).toEqual([]);
    expect(validatePublishedStagingPreconditions({
      manifest: candidate,
      committedManifest: {
        ...candidate,
        updatedAt: "2026-07-26",
      },
      sourceManifest: {
        ...candidate,
        releaseGroups: {
          ...candidate.releaseGroups,
          engine: { ...candidate.releaseGroups.engine, version: "2.6.2" },
        },
      },
      releaseRecord: {
        ...record,
        sourceCommit: "f".repeat(40),
      },
      sourceIsAncestor: false,
      sourceSurfaceFailures: ["package.json at source commit drifted"],
    })).toEqual(expect.arrayContaining([
      "candidate manifest must be committed without working-tree drift before staging",
      "release record source commit is not an ancestor of the candidate checkout",
      "release record source commit does not contain the same candidate manifest",
      "package.json at source commit drifted",
    ]));
  });

  it("rejects a release record symlink that escapes the checkout", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "memi-release-record-"));
    const outside = await mkdtemp(join(tmpdir(), "memi-release-outside-"));
    try {
      await mkdir(join(fixture, "release-artifacts", "npm"), { recursive: true });
      const outsideRecord = join(outside, "2.6.3.release.json");
      await writeFile(outsideRecord, serializeJson(releaseRecord()), "utf8");
      await symlink(
        outsideRecord,
        join(fixture, "release-artifacts", "npm", "2.6.3.release.json"),
      );

      await expect(resolveReleaseRecordPath(
        fixture,
        "release-artifacts/npm/2.6.3.release.json",
      )).rejects.toThrow("symlink");
    } finally {
      await rm(fixture, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects cross-version, non-ancestor, surface-drifted, or tampered transitions", () => {
    const record = releaseRecord();
    const recordSha256 = createHash("sha256")
      .update(serializeJson(record))
      .digest("hex");
    const previous = manifestFor({
      state: "candidate",
      sourceCommit: null,
      releaseRecord: null,
    });
    const current = manifestFor({
      state: "published",
      sourceCommit,
      releaseRecord: { path: recordPath, sha256: recordSha256 },
    });

    expect(validateEngineReleaseTransition({
      previousManifest: previous,
      currentManifest: {
        ...current,
        releaseGroups: {
          ...current.releaseGroups,
          engine: { ...current.releaseGroups.engine, version: "2.6.4" },
        },
      },
      releaseRecord: record,
      releaseRecordBytes: `${serializeJson(record)} `,
      currentCommit: transitionCommit,
      sourceIsAncestor: false,
      sourceSurfaceFailures: ["package.json at source commit is 2.6.2"],
    })).toEqual(expect.arrayContaining([
      "published transition must preserve the candidate version",
      "engine source commit must be an ancestor of the transition commit",
      "release record SHA-256 does not match its committed bytes",
      "package.json at source commit is 2.6.2",
    ]));
  });

  it("makes published release state immutable", () => {
    const record = releaseRecord();
    const recordBytes = serializeJson(record);
    const recordSha256 = createHash("sha256").update(recordBytes).digest("hex");
    const previous = manifestFor({
      state: "published",
      sourceCommit,
      releaseRecord: { path: recordPath, sha256: recordSha256 },
    });
    const current = {
      ...previous,
      releaseGroups: {
        ...previous.releaseGroups,
        engine: { ...previous.releaseGroups.engine, version: "2.6.4" },
      },
    };

    expect(validateEngineReleaseTransition({
      previousManifest: previous,
      currentManifest: current,
      releaseRecord: record,
      releaseRecordBytes: recordBytes,
      currentCommit: transitionCommit,
      sourceIsAncestor: true,
      sourceSurfaceFailures: [],
    })).toContain("published engine release state is immutable");
  });

  it("clears the cap only for a fully verified published transition", () => {
    const record = releaseRecord();
    const recordSha256 = createHash("sha256")
      .update(serializeJson(record))
      .digest("hex");
    const manifest = manifestFor({
      state: "published",
      sourceCommit,
      releaseRecord: { path: recordPath, sha256: recordSha256 },
    });
    const evidence = {
      transition: { verified: true, sourceCommit },
      npm: { verified: true, sourceCommit },
      githubRelease: { verified: true, sourceCommit, checksumsVerified: true },
      githubAction: { verified: true, sourceCommit },
      mcp: { verified: true, version: "2.6.3" },
      studio: { verified: true, version: "2.5.0" },
      website: {
        verified: true,
        manifestSha256: createHash("sha256").update(serializeJson(manifest)).digest("hex"),
      },
    };

    expect(canClearPublicParityCap(manifest, evidence)).toBe(true);
    expect(canClearPublicParityCap(manifest, {
      ...evidence,
      githubRelease: { ...evidence.githubRelease, checksumsVerified: false },
    })).toBe(false);
  });
});
