import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEvidenceManifest,
  hashFile,
  verifyEvidenceManifest,
} from "../prospective-files.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("prospective evidence files", () => {
  it("hashes and verifies immutable trial artifacts", async () => {
    const directory = await temporaryDirectory();
    await writeFile(path.join(directory, "git.patch"), "patch\n");
    await writeFile(path.join(directory, "events.jsonl"), "{}\n");
    await writeFile(path.join(directory, "verification.json"), "[]\n");
    await writeFile(path.join(directory, "run.json"), "{}\n");

    const receipt = await createEvidenceManifest({
      evidenceDirectory: directory,
      trialId: "study:task:r1:baseline",
      artifactNames: ["git.patch", "events.jsonl", "verification.json"],
    });
    expect(receipt.manifestSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await hashFile(path.join(directory, "git.patch"))).toMatch(/^sha256:/);

    await expect(verifyEvidenceManifest({
      evidenceDirectory: directory,
      expectedManifestSha256: receipt.manifestSha256,
      requiredArtifacts: [
        "git.patch",
        "events.jsonl",
        "verification.json",
        "evidence-manifest.json",
        "run.json",
      ],
    })).resolves.toEqual({ valid: true, reasons: [] });
  });

  it("rejects artifact mutation after the receipt is written", async () => {
    const directory = await temporaryDirectory();
    await writeFile(path.join(directory, "git.patch"), "before\n");
    await writeFile(path.join(directory, "run.json"), "{}\n");
    const receipt = await createEvidenceManifest({
      evidenceDirectory: directory,
      trialId: "study:task:r1:memi",
      artifactNames: ["git.patch"],
    });

    await writeFile(path.join(directory, "git.patch"), "after\n");

    const result = await verifyEvidenceManifest({
      evidenceDirectory: directory,
      expectedManifestSha256: receipt.manifestSha256,
      requiredArtifacts: [
        "git.patch",
        "evidence-manifest.json",
        "run.json",
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("artifact-hash-mismatch:git.patch");
  });

  it("rejects run receipt mutation after the evidence manifest is sealed", async () => {
    const directory = await temporaryDirectory();
    await writeFile(path.join(directory, "git.patch"), "patch\n");
    await writeFile(path.join(directory, "run.json"), JSON.stringify({
      runId: "study:task:r1:baseline",
      accepted: true,
    }));
    const receipt = await createEvidenceManifest({
      evidenceDirectory: directory,
      trialId: "study:task:r1:baseline",
      artifactNames: ["git.patch", "run.json"],
    });

    await writeFile(path.join(directory, "run.json"), JSON.stringify({
      runId: "study:task:r1:baseline",
      accepted: false,
    }));

    const result = await verifyEvidenceManifest({
      evidenceDirectory: directory,
      expectedManifestSha256: receipt.manifestSha256,
      requiredArtifacts: [
        "git.patch",
        "evidence-manifest.json",
        "run.json",
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("artifact-hash-mismatch:run.json");
  });

  it("fails closed for malformed, missing, and unlisted evidence", async () => {
    const directory = await temporaryDirectory();
    await writeFile(path.join(directory, "evidence-manifest.json"), "not-json\n");
    await expect(verifyEvidenceManifest({
      evidenceDirectory: directory,
      expectedManifestSha256: `sha256:${"0".repeat(64)}`,
      requiredArtifacts: ["git.patch"],
    })).resolves.toEqual({
      valid: false,
      reasons: ["evidence-manifest-invalid"],
    });

    await writeFile(path.join(directory, "git.patch"), "patch\n");
    await writeFile(path.join(directory, "events.jsonl"), "{}\n");
    const receipt = await createEvidenceManifest({
      evidenceDirectory: directory,
      trialId: "study:task:r1:baseline",
      artifactNames: ["git.patch"],
    });
    const result = await verifyEvidenceManifest({
      evidenceDirectory: directory,
      expectedManifestSha256: receipt.manifestSha256,
      requiredArtifacts: ["git.patch", "events.jsonl", "verification.json"],
    });
    expect(result.reasons).toContain("artifact-not-in-manifest:events.jsonl");
    expect(result.reasons).toContain("required-artifact-missing:verification.json");
  });

  it("binds the run receipt back to the expected evidence manifest", async () => {
    const directory = await temporaryDirectory();
    const placeholder = `sha256:${"0".repeat(64)}`;
    const runPath = path.join(directory, "run.json");
    await writeFile(runPath, `${JSON.stringify({
      prospective: { evidenceManifestSha256: placeholder },
    }, null, 2)}\n`);
    const receipt = await createEvidenceManifest({
      evidenceDirectory: directory,
      trialId: "study:task:r1:baseline",
      artifactNames: ["run.json"],
    });
    await writeFile(runPath, `${JSON.stringify({
      prospective: { evidenceManifestSha256: receipt.manifestSha256 },
    }, null, 2)}\n`);
    await expect(verifyEvidenceManifest({
      evidenceDirectory: directory,
      expectedManifestSha256: receipt.manifestSha256,
      requiredArtifacts: ["run.json"],
    })).resolves.toEqual({ valid: true, reasons: [] });

    await writeFile(runPath, `${JSON.stringify({
      prospective: { evidenceManifestSha256: `sha256:${"f".repeat(64)}` },
    }, null, 2)}\n`);
    const tampered = await verifyEvidenceManifest({
      evidenceDirectory: directory,
      expectedManifestSha256: receipt.manifestSha256,
      requiredArtifacts: ["run.json"],
    });
    expect(tampered.reasons).toContain("run-manifest-hash-mismatch");
  });

  it("rejects evidence rebound to a different trial binding", async () => {
    const directory = await temporaryDirectory();
    const receipt = await sealProspectiveEvidence(directory, {
      trialId: "study:task:r1:baseline",
      taskId: "task",
      repeat: 1,
      condition: "baseline",
      sequence: 0,
    });

    await expect(verifyEvidenceManifest({
      evidenceDirectory: directory,
      expectedManifestSha256: receipt.manifestSha256,
      requiredArtifacts: ["git.patch", "run.json"],
      expectedBinding: {
        trialId: "study:task:r2:baseline",
        taskId: "task",
        repeat: 1,
        condition: "baseline",
        sequence: 0,
      },
    })).resolves.toMatchObject({
      valid: false,
      reasons: expect.arrayContaining(["trial-binding-mismatch:trialId"]),
    });

    await expect(verifyEvidenceManifest({
      evidenceDirectory: directory,
      expectedManifestSha256: receipt.manifestSha256,
      requiredArtifacts: ["git.patch", "run.json"],
      expectedBinding: {
        trialId: "study:task:r1:baseline",
        taskId: "other-task",
        repeat: 1,
        condition: "baseline",
        sequence: 0,
      },
    })).resolves.toMatchObject({
      valid: false,
      reasons: expect.arrayContaining(["trial-binding-mismatch:taskId"]),
    });

    await expect(verifyEvidenceManifest({
      evidenceDirectory: directory,
      expectedManifestSha256: receipt.manifestSha256,
      requiredArtifacts: ["git.patch", "run.json"],
      expectedBinding: {
        trialId: "study:task:r1:baseline",
        taskId: "task",
        repeat: 1,
        condition: "memi",
        sequence: 0,
      },
    })).resolves.toMatchObject({
      valid: false,
      reasons: expect.arrayContaining(["trial-binding-mismatch:condition"]),
    });

    await expect(verifyEvidenceManifest({
      evidenceDirectory: directory,
      expectedManifestSha256: receipt.manifestSha256,
      requiredArtifacts: ["git.patch", "run.json"],
      expectedBinding: {
        trialId: "study:task:r1:baseline",
        taskId: "task",
        repeat: 1,
        condition: "baseline",
        sequence: 7,
      },
    })).resolves.toMatchObject({
      valid: false,
      reasons: expect.arrayContaining(["trial-binding-mismatch:sequence"]),
    });
  });

  it("rejects evidence directories outside the allowed root, including symlink escapes", async () => {
    const allowedRoot = await temporaryDirectory();
    const escapedRoot = await temporaryDirectory();
    const directDirectory = path.join(escapedRoot, "trial-direct");
    await mkdir(directDirectory, { recursive: true });
    const directReceipt = await sealProspectiveEvidence(directDirectory, {
      trialId: "study:task:r1:baseline",
      taskId: "task",
      repeat: 1,
      condition: "baseline",
      sequence: 0,
    });

    await expect(verifyEvidenceManifest({
      evidenceDirectory: directDirectory,
      expectedManifestSha256: directReceipt.manifestSha256,
      requiredArtifacts: ["git.patch", "run.json"],
      allowedEvidenceRoot: allowedRoot,
    })).resolves.toMatchObject({
      valid: false,
      reasons: expect.arrayContaining(["evidence-directory-escape"]),
    });

    const symlinkTarget = path.join(escapedRoot, "trial-symlink");
    await mkdir(symlinkTarget, { recursive: true });
    const symlinkReceipt = await sealProspectiveEvidence(symlinkTarget, {
      trialId: "study:task:r1:baseline",
      taskId: "task",
      repeat: 1,
      condition: "baseline",
      sequence: 0,
    });
    const linkedDirectory = path.join(allowedRoot, "linked-trial");
    await symlink(symlinkTarget, linkedDirectory, "dir");

    await expect(verifyEvidenceManifest({
      evidenceDirectory: linkedDirectory,
      expectedManifestSha256: symlinkReceipt.manifestSha256,
      requiredArtifacts: ["git.patch", "run.json"],
      allowedEvidenceRoot: allowedRoot,
    })).resolves.toMatchObject({
      valid: false,
      reasons: expect.arrayContaining(["evidence-directory-escape"]),
    });
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "memi-prospective-files-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function sealProspectiveEvidence(
  directory: string,
  binding: {
    trialId: string;
    taskId: string;
    repeat: number;
    condition: "baseline" | "memi";
    sequence: number;
  },
) {
  const placeholder = `sha256:${"0".repeat(64)}`;
  await writeFile(path.join(directory, "git.patch"), "patch\n");
  await writeFile(path.join(directory, "run.json"), `${JSON.stringify({
    schemaVersion: 1,
    runId: binding.trialId,
    experimentId: "experiment",
    suiteId: "suite",
    taskId: binding.taskId,
    repeat: binding.repeat,
    condition: binding.condition,
    repository: {
      pathHash: `sha256:${"a".repeat(64)}`,
      revision: "9cde918",
      dirty: false,
    },
    harness: {
      id: "codex",
      modelId: "gpt-5.6-sol",
      reasoningEffort: "medium",
    },
    timing: {
      startedAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:05:00.000Z",
      wallTimeMs: 300000,
      toolTimeMs: 1000,
    },
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
      estimatedCostUsd: null,
    },
    tools: { calls: 1, errors: 0, retries: 0 },
    outcome: {
      accepted: true,
      testsPassed: true,
      qualityScore: 100,
      qualityEvidence: "automated_acceptance",
      qualityCeiling: 100,
      defects: 0,
      humanInterventions: 0,
    },
    evidenceRefs: [
      path.join(directory, "git.patch"),
      path.join(directory, "run.json"),
    ],
    prospective: {
      planHash: `sha256:${"b".repeat(64)}`,
      freezeHash: `sha256:${"c".repeat(64)}`,
      candidateArtifactSha256: `sha256:${"d".repeat(64)}`,
      taskManifestSha256: `sha256:${"e".repeat(64)}`,
      evidenceManifestSha256: placeholder,
      trialId: binding.trialId,
      sequence: binding.sequence,
    },
  }, null, 2)}\n`);
  const initialReceipt = await createEvidenceManifest({
    evidenceDirectory: directory,
    trialId: binding.trialId,
    artifactNames: ["git.patch", "run.json"],
  });
  await writeFile(path.join(directory, "run.json"), `${JSON.stringify({
    schemaVersion: 1,
    runId: binding.trialId,
    experimentId: "experiment",
    suiteId: "suite",
    taskId: binding.taskId,
    repeat: binding.repeat,
    condition: binding.condition,
    repository: {
      pathHash: `sha256:${"a".repeat(64)}`,
      revision: "9cde918",
      dirty: false,
    },
    harness: {
      id: "codex",
      modelId: "gpt-5.6-sol",
      reasoningEffort: "medium",
    },
    timing: {
      startedAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:05:00.000Z",
      wallTimeMs: 300000,
      toolTimeMs: 1000,
    },
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
      estimatedCostUsd: null,
    },
    tools: { calls: 1, errors: 0, retries: 0 },
    outcome: {
      accepted: true,
      testsPassed: true,
      qualityScore: 100,
      qualityEvidence: "automated_acceptance",
      qualityCeiling: 100,
      defects: 0,
      humanInterventions: 0,
    },
    evidenceRefs: [
      path.join(directory, "git.patch"),
      path.join(directory, "run.json"),
    ],
    prospective: {
      planHash: `sha256:${"b".repeat(64)}`,
      freezeHash: `sha256:${"c".repeat(64)}`,
      candidateArtifactSha256: `sha256:${"d".repeat(64)}`,
      taskManifestSha256: `sha256:${"e".repeat(64)}`,
      evidenceManifestSha256: initialReceipt.manifestSha256,
      trialId: binding.trialId,
      sequence: binding.sequence,
    },
  }, null, 2)}\n`);
  return await createEvidenceManifest({
    evidenceDirectory: directory,
    trialId: binding.trialId,
    artifactNames: ["git.patch", "run.json"],
  });
}
