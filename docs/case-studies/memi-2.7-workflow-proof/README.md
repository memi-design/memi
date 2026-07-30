# Memi 2.7 routed workflow proof

## Release decision

The five-pair evidence gate is complete. The greater-than-25% efficiency claim
and the 2.7 publish gate remain closed.

Five canonical, writable, multi-minute Codex workflow pairs completed against
clean pinned revisions. Every included baseline and Memi run passed its real
build and rendered-product contract with zero detected acceptance defects. The
aggregate evidence status is `verified`, while the claim is `not_verified`:

- Mean total-token savings: 0.55%; 95% bootstrap interval -51.23% to 37.30%.
- Mean latency savings: 5.66%; 95% bootstrap interval -24.30% to 25.86%.
- Mean tool-call savings: -15.69%; 95% bootstrap interval -61.86% to 28.14%.
- USD cost: unassessed because the Codex subscription trace exposes no
  defensible per-run dollar cost.

Positive savings mean Memi used less. Negative savings mean Memi regressed.
Strong Paraform and positive dorii results offset some of Buzzr's regression,
but the aggregate remains too small and uncertain to support a universal
efficiency claim. The negative case remains first-class release evidence.

## Canonical cases

| Case | Real product contract | Routed skill | Wall savings | Total-token savings | Uncached-input savings | Tool-call savings | Quality |
|---|---|---|---:|---:|---:|---:|---:|
| DoriOS | Next.js build plus Playwright desktop and mobile keyboard-dialog journeys | `motion-performance` | 1.00% | 7.31% | 39.75% | -105.88% | Automated acceptance passed |
| Buzzr | Expo web export plus rendered React Native bottom-tab unread badge contract | `react-native-gen` | -49.06% | -98.33% | -40.67% | -25.00% | Automated acceptance passed |
| Nate the Bait | Xcode build plus real SwiftUI Options journey on pinned iPhone Simulator | `swiftui-design-engineering` | 23.47% | 21.90% | 37.58% | -25.00% | Automated acceptance passed |
| Paraform | Vite production build plus recruiter command-menu keyboard and reduced-motion journeys | `emil-design-eng` + `interaction-design` | 28.26% | 52.43% | 26.98% | 44.12% | Automated acceptance passed |
| dorii public site | Next.js production build plus mobile navigation, route, focus, and reduced-motion journeys | `emil-design-eng` + `interaction-design` | 24.65% | 19.43% | 20.68% | 33.33% | Automated acceptance passed |

### Buzzr Router v2 calibration

Post-canonical traces tested progressively narrower Expo routing without
rewriting the original negative case:

| Configuration | Context | Wall savings | Total-token savings | Tool-call savings | Quality |
|---|---:|---:|---:|---:|---:|
| Two repository-matched skills | 3,797 bytes | -4.35% | -11.11% | -5.26% | Automated acceptance passed |
| Exclusive Expo skill | 1,920 bytes | -57.68% | -65.54% | -16.67% | Automated acceptance passed |
| Exclusive Expo skill plus execution budget | 1,429 bytes | 25.08% | 14.15% | -57.89% | Automated acceptance passed |

The third configuration is a real improvement in tokens and time, but not a
release proof. Trace comparison showed that the earlier routed agent broadened
repository discovery and ran full-suite and extra-platform checks beyond the
task contract. Router v2 now states that the task manifest and closest
repository evidence are authoritative, and the Expo skill forbids broad
inventory or extra verification unless a concrete failure identifies that
boundary.

The three rows are different router configurations, not homogeneous repeats,
so they must not be averaged into a confidence claim. Both negative
configurations remain in the immutable run store. Content-addressed fitness
events recommend `observe` for both Expo skill revisions until each revision
has sufficient repeated evidence.

The isolated calibration report has SHA-256
`0abdaa3dbbe4b3556e4b801e1143befe4f4f294d70b2985e83f4d39dc09aedd0`.
It includes exactly one environment-matched pair, reports the claim as
`not_verified`, and leaves subscription USD cost unassessed.

### Why more tool calls can still be better

Tool-call count is a diagnostic, not a release gate. A narrow file read and a
large repository scan each count as one call, even though their token cost,
latency, and risk are different. Optimizing the raw count can therefore
encourage agents to load more context than they need.

The privacy-safe profile of the latest Buzzr pair found:

| Phase or category | Baseline | Memi |
|---|---:|---:|
| Total calls | 19 | 30 |
| Calls before the first edit | 6 | 18 |
| Calls after the first edit | 13 | 12 |
| Search calls | 4 | 8 |
| Read calls | 5 | 15 |
| Verification calls | 8 | 5 |
| Status calls | 2 | 2 |
| Batched-read calls | 8 | 3 |
| Repeated verification calls | 3 | 2 |

This separates observation from interpretation:

1. **Observed:** Memi made 11 more calls, almost entirely before the first edit.
   It used 10 more read calls and 4 more search calls, but 3 fewer verification
   calls.
2. **Observed:** The same Memi run used 14.15% fewer counted tokens, completed
   25.08% faster, reduced retries from 3 to 2, and retained automated
   acceptance.
3. **Interpretation:** the additional calls were narrower discovery steps. They
   increased call count without increasing total token consumption or elapsed
   time.
4. **Decision:** preserve those calls when they reduce cost, time, or
   uncertainty. Continue to batch related reads when doing so is cheaper, but
   never impose an arbitrary tool-call ceiling.
5. **Limitation:** the subscription trace does not expose defensible billed USD.
   “Cheaper” in this pair means the same model consumed fewer input, output, and
   reasoning tokens. It is a token-cost proxy, not a dollar invoice.

The machine-readable analysis is in
[tool-call-analysis.json](tool-call-analysis.json). Future workflow runs emit a
`tool-profile.json` beside the patch, verification, events, and provider logs.
The profile records only counts, categories, edit phase, repeat counts, and a
SHA-256 sequence commitment. It does not retain commands or file paths.

### Cost-aware decision policy

The evaluator now records its decision basis directly:

- Use paired measured USD cost when every included pair exposes trustworthy
  provider cost evidence.
- Otherwise use total tokens as the explicitly labeled cost proxy.
- Require the selected cost metric, latency, and quality to clear the configured
  confidence threshold.
- Report tool-call savings as `diagnostic_only`; more calls do not fail a run
  that is cheaper, faster, and equally accurate.

The greater-than-25% public claim is still locked. This calibration has one
pair, not enough homogeneous repeats, and the five-case canonical suite still
contains negative cost and latency cases. The new policy clarifies the decision;
it does not convert incomplete evidence into proof.

Paraform demonstrates a concrete stacked-skill benefit: the routed run was
109.3 seconds faster, used 780,622 fewer counted tokens, and made 15 fewer tool
calls while producing the same accepted result. dorii shows a second positive
stacked-skill case across a production mobile web journey. Nate demonstrates a
bounded native benefit. Dori demonstrates lower uncached discovery with similar
elapsed time but more tool calls. Buzzr demonstrates that one relevant skill can
still make an agent slower and more expensive. Routing relevance by itself is
not proof of efficiency.

The immutable JSON records retain their historical `qualityScore: 100` field.
That field meant the automated verification contract passed; it was not a
senior-practitioner score. New workflow records identify the evidence as
`automated_acceptance` and cap it at 80. DesignWorkBench practitioner scoring
remains a separate, blocked gate.

Exact run IDs and metric values are in [results.json](results.json).

## Protocol

- Codex CLI `0.145.0`
- Model `gpt-5.6-sol`
- Reasoning effort `medium`
- One baseline/Memi pair per canonical experiment
- Clean disposable Git clones at pinned revisions
- Identical task, fixture, model, effort, preparation, and verification within
  each pair
- Isolated agent home with personal plugins, skills, memory, and MCP disabled
- Deterministic maximum stack of two skills with an 8 KB skill-resource budget
- Human-readable prompt receipt plus full external routing trace
- Fixtures committed into the disposable baseline and hash-checked after agent
  execution
- Agent patch captured before external verification output can contaminate it
- Real build and rendered-flow or iOS Simulator verification run independently
  after the model
- Counted total tokens: input + output + reasoning
- Bootstrap samples: 10,000
- Seed: 270729
- Canonical experiment allowlist recorded in the report
- Required lower 95% confidence bound: greater than 25% for both tokens and
  latency with no quality regression

## Integrity and adapter evidence

The harness rejected evidence instead of silently repairing it:

1. The first Buzzr attempt passed its product checks but modified the injected
   acceptance fixture. The run was rejected. Both provider prompts now name
   every immutable fixture, and the post-run hash remains authoritative.
2. Earlier Dori iterations exposed an unavailable browser cache, an incorrect
   test assumption, and verification-generated patch contamination. Each trace
   remains immutable. The final case reuses the prepared browser cache, uses
   the corrected product contract, and captures the agent patch before
   verification.
3. Claude Code returned structured `authentication_failed` while exiting zero.
   The adapter now recognizes provider-declared errors, returns a failed
   execution, and skips expensive product verification. The machine's current
   Claude OAuth credential is revoked, so no Claude efficiency pair is claimed.
4. Paraform v1 collided with a pre-existing unrelated local port, and v2
   exposed an invalid accessible-name assumption in the acceptance fixture.
   Both traces remain immutable and excluded. The v3 contract uses a verified
   isolated port and Paraform's actual existing search semantics.

The Claude adapter is implemented and covered by deterministic tests, but live
model-agnostic proof remains blocked until the user reauthenticates Claude Code.

## Reproduction

Build the candidate first:

```bash
npm run build
```

Generate the canonical report from the immutable external run store:

```bash
node dist/index.js benchmark report \
  --suite memi-2.7-workflow-pilot \
  --experiments 'dori-atlas-shortcuts-v5,buzzr-tab-unread-badge-v2,nate-options-reduce-motion-v1,paraform-command-menu-v3,dorii-mobile-navigation-v1' \
  --minimum-pairs 5 \
  --bootstrap-samples 10000 \
  --seed 270729 \
  --target 0.25 \
  --store-root /Volumes/ExtremeSSD/Projects/_benchmarks/memi-2.7-results/workflow-pilot \
  --out /Volumes/ExtremeSSD/Projects/_benchmarks/memi-2.7-results/workflow-pilot/canonical-workflow-report.json \
  --json
```

The report SHA-256 is
`c4565fc818387a45ad04d79f0d7569a4ac866d34c84de504af936422de153fdb`.
Raw prompts, provider streams, patches, preparation receipts, verification
logs, privacy-safe tool profiles, events, routes, and run records remain in the
external evidence root.

## What unlocks 2.7

The five-pair evidence minimum is satisfied. A publishable greater-than-25%
claim still requires:

1. Repeats sufficient to separate routing effects from run variance.
2. Token and latency lower 95% confidence bounds above 25%.
3. No worse pass rate, defects, or human interventions.
4. A live second-provider pair after Claude authentication is repaired.
5. Defensible price evidence before making a USD cost claim.

Until then the truthful position is:

> Memi gives coding agents repository-specific design intelligence, and every
> efficiency claim comes with a reproducible trace showing exactly where the
> tokens, time, and errors were removed or added.

## Candidate verification

- Full suite: 285 files, 2,033 tests passed.
- Cost-aware evaluation, routing receipt, workflow evidence, and tool-profile
  contract: 32 focused tests passed.
- Whole-repository coverage: 64.91% statements, 66.62% lines, 73.11%
  functions, and 53.73% branches.
- Production dependency audit: zero vulnerabilities.
- Candidate tarball: 560 KB compressed and 1.986 MB unpacked, with 48 files
  including all five reproducible workflow manifests. Detailed workflow research
  stays in GitHub instead of inflating every CLI install.
- Release consistency: passed locally.

The whole-repository coverage result is below the project's stated 80% target.
This is an independent release blocker even though the new routing and workflow
surface clears 80% statement, line, and function coverage.
