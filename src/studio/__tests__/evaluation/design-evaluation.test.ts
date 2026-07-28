import { describe, expect, it } from "vitest";
import {
  buildDesignHarnessEvaluation,
  designHarnessEvaluationSchema,
} from "../../evaluation/design-evaluation.js";

describe("evaluation/design-evaluation", () => {
  it("does not claim Memi improved design quality without paired independent evidence", () => {
    const evaluation = buildDesignHarnessEvaluation({
      taskId: "web-accessibility-1",
      modelId: "same-model",
      baselineRunId: "run-baseline",
      memiRunId: "run-memi",
      dimensions: [],
      reviewer: { kind: "self", id: "memi" },
      evidenceRefs: [],
    });
    expect(evaluation.status).toBe("unassessed");
    expect(evaluation.claim).toBe("insufficient_evidence");
  });

  it("computes a verified paired delta from rubric evidence", () => {
    const evaluation = buildDesignHarnessEvaluation({
      taskId: "web-accessibility-1",
      modelId: "same-model",
      baselineRunId: "run-baseline",
      memiRunId: "run-memi",
      dimensions: [
        { id: "build-validity", weight: 50, baselineScore: 70, memiScore: 95 },
        { id: "token-adherence", weight: 50, baselineScore: 60, memiScore: 90 },
      ],
      reviewer: { kind: "independent", id: "reviewer-1" },
      evidenceRefs: ["sha256:before", "sha256:after"],
    });
    expect(designHarnessEvaluationSchema.parse(evaluation)).toMatchObject({
      status: "verified",
      baselineScore: 65,
      memiScore: 92.5,
      delta: 27.5,
      claim: "improved",
    });
  });
});
