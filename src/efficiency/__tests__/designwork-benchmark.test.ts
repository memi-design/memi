// @ts-nocheck
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCalibrationReadiness,
  buildDesignWorkReadiness,
  geometricMean,
  krippendorffAlphaInterval,
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

  it("uses interval-scale Krippendorff alpha for grader reliability", () => {
    expect(krippendorffAlphaInterval([
      [70, 70],
      [75, 75],
      [80, 80],
      [85, 85],
    ])).toBe(1);
    expect(krippendorffAlphaInterval([
      [10, 90],
      [90, 10],
      [20, 80],
      [80, 20],
    ])).toBeLessThan(0.67);
    expect(krippendorffAlphaInterval([])).toBe(0);
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

  it("rejects verified fixtures and practitioner records without provenance", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const invalidFixture = {
      ...manifest,
      tasks: manifest.tasks.map((task, index) => index === 0
        ? { ...task, fixture: { ...task.fixture, status: "verified" } }
        : task),
    };
    const validation = await validateDesignWorkBenchmark(invalidFixture, { root });
    expect(validation.failures).toEqual(expect.arrayContaining([
      expect.stringContaining("verified fixture requires sourceRefs"),
      expect.stringContaining("verified fixture requires a sha256"),
      expect.stringContaining("verified fixture requires provenance"),
    ]));

    const fake = practitionerRatings("product-design").map((artifact) => ({
      ...artifact,
      consentRef: undefined,
      qualificationRef: undefined,
    }));
    const readiness = buildCalibrationReadiness(
      { tracks: [{ id: "product-design" }] },
      fake,
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.failures).toEqual(expect.arrayContaining([
      "product-design has practitioner artifacts without consent or qualification provenance",
    ]));
  });

  it("reports benchmark-foundation progress without fabricating release readiness", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const report = buildDesignWorkReadiness(manifest, []);

    expect(report.foundationReady).toBe(true);
    expect(report.releaseReady).toBe(false);
    expect(report.completed).toMatchObject({
      tracks: 15,
      taskContracts: 300,
      publicTasks: 60,
      privateTasks: 180,
      holdoutTasks: 60,
      runnerContracts: 8,
    });
    expect(report.verified).toMatchObject({
      fixtures: 0,
      runners: 0,
      practitioners: 0,
      calibratedTracks: 0,
    });
    expect(report.blockers).toEqual(expect.arrayContaining([
      "300 task fixtures remain contract_defined",
      "8 runner profiles remain contract_defined",
      "practitioner calibration is pending",
    ]));
  });

  it("derives readiness from validated receipts instead of mutable manifest status", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const report = buildDesignWorkReadiness(manifest, {
      verifiedFixtureIds: [manifest.tasks[0].id],
      verifiedRunnerIds: ["artifact-validator"],
      calibrationArtifacts: [],
      results: null,
    });

    expect(report.verified).toMatchObject({
      fixtures: 1,
      runners: 1,
      practitioners: 0,
      calibratedTracks: 0,
    });
    expect(report.blockers).toEqual(expect.arrayContaining([
      "299 task fixtures require verified receipts",
      "7 runner profiles require verified receipts",
    ]));
  });

  it("wires benchmark integrity and practitioner proof into the release surface", async () => {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const releaseGate = await readFile(path.join(root, "scripts", "check-release.mjs"), "utf8");
    const readme = await readFile(path.join(root, "README.md"), "utf8");

    expect(packageJson.scripts).toMatchObject({
      "build:designwork-bench": "node scripts/generate-designwork-benchmark.mjs",
      "check:designwork-bench": "node scripts/generate-designwork-benchmark.mjs --check",
      "build:designwork-readiness": "node scripts/build-designwork-readiness.mjs",
      "check:designwork-readiness": "node scripts/build-designwork-readiness.mjs --check",
      "check:designwork-release": "node scripts/build-designwork-readiness.mjs --check --require-ready",
      "build:designwork-evidence": "node scripts/build-designwork-evidence.mjs",
      "check:designwork-evidence": "node scripts/build-designwork-evidence.mjs --check",
    });
    expect(releaseGate).toContain("check:designwork-release");
    expect(readme).toContain("Memi DesignWorkBench v2");
    expect(readme).toContain("300 task contracts");
    expect(readme).toContain("practitioner calibration");
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
      consentRef: `consent:${practitionerIndex + 1}`,
      qualificationRef: `qualification:${practitionerIndex + 1}`,
      artifactSha256: "a".repeat(64),
      ratings: [
        {
          graderId: "grader-a",
          score: 72 + artifactIndex,
          blinded: true,
          receiptRef: `receipt:a:${artifactIndex + 1}`,
        },
        {
          graderId: "grader-b",
          score: 72 + artifactIndex,
          blinded: true,
          receiptRef: `receipt:b:${artifactIndex + 1}`,
        },
      ],
    }))).flat();
}
