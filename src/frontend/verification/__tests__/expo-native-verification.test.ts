import { describe, expect, it, vi } from "vitest";
import {
  EXPO_NATIVE_VERIFICATION_PLAN,
  runExpoNativeVerification,
} from "../expo-native-verification.js";
import {
  CAPTURED_AT,
  COMPLETED_AT,
  STARTED_AT,
  evidenceRoot,
  fixtureDriver,
  writeCompleteEvidence,
} from "./native-verification-fixtures.js";

describe("Expo native verification adapter", () => {
  it("captures the deterministic Expo journey after an exclusive clean reset", async () => {
    const root = await evidenceRoot("memi-expo-verification-");
    const candidates = await writeCompleteEvidence(
      root,
      EXPO_NATIVE_VERIFICATION_PLAN.requirements,
      EXPO_NATIVE_VERIFICATION_PLAN.journey.id,
    );
    const driver = fixtureDriver({ candidates: [...candidates].reverse() });

    const result = await runExpoNativeVerification({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, driver);

    expect(driver.acquireExclusiveSimulatorLease).toHaveBeenCalledWith({
      platform: "expo",
      isolation: "exclusive",
    });
    expect(driver.reset).toHaveBeenCalledTimes(1);
    expect(driver.capture).toHaveBeenCalledWith(EXPO_NATIVE_VERIFICATION_PLAN);
    expect(driver.reset.mock.invocationCallOrder[0]).toBeLessThan(
      driver.capture.mock.invocationCallOrder[0],
    );
    expect(driver.release).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("passed");
    expect(result.adapter).toBe("expo-native-v1");
    expect(result.reasons).toEqual([]);
    expect(result.artifacts.map((artifact) => artifact.requirementId)).toEqual(
      EXPO_NATIVE_VERIFICATION_PLAN.requirements.map((requirement) =>
        requirement.id),
    );
    expect(result.artifacts.every((artifact) =>
      /^sha256:[a-f0-9]{64}$/.test(artifact.sha256))).toBe(true);
    expect(result.manifestSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.evidenceRootSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.simulatorLeaseSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.simulatorIdSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.artifacts)).toBe(true);
    expect(Object.isFrozen(result.artifacts[0])).toBe(true);

    const repeated = await runExpoNativeVerification({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, fixtureDriver({ candidates }));
    expect(repeated.manifestSha256).toBe(result.manifestSha256);
  });

  it("serializes concurrent Expo capture journeys", async () => {
    const firstRoot = await evidenceRoot("memi-expo-first-");
    const secondRoot = await evidenceRoot("memi-expo-second-");
    const firstCandidates = await writeCompleteEvidence(
      firstRoot,
      EXPO_NATIVE_VERIFICATION_PLAN.requirements,
      EXPO_NATIVE_VERIFICATION_PLAN.journey.id,
    );
    const secondCandidates = await writeCompleteEvidence(
      secondRoot,
      EXPO_NATIVE_VERIFICATION_PLAN.requirements,
      EXPO_NATIVE_VERIFICATION_PLAN.journey.id,
    );
    let active = 0;
    let maximumActive = 0;
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const enteredFirst = vi.fn();
    const first = fixtureDriver({
      candidates: firstCandidates,
      onCapture: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        enteredFirst();
        await gate;
        active -= 1;
      },
    });
    const second = fixtureDriver({
      candidates: secondCandidates,
      onCapture: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        active -= 1;
      },
    });

    const firstRun = runExpoNativeVerification({
      evidenceRoot: firstRoot,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, first);
    await vi.waitFor(() => expect(enteredFirst).toHaveBeenCalledTimes(1));
    const secondRun = runExpoNativeVerification({
      evidenceRoot: secondRoot,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, second);
    await Promise.resolve();
    expect(second.acquireExclusiveSimulatorLease).not.toHaveBeenCalled();
    releaseFirst();

    const results = await Promise.all([firstRun, secondRun]);
    expect(maximumActive).toBe(1);
    expect(results.map((result) => result.status)).toEqual(["passed", "passed"]);
  });

  it("rejects missing evidence without imputing an artifact", async () => {
    const root = await evidenceRoot("memi-expo-missing-");
    const candidates = await writeCompleteEvidence(
      root,
      EXPO_NATIVE_VERIFICATION_PLAN.requirements,
      EXPO_NATIVE_VERIFICATION_PLAN.journey.id,
    );
    const missingId = "expo-navigation-state";

    const result = await runExpoNativeVerification({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, fixtureDriver({
      candidates: candidates.filter((candidate) =>
        candidate.requirementId !== missingId),
    }));

    expect(result.status).toBe("rejected");
    expect(result.reasons).toContain(`artifact-missing:${missingId}`);
    expect(result.artifacts.some((artifact) =>
      artifact.requirementId === missingId)).toBe(false);
  });

  it("fails closed before capture when Simulator reset is not clean", async () => {
    const root = await evidenceRoot("memi-expo-reset-");
    const driver = fixtureDriver({ resetClean: false });

    const result = await runExpoNativeVerification({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, driver);

    expect(result.status).toBe("rejected");
    expect(result.reasons).toEqual(["simulator-reset-not-clean"]);
    expect(driver.capture).not.toHaveBeenCalled();
    expect(driver.release).toHaveBeenCalledTimes(1);
    expect(result.artifacts).toEqual([]);
  });

  it("releases an acquired Simulator lease whose descriptor is invalid", async () => {
    const root = await evidenceRoot("memi-expo-invalid-lease-");
    const driver = fixtureDriver();
    const release = vi.fn(async () => undefined);
    driver.acquireExclusiveSimulatorLease.mockResolvedValueOnce({
      descriptor: {
        leaseId: "lease-fixture",
        simulatorId: "simulator-fixture",
        acquiredAt: "2026-08-06T12:00:01.000Z",
        exclusive: false,
      },
      reset: vi.fn(),
      capture: vi.fn(),
      release,
    });

    const result = await runExpoNativeVerification({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, driver);

    expect(result.status).toBe("rejected");
    expect(result.reasons).toEqual(["simulator-lease-invalid"]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rejects stale candidate timestamps", async () => {
    const root = await evidenceRoot("memi-expo-stale-");
    const candidates = await writeCompleteEvidence(
      root,
      EXPO_NATIVE_VERIFICATION_PLAN.requirements,
      EXPO_NATIVE_VERIFICATION_PLAN.journey.id,
    );
    const target = candidates[0];

    const result = await runExpoNativeVerification({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, fixtureDriver({
      candidates: candidates.map((candidate) => candidate === target
        ? { ...candidate, capturedAt: "2026-08-06T11:59:59.000Z" }
        : candidate),
    }));

    expect(result.status).toBe("rejected");
    expect(result.reasons).toContain(`artifact-stale:${target.requirementId}`);
    expect(CAPTURED_AT).not.toBe("2026-08-06T11:59:59.000Z");
  });
});
