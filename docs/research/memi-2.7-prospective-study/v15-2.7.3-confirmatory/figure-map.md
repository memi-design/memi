# Figure contracts

These contracts make the paper's visual encodings reviewable independently of
the prose. All charts use a colorblind-safe blue/orange/olive palette with
shape, line style, position, or direct labels as redundant encodings.

## Figure 1 — What V15 establishes and does not establish

- **Question:** What can a public reader conclude from the study without
  mistaking non-inferiority for a performance win?
- **Takeaway:** Two task-specific quality bounds rule out the preregistered
  five-point decline; they do not establish that Memi is better, faster, or
  cheaper.
- **Form:** Plain-language claim-boundary panel.
- **Fields:** task-level means and one-sided decision bounds from
  `generated/primary-analysis.json`, plus the secondary-test count.
- **Limitation:** The panel summarizes the registered interpretation. It does
  not replace the pair-level data, and the quality outcome is model-graded.
- **Output:** `generated/figures/claim-decision.png`.

## Figure 2 — Study design and evidence boundary

- **Question:** How do the frozen candidate, fixtures, matched pairs, evidence
  checks, and admissible claims relate?
- **Takeaway:** All 36 cells contribute to functional and resource analysis,
  while only 10 complete pairs support blinded quality inference.
- **Form:** Directed experimental-flow diagram.
- **Sources:** `protocol.json`, `generated/receipt-validation-summary.json`,
  `exclusions.json`, and `generated/grading-summary.json`.
- **Limitation:** The diagram summarizes admission rules; it does not encode
  effect size or uncertainty.
- **Output:** `generated/figures/study_design.png`.

## Figure 3 — Paired design-quality differences

- **Question:** Does the matched quality difference clear the preregistered
  non-inferiority margin within each gradable fixture?
- **Takeaway:** Buzzr and Paraform clear the -5-point margin; neither supports a
  broad superiority claim, and Nate has no admissible quality estimate.
- **Form:** Paired-difference dot plots with mean, bootstrap interval, and
  non-inferiority boundary.
- **Fields:** `task`, `pair_id`, `candidate_score`, `baseline_score`, and
  bootstrap interval from `generated/primary-analysis.json`.
- **Limitation:** Scores come from a blinded model panel, not independent human
  practitioners, and only 10 complete pairs are available.
- **Output:** `generated/figures/paired_quality_comparisons.png`.

## Figure 4 — Resource differences by fixture

- **Question:** How do candidate-minus-baseline resource outcomes vary by task?
- **Takeaway:** Resource behavior is task-dependent; no single efficiency
  direction is stable across input tokens, output tokens, latency, and calls.
- **Form:** Four task-faceted interval panels sharing a zero reference.
- **Fields:** paired differences and bootstrap intervals for input tokens,
  output tokens, wall time, and tool calls from `generated/secondary-analysis.json`.
- **Limitation:** Token counts are not billing observations, and Holm-corrected
  secondary tests yield no confirmatory rejection.
- **Output:** `generated/figures/task_resource_intervals.png`.

## Figure 5 — Fail-closed routing policy

- **Question:** How does exact-match evidence change whether a skill route is
  admitted, suppressed, or re-enabled?
- **Takeaway:** Promotion requires route-identical evidence; a quality or joint
  catastrophic regression suppresses immediately, and recovery requires three
  later healthy prospective pairs.
- **Form:** State-machine diagram.
- **Sources:** the released fitness-policy specification and its tested CLI
  transition rules.
- **Limitation:** The diagram describes the policy, not evidence that every
  future repository or model will benefit from it.
- **Output:** `generated/figures/routing_policy_state_machine.png`.

## Supporting artifact — Chronological policy replay

- **Question:** Does time-forward replay reproduce each route's recorded state
  without using future evidence?
- **Takeaway:** The three frozen routes follow distinct admit, suppress, and
  recovery histories under as-of replay.
- **Form:** Faceted event timeline with state bands and direct annotations.
- **Fields:** event timestamps, decision state, and reason from
  `generated/fitness-policy/fitness-backtest-as-of.json`.
- **Limitation:** Replay validates deterministic policy behavior on the sealed
  ledger; it is not a new prospective efficacy trial.
- **Output:** `generated/figures/fitness_backtest.png`. This is kept in the
  reproducibility package, rather than presented as a headline paper figure,
  because it validates policy chronology rather than a reader-facing product
  outcome.

Separate website screenshots remain audit evidence rather than headline
figures because they mix heterogeneous breakpoints and renderer capabilities;
presenting them as a quantitative visual comparison would imply a common
measurement scale that the protocol did not define.
