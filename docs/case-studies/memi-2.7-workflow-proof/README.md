# Memi 2.7 routed workflow proof

## Release decision

The 2.7 efficiency release gate remains closed.

Three canonical, writable, multi-minute Codex workflow pairs completed against
clean pinned revisions. Every included baseline and Memi run passed its real
build and rendered-product contract at quality 100 with zero defects. The
aggregate release status is `insufficient_evidence`, and the observed metrics
do not support the efficiency claim:

- Mean total-token savings: -23.04%; 95% bootstrap interval -98.33% to 21.90%.
- Mean latency savings: -8.20%; 95% bootstrap interval -49.06% to 23.47%.
- Mean tool-call savings: -51.96%; 95% bootstrap interval -105.88% to -25.00%.
- USD cost: unassessed because the Codex subscription trace exposes no
  defensible per-run dollar cost.

Positive savings mean Memi used less. Negative savings mean Memi regressed.
The aggregate is negative because the Buzzr routed condition used substantially
more context and time. That negative case remains first-class release evidence.

## Canonical cases

| Case | Real product contract | Routed skill | Wall savings | Total-token savings | Uncached-input savings | Tool-call savings | Quality |
|---|---|---|---:|---:|---:|---:|---:|
| DoriOS | Next.js build plus Playwright desktop and mobile keyboard-dialog journeys | `motion-performance` | 1.00% | 7.31% | 39.75% | -105.88% | 100 / 100 |
| Buzzr | Expo web export plus rendered React Native bottom-tab unread badge contract | `react-native-gen` | -49.06% | -98.33% | -40.67% | -25.00% | 100 / 100 |
| Nate the Bait | Xcode build plus real SwiftUI Options journey on pinned iPhone Simulator | `swiftui-design-engineering` | 23.47% | 21.90% | 37.58% | -25.00% | 100 / 100 |

Nate demonstrates a bounded real benefit: the routed run was 98.8 seconds
faster and used 547,691 fewer input tokens while producing the same accepted
native result. Dori demonstrates lower uncached discovery and reasoning with
similar elapsed time, but more tool calls. Buzzr demonstrates that one relevant
skill can still make an agent slower and more expensive. Routing relevance by
itself is not proof of efficiency.

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
  --experiments 'dori-atlas-shortcuts-v5,buzzr-tab-unread-badge-v2,nate-options-reduce-motion-v1' \
  --minimum-pairs 5 \
  --bootstrap-samples 10000 \
  --seed 270729 \
  --target 0.25 \
  --store-root /Volumes/ExtremeSSD/Projects/_benchmarks/memi-2.7-results/workflow-pilot \
  --out /Volumes/ExtremeSSD/Projects/_benchmarks/memi-2.7-results/workflow-pilot/canonical-workflow-report.json \
  --json
```

The report SHA-256 is
`a3fdcd2393c4b8c28b65be3560aef655eb4cc7d21c614d58dc528ae24fe8f413`.
Raw prompts, provider streams, patches, preparation receipts, verification
logs, events, routes, and run records remain in the external evidence root.

## What unlocks 2.7

The release claim does not unlock from these three pairs. A publishable claim
requires:

1. At least five canonical revision-matched pairs.
2. Repeats sufficient to separate routing effects from run variance.
3. Token and latency lower 95% confidence bounds above 25%.
4. No worse pass rate, defects, or human interventions.
5. A live second-provider pair after Claude authentication is repaired.
6. Defensible price evidence before making a USD cost claim.

Until then the truthful position is:

> Memi gives coding agents repository-specific design intelligence, and every
> efficiency claim comes with a reproducible trace showing exactly where the
> tokens, time, and errors were removed or added.

## Candidate verification

- Full suite: 282 files, 2,018 tests passed.
- Focused router and workflow coverage: 80.25% statements, 82.92% lines,
  81.15% functions, and 73.51% branches across the new critical modules.
- Whole-repository coverage: 64.59% statements, 66.30% lines, 72.76%
  functions, and 53.41% branches.
- Production dependency audit: zero vulnerabilities.
- Candidate tarball: 557,380 bytes compressed, 1,976,940 bytes unpacked,
  50 files before the coverage-provider manifest update.
- Release consistency: passed locally.

The whole-repository coverage result is below the project's stated 80% target.
This is an independent release blocker even though the new routing and workflow
surface clears 80% statement, line, and function coverage.
