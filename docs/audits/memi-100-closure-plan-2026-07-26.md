# Memi 100/100 closure plan

Evidence baseline: 2026-07-26

Current verified score: 69/100

Raw passed points before caps: 85/100

Engineering-only ceiling before the time-bound adoption criterion: 95/100

Absolute earliest possible adoption close if a valid eight-week window began on
2026-07-26: 2026-09-20. The real close date is eight weeks after Phase 1 clears
and the fixed measurement definitions are live, so it may be later.

Current caps:

- `public-version-drift` caps the score at 69.
- `hosted-ci-incomplete` caps the score at 84.

## Current execution ledger

| Workstream | Repository / PR | Current immutable head | Status | Blocking exit |
|---|---|---|---|---|
| Engine, CLI, MCP, package, Action | `sarveshsea/memi` PR 73 | `ccb2971c87285413443e0e98996bfb17a87209d4` | Local 1,820-test suite and all three hosted workflows pass | Review, merge, publish a verified successor to immutable npm 2.6.2 |
| Public website | `sarveshsea/memoire-web` PR 20 | `ed746daedfdde52b7d8cdb326c9db29560fdbaa6` | Local unit/build/size/Chromium proof and Vercel preview pass | GitHub-hosted job is blocked before startup by account billing or spending limits; then review, merge, and deploy |
| Canonical shader skills | `sarveshsea/design-skills` PR 5 | `58b0c9a9abc20fbc91c01e9b6c2736e466446dbc` | Hosted checks pass; 45/45 routing with 6/6 negative abstentions | Review, merge, publish/install proof |
| WebGL2 shader lab | `sarveshsea/design-sandbox` PR 2 | `65bd7efdd20af4d38474b3de80703e364df2d580` | Checks pass; isolated lab and blocking proof workflow exist | Review, merge, deploy, and capture durable cross-browser/rendering evidence |

Hosted engine evidence:

- CI: <https://github.com/sarveshsea/memi/actions/runs/30226226769>
- Clean install compatibility: <https://github.com/sarveshsea/memi/actions/runs/30226226789>
- HOL Plugin Scanner: <https://github.com/sarveshsea/memi/actions/runs/30226226773>

Website blocker evidence:

- Failed-before-start workflow:
  <https://github.com/sarveshsea/memoire-web/actions/runs/30225897481>
- GitHub annotation: “The job was not started because recent account payments
  have failed or your spending limit needs to be increased.”

The engine runs prove the engine candidate. They do not clear the separate
website hosted-CI cap.

Current unassessed criteria:

- `surface-parity/public-release-parity`
- `design-engineering-depth/swiftui-rendered-rerun`
- `shader-and-dither/durable-rendering-evidence`
- `security-privacy-licensing/complete-supply-chain-proof`
- `growth-and-community-proof/eight-week-adoption`
- `testing-and-operations/aggregate-clean-room-release`

## Non-negotiable rule

Memi cannot truthfully claim 100/100 until every active cap is cleared and every unassessed criterion is replaced with independent evidence. The adoption criterion also requires elapsed time. No documentation rewrite or local test pass can substitute for that calendar-bound proof.

## What blocks 100 today

1. Public release truth is still split across old `2.5.x` docs, current `2.6.2` engine releases, `2.5.0` Studio assets, and a separate website repository.
2. The website hosted GitHub workflow has not executed because of account billing or spending limits, so the hosted proof cap remains active.
3. The scorecard still has six unassessed criteria, each worth real points.
4. The growth criterion requires eight weeks of verified external behavior and cannot be compressed into one release day.

## Required sequence

### Phase 0: Truth reset across public surfaces

Goal: remove stale release claims so the repo expresses one current public story.

Required work:

- Update release and launch docs that still describe `2.5.x` as current.
- Reconcile `release-manifest.json`, release docs, website handoff docs, GitHub Action docs, and launch copy with the actual released engine line and the current Studio line.
- Keep historical launch docs historical; do not silently rewrite dated records that are meant to stay archival. Instead, clearly mark them as historical or move current operating truth into one canonical location.

Primary files already showing drift:

- [docs/RELEASE_GATES.md](../RELEASE_GATES.md)
- [docs/LAUNCH.md](../LAUNCH.md)
- [docs/SITE_HANDOFF.md](../SITE_HANDOFF.md)
- [docs/GITHUB_ACTION_MARKETPLACE.md](../GITHUB_ACTION_MARKETPLACE.md)
- [docs/METRICS.md](../METRICS.md)
- [release-manifest.json](../../release-manifest.json)

Exit evidence:

- `rg -n "2\\.4\\.0|2\\.5\\.0|2\\.5\\.x" docs README.md release-manifest.json action.yml server.json` returns only intentionally historical references.
- `npm run sync:release-manifest`
- `npm run check:release-manifest`
- `npm run check:release`

Why first: `public-version-drift` cannot clear while the repo itself still contains contradictory public guidance.

Current state: source-side truth repair is implemented on the engine and website
candidate branches. The phase remains open until those changes are reviewed,
merged, published, deployed, and verified against live URLs.

### Phase 1: Clear the active score caps

Goal: move from capped 69 to uncapped technical scoring.

#### Cap 1: `public-version-drift`

Required evidence:

- Reviewed candidate branches are merged.
- npm, GitHub release, MCP metadata, package docs, action defaults, and website artifact all match one verified release manifest.
- The public website repository has consumed the exact generated release artifact and passed its public-release gate.

Exit evidence:

- Live GitHub release URL resolves to the same version and commit recorded in the manifest.
- `npm view @memi-design/cli version dist-tags.latest mcpName --json`
- `npm run check:public-release`
- Website repository proof that `src/data/memi-release.generated.json` matches the generated artifact and its SHA-256 check.

#### Cap 2: `hosted-ci-incomplete`

Required evidence:

- Resolve the billing or spending-limit blocker on the website repository.
- Re-run the hosted GitHub workflow that previously never started.
- Capture the successful run URL in the scorecard evidence ledger.

Exit evidence:

- Hosted workflow run URL with terminal success.
- Check annotations show no blocked startup state.
- Scorecard cap state changes from `active` to `cleared` with clearing evidence IDs.

Current state: engine hosted CI is green. Website run `30225897481` failed before
executing steps with the same billing/spending annotation, so this cap remains
active and is not a code failure.

Why second: until both caps clear, no rescore can exceed 84 regardless of technical quality.

### Phase 2: Close the remaining unassessed criteria

Goal: convert every remaining point into independent evidence.

#### 1. `core-activation/external-clean-repositories` (+2)

Requirement:

- Run the pinned read-only audit on three external clean repositories.
- Each run must prove one of:
  - useful file-anchored findings, or
  - a truthful unsupported-state result with no mutation.

Acceptable evidence:

- Fresh clean checkouts.
- Before and after `git status --short`.
- Saved JSON or markdown audit artifacts.
- Command transcript showing no writes.

Minimum bar:

- At least one web repository.
- At least one Apple or SwiftUI repository.
- At least one repository outside the Memi-maintained set.

Current state: passed for the candidate. Three fresh checkouts stayed clean.
The web repository returned file-anchored findings, the SwiftUI repository
returned partial-coverage findings without a whole-category score, and the
non-UI negative control returned an explicit zero-score unassessed result.
See `memi-external-clean-repositories-2026-07-26.json`.

#### 2. `surface-parity/public-release-parity` (+4)

Requirement:

- All public surfaces match one verified release manifest.

Acceptable evidence:

- Current npm metadata.
- Current GitHub release.
- Current website deploy.
- Current action documentation and defaults.
- Current MCP metadata.

Failure condition:

- Any public surface still advertises a stale engine line or conflicting install path.

#### 3. `design-engineering-depth/swiftui-rendered-rerun` (+2)

Requirement:

- Use real SwiftUI source that Memi can actually scan.
- Produce an initial audit with file-anchored findings.
- Apply or document a concrete correction.
- Capture rendered before and after evidence.
- Re-run the audit and show improvement or an evidence-backed pass.

Acceptable evidence:

- SwiftUI files included in `scannedFiles`.
- Simulator launch proof.
- Screenshots or video with analyzed changes, not only generation.
- Audit rerun artifact tied to the same source revision.

Failure condition:

- A nominal score with `scannedFiles: 0`.

#### 4. `skill-governance/zero-routing-gaps` (+1)

Requirement:

- Resolve the known held-out routing confusion that remained in the 44/45 benchmark.
- Re-run the held-out benchmark and show no known routing ambiguity in the covered set.

Acceptable evidence:

- Updated benchmark artifact.
- Prompt set and result summary checked into canonical audit output.
- Explicit negative controls that still abstain correctly.

Minimum bar:

- 45/45 on the current benchmark or a stronger replacement benchmark with no known unresolved confusion.

Current state: passed. Commit
`58b0c9a9abc20fbc91c01e9b6c2736e466446dbc` requires and achieves 45/45,
preserves the original WGSL WebGPU prompt, and keeps all six negative controls
abstaining. Hosted run `30226100966` passed.

#### 5. `shader-and-dither/durable-rendering-evidence` (+2)

Requirement:

- Prove the shader lab beyond functional correctness.
- Record durable evidence for frame behavior, temporal stability, fallback behavior, and color or alpha correctness across a defined browser matrix.

Acceptable evidence:

- Deterministic screenshot or video comparisons across at least Chromium and WebKit.
- Reduced-motion run.
- WebGL unavailable fallback run.
- Captured frame-timing methodology on named hardware.
- Explicit notes for what remains unsupported if wide-gamut or power metrics are not in scope.

Failure condition:

- Local observation without a durable artifact.

#### 6. `security-privacy-licensing/complete-supply-chain-proof` (+1)

Requirement:

- Produce a complete supply-chain verification set, not only dependency cleanup.

Acceptable evidence:

- SBOM or equivalent locked inventory for the published package.
- Provenance or reproducibility proof for the published artifact.
- Current dependency advisory scan policy and result.
- Workflow least-privilege review.
- Independent reviewer signoff on archive, network, publisher, and licensing boundaries.

Candidate preparation now present:

- Commit `e3789ce6` makes the main-branch npm workflow OIDC-only, generates and
  uploads a CycloneDX SBOM, publishes with npm provenance, validates the
  registry signature and artifact integrity, binds the SLSA statement to the
  exact package digest/repository/workflow/ref/commit, and runs npm's
  signature-and-attestation verifier in a clean consumer.
- This is implementation evidence only. The criterion remains `unassessed`
  until a successor npm release runs that workflow successfully and an
  independent reviewer verifies the resulting public tarball, SBOM,
  attestation, advisory result, publisher boundary, and licensing boundary.

Failure condition:

- Relying only on `npm audit` and prior manual review notes.
- Awarding the point from a locally generated SBOM or historical package
  signature without public SLSA provenance.

#### 7. `growth-and-community-proof/eight-week-adoption` (+5)

Requirement:

- Ten verified external repository integrations.
- One hundred successful first audits.
- Twenty-five repeat audits in 7 to 21 days.
- Four consecutive non-release weeks with median daily npm downloads at least 24.

Acceptable evidence:

- Public integrations.
- Opted-in reports.
- Action runs.
- skills.sh install evidence.
- Release-normalized npm download ledger.

Important constraint:

- This criterion is time-bound. The earliest truthful completion date is eight measured weeks after the growth loop starts collecting evidence under the published definitions.

#### 8. `testing-and-operations/aggregate-clean-room-release` (+1)

Requirement:

- Run the full aggregate public-release path, not only isolated pieces.

Candidate preparation now present:

- The public-release gate now records registry, site, and `installSmoke` stages
  independently unless explicitly skipped. A network or runtime exception is
  converted into structured failure evidence without hiding the other stages.
- Targeted release-gate tests pass for this behavior, and a live diagnostic run
  confirms the JSON payload now contains both `siteSmoke` and `installSmoke`
  instead of leaving the install stage null behind the first failure.
- This is still implementation evidence only. The point remains `unassessed`
  until one full public-release run passes end to end against the actual public
  surfaces.

Acceptable evidence:

- Aggregate `npm run check:public-release` success including install smoke.
- Clean-room install on supported environments.
- Rollback notes verified against the current release process.
- Package size headroom still inside budget.

Failure condition:

- Reporting isolated `SKIP_SITE_SMOKE=1` success as if the aggregate gate passed.

### Phase 3: Growth execution loop

Goal: create the only evidence that can unlock the adoption points.

Weekly operating loop:

1. Publish one focused external proof at a time.
2. Measure qualified visit to first audit to repeat audit.
3. Review only non-release download weeks against the baseline median of 19 and the threshold of 24.
4. Log integrations and repeats with public or explicitly opted-in evidence.
5. Do not change the core product story during the four-week npm measurement window unless a blocking defect forces it.

This phase has a calendar dependency. It should start immediately after Phase 1 clears public truth and hosted CI so traffic and audit evidence are not collected against stale public copy.

Measurement lock:

- Publish a timestamped kickoff ledger before counting any event.
- Freeze the definitions of qualified visit, successful first audit, external
  integration, repeat audit, release week, and non-release week for the window.
- Count public evidence or explicit opt-in evidence only.
- Deduplicate repository and actor evidence without storing private source.
- Record exclusions and corrections append-only.
- Do not backfill pre-kickoff activity into the eight-week result.

### Phase 4: Final rescore and independent closeout

Goal: prove 100/100 rather than merely stop finding gaps.

Required evidence set:

- Updated [docs/audits/memi-design-engineering-audit-2026-07-26.json](./memi-design-engineering-audit-2026-07-26.json) or a superseding dated audit ledger.
- Updated [docs/audits/memi-100-scorecard.json](./memi-100-scorecard.json) with:
  - zero active caps
  - zero unassessed criteria
  - independent clearing evidence IDs for every formerly capped or unassessed item
- Regenerated markdown scorecard from the JSON source.
- Independent review of the final evidence package.

Final acceptance rule:

- If any criterion still says `unassessed`, any cap is still `active`, any public surface is stale, or the eight-week adoption proof is incomplete, Memi is not yet 100/100.

## Closure progress recorded July 27, 2026

- The SwiftUI rendered-rerun criterion is closed with a real source audit,
  reduced-motion correction, simulator rendering, runtime accessibility action,
  clean rerun, hosted validation, and independent review.
- The shader proof now has real Apple M3 Pro GPU timer evidence, opaque-alpha
  and sRGB diagnostics, deterministic frame hashes, Chromium and WebKit hosted
  runs, successful artifact retention, source-commit ancestry validation, and
  independent approval. See
  [memi-shader-rendering-evidence-2026-07-27.json](./memi-shader-rendering-evidence-2026-07-27.json).
- The shader criterion remains `unassessed`, not partially scored. Power
  consumption is blocked because Xcode Power Profiler is unsupported on macOS
  and `powermetrics` requires superuser access. Wide-gamut accuracy remains
  pending because the verified drawing buffer is sRGB and no calibrated
  Display P3 capture path has been proven.
- Candidate SBOM and policy evidence is recorded, but complete supply-chain
  proof still requires a public successor npm release with trusted-publisher
  provenance and independent public-artifact review.
- The raw score remains 87/100 and the verified score remains capped at 69/100.

## Recommended next three workstreams

1. Website billing and hosted-CI unblock, followed by reviewed merge, publish,
   deploy, and live release parity so both caps can clear.
2. Complete the shader power and wide-gamut evidence on supported calibrated
   hardware without privileged shortcuts or inferred passes.
3. Publish and independently verify the successor npm release, then run the
   aggregate clean-room public-release gate.

## Critical path and stop rules

1. Review and merge the four candidate PRs only after their repository-specific
   required checks pass. A green Vercel preview is not a substitute for the
   blocked website GitHub workflow.
2. Cut the next engine version from the reviewed merge commit. Never move or
   rewrite the historical `v2.6.2` tag or npm artifact.
3. Publish npm, GitHub release, Action metadata, MCP metadata, and the generated
   website release artifact from that same release manifest.
4. Deploy the website and shader lab, then run public parity and clean-room
   install gates from fresh directories.
5. Close the remaining five non-adoption unknowns with independently reviewed
   artifacts.
6. Start the eight-week adoption clock only after public parity is green.
7. Perform a fresh final audit from public state, not from a feature branch.

Stop immediately and keep the applicable criterion unassessed when:

- an evidence artifact cannot be tied to a commit and environment;
- a clean-room test uses an unpublished local package by accident;
- a rendered proof has zero scanned source files or only fixture evidence;
- a workflow did not start;
- a public surface differs from the release manifest;
- a result relies on covert telemetry, private repository contents, or an
  unverified self-report;
- an independent reviewer cannot reproduce the claimed result.

## Fastest possible honest timeline

- Same day: finish the closure plan, fix repo truth drift, and line up hosted CI reruns.
- Short term: close the technical unassessed items that do not depend on elapsed time.
- Minimum calendar time for 100/100: eight measured weeks after the growth loop begins collecting valid public evidence.
