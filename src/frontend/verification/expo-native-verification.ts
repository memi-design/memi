import {
  freezeNativePlan,
  runNativeVerification,
  type NativeVerificationDriver,
  type NativeVerificationInput,
  type NativeVerificationResult,
} from "./native-verification-contract.js";

/** Deterministic proof plan for an Expo development-client journey. */
export const EXPO_NATIVE_VERIFICATION_PLAN = freezeNativePlan({
  schemaVersion: 1,
  platform: "expo",
  isolation: "exclusive-simulator-lease",
  resetPolicy: "clean-before-capture",
  journey: {
    id: "expo-primary-v1",
    steps: [
      { id: "launch", ordinal: 0, action: "launch" },
      { id: "open-detail", ordinal: 1, action: "activate" },
      { id: "verify-detail", ordinal: 2, action: "assert" },
    ],
    expectedNavigationStates: ["root", "detail"],
  },
  requirements: requirements("expo"),
});

export function runExpoNativeVerification(
  input: NativeVerificationInput,
  driver: NativeVerificationDriver,
): Promise<NativeVerificationResult> {
  return runNativeVerification(input, driver, EXPO_NATIVE_VERIFICATION_PLAN);
}

function requirements(prefix: "expo") {
  return [
    screenshot(`${prefix}-journey-start`),
    screenshot(`${prefix}-journey-end`),
    json(`${prefix}-accessibility-hierarchy`, "accessibility-hierarchy"),
    json(`${prefix}-navigation-state`, "navigation-state"),
    json(`${prefix}-interaction-trace`, "interaction-trace"),
    json(`${prefix}-reduced-motion`, "reduced-motion"),
    json(`${prefix}-adaptive-compact`, "adaptive-layout", "compact"),
    json(`${prefix}-adaptive-regular`, "adaptive-layout", "regular"),
    json(`${prefix}-adaptive-accessibility`, "adaptive-layout", "accessibility"),
  ] as const;
}

function screenshot(id: string) {
  return { id, kind: "screenshot", mimeType: "image/png", profile: "standard" } as const;
}

function json(
  id: string,
  kind: "accessibility-hierarchy" | "navigation-state" | "interaction-trace"
    | "reduced-motion" | "adaptive-layout",
  profile: "standard" | "compact" | "regular" | "accessibility" = "standard",
) {
  return { id, kind, mimeType: "application/json", profile } as const;
}

export type {
  NativeArtifactCandidate,
  NativeArtifactReceipt,
  NativeSimulatorLease,
  NativeVerificationDriver,
  NativeVerificationInput,
  NativeVerificationResult,
} from "./native-verification-contract.js";
