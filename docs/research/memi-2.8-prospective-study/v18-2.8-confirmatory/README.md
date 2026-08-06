# V18 — Memi 2.8 frontend reliability confirmatory study

**Status:** preregistered foundation; no cells have run and no result or product-performance claim is supported.

V18 is the single prospective source of truth for deciding whether Memi 2.8 may
enable routing v3 on its supported frontend routes. It compares an immutable
2.7.9 baseline with an immutable 2.8.0-rc.1 candidate using Codex,
`gpt-5.6-luna`, and low reasoning. The design is frozen before provider use;
failed or excluded cells are retained without replacement or imputation.

## Exact execution matrix

| Phase | Design | Cells | Statistical role |
| --- | --- | ---: | --- |
| A/A | One two-cell baseline pair on each platform | 6 | Harness check only; excluded |
| Native calibration | One baseline/candidate pair on each platform | 6 | Collector calibration only; excluded |
| Confirmatory | 12 tasks × 5 matched pairs × 2 conditions | 120 | Primary and secondary analyses |
| Held-out canary | 20 unseen candidate-only tasks | 20 | First-attempt reliability |
| **Total** |  | **152** |  |

The 12 confirmatory tasks contain exactly four web, four Expo, and four SwiftUI
task slots. `plan.json` enumerates every cell and counterbalanced within-pair
order. `task-registry.json` deliberately leaves only fixture-bound fields
unfilled because the immutable fixtures and task contracts do not yet exist.

## Preregistered release decision

Memi 2.8 is eligible for default routing v3 only if every gate in
`analysis-plan.json` passes:

- All 12 critical tasks pass all five candidate repetitions.
- At least 19 of 20 held-out tasks pass on their first attempt.
- No critical functional, accessibility, security, or rendering defect occurs.
- The one-sided 95% quality lower bound exceeds -5 points for web, Expo, and
  SwiftUI separately.
- Median paired token reduction is at least 25%, with a one-sided 95% lower
  bound greater than 10%.
- Median wall time is non-inferior within 10% in every platform stratum.
- Route precision and recall lower bounds are at least 90%; abstention
  correctness is at least 95%.
- No unsafe pattern, evidence leakage, look-ahead decision, stale cache, or
  nondeterministic receipt is observed.

Failure of any gate keeps the affected route in repository-only discovery.
Non-inferiority is not superiority. No dollar claim is permitted without
cell-bound provider billing records and an immutable price card.

## Evidence and grading

Every admitted cell requires a content-addressed receipt, a clean clone, an
immutable fixture revision, isolated verification, and the platform evidence
listed in `protocol.json`. Missing native artifacts exclude the cell.

Each admitted artifact is scored on the 100-point `rubric.json` by three
blinded model graders. Four qualified practitioners are required for each
platform track, including at least two external practitioners. Model and
practitioner results remain separate. `price-card.json` preregisters no USD
claim; token counts cannot be converted to dollars without a prospective
amendment and cell-bound billing evidence.

## Historical boundary

`predecessor-status.json` records, without editing either historical package:

- V16 remains an excluded calibration attempt and contributes no V18 outcome.
- V17 was superseded before execution; its deterministic router tests are not
  agent-quality results.

## Freeze and execution

The package is intentionally **not ready for provider invocation**. The only
permitted unresolved fields are immutable artifact provenance, fixture
revisions and task contracts, grader identities, and the receipt root. The
complete blocker list is in `freeze-readiness.json`.

Validate the current foundation:

```bash
node --test docs/research/memi-2.8-prospective-study/v18-2.8-confirmatory/validate-plan.test.mjs
node docs/research/memi-2.8-prospective-study/v18-2.8-confirmatory/validate-plan.mjs
```

A later execution branch must freeze and hash the missing immutable inputs,
create the analysis notebook and paper only after receipts are sealed, and
publish every failure, exclusion, and deviation. This foundation contains no
invented fixtures, graders, receipts, scores, figures, or results.
