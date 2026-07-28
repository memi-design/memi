# Studio New Engine — Effect.js + ProviderRuntime contract

This document describes the architecture introduced by PR #17 (the 15-commit Effect.js + state-machine rewrite) and how to migrate consumers from the legacy engine surface to the new one.

## What's new

The engine ships a parallel implementation of the harness/runtime layer alongside the existing one. **The new layer is fully built and tested but not yet mounted on the live HTTP server** — that mount is a deferred follow-up. The 1456 existing tests continue to pass without modification because the new code is purely additive.

### New modules

| Module | Purpose |
|---|---|
| `src/studio/contracts/{ids,errors,provider-runtime}.ts` | Branded entity IDs, typed harness errors, the canonical `ProviderRuntimeEvent` discriminated union |
| `src/studio/state/{session-machine,turn-machine}.ts` | Tiny FSMs encoding legal transitions for sessions + turns |
| `src/studio/drivers/{base,registry}.ts` | `HarnessDriver` abstract base + driver factory registry |
| `src/studio/drivers/{codex,claude-code,opencode,hermes,ollama,gemini,memoire-native}.ts` | Per-harness drivers (8 in total, replacing the 596-line dispatch switch) |
| `src/studio/drivers/json-line-driver.ts` | Shared base for JSON-line agents (Hermes/Ollama/Gemini/Memoire-native are 30 LOC each) |
| `src/studio/snapshots/snapshot-store.ts` | Per-session snapshot store + crash-recovery helpers |
| `src/studio/journal/event-journal.ts` | Append-only event journal + `replay(sessionId, fromSeq?)` |
| `src/studio/maintenance/runner.ts` | Periodic background prune of snapshots/journals |
| `src/studio/event-bus.ts` | In-process pub/sub for `ProviderRuntimeEvents` |
| `src/studio/usage-rollup.ts` | Per-session/per-harness/per-tool token + cost rollup over the bus |
| `src/studio/rpc/{protocol,server.ts}` | Typed RPC dispatcher (5 ops, single envelope) |
| `src/studio/feature-flags.ts` | Env-var gate for staged cut-over |
| `packages/memi-studio-types/` | Public npm package re-exporting the contracts for memi-studio's frontend |

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     ProviderRuntimeEvent                         │
│              (one canonical discriminated union)                 │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ emit()
                              │
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐
│ CodexDriver  │  │ ClaudeCode-  │  │ Hermes/Ollama│  │ Memoire- │
│              │  │   Driver     │  │   /Gemini    │  │ Native   │
│              │  │              │  │ (JsonLine-   │  │ Driver   │
│              │  │              │  │  Driver)     │  │          │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────┘
        │                                                       │
        ▼ (via emit() chain)                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  SnapshotStore  │  EventJournal  │  EventBus  │ (subscribers…)  │
└─────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                          ┌────────────────────────┐
                          │   UsageRollup          │
                          │   CheckpointStore (TBD)│
                          │   HookRunner (TBD)     │
                          │   WalkthroughWriter    │
                          │   ArtifactStore        │
                          │   MonitorManager       │
                          └────────────────────────┘
```

## Cut-over plan

The new layer is built; activating it is gated by `STUDIO_USE_NEW_HARNESS_LAYER=1` (and friends — see `src/studio/feature-flags.ts`). Cut-over steps in order:

1. **Mount the RpcServer on `server.ts`'s WebSocket upgrade path.** The `RpcServer` class is ready; mounting it requires choosing a path (`/v1/rpc` is the default plan), wiring `SessionResolver` to the existing session registry, and routing inbound JSON to `dispatch(req)`.
2. **Switch `buildHarnessCommand()` to delegate to the driver registry when the flag is set.** Today the legacy switch and the driver registry exist side-by-side; flipping the flag at the dispatch site is a small, contained change.
3. **Migrate cluster A–E primitives to subscribe to the EventBus.** The pattern is locked (`UsageRollup` is the worked example). Each primitive becomes ~30 LOC: import the bus, register a filtered subscriber on init.
4. **Publish `@sarveshsea/memi-studio-types` to npm.** Once published, memi-studio's frontend swaps its vendored `src/runtime/` for the package import.
5. **Delete the legacy switch in `harnesses.ts`.** The file shrinks to a thin compat re-export of the new public surface.

## Verification

Per-commit gate (every push):
- `npx tsc --noEmit -p tsconfig.json` clean
- `npx vitest run` — every existing test plus new tests for that commit passes

Whole-PR cut-over criteria:
- All 8 drivers ported, all in registry, conformance test green
- Snapshot resume verified live
- Journal replay verified live
- All cluster A–E primitives subscribe to the event stream
- `@sarveshsea/memi-studio-types` published

## See also

- [PR #17](https://github.com/memi-design/memi/pull/17) — the rewrite
- `~/.claude/plans/go-to-the-macos-radiant-sketch.md` — the engineering plan
- [pingdotgg/t3code](https://github.com/pingdotgg/t3code) — the architecture inspiration
