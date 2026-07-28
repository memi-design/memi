# Memi model-harness and tracing audit

Assessed: 2026-07-27  
Branch: `codex/model-harness-tracing`  
Public verified score at kickoff: **69/100**  
Raw reviewed-candidate score at kickoff: **87/100**

## Why Memi is not at 100

The branch now closes important architecture and privacy gaps, but it does not
change the public verified score by itself. Code on an unpublished branch is
candidate evidence, not release evidence.

| Gap | Current state | Evidence required to close |
| --- | --- | --- |
| Public release parity | Active 69-point cap | Merge, publish, deploy, and verify one version across npm, GitHub release/tag, site, Action, Studio, MCP metadata, and docs |
| Hosted CI | Active 84-point cap in the reviewed scorecard | Green Blacksmith/GitHub checks for the immutable release commit, including the full OS and Node matrix |
| Aggregate clean-room release | Unassessed | Install the packed artifact on Linux, macOS, and Windows with Node 20, 22, and 24; run first audit and MCP/plugin smoke proof |
| Complete supply-chain proof | Unassessed | Verify provenance, SBOM, publisher identity, dependency audit, archive traversal defenses, and release asset hashes for the exact artifact |
| Durable shader/rendering proof | Unassessed | Re-run the web shader and Apple rendered evidence from the release commit on named hardware |
| Eight-week adoption | Unassessed | Complete the defined external first-audit, repeat-use, integration, and non-release download targets |

These are not cosmetic deductions. The score contract assigns zero to unknown
or untested behavior and preserves the public-version-drift cap.

## Model harness delta

| Area | Before this branch | Candidate state | Remaining proof |
| --- | --- | --- | --- |
| Direct AI client | Anthropic-only singleton | Shared `AIClient` with Anthropic, OpenAI, explicit OpenAI-compatible, and explicit Ollama configuration | Live conformance against current provider/model versions |
| Model routing | Vendor checks and model aliases | Capability negotiation with fail-closed missing-capability reporting | Cross-provider task fixtures plus live authorized handoff proof |
| Studio events | Mixed legacy Studio events and driver events | All current legacy harness sessions project to one versioned runtime union | Make the typed drivers the execution source rather than a compatibility projection |
| Model changes | No complete canonical lifecycle | Selected, changed, and requested/accepted/started/terminal handoff events | Real multi-model run with correlated trace evidence |
| Trace context | Partial session identifiers | W3C-compatible trace/span IDs, parentage, links, and OpenTelemetry projection | External collector interoperability and failure-path proof |
| Privacy | Raw live and persisted content paths existed | Metadata-only live RPC/SSE, recursive redaction, reasoning omission, private file modes | Independent security validation and adversarial payload matrix |
| Rust readiness | TypeScript-only internal types | Generated strict JSON Schema checked for drift | Rust Serde consumer, golden vectors, and bidirectional compatibility tests |
| Canvas readiness | UI-specific session shapes | Versioned Atomic Design canvas projection linked to trace/artifact/evidence IDs | Actual canvas renderer, editing model, persistence, and browser E2E |
| Design improvement | Feature presence used as a proxy | Paired same-model evaluation contract fails closed without independent evidence | Real baseline/Memi-assisted studies showing a measurable design-quality delta |

## Verified in this branch

- Full pre-change baseline: 257 test files and 1,904 tests.
- Current candidate: 268 test files and 1,945 tests.
- Targeted live privacy, replay ordering, span lineage, provider configuration,
  OpenAI-compatible HTTP, vision serialization, and malformed-response tests
  pass.
- Strict TypeScript typecheck and generated-schema drift check pass.
- The default trace sink is no-op and performs no network export.
- Local Ollama is contacted only after explicit provider selection.

Final release evidence must be regenerated after all branch work is complete.

## Release decision

**Do not publish yet.** Publish the next npm version only after:

1. the full local release suite and package dry-run pass from a clean tree;
2. code and security review have no critical or high findings;
3. the pull request is merged;
4. Blacksmith checks are green on the immutable release commit;
5. public version metadata is updated from the release manifest;
6. the npm trusted-publisher workflow publishes with provenance;
7. the installed tarball passes clean-room smoke tests.

The Rust runtime and canvas GUI should consume the versioned schema instead of
re-creating model, tracing, or evaluation semantics.
