# Dependency trust ledger

This ledger explains why the 2.7.x CLI source baseline installs each direct
runtime dependency. It is a review aid, not a claim that a dependency or an
unbuilt 2.8 artifact is risk-free. The artifact-bound 2.8 checklist is in
[Trust Core dependency and license review](trust/DEPENDENCY_LICENSE_REVIEW.md).

## Review record

- Reviewed: 2026-08-02
- Package: `@memi-design/cli` 2.7.5 source baseline
- Known-vulnerability check: `npm audit --omit=dev --audit-level=high`
- Baseline result: zero known production vulnerabilities
- Artifact evidence: captured by `npm run pack:dry-run` at every release gate

`npm audit` and third-party supply-chain services answer different questions.
A clean audit does not remove the need to inspect dynamic loading, subprocess,
or network behavior. Conversely, a capability warning is not by itself a
confirmed vulnerability.

## Base CLI dependencies

| Dependency | Execution boundary | Why it is installed |
| --- | --- | --- |
| `commander` | CLI parsing | Stable command and help surface. |
| `zod` | Input and artifact validation | Validates untrusted configuration and structured output. |
| `effect` | Core execution paths | Typed effect and error-handling primitives used by the engine. |
| `chalk`, `ora` | Terminal interaction | Human-readable, non-machine CLI output. |
| `pino`, `pino-pretty` | Logging | `pino-pretty` is dynamically selected only for local, non-test logging. |
| `@chenglou/pretext` | Interface analysis | Text layout measurement. |
| `cross-spawn` | Local subprocesses | Cross-platform, argument-safe command execution. |
| `tar` | Archive handling | Reads and validates release/archive inputs. |
| `ws`, `@modelcontextprotocol/sdk` | MCP | Local MCP stdio/WebSocket capability when explicitly started. |

## Deferred feature dependencies

| Dependency | Loaded by | Future separation criterion |
| --- | --- | --- |
| `@anthropic-ai/sdk` | Anthropic AI provider | Move to an optional provider adapter without weakening no-key workflows. |
| `xlsx-populate`, `ssf` | Excel research import | Move to an optional spreadsheet adapter while preserving CSV-only use with no extra install. |

## Deliberately removed from the CLI runtime

`react` was a direct dependency even though the CLI only writes React imports
into generated consumer-project source. The package does not import React at
runtime, so consumers—not the audit CLI—own the React version and installation.

## Alert handling policy

Socket-style alerts for filesystem access, shell access, environment reads, URL
strings, or network access must be triaged to a direct source location and an
explicit command path. The release gate should block on known high/critical
vulnerabilities or an unexplained capability—not on a blanket attempt to make a
local developer tool appear capability-free.

Before each release, run:

```bash
npm audit --omit=dev --audit-level=high
npm run pack:dry-run
```

Review this ledger whenever a direct runtime dependency changes.
