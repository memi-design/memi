# Evidence-led 2.7.5 plan: better frontend outcomes and measured efficiency

## Starting point

Memi 2.7.4 is already released. Its contribution is a fail-closed routing
policy, not proof that Memi is better, faster, or cheaper. V15 found no large
model-graded quality decline on two gradable tasks, but it did not establish
superiority, a general efficiency result, or dollar savings. This plan targets
**2.7.5**; it must not be used to retroactively strengthen a 2.7.4 claim.

The objective is a product that is demonstrably more useful for frontend work
without routing speculative skill history into a user's repository. Every
release claim below is conditional on a preregistered confirmatory study and
its stated gate.

## Product hypotheses to test before promising an outcome

| Outcome | Proposed release claim gate | Evidence required |
| --- | --- | --- |
| Better frontend quality | A preregistered superiority test has a positive one-sided 95% lower bound on an independent human design-quality score, with zero critical defects. | Native web, Expo, and SwiftUI artifacts; independent human panel; blinded matched pairs. |
| Faster delivery | The paired latency estimate and its interval cross a preregistered practical threshold while quality remains non-inferior. | Agent and verification wall-clock telemetry, machine-utilization record, and identical task contracts. |
| Cheaper delivery | Measured provider billing is lower by a preregistered practical threshold while quality remains non-inferior. | Per-cell billing export or invoice-backed usage, a versioned price card, and immutable receipt linkage. |
| Safer skill reuse | Exact-route policy makes no look-ahead decision and blocks a harmful skill immediately. | Sealed chronological event store, adversarial isolation tests, and prospective recovery probes. |

The exact effect sizes, sample size, and practical thresholds are not chosen
after looking at pilot outcomes. A statistical power analysis, frozen protocol,
and analysis code must be reviewed before the first confirmatory cell starts.

## 1. Repair the harness before optimizing the model

### Make trial execution native and observable

- Define three platform-native fixture lanes: Chromium/Playwright web,
  Expo Simulator with interaction and accessibility-tree capture, and SwiftUI
  Simulator with native screenshots and accessibility inspection.
- Run each paired cell from a clean clone with a pinned fixture revision,
  candidate tarball checksum, provider/model/effort tuple, task contract, and
  isolated post-patch verification.
- Serialize simulator and Xcode work. Record boot state, device image,
  hardware, environment, tool calls, retries, input/output/reasoning tokens,
  verification time, provider failures, and agent wall time in the receipt.
- Add deterministic preflight checks for fixture health, required simulators,
  artifact capture, prompt size, and billing telemetry. A failed preflight is a
  recorded exclusion, not a silently retried success.

### Reduce waste without sacrificing verification

- Split each run into a bounded design-plan phase and a bounded implementation
  phase. The plan emits the target components, tokens, interaction states, and
  verification commands before edits begin.
- Build a repository fingerprint and component/design-token inventory once per
  clean fixture. Cache it only by immutable repository revision and invalidate
  on a fingerprint mismatch.
- Use task-specific token ceilings and early stop conditions: no further tool
  exploration after the relevant component, test, and design-system surface
  are resolved; no automatic “repair” loop after two evidence-bearing failed
  attempts.
- Emit structured reason codes for every retry and stop. This lets later
  analysis distinguish a provider failure, harness fault, missing skill
  context, and legitimate implementation difficulty.

### Prove the harness itself is trustworthy

1. Run an A/A study before any Memi-versus-baseline comparison: identical
   baseline conditions must show balanced order effects and complete receipts.
2. Re-run a small sample on a second machine image to quantify harness and
   simulator variance.
3. Lock a no-look-ahead receipt ledger and independently recompute all summary
   tables from the raw cells before the candidate is evaluated.

## 2. Make skills narrower, evidence-bearing, and frontend-specific

### Skill design

Replace broad “frontend quality” instructions with short, composable skills:

- **Design-system mapper:** identifies the existing component catalog, tokens,
  spacing, typography, and state conventions before edits.
- **Responsive interaction builder:** implements the requested flow across
  target breakpoints, empty/error/loading states, keyboard navigation, and
  reduced-motion behavior.
- **Accessibility verifier:** produces a task-specific checklist for semantic
  controls, focus order, accessible names, contrast, and platform-native
  accessibility behavior.

Every skill must declare its task class, repository preconditions, required
evidence, expected commands, and content hash. It returns a concise plan and
acceptance checklist rather than unbounded prose. The agent may inject one
exact-match skill plus repository-local discovery; it must not stack unrelated
skills merely because their historical averages are favorable.

### Skill fitness and recovery

- Preserve the current exact identity tuple: task class, repository
  fingerprint, provider, model, effort, skill ID, and skill content hash.
  Evidence from another tuple never promotes a route.
- Keep immediate suppression for a quality regression or joint catastrophic
  resource regression. When suppressed, repository-only discovery begins
  immediately.
- Treat every changed skill hash as a challenger with no inherited positive
  evidence. It earns eligibility only through later prospective exact-match
  pairs.
- Run eligible challengers in an explicitly preregistered shadow or limited
  allocation study; never switch a default route from a retrospective average.
- Keep the three later healthy prospective-pair recovery rule, and add tests
  for duplicate events, corrupt evidence, clocks out of order, and attempted
  cross-repository recovery.

## 3. Evaluate actual frontend quality, not only build success

### Matched study design

- Freeze a representative task set before execution: information hierarchy,
  responsive behavior, interaction state, accessibility repair, and
  design-system extension tasks across web, Expo, and SwiftUI.
- Pair baseline and Memi on the same task, fixture revision, provider/model,
  effort, token ceiling, and verification contract. Counterbalance order with a
  published seed and execute serially where hardware is shared.
- Capture anonymized desktop and mobile web states, native Expo and SwiftUI
  states, keyboard/focus flows, light/dark mode where available, reduced
  motion, and empty/error states. Do not grade a task that lacks its required
  native rendered evidence.
- Use an independent human practitioner panel, blinded to condition and run
  identity. Pre-register rater count, adjudication, and the 100-point rubric:
  task correctness (25), accessibility (20), hierarchy (15), design-system
  consistency (15), responsive/adaptive behavior (15), and implementation
  quality (10).
- Report individual pairs, panel medians, rater disagreement, inter-rater
  reliability, all exclusions, and every failure without imputation. Model
  graders may remain a secondary diagnostic, clearly labeled as such.

### Statistical decision rules

- Primary superiority and quality non-inferiority are distinct tests. The
  confirmatory protocol must define the primary endpoint, one-sided interval,
  multiplicity family, and power calculation before data collection.
- A speed or cost claim requires both a quality non-inferiority gate and its
  own corrected paired result. No provider token count may be relabeled as a
  billing saving.
- Publish paired means, medians, exact tests, bootstrap intervals, leave-one-
  pair-out sensitivity, and a descriptive cross-fixture summary. Keep
  heterogeneous fixture pools out of a single marketing average.

## 4. Measure cost and latency honestly

- Collect per-cell provider billing records or invoice-backed usage under an
  immutable run ID. Preserve the applicable versioned price card and currency
  conversion date.
- Separate agent time, tool time, verifier time, queue time, and simulator
  boot time. Report cold and warm execution separately.
- Track the cost of failed, retried, and suppressed routes. A “cheap” result
  that excludes recovery work, retries, or verification is not admissible.
- Give the public report both absolute currency totals and paired relative
  differences with uncertainty; withhold any dollar claim if billing linkage is
  incomplete.

## 5. Implementation sequence and release gates

### Phase A — harness reliability (no behavior change)

1. Add receipt schema v3 for native render captures, billing linkage, and
   structured stop/retry reasons.
2. Add unit and integration tests for preflight, clean-clone isolation,
   immutable fixture capture, receipt hashing, and no-look-ahead replay.
3. Complete an A/A verification run and publish its deviations before using
   the harness to compare skills.

### Phase B — skill quality (shadow only)

1. Implement the three focused skill capsules and exact content-hash routing.
2. Add adversarial tests for evidence leakage, stale cache use, cross-model
   promotion, immediate suppression, and recovery after exactly three healthy
   later pairs.
3. Run a bounded prospective pilot. The pilot selects neither a winner nor a
   marketing claim; it validates sample-size assumptions and harness health.

### Phase C — confirmatory evaluation

1. Freeze the candidate, fixtures, protocol, statistical plan, reviewer
   assignment, and public analysis repository.
2. Execute the native matched study with complete receipts and independent
   human grading.
3. Independently recompute the analysis, inspect every rendered artifact, and
   publish results whether they are favorable, null, or adverse.

### Phase D — 2.7.5 release

Ship only if all applicable gates pass:

- deterministic package, security, type, unit, integration, and native E2E
  tests pass on the supported platform matrix;
- zero critical accessibility or security findings on admitted product flows;
- quality, speed, and cost claims each satisfy their own preregistered evidence
  gate;
- all receipt, fixture, candidate, native artifact, billing, and analysis
  hashes verify; and
- npm, GitHub release, binaries, MCP Registry, Homebrew, GHCR, website, and
  research-report artifacts agree on version, checksum, and claim language.

If quality does not improve, route evidence is incomplete, or cost/latency does
not clear its gate, the release may still ship the safety repair with that skill
disabled or in shadow mode. Its public language must say exactly that.
