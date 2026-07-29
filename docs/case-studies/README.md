# Reproducible Memi case studies

These cases demonstrate the evidence contract, not a marketing percentage. Each
case pins the repository revision, command, evidence boundary, and current
result. Re-run the command before quoting a result because code and tools change.

| Case | Surface | Current proof | Efficiency claim |
|---|---|---|---|
| [Nate the Bait](nate-the-bait/README.md) | Native SwiftUI and SpriteKit iOS app | Static audit, Apple brief, simulator build, paired plan | Insufficient paired evidence |
| [Memi self-audit](memi-self-audit/README.md) | TypeScript web and CLI repository | Read-only design audit with explicit coverage | Not measured |
| [Design Skills catalog](design-skills-catalog/README.md) | 94 installable agent skills | Catalog, routing, provenance, instruction, and coverage gates | Not measured |

## Claim policy

Memi may report `verified_gt_25` only when at least five revision-matched
baseline/Memi pairs clear both token and latency lower 95% confidence bounds,
while pass rate, defects, and human interventions satisfy the quality guard.
Anything else remains `insufficient_evidence` or `not_verified`.

That rule exists because one fast command, a successful demo, or an npm download
count cannot prove an agent-efficiency improvement.
