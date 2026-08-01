import { describe, expect, it } from "vitest";
import {
  prospectiveEvidenceV2Schema,
  validateProspectiveEvidenceV2,
} from "../prospective-evidence-v2.js";

const sha = (character: string) => `sha256:${character.repeat(64)}`;

function receipt(overrides: Record<string, unknown> = {}) {
  return prospectiveEvidenceV2Schema.parse({
    schemaVersion: 2,
    kind: "memi-prospective-evidence-v2",
    runId: "study:web:r1:memi",
    trial: {
      trialId: "study:web:r1:memi",
      taskId: "web",
      repeat: 1,
      condition: "memi",
      repositoryRevision: "a".repeat(40),
      candidateArtifactSha256: sha("b"),
    },
    native: {
      platform: "web",
      captures: [
        { kind: "screenshot", name: "desktop.png", sha256: sha("c") },
        { kind: "interaction-trace", name: "flow.json", sha256: sha("d") },
        { kind: "accessibility-tree", name: "a11y.json", sha256: sha("e") },
      ],
    },
    billing: {
      source: "provider-usage-export",
      currency: "USD",
      amount: 0.42,
      sourceSha256: sha("f"),
      priceCardSha256: sha("1"),
    },
    execution: {
      stopReason: "verification-passed",
      retryReasons: [],
      agentWallTimeMs: 12_000,
      verifierWallTimeMs: 4_000,
    },
    ...overrides,
  });
}

const expected = {
  runId: "study:web:r1:memi",
  trialId: "study:web:r1:memi",
  taskId: "web",
  repeat: 1,
  condition: "memi" as const,
  repositoryRevision: "a".repeat(40),
  candidateArtifactSha256: sha("b"),
  platform: "web" as const,
  requiredCaptureKinds: [
    "screenshot",
    "interaction-trace",
    "accessibility-tree",
  ] as const,
};

describe("prospective evidence v2", () => {
  it("admits a native, billed, exact-trial receipt", () => {
    expect(validateProspectiveEvidenceV2({
      receipt: receipt(),
      expected,
    })).toEqual({ valid: true, reasons: [] });
  });

  it("fails closed for incomplete native capture, unmeasured billing, and binding drift", () => {
    const incomplete = receipt({
      native: {
        platform: "web",
        captures: [
          { kind: "screenshot", name: "desktop.png", sha256: sha("c") },
        ],
      },
      billing: {
        source: "unavailable",
        currency: "USD",
        amount: null,
        sourceSha256: null,
        priceCardSha256: null,
      },
      trial: {
        trialId: "study:web:r1:memi",
        taskId: "web",
        repeat: 1,
        condition: "memi",
        repositoryRevision: "f".repeat(40),
        candidateArtifactSha256: sha("b"),
      },
    });

    expect(validateProspectiveEvidenceV2({
      receipt: incomplete,
      expected,
    })).toEqual({
      valid: false,
      reasons: [
        "trial-binding-mismatch:repositoryRevision",
        "native-capture-missing:interaction-trace",
        "native-capture-missing:accessibility-tree",
        "billing-unmeasured",
      ],
    });
  });

  it("rejects duplicate capture identities before a receipt can be admitted", () => {
    expect(() => receipt({
      native: {
        platform: "web",
        captures: [
          { kind: "screenshot", name: "same.png", sha256: sha("c") },
          { kind: "screenshot", name: "same.png", sha256: sha("d") },
        ],
      },
    })).toThrow(/unique/);
  });

  it("rejects a measured billing claim without retained source and price-card artifacts", () => {
    expect(() => receipt({
      billing: {
        source: "provider-usage-export",
        currency: "USD",
        amount: 0.42,
        sourceSha256: sha("f"),
        priceCardSha256: sha("1"),
      },
    })).toThrow(/sourceArtifact/);
  });
});
