# Memi model harness

Memi has two complementary model surfaces:

1. The direct AI client used by design analysis, research synthesis, and code
   critique.
2. The Studio harness runtime used to supervise coding-agent CLIs and project
   every run into one canonical event stream.

The boundary is capability-based. Application code depends on `AIClient` or
`ProviderRuntimeEvent`, not a vendor SDK response.

## Direct AI providers

| Provider | Selection | Required configuration | Notes |
| --- | --- | --- | --- |
| Anthropic | Automatic when only `ANTHROPIC_API_KEY` is present, or explicit `MEMI_AI_PROVIDER=anthropic` | `ANTHROPIC_API_KEY` | Backward-compatible SDK path |
| OpenAI | Automatic when only `OPENAI_API_KEY` is present, or explicit `MEMI_AI_PROVIDER=openai` | `OPENAI_API_KEY` | OpenAI-compatible Chat Completions transport |
| OpenAI-compatible | Explicit `MEMI_AI_PROVIDER=openai-compatible` | `MEMI_AI_BASE_URL`, `MEMI_AI_MODEL`; optional `MEMI_AI_API_KEY` | Works with a declared compatible HTTP endpoint |
| Ollama | Explicit `MEMI_AI_PROVIDER=ollama` | `MEMI_AI_MODEL`; optional `MEMI_AI_BASE_URL` | Defaults to `http://127.0.0.1:11434/v1` only after explicit opt-in |

Model selection can be overridden with `MEMI_AI_MODEL`,
`MEMI_AI_MODEL_FAST`, and `MEMI_AI_MODEL_DEEP`. Compatible endpoints declare
optional features with a comma-separated `MEMI_AI_CAPABILITIES` value such as
`text,streaming,json,vision,tools`. Memi fails closed when a required
capability is not declared.

This is protocol support, not a claim that every model or endpoint has passed
live conformance. A provider is counted as verified only after its current
version completes the clean-room conformance matrix.

## Canonical runtime and tracing

Every Studio harness is projected into the versioned
`ProviderRuntimeEvent` union. Events include:

- stable run, trace, span, session, turn, and tool-call identities;
- model selection, change, and explicit handoff lifecycle events;
- capability declarations and content-trust labels;
- monotonic sequence numbers and replay cursors;
- metadata-only capture by default;
- optional W3C `traceparent` and OpenTelemetry GenAI projection.

Reasoning content is never persisted by the trace layer. Prompts, tool
arguments, outputs, and model text are omitted in metadata-only mode. Exporting
content requires an explicit privacy mode and remains subject to recursive
secret and personal-data redaction.

Automatic model chaining is not enabled implicitly. A caller must authorize a
handoff, satisfy the target capability requirements, and emit every requested,
accepted, started, and terminal phase. This keeps cross-provider routing
observable and prevents silent model substitution.

## Stable integration schema

`schemas/memi-runtime-trace-v1.schema.json` is generated from the TypeScript
contracts and checked for drift during builds and release validation. It is the
language-neutral boundary for:

- a future Rust runtime using Serde-generated types;
- the Memi canvas and Figma-like GUI;
- offline trace viewers;
- external telemetry adapters;
- repeatable design-quality evaluations.

The canvas contract uses Atomic Design levels for nodes and keeps trace,
artifact, evidence, and evaluation links explicit. The GUI remains a future
consumer; this release establishes its data boundary rather than claiming the
canvas itself is complete.

## Design-quality evaluation

Model quality is not inferred from a successful API call. The evaluation
contract requires:

- a baseline and Memi-assisted run using the same model and task;
- an independent reviewer;
- file or rendered evidence for both runs;
- scored craft, hierarchy, accessibility, implementation quality, and
  evidence completeness;
- an unassessed result when paired evidence is missing.

No deterministic fixture is counted as live proof.
