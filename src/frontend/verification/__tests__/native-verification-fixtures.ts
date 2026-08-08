import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type {
  NativeArtifactCandidate,
  NativeSimulatorLease,
  NativeVerificationDriver,
  NativeVerificationPlan,
  NativeVerificationRequirement,
} from "../native-verification-contract.js";

export const STARTED_AT = "2026-08-06T12:00:00.000Z";
export const COMPLETED_AT = "2026-08-06T12:01:00.000Z";
export const ACQUIRED_AT = "2026-08-06T12:00:01.000Z";
export const RESET_AT = "2026-08-06T12:00:02.000Z";
export const CAPTURED_AT = "2026-08-06T12:00:10.000Z";

export interface FixtureDriverOptions {
  readonly candidates?: readonly NativeArtifactCandidate[];
  readonly acquireError?: Error;
  readonly resetError?: Error;
  readonly resetClean?: boolean;
  readonly captureError?: Error;
  readonly onCapture?: (plan: NativeVerificationPlan) => Promise<void> | void;
}

export function fixtureDriver(
  options: FixtureDriverOptions = {},
): NativeVerificationDriver & {
  readonly acquireExclusiveSimulatorLease: ReturnType<typeof vi.fn>;
  readonly reset: ReturnType<typeof vi.fn>;
  readonly capture: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
} {
  const reset = vi.fn(async () => {
    if (options.resetError) throw options.resetError;
    return {
      leaseId: "lease-fixture",
      simulatorId: "simulator-fixture",
      resetAt: RESET_AT,
      clean: options.resetClean ?? true,
    } as const;
  });
  const capture = vi.fn(async (plan: NativeVerificationPlan) => {
    if (options.captureError) throw options.captureError;
    await options.onCapture?.(plan);
    return options.candidates ?? [];
  });
  const release = vi.fn(async () => undefined);
  const lease: NativeSimulatorLease = {
    descriptor: {
      leaseId: "lease-fixture",
      simulatorId: "simulator-fixture",
      acquiredAt: ACQUIRED_AT,
      exclusive: true,
    },
    reset,
    capture,
    release,
  };
  const acquireExclusiveSimulatorLease = vi.fn(async () => {
    if (options.acquireError) throw options.acquireError;
    return lease;
  });
  return {
    acquireExclusiveSimulatorLease,
    reset,
    capture,
    release,
  };
}

export async function evidenceRoot(prefix = "memi-native-verification-"):
Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function writeCompleteEvidence(
  root: string,
  requirements: readonly NativeVerificationRequirement[],
  journeyId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<readonly NativeArtifactCandidate[]> {
  const candidates: NativeArtifactCandidate[] = [];
  for (const requirement of requirements) {
    const extension = requirement.mimeType === "image/png" ? "png" : "json";
    const relativePath = `${requirement.id}.${extension}`;
    const content = overrides[requirement.id]
      ?? evidenceFor(requirement, journeyId);
    await writeFile(
      join(root, relativePath),
      requirement.mimeType === "image/png"
        ? pngBytes()
        : Buffer.from(JSON.stringify(content)),
    );
    const timestamp = new Date(CAPTURED_AT);
    await utimes(join(root, relativePath), timestamp, timestamp);
    candidates.push({
      requirementId: requirement.id,
      path: relativePath,
      capturedAt: CAPTURED_AT,
    });
  }
  return candidates;
}

export function pngBytes(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}

function evidenceFor(
  requirement: NativeVerificationRequirement,
  journeyId: string,
): unknown {
  switch (requirement.kind) {
    case "accessibility-hierarchy":
      return {
        schemaVersion: 1,
        completed: true,
        root: {
          role: "application",
          label: "Fixture app",
          children: [{ role: "button", label: "Continue", children: [] }],
        },
      };
    case "navigation-state":
      return {
        schemaVersion: 1,
        completed: true,
        journeyId,
        orderedStates: ["root", "detail"],
        finalState: "detail",
      };
    case "interaction-trace":
      return {
        schemaVersion: 1,
        completed: true,
        journeyId,
        orderedStepIds: ["launch", "open-detail", "verify-detail"],
        failures: [],
      };
    case "reduced-motion":
      return {
        schemaVersion: 1,
        completed: true,
        setting: "reduce",
        observations: [{ transition: "root-to-detail", animated: false }],
        failures: [],
      };
    case "adaptive-layout":
      return {
        schemaVersion: 1,
        completed: true,
        profile: requirement.profile,
        viewport: requirement.profile === "compact"
          ? { width: 390, height: 844 }
          : { width: 1024, height: 1366 },
        contentSizeCategory: requirement.profile === "accessibility"
          ? "accessibilityExtraExtraExtraLarge"
          : "large",
        failures: [],
      };
    case "screenshot":
      return undefined;
  }
}
