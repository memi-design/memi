import type { WebVerificationResult } from "../../efficiency/frontend-verification/web-adapter.js";
import type { WebArtifactKind } from "../../efficiency/frontend-verification/web-contract.js";
import { hashValue } from "../foundation.js";
import type { WorkflowReceiptV3Input } from "../receipts/workflow-receipt-v3.js";
import type { FrontendTaskContractV1 } from "../task-contract.js";
import type {
  NativeArtifactKind,
  NativeVerificationResult,
} from "./native-verification-contract.js";

type AdapterResult = WebVerificationResult | NativeVerificationResult;

export function createReceiptVerificationEvidence(input: {
  readonly contract: FrontendTaskContractV1;
  readonly result: AdapterResult;
}): Readonly<{
  nativeEvidence: WorkflowReceiptV3Input["nativeEvidence"];
  verification: WorkflowReceiptV3Input["verification"];
}> {
  const platform = input.contract.platform;
  if (platformForResult(input.result) !== platform) {
    throw new Error("Verification adapter platform does not match the task contract");
  }
  const verification = [{
    verificationId: `${input.result.adapter}-verification`,
    kind: platform === "web" ? "rendered-flow" as const : "ios-simulator" as const,
    commandSha256: hashValue(input.contract.verificationCommands),
    status: input.result.status === "passed" ? "passed" as const : "failed" as const,
    exitCode: input.result.status === "passed" ? 0 : 1,
    startedAt: input.result.runStartedAt,
    completedAt: input.result.runCompletedAt,
    durationMs: Date.parse(input.result.runCompletedAt) - Date.parse(input.result.runStartedAt),
    outputSha256: input.result.manifestSha256,
  }];
  if (input.result.status !== "passed") {
    return Object.freeze({
      nativeEvidence: {
        status: "excluded",
        platform,
        artifacts: [],
        reason: exclusionReason(input.result.reasons),
      },
      verification,
    });
  }
  const verifiedAt = input.result.runCompletedAt;
  const artifacts = input.result.artifacts.map((artifact) => {
    const freshnessWindowMs = 5 * 60 * 1_000;
    return {
      evidenceId: artifactId(artifact),
      kind: receiptArtifactKind(artifact.kind),
      file: artifact.path,
      sha256: artifact.sha256,
      capturedAt: artifact.capturedAt,
      verifiedAt,
      freshUntil: new Date(Date.parse(verifiedAt) + freshnessWindowMs).toISOString(),
      freshnessWindowMs,
    };
  });
  return Object.freeze({
    nativeEvidence: {
      status: "admitted",
      platform,
      artifacts,
    },
    verification,
  });
}

function platformForResult(result: AdapterResult): "web" | "expo" | "swiftui" {
  return result.adapter === "chromium-web-v1" ? "web" : result.platform;
}

function artifactId(artifact: { readonly requirementId: string }): string {
  return artifact.requirementId;
}

function receiptArtifactKind(kind: WebArtifactKind | NativeArtifactKind):
  "screenshot" | "interaction-trace" | "accessibility-tree" | "reduced-motion-trace" | "verification-log" {
  if (kind === "screenshot") return "screenshot";
  if (kind === "interaction-trace") return "interaction-trace";
  if (kind === "axe" || kind === "accessibility-hierarchy") return "accessibility-tree";
  if (kind === "reduced-motion") return "reduced-motion-trace";
  return "verification-log";
}

function exclusionReason(reasons: readonly string[]):
  "missing-native-artifact" | "driver-failed" | "stale-artifact" | "corrupt-artifact" {
  if (reasons.some((reason) => reason.includes("stale"))) return "stale-artifact";
  if (reasons.some((reason) => reason.includes("corrupt") || reason.includes("mutated"))) {
    return "corrupt-artifact";
  }
  if (reasons.some((reason) =>
    reason.includes("capture")
    || reason.includes("driver")
    || reason.includes("simulator")
    || reason.includes("evidence-root"))) {
    return "driver-failed";
  }
  return "missing-native-artifact";
}
