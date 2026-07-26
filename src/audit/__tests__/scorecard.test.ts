import { describe, expect, it } from "vitest";
import {
  AuditScorecardSchema,
  evaluateAuditScorecard,
  renderAuditScorecardMarkdown,
  type AuditScorecard,
} from "../scorecard.js";

const SHA = "a".repeat(64);
const AS_OF = "2026-07-26T12:00:00.000Z";

function scorecard(overrides: Partial<AuditScorecard> = {}): AuditScorecard {
  return {
    schemaVersion: 1,
    auditId: "memi-100",
    title: "Memi 100-point audit",
    assessedAt: AS_OF,
    subject: {
      repository: "https://github.com/sarveshsea/memi",
      commit: "29a620569723565597837415d5947bc36a042c20",
    },
    evidence: [
      {
        id: "core-proof",
        kind: "implementation",
        status: "passed",
        capturedAt: "2026-07-25T12:00:00.000Z",
        artifact: { location: "artifacts/core-proof.json", sha256: SHA },
        producer: "implementation-agent",
        verifier: "independent-reviewer",
        environment: "macOS 15.5, Node 22.17.0",
      },
    ],
    dimensions: [
      {
        id: "core-activation",
        title: "Core activation",
        maximum: 2,
        owner: "memi-core",
        criteria: [
          {
            id: "read-only-result",
            title: "Read-only audit produces a useful result",
            points: 2,
            assessment: "passed",
            evidenceIds: ["core-proof"],
            requiresIndependentVerification: true,
          },
        ],
      },
    ],
    caps: [],
    ...overrides,
  };
}

describe("AuditScorecardSchema", () => {
  it("rejects dimensions whose criterion points do not account for the full maximum", () => {
    const input = scorecard();
    input.dimensions[0]!.maximum = 3;

    const parsed = AuditScorecardSchema.safeParse(input);

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.message.includes("criterion points"))).toBe(true);
  });

  it("rejects duplicate evidence and criterion identifiers", () => {
    const input = scorecard({
      evidence: [
        ...scorecard().evidence,
        { ...scorecard().evidence[0]! },
      ],
      dimensions: [
        {
          ...scorecard().dimensions[0]!,
          maximum: 4,
          criteria: [
            ...scorecard().dimensions[0]!.criteria,
            { ...scorecard().dimensions[0]!.criteria[0]! },
          ],
        },
      ],
    });

    const parsed = AuditScorecardSchema.safeParse(input);

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.message.includes("Duplicate evidence id"))).toBe(true);
    expect(parsed.error?.issues.some((issue) => issue.message.includes("Duplicate criterion id"))).toBe(true);
  });
});

describe("evaluateAuditScorecard", () => {
  it("awards points only to fresh passing evidence with an independent verifier", () => {
    const result = evaluateAuditScorecard(scorecard(), { asOf: AS_OF });

    expect(result.rawScore).toBe(2);
    expect(result.score).toBe(2);
    expect(result.maximum).toBe(2);
    expect(result.confidence).toBe(1);
    expect(result.unassessedCriteria).toEqual([]);
    expect(result.unverifiedCriteria).toEqual([]);
    expect(result.appliedCaps).toEqual([]);
  });

  it("awards zero and reports stale evidence", () => {
    const input = scorecard();
    input.evidence[0] = {
      ...input.evidence[0]!,
      capturedAt: "2026-06-01T12:00:00.000Z",
    };

    const result = evaluateAuditScorecard(input, { asOf: AS_OF });

    expect(result.score).toBe(0);
    expect(result.staleEvidenceIds).toEqual(["core-proof"]);
    expect(result.unverifiedCriteria).toEqual(["core-activation/read-only-result"]);
  });

  it("awards zero for missing, failed, contradicted, or self-verified evidence", () => {
    const states = [
      { label: "missing", mutate: (input: AuditScorecard) => { input.evidence = []; } },
      { label: "failed", mutate: (input: AuditScorecard) => { input.evidence[0]!.status = "failed"; } },
      { label: "contradicted", mutate: (input: AuditScorecard) => { input.evidence[0]!.status = "contradicted"; } },
      {
        label: "self-verified",
        mutate: (input: AuditScorecard) => {
          input.evidence[0]!.verifier = input.evidence[0]!.producer;
        },
      },
    ];

    for (const state of states) {
      const input = scorecard();
      state.mutate(input);
      const result = evaluateAuditScorecard(input, { asOf: AS_OF });

      expect(result.score, state.label).toBe(0);
      expect(result.unverifiedCriteria, state.label).toEqual(["core-activation/read-only-result"]);
    }
  });

  it("distinguishes explicitly failed and unassessed criteria from unverified claims", () => {
    const input = scorecard();
    input.dimensions[0] = {
      ...input.dimensions[0]!,
      criteria: [
        {
          ...input.dimensions[0]!.criteria[0]!,
          points: 1,
          assessment: "failed",
        },
        {
          id: "unsupported-language",
          title: "Unsupported language is reported honestly",
          points: 1,
          assessment: "unassessed",
          evidenceIds: [],
          requiresIndependentVerification: false,
        },
      ],
    };

    const result = evaluateAuditScorecard(input, { asOf: AS_OF });

    expect(result.score).toBe(0);
    expect(result.failedCriteria).toEqual(["core-activation/read-only-result"]);
    expect(result.unassessedCriteria).toEqual(["core-activation/unsupported-language"]);
    expect(result.unverifiedCriteria).toEqual([]);
  });

  it("keeps a declared-cleared cap active when its clearing evidence is stale", () => {
    const input = scorecard({
      caps: [
        {
          id: "release-drift",
          maximum: 1,
          reason: "Public release surfaces disagree.",
          state: "cleared",
          clearingEvidenceIds: ["release-proof"],
          requiresIndependentVerification: true,
        },
      ],
      evidence: [
        ...scorecard().evidence,
        {
          id: "release-proof",
          kind: "live-release",
          status: "passed",
          capturedAt: "2026-07-24T12:00:00.000Z",
          artifact: { location: "artifacts/release-proof.json", sha256: SHA },
          producer: "release-agent",
          verifier: "independent-reviewer",
          environment: "GitHub and npm public APIs",
        },
      ],
    });

    const result = evaluateAuditScorecard(input, { asOf: AS_OF });

    expect(result.rawScore).toBe(2);
    expect(result.score).toBe(1);
    expect(result.appliedCaps).toEqual([
      expect.objectContaining({ id: "release-drift", maximum: 1 }),
    ]);
    expect(result.staleEvidenceIds).toContain("release-proof");
  });

  it("clears a cap only when every clearing artifact is fresh and independently verified", () => {
    const input = scorecard({
      caps: [
        {
          id: "release-drift",
          maximum: 1,
          reason: "Public release surfaces disagree.",
          state: "cleared",
          clearingEvidenceIds: ["release-proof"],
          requiresIndependentVerification: true,
        },
      ],
      evidence: [
        ...scorecard().evidence,
        {
          id: "release-proof",
          kind: "live-release",
          status: "passed",
          capturedAt: "2026-07-26T08:00:00.000Z",
          artifact: { location: "artifacts/release-proof.json", sha256: SHA },
          producer: "release-agent",
          verifier: "independent-reviewer",
          environment: "GitHub and npm public APIs",
        },
      ],
    });

    const result = evaluateAuditScorecard(input, { asOf: AS_OF });

    expect(result.score).toBe(2);
    expect(result.appliedCaps).toEqual([]);
  });
});

describe("renderAuditScorecardMarkdown", () => {
  it("renders only evaluated values and exposes every remaining gap", () => {
    const input = scorecard();
    input.dimensions[0]!.criteria[0]!.assessment = "unassessed";
    input.dimensions[0]!.criteria[0]!.evidenceIds = [];

    const markdown = renderAuditScorecardMarkdown(input, { asOf: AS_OF });

    expect(markdown).toContain("# Memi 100-point audit");
    expect(markdown).toContain("**Verified score: 0/2**");
    expect(markdown).toContain("| Core activation | 0 | 2 |");
    expect(markdown).toContain("core-activation/read-only-result");
    expect(markdown).not.toContain("2/2");
  });
});
