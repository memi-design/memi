import { symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SWIFTUI_NATIVE_VERIFICATION_PLAN,
  runSwiftUiNativeVerification,
} from "../swiftui-native-verification.js";
import {
  CAPTURED_AT,
  COMPLETED_AT,
  STARTED_AT,
  evidenceRoot,
  fixtureDriver,
  pngBytes,
  writeCompleteEvidence,
} from "./native-verification-fixtures.js";

describe("native SwiftUI verification adapter", () => {
  it("captures screenshots, hierarchy, navigation, motion, and adaptive evidence", async () => {
    const root = await evidenceRoot("memi-swiftui-verification-");
    const candidates = await writeCompleteEvidence(
      root,
      SWIFTUI_NATIVE_VERIFICATION_PLAN.requirements,
      SWIFTUI_NATIVE_VERIFICATION_PLAN.journey.id,
    );
    const driver = fixtureDriver({ candidates });

    const result = await runSwiftUiNativeVerification({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, driver);

    expect(result.status).toBe("passed");
    expect(result.adapter).toBe("swiftui-native-v1");
    expect(new Set(result.artifacts.map((artifact) => artifact.kind))).toEqual(
      new Set([
        "screenshot",
        "accessibility-hierarchy",
        "navigation-state",
        "interaction-trace",
        "reduced-motion",
        "adaptive-layout",
      ]),
    );
    expect(driver.capture).toHaveBeenCalledWith(SWIFTUI_NATIVE_VERIFICATION_PLAN);
  });

  it("rejects outside-root, duplicate, and corrupt evidence", async () => {
    const root = await evidenceRoot("memi-swiftui-bounded-");
    const outside = await evidenceRoot("memi-swiftui-outside-");
    const candidates = await writeCompleteEvidence(
      root,
      SWIFTUI_NATIVE_VERIFICATION_PLAN.requirements,
      SWIFTUI_NATIVE_VERIFICATION_PLAN.journey.id,
    );
    const screenshot = candidates.find((candidate) =>
      candidate.requirementId === "swiftui-journey-start")!;
    const hierarchy = candidates.find((candidate) =>
      candidate.requirementId === "swiftui-accessibility-hierarchy")!;
    const navigation = candidates.find((candidate) =>
      candidate.requirementId === "swiftui-navigation-state")!;
    await writeFile(join(outside, "escaped.png"), pngBytes());
    await symlink(join(outside, "escaped.png"), join(root, "escaped.png"));
    await writeFile(join(root, hierarchy.path), "not-json");
    await utimes(join(root, hierarchy.path), new Date(CAPTURED_AT), new Date(CAPTURED_AT));

    const result = await runSwiftUiNativeVerification({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, fixtureDriver({
      candidates: [
        ...candidates.map((candidate) => candidate === screenshot
          ? { ...candidate, path: "escaped.png" }
          : candidate),
        navigation,
      ],
    }));

    expect(result.status).toBe("rejected");
    expect(result.reasons).toContain(
      "artifact-outside-evidence-root:swiftui-journey-start",
    );
    expect(result.reasons).toContain(
      "artifact-duplicate:swiftui-navigation-state",
    );
    expect(result.reasons).toContain(
      "artifact-invalid-content:swiftui-accessibility-hierarchy",
    );
  });

  it("marks complete evidence with recorded check failures as failed", async () => {
    const root = await evidenceRoot("memi-swiftui-failures-");
    const candidates = await writeCompleteEvidence(
      root,
      SWIFTUI_NATIVE_VERIFICATION_PLAN.requirements,
      SWIFTUI_NATIVE_VERIFICATION_PLAN.journey.id,
      {
        "swiftui-reduced-motion": {
          schemaVersion: 1,
          completed: true,
          setting: "reduce",
          observations: [{ transition: "root-to-detail", animated: true }],
          failures: ["transition remained animated"],
        },
        "swiftui-adaptive-accessibility": {
          schemaVersion: 1,
          completed: true,
          profile: "accessibility",
          viewport: { width: 390, height: 844 },
          contentSizeCategory: "accessibilityExtraExtraExtraLarge",
          failures: ["primary action clipped"],
        },
      },
    );

    const result = await runSwiftUiNativeVerification({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, fixtureDriver({ candidates }));

    expect(result.status).toBe("failed");
    expect(result.reasons).toContain("reduced-motion-failures:1");
    expect(result.reasons).toContain("adaptive-layout-failures:accessibility:1");
    expect(result.artifacts).toHaveLength(
      SWIFTUI_NATIVE_VERIFICATION_PLAN.requirements.length,
    );
  });

  it("redacts driver failure details and always releases an acquired lease", async () => {
    const root = await evidenceRoot("memi-swiftui-driver-failure-");
    const driver = fixtureDriver({
      captureError: new Error("xcrun failed token=do-not-persist"),
    });

    const result = await runSwiftUiNativeVerification({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, driver);

    expect(result.status).toBe("rejected");
    expect(result.reasons).toEqual(["capture-failed:Error"]);
    expect(JSON.stringify(result)).not.toContain("do-not-persist");
    expect(driver.release).toHaveBeenCalledTimes(1);
    expect(result.artifacts).toEqual([]);
  });

  it("fails closed when the driver returns a malformed candidate collection", async () => {
    const root = await evidenceRoot("memi-swiftui-malformed-");
    const driver = fixtureDriver() as unknown as ReturnType<typeof fixtureDriver>;
    driver.capture.mockResolvedValueOnce(null);

    const result = await runSwiftUiNativeVerification({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, driver);

    expect(result.status).toBe("rejected");
    expect(result.reasons).toEqual([
      "capture-invalid:candidates-must-be-an-array",
    ]);
  });
});
