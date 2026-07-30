export interface AutomatedAcceptanceInput {
  readonly accepted: boolean;
  readonly verificationChecks: number;
  readonly failedChecks: number;
  readonly adapterFailed: boolean;
}

export interface AutomatedAcceptanceGrade {
  readonly qualityScore: number;
  readonly qualityEvidence: "automated_acceptance";
  readonly qualityCeiling: 80;
  readonly defects: number;
}

const AUTOMATED_EVIDENCE_CEILING = 80;

export function gradeAutomatedAcceptance(
  input: AutomatedAcceptanceInput,
): AutomatedAcceptanceGrade {
  const failedChecks = Math.max(0, Math.min(
    input.verificationChecks,
    input.failedChecks,
  ));
  const adapterDefect = input.adapterFailed ? 1 : 0;
  const acceptanceDefect = !input.accepted && failedChecks === 0 && adapterDefect === 0
    ? 1
    : 0;
  const defects = failedChecks + adapterDefect + acceptanceDefect;
  const score = AUTOMATED_EVIDENCE_CEILING
    - (failedChecks * 20)
    - (adapterDefect * 10)
    - (acceptanceDefect * 20);

  return {
    qualityScore: Math.max(0, score),
    qualityEvidence: "automated_acceptance",
    qualityCeiling: AUTOMATED_EVIDENCE_CEILING,
    defects,
  };
}
