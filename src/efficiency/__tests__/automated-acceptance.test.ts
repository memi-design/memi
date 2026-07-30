import { describe, expect, it } from "vitest";
import { gradeAutomatedAcceptance } from "../automated-acceptance.js";

describe("automated acceptance grading", () => {
  it("never represents machine acceptance as practitioner-perfect quality", () => {
    expect(gradeAutomatedAcceptance({
      accepted: true,
      verificationChecks: 3,
      failedChecks: 0,
      adapterFailed: false,
    })).toEqual({
      qualityScore: 80,
      qualityEvidence: "automated_acceptance",
      qualityCeiling: 80,
      defects: 0,
    });
  });

  it("penalizes failed checks below the automated evidence ceiling", () => {
    expect(gradeAutomatedAcceptance({
      accepted: false,
      verificationChecks: 4,
      failedChecks: 2,
      adapterFailed: true,
    })).toEqual({
      qualityScore: 30,
      qualityEvidence: "automated_acceptance",
      qualityCeiling: 80,
      defects: 3,
    });
  });

  it("records an acceptance defect when fixture integrity rejects an otherwise green run", () => {
    expect(gradeAutomatedAcceptance({
      accepted: false,
      verificationChecks: 2,
      failedChecks: 0,
      adapterFailed: false,
    })).toEqual({
      qualityScore: 60,
      qualityEvidence: "automated_acceptance",
      qualityCeiling: 80,
      defects: 1,
    });
  });
});
