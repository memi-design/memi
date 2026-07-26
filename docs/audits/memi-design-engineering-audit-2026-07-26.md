# Memi Design Engineering, Adoption, and Shader Audit

Evidence date: 2026-07-26

## Verdict

**Kickoff public baseline: 47/100, blocked.**

**Verified implementation candidate: 82/100, launchable with caveats.**

The 82/100 score is not the current public score. It belongs to reviewed candidate branches and the merged evaluation fork. The exact 2.6.2 release tag and fork integration were completed after the kickoff snapshot, but partial remediation is not silently folded into a new score. Until a complete post-deployment rescore, 47/100 remains the last fully assessed public snapshot.

The baseline score is capped at 69 for public version and product-story drift. The source checkout's baseline lockfile did contain a high-severity production advisory, but a separate clean install of the published 2.6.2 package returned zero high and critical advisories. The stricter 49-point public-package security cap therefore does not apply.

## Why Stars and Downloads Are Not Converting

The evidence supports a proof and activation problem more strongly than an awareness problem:

1. **The public funnel was disconnected.** GitHub recorded 98 unique visitors and 177 unique cloners in the captured 14-day window, but `memoire.cv` produced only one referral.
2. **The first action was unclear.** The public website led with Studio while the most trustworthy product wedge was already the pinned, read-only CLI audit.
3. **Versions drifted.** At kickoff, npm and `origin/main` were 2.6.2, the latest GitHub release was 2.6.1, and public pages still contained 2.4.0 and `@memi-design/cli@2.5.0`. The exact `v2.6.2` tag and release were restored during this audit after verifying npm `gitHead`.
4. **Release spikes hid retention.** The package recorded 697 downloads in the last complete week and 3,757 in the last year, but download peaks clustered around release dates. The non-release daily median for the measured baseline was 19.
5. **The proof was abstract.** README and CLI breadth asked newcomers to understand many surfaces before seeing one visual before-and-after result.
6. **The scores were too easy to misread.** Static UX and craft reports included unassessed dimensions while aggregate scores still looked strong. A screenshot path could be recorded without being analyzed.
7. **The skill wedge was young and difficult to discover.** The four focused Memi skills had seven combined installs on skills.sh.
8. **The creative-rendering gap was real.** The canonical catalog covered design, motion, SwiftUI, and systems work but had no primary owner for shader engineering or dithering.

Stars and npm downloads are therefore lagging indicators. The operating funnel is now:

`qualified visit → pinned read-only audit → file-anchored result → repeat audit → documented integration`

## 1–100 Score

| Dimension | Maximum | Public baseline | Candidate | Evidence |
| --- | ---: | ---: | ---: | --- |
| Core job, activation, useful first result | 15 | 9 | 13 | Pinned no-write command becomes the first action; audit JSON gains normalized evidence metadata. |
| CLI, MCP, skills, site, Studio, release parity | 15 | 6 | 11 | Candidate centralizes site release data, but it is not deployed and the corrected core is not published. |
| Design-engineering depth and rendered quality | 15 | 9 | 13 | Artifact-backed website proof, WebGL2 lab, and SwiftUI simulator evaluation now exist. |
| Skill governance, routing, freshness, provenance | 15 | 9 | 14 | 94 skills scored; mean 86/100; five-state dispositions; zero duplicate primary routes; 180-day shader freshness gate. |
| Shader, dither, creative rendering | 10 | 1 | 8 | Two canonical skills and an original WebGL2 proof cover ordered/noise dithering, distortion, fallback, and evidence export. |
| Security, privacy, licensing, supply chain | 10 | 3 | 9 | Candidate production audits are zero; fetch, path, archive, publisher, and media-provenance boundaries are hardened. |
| GitHub/npm funnel and community proof | 10 | 3 | 5 | Funnel and measurement are repaired, but external adoption targets are not yet achieved. |
| Testing, compatibility, operations | 10 | 7 | 9 | Core, catalog, site, web proof, simulator build, and independent review gates pass. |
| **Total** | **100** | **47** | **82** | Candidate score remains non-public until release and deployment. |

Machine-readable evidence is in [`memi-design-engineering-audit-2026-07-26.json`](./memi-design-engineering-audit-2026-07-26.json). Its evidence ledger records the capture time, API endpoints, calculation method, and time-bounded values for GitHub, npm, skills.sh, and release provenance.

## Implemented Candidate

### Memi core

- Added additive audit fields while preserving `version: 1`: `schemaVersion`, `confidence`, `assessedDimensions`, `unassessedDimensions`, `evidenceProvenance`, `appliedScoreCaps`, and normalized finding IDs.
- Unanalyzed screenshot-only UX and craft inputs now score zero instead of receiving an optimistic aggregate.
- Added shared private-address classification, including mapped IPv6 and normalized numeric loopback forms.
- Added lexical and realpath containment for registry reads and shadcn sources.
- Added tar and ZIP central-directory validation before extraction, with traversal, link, root, size, and record checks.
- Bound local servers explicitly to loopback.
- Pinned and checksum-verified MCP publisher v1.8.0.
- Removed all known production dependency advisories.
- Replaced the release-spike growth classification with privacy-safe adoption targets.
- Added one canonical release manifest for engine, npm, GitHub release, Action, MCP, Studio, and site groups, plus a deterministic website artifact anchored to immutable core commit provenance.

Core verification:

- 1,763 tests across 233 files.
- Strict typecheck, lint, build, release consistency, Codex plugin smoke, local packed-install smoke, isolated public 2.6.2 install smoke, and `npm audit` pass. The MCP smoke observed 50 tools; its enforced regression floor remains 20 tools plus six named tools.
- Package size: 1,281,175 of the 1,285,000-byte gate.
- Independent security review reproduced the original SSRF, symlink, and ZIP failures, then verified them fail closed after correction.
- The aggregate public-release gate still exits on live docs and changelog drift before its `installSmoke` stage. Its `installSmoke` field remains null; the public install result above comes from a separate site-skipped invocation and is not misreported as an aggregate gate pass.
- A committed clean-install workflow covers Node 20, 22, and 24 on Linux, macOS, and Windows. All nine hosted matrix jobs passed in run `30221969392`, including Node 24 with npm 11 after completing optional native lock metadata.

### Canonical design skills

- Expanded the catalog from 92 to 94 skills.
- Added `shader-design-engineering` and `creative-rendering-audit`, both scoring 100/100 under the catalog rubric.
- Added progressive references for WebGL2/GLSL, WGSL/WebGPU, SwiftUI/Metal, dithering, performance, accessibility, debugging, and audit evidence.
- Routed nine neighboring SwiftUI, motion, animation, color, and design-engineering skills away from shader ambiguity.
- Published a full stocktake:
  - Mean: 86/100.
  - Keep: 14.
  - Improve: 66.
  - Update: 8.
  - Retire after compatibility window: 6 deprecated aliases.
  - Duplicate primary routing intents: 0.
- Implemented concrete `Merge into <canonical>` output for future routing collisions.
- Enforced actual completion timestamps and a 180-day shader-reference freshness gate.

Catalog verification: 33 checks pass under the default parallel command, including an isolated-workspace regression for the former catalog rewrite race. A 45-prompt catalog QA benchmark scores 44/45, or 97.8%, against the 90% gate; all six negative near-misses abstain. The benchmark evaluates catalog metadata and skill descriptions, not Memi runtime routing, and preserves one WGSL ripple/creative-audit confusion instead of hiding it. All 94 skills validate and list through `npx skills@1.5.17`, and the production dependency audit is clean.

### Web shader proof

The isolated `/labs/shaders` route provides:

- Original WebGL2/GLSL ES 3 rendering.
- Ordered Bayer and fixed-seed noise dithering.
- Ripple and distortion controls.
- Original, processed, and Canvas fallback comparison.
- Reduced-motion/static behavior.
- JSON evidence export.
- Explicit Atomic Design ownership for atoms, molecules, organism, and page.
- A WebGPU/WGSL future-adapter boundary without delaying the first proof.

The proof does not copy source or media from The Book of Shaders or LYGIA.

Verified evidence:

- Fifteen unit and workflow-contract tests with 97.98% line, 93.1% branch, and 100% function coverage for the shader contract.
- Four Chromium E2E paths, including reduced-motion and WebGL2-unavailable fallback export.
- Static build, typecheck, lint, and zero-vulnerability production dependency audit.
- A blocking GitHub workflow passed with frozen install, a 90% coverage floor, build, Chromium E2E, and immutable action pins.
- A local M3 Pro run observed browser submission timing against a 16.7 ms budget, but no durable benchmark artifact is checked in, so this observation is not scored as verified GPU performance.
- GPU time, power, and wide-gamut accuracy remain unassessed.

### SwiftUI evaluation fork

The public evaluation fork is [`sarveshsea/ripple-image-transitions`](https://github.com/sarveshsea/ripple-image-transitions).

- The upstream MIT license is preserved byte-for-byte.
- Excluded upstream media was removed or replaced.
- Replacement prompts, tool output IDs, timestamps, dimensions, hashes, and licensing limits are recorded.
- CI rejects the three excluded upstream hashes regardless of filename.
- The Memi Action and CLI are pinned. GitHub permissions are read-only and SARIF upload is disabled; the Action still generates workspace-local report artifacts, so it is not described as a no-write CLI invocation.
- XcodeBuildMCP built and launched the unchanged SwiftUI/Metal implementation with zero structured diagnostics.
- A separate generic `xcodebuild` succeeded with the documented AppIntents metadata warning.
- No upstream issue or PR was opened because Memi 2.6.2 scanned zero SwiftUI files.

The nominal Memi score of 98 is explicitly rejected as design-quality evidence because `scannedFiles` was zero. This is a primary product gap, not a success metric.

### Public website candidate

- Leads with “Memi is the read-only design engineering audit and skill layer for coding agents.”
- Uses one pinned `npx` no-write audit command as the primary CTA.
- Keeps focused-skill, GitHub, npm, and Studio links secondary.
- Centralizes CLI release version, source commit, and public URLs.
- Consumes the generated core release artifact offline and verifies its immutable source commit in CI.
- Live release proof checks the exact Memi 2.6.2 tag and Studio 2.5.0 arm64, x64, and checksum assets.
- Replaces abstract proof with an artifact-backed inspect, find, correct, verify sequence.
- Runs the four proof steps as a 32-second CSS sequence while keeping all text visible.
- Pauses for hover and keyboard focus and becomes completely static under reduced motion.
- Removes all production dependency advisories.

Site verification: 206 unit tests, build, nine local desktop/mobile homepage E2E paths, accessibility checks, brand checks, and production audit pass. The Playwright workflow remains advisory. The July 26 hosted GitHub job did not start because of the account billing/spending gate; its run URL, check-run annotation endpoint, runner ID, and status are preserved in the machine-readable evidence ledger. The Vercel preview completed, but hosted runner proof remains outstanding.

## Reference Policy

| Reference | Policy |
| --- | --- |
| [The Book of Shaders](https://thebookofshaders.com/) | Link-only educational reference. Do not copy or redistribute its prose, shaders, or assets. |
| [LYGIA](https://github.com/patriciogonzalezvivo/lygia) | Learn and link only unless a compatible commercial license is obtained. |
| [ripple-image-transitions](https://github.com/eujinco/ripple-image-transitions) | MIT evaluation fork with preserved attribution and replaced excluded media. |
| [SwiftUI-experiments](https://github.com/mikelikesdesign/SwiftUI-experiments) | Study its focused prototype discipline; no maintained fork. |
| [senior-engineering-partner](https://github.com/bjgreenberg/senior-engineering-partner) | Use progressive-disclosure and evaluation ideas with Apache compliance; no fork. |
| [Inferno](https://github.com/twostraws/Inferno) | Prefer attributed SwiftPM dependency or recipe. |
| [Vortex](https://github.com/twostraws/Vortex) | Prefer attributed dependency or sample. |

Current trend evidence supports the direction:

- [Figma Config 2026](https://www.figma.com/blog/config-2026-recap/) treats code, motion, parameterized shaders, and agent skills as composable design materials.
- [Apple WWDC26](https://developer.apple.com/videos/play/wwdc2026/322/) frames advanced SwiftUI graphics as composable effect pipelines.
- The [Khronos 2026 shader survey](https://www.khronos.org/blog/shader-ecosystem-survey-results-2026) identifies debugging and profiling as the top pain point and cross-platform porting as a majority concern.
- The current [WGSL Candidate Recommendation Draft](https://www.w3.org/TR/WGSL/) keeps the WebGPU adapter path standards-based without making it a first-release dependency.

## Eight-Week Growth Contract

No covert telemetry is added.

| Outcome | Target | Baseline |
| --- | ---: | ---: |
| Verified external repository integrations | 10 | 1 evaluation fork |
| Successful first audits | 100 | Not yet measured consistently |
| Repeat audits within 7–21 days | 25 | Not yet measured consistently |
| Sustained non-release npm baseline | +25% for four weeks | 19 median daily downloads; target 24 |

A successful first audit requires a completed external run and either a file-anchored finding or an explicit evidence-backed pass. Public integrations, visible Action runs, skills.sh installs, release-normalized npm data, and explicitly opted-in reports are acceptable evidence.

## Remaining Release Gates

1. Merge and publish the hardened Memi core candidate as a new verified version. The missing `v2.6.2` release was restored at the exact npm `gitHead`; the immutable npm artifact was not changed.
2. Merge and deploy the website candidate, then verify the live first-fold command, version parity, referrals, and reduced-motion behavior.
3. Merge the canonical skill and shader-lab branches.
4. Keep the reviewed ripple integration on the fork’s default branch and use its first real Action run as the next public integration proof.
5. Add real SwiftUI source and rendered-evidence coverage before marketing SwiftUI audit quality.
6. Collect eight weeks of adoption evidence before claiming the growth targets are achieved.
7. Keep dev-only legacy-tool advisories visible until their upstream module chains can be upgraded without API breakage.
8. Resolve the GitHub account billing/spending gate and rerun website CI before treating hosted verification as green.
9. Merge both release-manifest PRs before declaring cross-repository public parity complete.

## Branch Evidence

| Surface | Branch | Reviewed state |
| --- | --- | --- |
| Memi core | `codex/memi-design-engineering-audit` | Core and follow-up security review approved |
| Canonical skills | `codex/shader-design-engineering` | Stocktake and licensing follow-up approved |
| Shader lab | `codex/shader-design-lab` | Rendered proof complete; final renderer-evidence review approved |
| Public website | `codex/memi-design-engineering-audit` | Artifact proof and production-security review approved |
| SwiftUI fork | `codex/memi-design-audit-integration` | Merged to the fork's `main`; provenance and hash-gate follow-up approved |
