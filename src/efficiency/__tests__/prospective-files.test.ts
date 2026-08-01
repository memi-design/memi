import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "memi-prospective-files-"));
  temporaryDirectories.push(directory);
  return directory;
}
