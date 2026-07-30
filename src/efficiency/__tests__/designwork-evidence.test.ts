// @ts-nocheck
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  sealDesignWorkReceipt,
  sha256File,
  validateDesignWorkEvidence,
} from "../../../scripts/lib/designwork-evidence.mjs";
import {
  runArtifactValidatorProbe,
  runBrowserPlaywrightProbe,
  runMotionRenderProbe,
} from "../../../scripts/lib/designwork-runner-probes.mjs";

const root = process.cwd();
const manifestPath = path.join(
  root,
  "benchmarks",
  "designworkbench-v2",
  "benchmark.json",
);

describe("DesignWorkBench evidence receipts", () => {
  it("accepts benchmark-bound fixture and runner receipts with complete artifacts", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "memi-designwork-evidence-"));
    const sourcePath = await artifact(evidenceRoot, "fixture.json", "{\"brief\":\"verified\"}");
    const runnerArtifacts = await Promise.all(
      manifest.runnerProfiles.find((runner) => runner.id === "artifact-validator")
        .requiredEvidence.map((kind) => artifact(evidenceRoot, `${kind}.json`, JSON.stringify({ kind }))),
    );
    const fixture = sealDesignWorkReceipt({
      schemaVersion: 1,
      kind: "fixture",
      subjectId: manifest.tasks[0].id,
      ...binding(manifest),
      status: "verified",
      sourceRefs: ["benchmark-owned:fixture-001"],
      provenance: {
        source: "Memi DesignWorkBench",
        license: "MIT",
        capturedAt: "2026-07-30T00:00:00.000Z",
      },
      artifacts: [sourcePath],
    });
    const runner = sealDesignWorkReceipt({
      schemaVersion: 1,
      kind: "runner",
      subjectId: "artifact-validator",
      ...binding(manifest),
      status: "verified",
      environment: {
        os: "darwin",
        architecture: "arm64",
        runtime: "node",
      },
      artifacts: runnerArtifacts,
    });

    const result = await validateDesignWorkEvidence(manifest, {
      schemaVersion: 1,
      benchmarkId: manifest.benchmarkId,
      receipts: [fixture, runner],
      calibrationArtifacts: [],
      results: null,
    }, { root: evidenceRoot });

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.verifiedFixtureIds).toEqual([manifest.tasks[0].id]);
    expect(result.verifiedRunnerIds).toEqual(["artifact-validator"]);
  });

  it("fails closed when an artifact changes after its receipt is sealed", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "memi-designwork-tamper-"));
    const sourcePath = await artifact(evidenceRoot, "fixture.json", "{\"brief\":\"original\"}");
    const receipt = sealDesignWorkReceipt({
      schemaVersion: 1,
      kind: "fixture",
      subjectId: manifest.tasks[0].id,
      ...binding(manifest),
      status: "verified",
      sourceRefs: ["benchmark-owned:fixture-001"],
      provenance: {
        source: "Memi DesignWorkBench",
        license: "MIT",
        capturedAt: "2026-07-30T00:00:00.000Z",
      },
      artifacts: [sourcePath],
    });
    await writeFile(path.join(evidenceRoot, "fixture.json"), "{\"brief\":\"tampered\"}", "utf8");

    const result = await validateDesignWorkEvidence(manifest, {
      schemaVersion: 1,
      benchmarkId: manifest.benchmarkId,
      receipts: [receipt],
      calibrationArtifacts: [],
      results: null,
    }, { root: evidenceRoot });

    expect(result.passed).toBe(false);
    expect(result.verifiedFixtureIds).toEqual([]);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.stringContaining("artifact hash mismatch"),
    ]));
  });

  it("rejects missing, escaping, absolute, and untyped evidence artifacts", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "memi-designwork-invalid-"));
    const base = {
      schemaVersion: 1,
      kind: "fixture",
      subjectId: manifest.tasks[0].id,
      ...binding(manifest),
      status: "verified",
      sourceRefs: ["benchmark-owned:fixture-001"],
      provenance: {
        source: "Memi DesignWorkBench",
        license: "MIT",
        capturedAt: "2026-07-30T00:00:00.000Z",
      },
    };
    const receipts = [
      sealDesignWorkReceipt({
        ...base,
        subjectId: manifest.tasks[0].id,
        artifacts: [{ kind: "", path: "unknown.json", sha256: "a".repeat(64) }],
      }),
      sealDesignWorkReceipt({
        ...base,
        subjectId: manifest.tasks[1].id,
        artifacts: [{ kind: "source", path: "../outside.json", sha256: "a".repeat(64) }],
      }),
      sealDesignWorkReceipt({
        ...base,
        subjectId: manifest.tasks[2].id,
        artifacts: [{ kind: "source", path: path.join(evidenceRoot, "absolute.json"), sha256: "a".repeat(64) }],
      }),
      sealDesignWorkReceipt({
        ...base,
        subjectId: manifest.tasks[3].id,
        artifacts: [{ kind: "source", path: "missing.json", sha256: "a".repeat(64) }],
      }),
      sealDesignWorkReceipt({
        ...base,
        subjectId: manifest.tasks[4].id,
        artifacts: [{ kind: "source", path: "missing-hash.json", sha256: "invalid" }],
      }),
    ];

    const result = await validateDesignWorkEvidence(manifest, {
      schemaVersion: 1,
      benchmarkId: manifest.benchmarkId,
      receipts,
      calibrationArtifacts: [],
      results: null,
    }, { root: evidenceRoot });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.stringContaining("without a kind"),
      expect.stringContaining("escapes the evidence root"),
      expect.stringContaining("path must be relative"),
      expect.stringContaining("artifact is missing"),
      expect.stringContaining("requires a sha256"),
    ]));
  });

  it("rejects receipts copied from another task bank or candidate", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "memi-designwork-binding-"));
    const sourcePath = await artifact(evidenceRoot, "fixture.json", "{\"brief\":\"verified\"}");
    const receipt = sealDesignWorkReceipt({
      schemaVersion: 1,
      kind: "fixture",
      subjectId: manifest.tasks[0].id,
      ...binding(manifest),
      taskBankSha256: "0".repeat(64),
      status: "verified",
      sourceRefs: ["benchmark-owned:fixture-001"],
      provenance: {
        source: "Memi DesignWorkBench",
        license: "MIT",
        capturedAt: "2026-07-30T00:00:00.000Z",
      },
      artifacts: [sourcePath],
    });

    const result = await validateDesignWorkEvidence(manifest, {
      schemaVersion: 1,
      benchmarkId: manifest.benchmarkId,
      receipts: [receipt],
      calibrationArtifacts: [],
      results: null,
    }, { root: evidenceRoot });

    expect(result.passed).toBe(false);
    expect(result.failures).toContain(
      `${receipt.kind}:${receipt.subjectId} task-bank binding does not match`,
    );
  });

  it("runs the artifact validator against a representative handoff", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "memi-designwork-probe-"));

    const receipt = await runArtifactValidatorProbe({ manifest, evidenceRoot });
    const result = await validateDesignWorkEvidence(manifest, {
      schemaVersion: 1,
      benchmarkId: manifest.benchmarkId,
      receipts: [receipt],
      calibrationArtifacts: [],
      results: null,
    }, { root: evidenceRoot });

    expect(receipt.subjectId).toBe("artifact-validator");
    expect(receipt.artifacts.map((entry) => entry.kind)).toEqual([
      "schema-validation",
      "hash-verification",
      "source-provenance",
      "handoff-reopen",
    ]);
    expect(result.passed).toBe(true);
    expect(result.verifiedRunnerIds).toEqual(["artifact-validator"]);
  });

  it("runs an accessible browser interaction with a Playwright trace", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "memi-designwork-browser-"));

    const receipt = await runBrowserPlaywrightProbe({ manifest, evidenceRoot });
    const result = await validateDesignWorkEvidence(manifest, {
      schemaVersion: 1,
      benchmarkId: manifest.benchmarkId,
      receipts: [receipt],
      calibrationArtifacts: [],
      results: null,
    }, { root: evidenceRoot });

    expect(receipt.subjectId).toBe("browser-playwright");
    expect(receipt.artifacts.map((entry) => entry.kind)).toEqual([
      "browser-build",
      "playwright-e2e",
      "accessibility-tree",
      "performance-trace",
    ]);
    expect(result.passed).toBe(true);
    expect(result.verifiedRunnerIds).toEqual(["browser-playwright"]);
  });

  it("renders and inspects motion with a reduced-motion alternative", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "memi-designwork-motion-"));

    const receipt = await runMotionRenderProbe({ manifest, evidenceRoot });
    const result = await validateDesignWorkEvidence(manifest, {
      schemaVersion: 1,
      benchmarkId: manifest.benchmarkId,
      receipts: [receipt],
      calibrationArtifacts: [],
      results: null,
    }, { root: evidenceRoot });

    expect(receipt.subjectId).toBe("motion-render");
    expect(receipt.artifacts.map((entry) => entry.kind)).toEqual([
      "timeline-source",
      "render",
      "frame-analysis",
      "reduced-motion-output",
    ]);
    expect(result.passed).toBe(true);
    expect(result.verifiedRunnerIds).toEqual(["motion-render"]);
  });
});

function binding(manifest) {
  return {
    benchmarkId: manifest.benchmarkId,
    taskBankSha256: manifest.integrity.taskBankSha256,
    frozenCandidateSha256: manifest.integrity.frozenCandidateSha256,
  };
}

async function artifact(directory, filename, content) {
  const artifactPath = path.join(directory, filename);
  await writeFile(artifactPath, content, "utf8");
  return {
    kind: path.basename(filename, path.extname(filename)),
    path: filename,
    sha256: await sha256File(artifactPath),
  };
}
