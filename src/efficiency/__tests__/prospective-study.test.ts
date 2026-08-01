import { describe, expect, it } from "vitest";
import type { BenchmarkRunRecord } from "../contracts.js";
import {
  buildProspectiveFreeze,
  evaluateProspectiveStudy,
  prospectiveStudyPlanSchema,
  selectProspectiveBatch,
  selectProspectiveTrial,
  verifyProspectiveFreeze,
} from "../prospective-study.js";

const plan = prospectiveStudyPlanSchema.parse({
  schemaVersion: 1,
  studyId: "memi-2.7-prospective-v12-pilot",
  planId: "memi-2.7-empirical-readiness-40",
  status: "draft",
  currentScore: 29,
  targetScore: 40,
  claimBoundary: "Interim evidence milestone only.",
  scoreBudget: [
    { dimension: "existing-evidence", currentCredit: 29, targetCredit: 29 },
    {
      dimension: "prospective-registration",
      currentCredit: 0,
      targetCredit: 5,
      unlock: "Frozen before runs",
    },
    {
      dimension: "independent-repeats",
      currentCredit: 0,
      targetCredit: 6,
      maximumCredit: 12,
      unlock: "Three platform families pass three pairs",
    },
  ],
  tasks: [
    {
      id: "expo-task",
      platformFamily: "react-native-expo",
      revision: "a".repeat(40),
      pairs: 3,
      interimCredit: 2,
      risk: "adverse route",
    },
    {
      id: "swift-task",
      platformFamily: "native-swiftui",
      revision: "b".repeat(40),
      pairs: 3,
      interimCredit: 2,
      risk: "native runtime",
    },
    {
      id: "web-task",
      platformFamily: "web-design-engineering",
      revision: "c".repeat(40),
      pairs: 3,
      interimCredit: 2,
      risk: "browser flow",
    },
  ],
  runContract: {
    seed: 41,
    matchedPairs: 9,
    trials: 18,
    conditions: ["baseline", "memi"],
    freshClonePerTrial: true,
    counterbalancedOrder: true,
    requiredArtifacts: [
      "git.patch",
      "events.jsonl",
      "verification.json",
      "environment.json",
      "run.json",
    ],
    acceptance: {
      requiredValidPairsPerTask: 3,
      requiredPassingPairsPerTask: 3,
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
    independentRepeatInterimCreditPerQualifiedPlatform: 2,
    independentRepeatInterimCreditCap: 6,
    fullRepeatCreditRequiresAllReleaseCriticalTasks: true,
  },
});

function freeze() {
  return buildProspectiveFreeze({
    plan,
    frozenAt: "2026-07-30T12:00:00.000Z",
    candidate: {
      version: "2.7.0",
      revision: "d".repeat(40),
      sourceState: "content-addressed-dirty-snapshot",
      dirtyFileCount: 12,
      sourceTreeSha256: `sha256:${"e".repeat(64)}`,
      artifactSha256: `sha256:${"f".repeat(64)}`,
    },
    harness: {
      provider: "codex",
      modelId: "gpt-5.6-sol",
      reasoningEffort: "medium",
      harnessVersion: "codex-cli 0.145.0",
      permissionPolicy: "workspace-write",
      maximumSkills: 2,
      maximumContextBytes: 8_000,
    },
    environment: {
      machine: "test-mac",
      os: "macOS 26.0",
      arch: "arm64",
      node: "v22.22.3",
      xcode: "26.6",
      simulator: "iPhone 17 / iOS 26.5",
      workspaceVolume: "external-ssd",
      temporaryRoot: "/Volumes/External/evidence/tmp",
    },
    taskManifestHashes: Object.fromEntries(
      plan.tasks.map((task, index) => [
        task.id,
        `sha256:${String(index + 1).repeat(64)}`,
      ]),
    ),
  });
}

describe("prospective Memi 2.7 study", () => {
  it("creates a tamper-evident freeze with a deterministic counterbalanced matrix", () => {
    const receipt = freeze();

    expect(receipt.studyId).toBe("memi-2.7-prospective-v12-pilot");
    expect(verifyProspectiveFreeze(receipt)).toEqual({
      valid: true,
      reasons: [],
    });
    expect(receipt.trials).toHaveLength(18);
    expect(receipt.trials.slice(0, 6).map((trial) => trial.condition)).toEqual([
      "baseline",
      "memi",
      "memi",
      "baseline",
      "baseline",
      "memi",
    ]);

    const tampered = {
      ...receipt,
      harness: { ...receipt.harness, modelId: "different-model" },
    };
    expect(verifyProspectiveFreeze(tampered).valid).toBe(false);
  });

  it("awards registration credit but no repeat credit before valid runs exist", () => {
    const result = evaluateProspectiveStudy({
      plan,
      freeze: freeze(),
      runs: [],
    });

    expect(result).toMatchObject({
      score: 34,
      registrationCredit: 5,
      repeatCredit: 0,
      qualifiedTasks: [],
      reachedTarget: false,
    });
  });

  it("binds execution arguments to one frozen trial and rejects drift", () => {
    const receipt = freeze();
    const trial = receipt.trials[0]!;

    expect(selectProspectiveTrial({
      freeze: receipt,
      trialId: trial.trialId,
      taskId: trial.taskId,
      condition: trial.condition,
      repeat: trial.repeat,
      provider: receipt.harness.provider,
      modelId: receipt.harness.modelId,
      reasoningEffort: receipt.harness.reasoningEffort,
      repositoryRevision: plan.tasks[0]!.revision,
      taskManifestSha256: receipt.taskManifestHashes[trial.taskId]!,
    })).toEqual(trial);

    expect(() => selectProspectiveTrial({
      freeze: receipt,
      trialId: trial.trialId,
      taskId: trial.taskId,
      condition: trial.condition,
      repeat: trial.repeat,
      provider: receipt.harness.provider,
      modelId: "drifted-model",
      reasoningEffort: receipt.harness.reasoningEffort,
      repositoryRevision: plan.tasks[0]!.revision,
      taskManifestSha256: receipt.taskManifestHashes[trial.taskId]!,
    })).toThrow(/model/);
  });

  it("selects a complete first batch across all platform families", () => {
    const receipt = freeze();

    const batch = selectProspectiveBatch({
      freeze: receipt,
      completedTrialIds: [],
      maximumTrials: 6,
    });

    expect(batch.map((trial) => [trial.taskId, trial.repeat, trial.condition])).toEqual([
      ["expo-task", 1, "baseline"],
      ["expo-task", 1, "memi"],
      ["swift-task", 1, "memi"],
      ["swift-task", 1, "baseline"],
      ["web-task", 1, "baseline"],
      ["web-task", 1, "memi"],
    ]);
  });

  it("rejects a batch size that would split a matched pair", () => {
    expect(() => selectProspectiveBatch({
      freeze: freeze(),
      completedTrialIds: [],
      maximumTrials: 5,
    })).toThrow(/complete matched pairs/);
  });

  it("unlocks exactly 40 only after all three platforms pass three matched pairs", () => {
    const receipt = freeze();
    const runs = receipt.trials.map((trial) => acceptedRun(receipt, trial));
    const result = evaluateProspectiveStudy({ plan, freeze: receipt, runs });

    expect(result).toMatchObject({
      score: 40,
      registrationCredit: 5,
      repeatCredit: 6,
      qualifiedTasks: ["expo-task", "swift-task", "web-task"],
      reachedTarget: true,
    });
    expect(result.validPairs).toBe(9);
    expect(result.invalidTrials).toEqual([]);
  });

  it("retains failed, stale, duplicate, and revision-mismatched evidence without credit", () => {
    const receipt = freeze();
    const valid = receipt.trials.map((trial) => acceptedRun(receipt, trial));
    const first = valid[0]!;
    const corrupted: BenchmarkRunRecord[] = [
      { ...first, timing: { ...first.timing, startedAt: "2026-07-30T11:59:00.000Z" } },
      { ...valid[1]!, repository: { ...valid[1]!.repository, revision: "0".repeat(40) } },
      { ...valid[2]!, outcome: { ...valid[2]!.outcome, accepted: false } },
      ...valid.slice(3),
      { ...valid[3]! },
    ];

    const result = evaluateProspectiveStudy({
      plan,
      freeze: receipt,
      runs: corrupted,
    });

    expect(result.score).toBe(36);
    expect(result.qualifiedTasks).toEqual(["web-task"]);
    expect(result.invalidTrials.map((entry) => entry.reason)).toEqual(
      expect.arrayContaining([
        "run-started-before-freeze",
        "repository-revision-mismatch",
        "acceptance-failed",
        "duplicate-trial",
      ]),
    );
  });
});

function acceptedRun(
  receipt: ReturnType<typeof freeze>,
  trial: ReturnType<typeof freeze>["trials"][number],
): BenchmarkRunRecord {
  const task = plan.tasks.find((candidate) => candidate.id === trial.taskId)!;
  const started = new Date(
    Date.parse(receipt.frozenAt) + 60_000 + trial.sequence * 120_000,
  );
  const completed = new Date(started.getTime() + 60_000);
  return {
    schemaVersion: 1,
    runId: trial.trialId,
    experimentId: receipt.planId,
    suiteId: receipt.studyId,
    taskId: trial.taskId,
    repeat: trial.repeat,
    condition: trial.condition,
    invocation: "ci",
    repository: {
      pathHash: `sha256:${"1".repeat(64)}`,
      revision: task.revision,
      dirty: false,
    },
    harness: {
      id: receipt.harness.provider,
      modelId: receipt.harness.modelId,
      reasoningEffort: receipt.harness.reasoningEffort,
    },
    timing: {
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      wallTimeMs: 60_000,
      toolTimeMs: 10_000,
    },
    usage: {
      inputTokens: 1_000,
      cachedInputTokens: 500,
      outputTokens: 100,
      reasoningTokens: 50,
      estimatedCostUsd: null,
    },
    tools: { calls: 10, errors: 0, retries: 0 },
    outcome: {
      accepted: true,
      testsPassed: true,
      qualityScore: 80,
      qualityEvidence: "automated_acceptance",
      qualityCeiling: 80,
      defects: 0,
      humanInterventions: 0,
    },
    evidenceRefs: receipt.requiredArtifacts.map((artifact) =>
      `/evidence/${trial.trialId}/${artifact}`),
    prospective: {
      planHash: receipt.planHash,
      freezeHash: receipt.freezeHash,
      candidateArtifactSha256: receipt.candidate.artifactSha256,
      taskManifestSha256: receipt.taskManifestHashes[trial.taskId]!,
      evidenceManifestSha256: `sha256:${"9".repeat(64)}`,
      trialId: trial.trialId,
      sequence: trial.sequence,
    },
  };
}
