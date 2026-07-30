// @ts-nocheck
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  approvePublicFixtureCandidate,
  buildPublicFixtureCandidates,
  validatePublicFixtureCandidates,
} from "../../../scripts/lib/designwork-fixtures.mjs";

const root = process.cwd();
const manifestPath = path.join(
  root,
  "benchmarks",
  "designworkbench-v2",
  "benchmark.json",
);

describe("DesignWorkBench public fixture production", () => {
  it("authors 60 deterministic candidate packs across all 15 tracks", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const candidates = buildPublicFixtureCandidates(manifest);
    const validation = validatePublicFixtureCandidates(manifest, candidates);

    expect(validation).toEqual({
      passed: true,
      candidateCount: 60,
      failures: [],
    });
    expect(candidates).toHaveLength(60);
    expect(buildPublicFixtureCandidates(manifest)).toEqual(candidates);
    for (const track of manifest.tracks) {
      expect(candidates.filter((candidate) => candidate.trackId === track.id)).toHaveLength(4);
    }
    for (const candidate of candidates) {
      const task = manifest.tasks.find((entry) => entry.id === candidate.taskId);
      expect(candidate.status).toBe("candidate");
      expect(candidate.disclosure).toContain("benchmark-authored synthetic");
      expect(candidate.provenance).toMatchObject({
        source: "Memi DesignWorkBench v2",
        owner: "Memi Design",
        license: "MIT",
        sourceType: "benchmark_owned_synthetic",
      });
      expect(candidate.inputs.brief.taskPrompt).toBe(task.prompt);
      expect(candidate.inputs.sourceMaterial.evidence.length).toBeGreaterThanOrEqual(4);
      expect(candidate.inputs.constraints.accessibility.length).toBeGreaterThanOrEqual(2);
      expect(candidate.inputs.constraints.safety.length).toBeGreaterThanOrEqual(1);
      expect(candidate.inputs.acceptanceFixtures.requiredArtifactKinds)
        .toEqual(task.requiredArtifactKinds);
      expect(candidate.inputs.acceptanceFixtures.negativeControlIds)
        .toEqual(task.negativeControlIds);
      expect(candidate.candidateSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("rejects leakage, undisclosed synthetic material, and incomplete packs", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const candidates = buildPublicFixtureCandidates(manifest);
    const privateTask = manifest.tasks.find((task) => task.split === "privateTest");
    const invalid = [
      {
        ...candidates[0],
        taskId: privateTask.id,
      },
      {
        ...candidates[1],
        disclosure: "",
      },
      {
        ...candidates[2],
        inputs: {
          ...candidates[2].inputs,
          sourceMaterial: { evidence: [] },
        },
      },
    ];

    const validation = validatePublicFixtureCandidates(manifest, invalid);

    expect(validation.passed).toBe(false);
    expect(validation.failures).toEqual(expect.arrayContaining([
      expect.stringContaining("is not a public development task"),
      expect.stringContaining("requires explicit synthetic disclosure"),
      expect.stringContaining("requires at least four source evidence records"),
    ]));
  });

  it("requires an independent approval bound to the exact candidate hash", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const candidate = buildPublicFixtureCandidates(manifest)[0];
    const review = {
      schemaVersion: 1,
      taskId: candidate.taskId,
      candidateSha256: candidate.candidateSha256,
      reviewerId: "reviewer-001",
      independent: true,
      qualificationRef: "qualification:reviewer-001",
      reviewReceiptRef: "receipt:reviewer-001:fixture-001",
      decision: "approved",
      reviewedAt: "2026-07-30T00:00:00.000Z",
    };

    expect(approvePublicFixtureCandidate(candidate, review)).toMatchObject({
      status: "approved",
      taskId: candidate.taskId,
      candidateSha256: candidate.candidateSha256,
      reviewerId: "reviewer-001",
    });
    expect(() => approvePublicFixtureCandidate(candidate, {
      ...review,
      independent: false,
    })).toThrow("fixture approval requires an independent reviewer");
    expect(() => approvePublicFixtureCandidate(candidate, {
      ...review,
      candidateSha256: "0".repeat(64),
    })).toThrow("fixture approval does not match the candidate hash");
  });
});
