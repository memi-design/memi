import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  prospectiveEvidenceV2Schema,
  validateProspectiveEvidenceV2,
} from "../prospective-evidence-v2.js";
import { materializeProspectiveEvidenceV2 } from "../prospective-evidence-materialization.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "memi-prospective-evidence-v2-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

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
      sourceArtifact: { name: "provider-usage.json", sha256: sha("f") },
      priceCardArtifact: { name: "price-card.json", sha256: sha("1") },
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
        sourceArtifact: null,
        priceCardArtifact: null,
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

  it("admits native quality and resource evidence without billing only when the frozen plan excludes a USD claim", () => {
    const unbilled = receipt({
      billing: {
        source: "unavailable",
        currency: "USD",
        amount: null,
        sourceSha256: null,
        priceCardSha256: null,
        sourceArtifact: null,
        priceCardArtifact: null,
      },
    });

    expect(validateProspectiveEvidenceV2({
      receipt: unbilled,
      expected,
      requireMeasuredBilling: false,
    })).toEqual({ valid: true, reasons: [] });
    expect(validateProspectiveEvidenceV2({
      receipt: unbilled,
      expected,
    })).toEqual({ valid: false, reasons: ["billing-unmeasured"] });
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

  it("materializes bounded native and billing source files into a sealed receipt", async () => {
    const artifactRoot = join(root, "captured");
    const evidenceDirectory = join(root, "evidence", "trial-1");
    await mkdir(artifactRoot, { recursive: true });
    await Promise.all([
      writeFile(join(artifactRoot, "desktop.png"), "desktop"),
      writeFile(join(artifactRoot, "flow.json"), "flow"),
      writeFile(join(artifactRoot, "a11y.json"), "a11y"),
      writeFile(join(artifactRoot, "usage.json"), "usage"),
      writeFile(join(artifactRoot, "price-card.json"), "price"),
    ]);

    const receipt = await materializeProspectiveEvidenceV2({
      artifactRoot,
      evidenceDirectory,
      draft: {
        schemaVersion: 1,
        kind: "memi-prospective-evidence-draft-v1",
        native: {
          captures: [
            { kind: "screenshot", name: "desktop.png", source: "desktop.png" },
            { kind: "interaction-trace", name: "flow.json", source: "flow.json" },
            { kind: "accessibility-tree", name: "a11y.json", source: "a11y.json" },
          ],
        },
        billing: {
          source: "provider-usage-export",
          currency: "USD",
          amount: 0.42,
          sourceArtifact: { name: "provider-usage.json", source: "usage.json" },
          priceCardArtifact: { name: "price-card.json", source: "price-card.json" },
        },
        execution: { retryReasons: ["provider-transient"] },
      },
      expected,
      execution: {
        stopReason: "verification-passed",
        agentWallTimeMs: 12_000,
        verifierWallTimeMs: 4_000,
      },
    });

    expect(validateProspectiveEvidenceV2({ receipt, expected })).toEqual({
      valid: true,
      reasons: [],
    });
    await expect(readFile(join(evidenceDirectory, "prospective-evidence-v2.json"), "utf8"))
      .resolves.toContain("provider-usage.json");
    expect((await lstat(join(evidenceDirectory, "desktop.png"))).isFile()).toBe(true);
  });

  it("rejects a symlinked capture source before it can enter the receipt", async () => {
    const artifactRoot = join(root, "captured");
    const evidenceDirectory = join(root, "evidence", "trial-1");
    const outside = join(root, "outside.png");
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(outside, "outside");
    await symlink(outside, join(artifactRoot, "desktop.png"));

    await expect(materializeProspectiveEvidenceV2({
      artifactRoot,
      evidenceDirectory,
      draft: {
        schemaVersion: 1,
        kind: "memi-prospective-evidence-draft-v1",
        native: {
          captures: [
            { kind: "screenshot", name: "desktop.png", source: "desktop.png" },
            { kind: "interaction-trace", name: "flow.json", source: "flow.json" },
            { kind: "accessibility-tree", name: "a11y.json", source: "a11y.json" },
          ],
        },
        billing: {
          source: "provider-usage-export",
          currency: "USD",
          amount: 0.42,
          sourceArtifact: { name: "provider-usage.json", source: "usage.json" },
          priceCardArtifact: { name: "price-card.json", source: "price-card.json" },
        },
        execution: { retryReasons: [] },
      },
      expected,
      execution: {
        stopReason: "verification-passed",
        agentWallTimeMs: 12_000,
        verifierWallTimeMs: 4_000,
      },
    })).rejects.toThrow(/regular file/);
    await expect(readFile(join(evidenceDirectory, "prospective-evidence-v2.json"), "utf8"))
      .rejects.toThrow();
  });
});
