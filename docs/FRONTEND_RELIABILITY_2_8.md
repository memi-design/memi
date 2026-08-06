# Memi 2.8 frontend reliability preview

Memi 2.8 is a development program for bounded frontend execution and
fail-closed evidence. It is not yet a published quality, speed, token, or cost
claim. The release remains gated on the frozen V18 study.

## Contracted compose execution

Create a `FrontendTaskContractV1` before a measured frontend run:

```json
{
  "schemaVersion": "frontend-task-contract.v1",
  "taskId": "settings-responsive-layout",
  "taskClass": "responsive-layout",
  "platform": "web",
  "intent": "Make the settings panel responsive",
  "targetFiles": ["src/SettingsPanel.tsx"],
  "targetComponents": ["SettingsPanel"],
  "requiredStates": ["desktop", "mobile", "keyboard", "reduced-motion"],
  "constraints": ["Preserve current behavior and design tokens"],
  "verificationCommands": ["npm run typecheck", "npm run test:e2e"],
  "resourceCeilings": {
    "inputTokens": 10000,
    "outputTokens": 2000,
    "reasoningTokens": 2000,
    "wallTimeMs": 120000,
    "toolCalls": 20,
    "implementationAttempts": 2
  },
  "contextExpansion": { "state": "unused" }
}
```

Run the contract with an explicit budget and routing policy:

```bash
memi compose "Make the settings panel responsive" \
  --task-contract ./task-contract.json \
  --budget-profile strict \
  --routing-policy v3 \
  --receipt-root ./receipts \
  --json
```

The contract intent must exactly match the command intent. A revision-bound
repository design index is built locally, and the execution receives one
content-addressed capsule with fixed section budgets:

| Section | Maximum |
| --- | ---: |
| Task and route | 1 KB |
| Focused skills | 4 KB |
| Repository evidence | 12 KB |
| Verification contract | 3 KB |
| **Total** | **20 KB** |

Generated output, dependencies, archives, credential files, and environment
files are excluded from repository evidence. A missing lockfile, missing target
file, unsafe path, oversized required section, ambiguous route, or incomplete
route evidence fails closed.

In the current beta.1 shadow foundation, mutation-capable heuristic agents are
also disabled for contracted runs. They cannot be enabled for beta.2 until a
transaction-safe adapter can prove that a wall-time abort cannot leave an
unreceipted token, spec, generated file, or Figma write. Read-only audits and
repository discovery remain available; a refused mutation route is a safe
outcome, not a successful implementation.

Use repository-only discovery when the route is unsupported or when measuring
the fallback explicitly:

```bash
memi compose "Make the settings panel responsive" \
  --task-contract ./task-contract.json \
  --routing-policy repository-only \
  --receipt-root ./receipts \
  --json
```

## Verification evidence

The public `@memi-design/cli/frontend` surface exposes:

- `FrontendTaskContractV1`
- `RepositoryDesignIndexV1`
- `ContextCapsuleV1`
- `WorkflowReceiptV3`
- Chromium web verification requirements and adapter
- Expo and SwiftUI exclusive-Simulator verification adapters
- adapter-to-receipt evidence binding
- chronological receipt replay

The web and native adapters define evidence admission and content addressing;
the caller supplies the browser or Simulator driver. Expo and SwiftUI drivers
must acquire an exclusive Simulator lease and perform a clean reset before
capture. A task missing any required artifact is excluded rather than imputed.

Verify a completed receipt directory and its sequence chronology:

```bash
memi benchmark receipt-verify --receipt-root ./receipts --json
```

The command exits non-zero for an empty or invalid ledger. It reports admitted,
excluded, and invalid receipts separately and emits a deterministic verification
hash.

## Rollout boundary

| Stage | Runtime behavior |
| --- | --- |
| `2.8.0-beta.1` | Router v3 records shadow decisions; execution remains opt-in. |
| `2.8.0-beta.2` | Contracted execution is opt-in for supported routes. |
| `2.8.0-rc.1` | Immutable candidate for the 152-cell V18 study. |
| `2.8.0` | V3 becomes the default only for routes whose preregistered gates pass. |

The V18 source of truth is
[`docs/research/memi-2.8-prospective-study/v18-2.8-confirmatory/`](research/memi-2.8-prospective-study/v18-2.8-confirmatory/README.md).
It currently contains no fabricated cells, graders, scores, receipts, or result
figures.
