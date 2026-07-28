# @sarveshsea/memi-studio-types

Public type contracts for the [Mémoire Studio](https://github.com/memi-design/memi-studio) runtime sidecar.

## What's in here

- **ProviderRuntime event union** — the canonical discriminated union of events drivers emit (`session.created`, `tool.call.started`, `usage.updated`, etc.)
- **Branded entity IDs** — `HarnessId`, `SessionId`, `ThreadId`, `TurnId`, `ToolCallId`, `EventId`
- **Typed harness errors** — `HarnessAuthError`, `HarnessRateLimitError`, etc.
- **State machine alphabets** — `SessionState`, `TurnState`, transition events
- **RPC protocol** — typed request/response envelopes for the engine's WebSocket surface

## Why it exists

memi-studio's React frontend needs to deserialize the engine's event stream and dispatch RPC commands typed-end-to-end. Vendoring the engine source into the GUI repo would couple the two repos forever. This package is the minimum surface the GUI needs, published from the engine repo as the source of truth.

## Usage

```ts
import {
  parseProviderRuntimeEvent,
  type ProviderRuntimeEvent,
  type HarnessId,
} from "@sarveshsea/memi-studio-types";

const event: ProviderRuntimeEvent = parseProviderRuntimeEvent(rawJson);
```

## Versioning

Tracks the engine's own `runtime-v*` release tags. A bump here means a corresponding `runtime-v*` tag landed on `memi-design/memi`.

## License

MIT, same as the engine.
