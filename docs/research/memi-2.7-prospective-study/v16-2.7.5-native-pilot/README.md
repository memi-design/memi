# Memi 2.7.5 native-evidence pilot and confirmatory protocol

Status: preregistration draft. This directory contains no outcomes and does not
support a quality, speed, or cost claim.

V16 closes the known V15 evidence gaps before a new study begins. Every admitted
cell must have an exact candidate artifact, immutable fixture revision, a fresh
post-patch verification clone, and a V2 evidence receipt. The receipt is only
admitted when its native captures and measured billing files are copied from a
bounded source root, individually hashed, and included in the cell manifest.

## What would make a claim supported

The prior paper's two "not supported" rows are not a verdict that Memi is
worse. They mean the available data could not distinguish a real improvement
from chance, task variation, missing native rendering, or unobserved billing.
V16 treats each statement as a separate gate:

| Statement a reader might make | Current status | Evidence that can support it |
| --- | --- | --- |
| "Memi preserves design quality on these tasks" | Not yet re-tested natively | Six complete native matched pairs per fixture, blinded-quality non-inferiority gate, and no unreported exclusions |
| "Memi is better on a named task" | Not supported | The corresponding preregistered superiority analysis passes after the quality gate; a pooled average alone never suffices |
| "Memi is faster" | Not supported | All admitted pairs retain comparable adapter and verifier wall times, with the corrected task-level secondary test passing |
| "Memi is cheaper in USD" | Not measured | Per-cell provider usage exports or invoice allocations plus immutable price cards, followed by the preregistered cost analysis |
| "Memi produces professionally better frontend work" | Not established | The native evidence above plus blinded practitioner grading; model graders alone are explicitly insufficient |

The engineering gates already implemented are narrower but real: V2 receipts
require the native capture and billing files, manifests seal every declared
file, fresh capture roots reject stale artifacts, preflight refuses dirty or
wrong-origin fixture repositories, and it can emit a hash-verified attestation.
Those controls improve whether the next data are trustworthy; they do not turn
the old data into positive evidence.

## Two-stage execution

1. **Capture-calibration pilot.** Run one matched baseline/Memi pair on each
   platform. It proves the collector can capture the declared states and that
   the blind packet is usable. Pilot cells are marked `calibration` and are
   excluded from every confirmatory statistic, regardless of outcome.
2. **Confirmatory study.** After the pilot’s capture and billing receipts pass
   independent audit, freeze a new V16 confirmatory receipt and run six matched
   pairs for each of Buzzr/Expo, Paraform/web, and Nate/SwiftUI (18 pairs / 36
   agent cells), serially. No cell is replaced, imputed, or silently retried.

## Native capture contract

Each task manifest's `nativeCaptures` entries execute only in the isolated
post-patch verification clone. Their `sourcePath` and `artifactName` are the
same single filename and must exactly match the V2 receipt draft. The runner
rejects stale files before provider invocation, runs each collector after all
functional verification passes, copies only regular files to the supplied
capture root, and records command output in `native-capture.json`.

Required capture kinds for every cell:

| Platform | Screenshot | Interaction trace | Accessibility artifact |
| --- | --- | --- | --- |
| Web | Playwright screenshot at frozen desktop and phone viewports | Playwright trace of the task journey | axe results plus serialized accessibility tree |
| Expo | `xcrun simctl io <UDID> screenshot` from a reset Simulator | Detox/Maestro or equivalent deterministic journey log | collector-produced React Native accessibility-tree JSON |
| SwiftUI | `xcrun simctl io <UDID> screenshot` from a reset Simulator | XCUITest journey result/trace | XCTest `XCUIApplication` element snapshot/debug hierarchy |

The platform collector command belongs in the task manifest, not in a shell
history. It must write its declared filename in the isolated verification clone
and exit nonzero on launch, interaction, or capture failure. For mobile cells,
the Simulator is erased/reset and receives exclusive machine access before each
pair; no host screenshots are admissible.

## Measured billing contract

Before each cell, the operator places a provider usage export and the immutable
price-card or invoice-allocation document in that cell's empty capture root.
The source must identify the run/window and report USD; token-based estimates,
subscription assumptions, and manually typed dollar figures are not admissible.
The native collectors then populate the three fresh capture files in the same
root. The receipt draft must use only those five files.

## Confirmatory decision rules

- Primary outcome: blinded paired design-quality score on the preregistered
  100-point rubric.
- Quality non-inferiority: one-sided 95% paired-bootstrap lower bound above
  -5 points within each fixture. Superiority is evaluated separately and is
  never inferred from non-inferiority.
- Secondary outcomes: functional acceptance, critical defects, input/output/
  reasoning tokens, adapter wall time, verifier time, tool calls, retries,
  provider failures, and measured USD cost.
- Use task-level paired mean/median, exact sign tests, 10,000 paired bootstrap
  samples, leave-one-pair-out sensitivity, and Holm correction for secondary
  tests. Pooled cross-platform summaries remain descriptive.
- Three blinded model graders may be reported as model-graded evidence.
  Independent practitioner/human grading is required for an independent
  professional-design claim.
- A route or release may not promote an automation-only result. The 2.7.5
  fitness policy remains fail-closed until exact-route, blinded-quality evidence
  meets its prospective recovery rule.

## Run sequence

1. Build and hash the exact candidate tarball; record its source commit and
   clean/dirtied snapshot state.
2. Pin each fixture at its commit and run the platform-specific preflight.
3. Create a fresh, empty per-cell capture root. Add the two billing files.
4. Freeze the protocol, environment, task-manifest hashes, candidate hash, and
   counterbalanced trial matrix before the first scored provider invocation.
5. Invoke `memi benchmark workflow-run` with `--freeze`, `--trial`,
   `--evidence-draft`, and `--artifact-root`. The command fails before provider
   use when the V2 draft, task collectors, or freshness boundary do not match.
6. Run `memi benchmark prospective-evaluate` over the immutable run store. A
   cell is excluded on any manifest, hash, capture, binding, or billing defect.
7. Generate blinded packets only from admitted cells. Preserve all rejected
   cells and their reasons in the deviations ledger.

The accompanying [protocol.json](protocol.json) is the source-of-record plan;
it remains a draft until it includes the exact candidate SHA-256 and verified
fixture revisions.

The current [preflight audit](preflight-audit.json) records the observed local
fixture revisions and the remaining freeze prerequisites. It is a readiness
ledger, not a study result.
