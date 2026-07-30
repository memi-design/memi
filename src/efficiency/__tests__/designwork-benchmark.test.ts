// @ts-nocheck
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCalibrationReadiness,
  geometricMean,
  scoreProfessionalArtifact,
  validateDesignWorkBenchmark,
} from "../../../scripts/lib/designwork-benchmark.mjs";

const root = process.cwd();
const manifestPath = path.join(
  root,
  "benchmarks",
  "designworkbench-v2",
  "benchmark.json",
);

describe("Memi DesignWorkBench v2", () => {
  it("defines 300 tasks across 15 senior-practitioner tracks", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const result = await validateDesignWorkBenchmark(manifest, { root });

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.benchmarkId).toBe("memi-designworkbench-v2");
    expect(result.trackCount).toBe(15);
    expect(result.taskCount).toBe(300);
    expect(result.splitCounts).toEqual({
      publicDevelopment: 60,
      privateTest: 180,
      rollingHoldout: 60,
    });
    expect(new Set(manifest.tasks.map((task) => task.id)).size).toBe(300);
    for (const track of manifest.tracks) {
      expect(manifest.tasks.filter((task) => task.trackId === track.id)).toHaveLength(20);
    }
  });

  it("keeps acceptance separate from professional quality and applies evidence caps", () => {
    const promptOnly = scoreProfessionalArtifact({
      accepted: true,
      evidenceLevel: "prompt_only",
      dimensions: [
        { id: "craft", weight: 50, score: 100 },
        { id: "judgment", weight: 50, score: 100 },
      ],
      penalties: [],
    });
    const runtime = scoreProfessionalArtifact({
      accepted: true,
      evidenceLevel: "runtime_reproduced",
      dimensions: [
        { id: "craft", weight: 50, score: 84 },
        { id: "judgment", weight: 50, score: 76 },
      ],
      penalties: [],
    });

    expect(promptOnly.accepted).toBe(true);
    expect(promptOnly.qualityScore).toBe(25);
    expect(promptOnly.qualityStatus).toBe("evidence_capped");
    expect(runtime.qualityScore).toBe(80);
    expect(runtime.qualityStatus).toBe("assessed");
  });

  it("uses a noncompensating geometric composite", () => {
    expect(geometricMean([70, 70, 70])).toBe(70);
    expect(geometricMean([70, 70, 5])).toBeLessThan(30);
    expect(geometricMean([70, 70, 0])).toBe(0);
  });

  it("fails calibration readiness without real practitioners and reliable graders", () => {
    const manifest = {
      tracks: [
        { id: "product-design" },
        { id: "android-compose" },
      ],
    };
    const empty = buildCalibrationReadiness(manifest, []);
    expect(empty.ready).toBe(false);
    expect(empty.failures).toEqual(expect.arrayContaining([
      "product-design requires at least 4 qualified practitioners",
      "android-compose requires at least 4 qualified practitioners",
    ]));

    const reliable = buildCalibrationReadiness(
      { tracks: [{ id: "product-design" }] },
      practitionerRatings("product-design"),
    );
    expect(reliable.ready).toBe(true);
    expect(reliable.tracks[0].practitioners).toBe(4);
    expect(reliable.tracks[0].artifacts).toBe(20);
    expect(reliable.tracks[0].reliability).toBeGreaterThanOrEqual(0.8);
  });

  it("fails closed on task leakage, missing controls, and fabricated calibration", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const invalid = {
      ...manifest,
      tasks: manifest.tasks.map((task, index) => index === 0
        ? {
          ...task,
          split: "privateTest",
          fixture: { ...task.fixture, public: true },
          negativeControlIds: [],
        }
        : task),
      calibration: {
        ...manifest.calibration,
        status: "complete",
        evidenceFile: null,
      },
    };

    const result = await validateDesignWorkBenchmark(invalid, { root });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.stringContaining("private task fixture cannot be public"),
      expect.stringContaining("requires negative controls"),
      "complete calibration requires an evidence file",
    ]));
  });
});

function practitionerRatings(trackId: string) {
  return Array.from({ length: 4 }, (_, practitionerIndex) =>
    Array.from({ length: 5 }, (_, artifactIndex) => ({
      trackId,
      practitionerId: `practitioner-${practitionerIndex + 1}`,
      artifactId: `${trackId}-artifact-${practitionerIndex + 1}-${artifactIndex + 1}`,
      qualified: true,
      external: practitionerIndex < 2,
      ratings: [
        { graderId: "grader-a", score: 72 + artifactIndex },
        { graderId: "grader-b", score: 72 + artifactIndex },
      ],
    }))).flat();
}
