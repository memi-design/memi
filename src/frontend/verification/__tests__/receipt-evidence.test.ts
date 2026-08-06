import { describe, expect, it } from "vitest";
import type { WebVerificationResult } from "../../../efficiency/frontend-verification/web-adapter.js";
import { createFrontendTaskContract } from "../../task-contract.js";
import { createReceiptVerificationEvidence } from "../receipt-evidence.js";
import type { NativeVerificationResult } from "../native-verification-contract.js";

describe("createReceiptVerificationEvidence", () => {
  it("admits passed adapter artifacts and excludes failed adapter output without imputation", () => {
    const contract = createFrontendTaskContract({
      taskId: "web-settings",
      taskClass: "frontend-modification",
      platform: "web",
      intent: "Improve settings",
      targetFiles: ["src/Settings.tsx"],
      targetComponents: ["Settings"],
      requiredStates: ["desktop", "mobile"],
      constraints: [],
      verificationCommands: ["npm run test:e2e"],
      resourceCeilings: {
        inputTokens: 10_000,
        outputTokens: 2_000,
        reasoningTokens: 2_000,
        wallTimeMs: 120_000,
        toolCalls: 20,
        implementationAttempts: 2,
      },
      contextExpansion: { state: "unused" },
    });
    const passed: WebVerificationResult = {
      schemaVersion: 1,
      adapter: "chromium-web-v1",
      status: "passed",
      evidenceRootSha256: `sha256:${"1".repeat(64)}`,
      runStartedAt: "2026-08-06T12:00:00.000Z",
      runCompletedAt: "2026-08-06T12:00:02.000Z",
      reasons: [],
      artifacts: [{
        requirementId: "desktop-default",
        kind: "screenshot",
        browser: "chromium",
        viewport: "desktop",
        colorScheme: "light",
        reducedMotion: "no-preference",
        state: "default",
        mimeType: "image/png",
        path: "evidence/desktop.png",
        capturedAt: "2026-08-06T12:00:01.000Z",
        bytes: 42,
        sha256: `sha256:${"2".repeat(64)}`,
      }],
      manifestSha256: `sha256:${"3".repeat(64)}`,
    };

    const admitted = createReceiptVerificationEvidence({ contract, result: passed });
    const excluded = createReceiptVerificationEvidence({
      contract,
      result: { ...passed, status: "rejected", reasons: ["artifact-stale:desktop-default"], artifacts: [] },
    });

    expect(admitted.nativeEvidence).toMatchObject({ status: "admitted", platform: "web" });
    expect(admitted.nativeEvidence.artifacts[0]).toMatchObject({
      evidenceId: "desktop-default",
      kind: "screenshot",
      file: "evidence/desktop.png",
    });
    expect(admitted.verification[0]).toMatchObject({ status: "passed", kind: "rendered-flow" });
    expect(excluded.nativeEvidence).toEqual({
      status: "excluded",
      platform: "web",
      artifacts: [],
      reason: "stale-artifact",
    });
    expect(excluded.verification[0]?.status).toBe("failed");
  });

  it("anchors artifact freshness to verification for long-running captures", () => {
    const contract = webContract();
    const result: WebVerificationResult = {
      ...passedWebResult(),
      runCompletedAt: "2026-08-06T12:10:00.000Z",
    };

    const evidence = createReceiptVerificationEvidence({ contract, result });

    expect(evidence.nativeEvidence.artifacts[0]).toMatchObject({
      capturedAt: "2026-08-06T12:00:01.000Z",
      verifiedAt: "2026-08-06T12:10:00.000Z",
      freshUntil: "2026-08-06T12:15:00.000Z",
      freshnessWindowMs: 300_000,
    });
  });

  it.each([
    "simulator-lease-failed:Error",
    "simulator-reset-invalid",
    "simulator-release-failed:Error",
    "evidence-root-invalid",
  ])("classifies native harness failure %s as driver-failed", (reason) => {
    const contract = createFrontendTaskContract({
      taskId: "expo-settings",
      taskClass: "frontend-modification",
      platform: "expo",
      intent: "Improve settings",
      targetFiles: ["src/Settings.tsx"],
      targetComponents: ["Settings"],
      requiredStates: ["compact", "regular"],
      constraints: [],
      verificationCommands: ["npm run test:expo"],
      resourceCeilings: {
        inputTokens: 10_000,
        outputTokens: 2_000,
        reasoningTokens: 2_000,
        wallTimeMs: 120_000,
        toolCalls: 20,
        implementationAttempts: 2,
      },
      contextExpansion: { state: "unused" },
    });
    const result: NativeVerificationResult = {
      schemaVersion: 1,
      adapter: "expo-native-v1",
      platform: "expo",
      status: "rejected",
      evidenceRootSha256: `sha256:${"1".repeat(64)}`,
      simulatorLeaseSha256: null,
      simulatorIdSha256: null,
      resetAt: null,
      runStartedAt: "2026-08-06T12:00:00.000Z",
      runCompletedAt: "2026-08-06T12:00:02.000Z",
      reasons: [reason],
      artifacts: [],
      manifestSha256: `sha256:${"3".repeat(64)}`,
    };

    const evidence = createReceiptVerificationEvidence({ contract, result });

    expect(evidence.nativeEvidence).toMatchObject({
      status: "excluded",
      platform: "expo",
      reason: "driver-failed",
    });
  });
});

function webContract() {
  return createFrontendTaskContract({
    taskId: "web-settings",
    taskClass: "frontend-modification",
    platform: "web",
    intent: "Improve settings",
    targetFiles: ["src/Settings.tsx"],
    targetComponents: ["Settings"],
    requiredStates: ["desktop", "mobile"],
    constraints: [],
    verificationCommands: ["npm run test:e2e"],
    resourceCeilings: {
      inputTokens: 10_000,
      outputTokens: 2_000,
      reasoningTokens: 2_000,
      wallTimeMs: 120_000,
      toolCalls: 20,
      implementationAttempts: 2,
    },
    contextExpansion: { state: "unused" },
  });
}

function passedWebResult(): WebVerificationResult {
  return {
    schemaVersion: 1,
    adapter: "chromium-web-v1",
    status: "passed",
    evidenceRootSha256: `sha256:${"1".repeat(64)}`,
    runStartedAt: "2026-08-06T12:00:00.000Z",
    runCompletedAt: "2026-08-06T12:00:02.000Z",
    reasons: [],
    artifacts: [{
      requirementId: "desktop-default",
      kind: "screenshot",
      browser: "chromium",
      viewport: "desktop",
      colorScheme: "light",
      reducedMotion: "no-preference",
      state: "default",
      mimeType: "image/png",
      path: "evidence/desktop.png",
      capturedAt: "2026-08-06T12:00:01.000Z",
      bytes: 42,
      sha256: `sha256:${"2".repeat(64)}`,
    }],
    manifestSha256: `sha256:${"3".repeat(64)}`,
  };
}
