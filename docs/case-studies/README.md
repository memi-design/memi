# Reproducible Memi case studies

These cases demonstrate the evidence contract, not a marketing percentage. Each
case pins the repository revision, command, evidence boundary, and current
result. Re-run the command before quoting a result because code and tools change.

| Case | Surface | Current proof | Efficiency claim |
|---|---|---|---|
| [Routed workflow proof](memi-2.7-workflow-proof/README.md) | Real Next.js, Expo/React Native, and native SwiftUI product changes | Three protected multi-minute build and rendered-flow pairs | Not verified; Nate positive, Buzzr negative |
| [Six-repository 2.7 study](memi-2.7-six-repo/README.md) | Native, React Native, web, Tauri, and hybrid products | Six isolated revision-matched pairs | Not verified; release blocked |
| [Nate the Bait](nate-the-bait/README.md) | Native SwiftUI and SpriteKit iOS app | Static audit, Apple brief, simulator build, paired trace | 21.7% tokens; 13.6% slower |
| [Buzzr](buzzr/README.md) | Expo and React Native iOS app | Real source design-system map | Token regression |
| [DoriOS](doriios/README.md) | Web, Tauri, native, and visualization surfaces | Real source design-system map | 60.1% tokens; 28.2% faster |
| [Nyra](nyra/README.md) | Patient and clinician product UI | Design-only evidence boundary | Regression |
| [Paraform](paraform/README.md) | Focused React product | Corrected graph and paired trace | 33.3% tokens; 14.3% slower |
| [Nyra Landing](nyra-landing/README.md) | Marketing, docs, blog, and shared chrome | Paired trace | 26.8% tokens; 6.0% faster |
| [Memi self-audit](memi-self-audit/README.md) | TypeScript web and CLI repository | Read-only design audit with explicit coverage | Not measured |
| [Design Skills catalog](design-skills-catalog/README.md) | 94 installable agent skills | 94/94 quality, 154/154 routing prompts | Not measured |

## Claim policy

Memi may report `verified_gt_25` only when at least five revision-matched
baseline/Memi pairs clear both token and latency lower 95% confidence bounds,
while pass rate, defects, and human interventions satisfy the quality guard.
Anything else remains `insufficient_evidence` or `not_verified`.

That rule exists because one fast command, a successful demo, or an npm download
count cannot prove an agent-efficiency improvement.
