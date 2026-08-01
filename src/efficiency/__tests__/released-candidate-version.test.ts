import { describe, expect, it } from "vitest";
import { buildProspectiveFreeze, prospectiveStudyPlanSchema } from "../prospective-study.js";

const plan = prospectiveStudyPlanSchema.parse({
  schemaVersion: 1,
  studyId: "memi-2.7-prospective-v14-calibrated-web",
  planId: "memi-2.7-v14-calibrated-web",
  status: "draft",
  currentScore: 0,
  targetScore: 11,
  claimBoundary: "A narrow release-candidate feasibility study.",
  scoreBudget: [
    { dimension: "registration", currentCredit: 0, targetCredit: 5 },
    { dimension: "paired-runs", currentCredit: 0, targetCredit: 6 },
    { dimension: "independent-review", currentCredit: 0, targetCredit: 0 },
  ],
  tasks: [{
    id: "web-task",
    platformFamily: "web",
    revision: "a".repeat(40),
    pairs: 1,
    interimCredit: 6,
    risk: "fixture",
  }],
  runContract: {
    seed: 1,
    matchedPairs: 1,
    trials: 2,
    conditions: ["baseline", "memi"],
    freshClonePerTrial: true,
    counterbalancedOrder: true,
    requiredArtifacts: ["git.patch", "verification.json", "run.json"],
    acceptance: {
      requiredValidPairsPerTask: 1,
      requiredPassingPairsPerTask: 1,
      fixtureMutationAllowed: false,
      providerErrorAllowed: false,
      missingOrDuplicateConditionAllowed: false,
      postPatchIsolatedVerificationRequired: true,
    },
  },
  creditPolicy: {
    planningEarnsCredit: false,
    manualCreditEditsAllowed: false,
    prospectiveRegistrationCredit: "all-or-none",
    independentRepeatInterimCreditPerQualifiedPlatform: 6,
    independentRepeatInterimCreditCap: 6,
    fullRepeatCreditRequiresAllReleaseCriticalTasks: true,
  },
});

describe("released prospective candidates", () => {
  it("seals the actual 2.7.1 package version rather than rewriting it as 2.7.0", () => {
    const receipt = buildProspectiveFreeze({
      plan,
      frozenAt: "2026-07-31T23:50:00.000Z",
      candidate: {
        version: "2.7.1",
        revision: "b".repeat(40),
        sourceState: "clean",
        dirtyFileCount: 0,
        sourceTreeSha256: `sha256:${"c".repeat(64)}`,
        artifactSha256: `sha256:${"d".repeat(64)}`,
      },
      harness: {
        provider: "codex",
        modelId: "gpt-5.6-luna",
        reasoningEffort: "low",
        harnessVersion: "codex-cli-0.145.0",
        permissionPolicy: "workspace-write",
        maximumSkills: 1,
        maximumContextBytes: 4096,
      },
      environment: {
        machine: "test-mac",
        os: "macOS 26.2",
        arch: "arm64",
        node: "v22.22.3",
        xcode: "26.6",
        simulator: "not used",
        workspaceVolume: "external-ssd",
        temporaryRoot: "/Volumes/External/evidence/tmp",
      },
      taskManifestHashes: { "web-task": `sha256:${"e".repeat(64)}` },
    });

    expect(receipt.candidate.version).toBe("2.7.1");
  });
});
