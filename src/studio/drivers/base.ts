/**
 * HarnessDriver — abstract base contract every harness implementation honors.
 *
 * Pattern adapted from t3code's `ProviderDriver`. Each driver wraps one CLI
 * (codex, claude-code, opencode, hermes, openclaw, ollama, gemini) and emits
 * canonical `ProviderRuntimeEvent`s into an Effect Stream.
 *
 * The base class owns:
 *   - the SessionMachine and per-turn TurnMachine
 *   - monotonic event sequencing
 *   - event emission helpers that stamp envelope fields automatically
 *   - typed error mapping
 *
 * Subclasses implement transport: subprocess management, stdout parsing,
 * stdin marshalling, cancellation. Subclasses do not handle event envelope
 * boilerplate.
 */

import { Effect, Stream } from "effect";
import {
  asId,
  makeId,
  type EventId,
  type HarnessId,
  type ProviderInstanceId,
  type SessionId,
  type ThreadId,
  type ToolCallId,
  type TurnId,
} from "../contracts/ids.js";
import {
  fromUnknown,
  type HarnessError,
} from "../contracts/errors.js";
import type {
  ProviderRuntimeEvent,
  ProviderRuntimeEventBase,
  RuntimeTraceContext,
  ModelRef,
  SessionState,
  TurnState,
} from "../contracts/provider-runtime.js";
import { SessionMachine } from "../state/session-machine.js";
import { TurnMachine } from "../state/turn-machine.js";
import {
  buildSnapshot,
  type HarnessSnapshot,
  type SnapshotStore,
} from "../snapshots/snapshot-store.js";
import type { EventJournal } from "../journal/event-journal.js";
import type { EventBus } from "../event-bus.js";
import {
  createChildTraceContext,
  createRuntimeTraceContext,
} from "../tracing/context.js";

export interface HarnessDriverConfig {
  readonly harnessId: HarnessId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly sessionId: SessionId;
  readonly threadId?: ThreadId;
  /** Implementation-specific knobs (model, effort, base URL, env). */
  readonly options?: Record<string, unknown>;
  /**
   * Optional snapshot store. When provided, the driver writes a snapshot
   * after every state-changing event so a runtime restart can resume the
   * session. When absent, the driver behaves exactly as before.
   */
  readonly snapshotStore?: SnapshotStore;
  /**
   * Optional event journal. When provided, every emitted event is appended
   * to a per-session JSONL log so a UI client can replay the session from
   * a cursor (offline playback, audit, post-hoc rendering). When absent,
   * the driver behaves exactly as before.
   */
  readonly eventJournal?: EventJournal;
  /**
   * Optional shared event bus. When provided, every emitted event is also
   * published to the bus so cross-cutting primitives (checkpoint-store,
   * hook-runner, walkthrough-writer, etc.) can subscribe instead of being
   * called explicitly from the tool broker.
   */
  readonly eventBus?: EventBus;
  /** Stable provider identity; defaults from the harness id when omitted. */
  readonly providerId?: string;
  /** Capabilities negotiated for this run. */
  readonly capabilities?: readonly string[];
  /** Optional upstream trace context for cross-process or model handoffs. */
  readonly traceContext?: RuntimeTraceContext;
}

export interface HarnessTurnRequest {
  readonly turnId: TurnId;
  readonly prompt: string;
  readonly attachments?: ReadonlyArray<{ kind: string; ref: string }>;
}

export interface HarnessDriver {
  readonly config: HarnessDriverConfig;
  start(): Effect.Effect<void, HarnessError>;
  sendTurn(req: HarnessTurnRequest): Effect.Effect<void, HarnessError>;
  interrupt(reason?: string): Effect.Effect<void, HarnessError>;
  shutdown(): Effect.Effect<void, HarnessError>;
  events(): Stream.Stream<ProviderRuntimeEvent, HarnessError>;
  sessionState(): SessionState;
  recordModelChange(input: {
    readonly from: ModelRef;
    readonly to: ModelRef;
    readonly reason: string;
  }): void;
  recordModelHandoff(input: {
    readonly handoffId: string;
    readonly phase: "requested" | "accepted" | "rejected" | "started" | "completed" | "failed" | "cancelled";
    readonly from: ModelRef;
    readonly to: ModelRef;
    readonly reason?: string;
  }): void;
}

type EventEmitter = (event: ProviderRuntimeEvent) => void;

export abstract class BaseHarnessDriver implements HarnessDriver {
  readonly config: HarnessDriverConfig;
  protected readonly session: SessionMachine;
  protected currentTurn: TurnMachine | null = null;
  protected currentTurnId: TurnId | null = null;
  private seq = 0;
  private readonly subscribers = new Set<EventEmitter>();
  private finalized = false;
  private readonly rootTrace: RuntimeTraceContext;
  private readonly turnTraces = new Map<string, RuntimeTraceContext>();
  private readonly toolTraces = new Map<string, RuntimeTraceContext>();
  private lastEmittedSessionState: SessionState = "idle";

  constructor(config: HarnessDriverConfig) {
    this.config = config;
    this.session = new SessionMachine("idle");
    this.rootTrace = config.traceContext ?? createRuntimeTraceContext();
  }

  abstract start(): Effect.Effect<void, HarnessError>;
  abstract sendTurn(req: HarnessTurnRequest): Effect.Effect<void, HarnessError>;
  abstract interrupt(reason?: string): Effect.Effect<void, HarnessError>;
  abstract shutdown(): Effect.Effect<void, HarnessError>;

  sessionState(): SessionState {
    return this.session.current();
  }

  events(): Stream.Stream<ProviderRuntimeEvent, HarnessError> {
    const subscribers = this.subscribers;
    const emitter = (cb: EventEmitter) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    };

    return Stream.async<ProviderRuntimeEvent, HarnessError>((emit) => {
      const cb: EventEmitter = (event) => {
        emit.single(event);
      };
      const unsubscribe = emitter(cb);
      return Effect.sync(() => unsubscribe());
    });
  }

  protected nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  protected envelope(extra?: {
    turnId?: TurnId;
    trace?: RuntimeTraceContext;
  }): ProviderRuntimeEventBase {
    const turnId = extra?.turnId ?? this.currentTurnId ?? undefined;
    return {
      schemaVersion: 1,
      eventId: asId("EventId", makeId("EventId")),
      seq: this.nextSeq(),
      harnessId: this.config.harnessId,
      providerInstanceId: this.config.providerInstanceId,
      sessionId: this.config.sessionId,
      threadId: this.config.threadId,
      turnId,
      createdAt: new Date().toISOString(),
      trace: extra?.trace ?? this.traceForTurn(turnId),
    };
  }

  protected emit(event: ProviderRuntimeEvent): void {
    if (this.finalized) return;
    this.publishEvent(event);
    if (event.type === "session.created" && event.harnessConfigSummary.model) {
      this.publishEvent({
        ...this.envelope({ trace: this.rootTrace }),
        type: "model.selected",
        providerId: this.config.providerId ?? providerIdForHarness(this.config.harnessId),
        requestedModel: event.harnessConfigSummary.model,
        resolvedModel: event.harnessConfigSummary.model,
        reason: "requested",
        capabilities: [...(this.config.capabilities ?? [])],
      });
    }
  }

  private publishEvent(event: ProviderRuntimeEvent): void {
    const publishable = event.contentTrust
      ? event
      : { ...event, contentTrust: contentTrustForEvent(event) } as ProviderRuntimeEvent;
    for (const sub of this.subscribers) {
      try {
        sub(publishable);
      } catch {
        // a misbehaving subscriber must never break the stream
      }
    }
    this.maybeUpdateSnapshot(publishable);
    this.maybeAppendJournal(publishable);
    this.maybePublishToBus(publishable);
  }

  private traceForTurn(turnId?: TurnId): RuntimeTraceContext {
    if (!turnId) return this.rootTrace;
    const key = turnId as unknown as string;
    const current = this.turnTraces.get(key);
    if (current) return current;
    const created = createChildTraceContext(this.rootTrace);
    this.turnTraces.set(key, created);
    return created;
  }

  private maybePublishToBus(event: ProviderRuntimeEvent): void {
    if (!this.config.eventBus) return;
    this.config.eventBus.publish(event);
  }

  private journalWriteInflight: Promise<void> | null = null;

  private maybeAppendJournal(event: ProviderRuntimeEvent): void {
    const journal = this.config.eventJournal;
    if (!journal) return;
    const previous = this.journalWriteInflight ?? Promise.resolve();
    this.journalWriteInflight = previous
      .then(() => journal.append(this.config.sessionId, event))
      .catch((error) => {
        // Best-effort write; surface as a diagnostic, never throw.
        try {
          for (const sub of this.subscribers) {
            sub({
              ...this.envelope(),
              type: "diagnostic.warn",
              message: `journal append failed: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        } catch {
          // ignore
        }
      });
  }

  // Tracked counters for snapshot persistence. Updated by maybeUpdateSnapshot.
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalReasoningTokens = 0;
  private estimatedCostUsd = 0;
  private lastError: string | undefined;
  private snapshotCreatedAt = new Date().toISOString();
  private snapshotWriteInflight: Promise<void> | null = null;

  /**
   * Returns the cumulative usage + last-error stats accumulated from emitted
   * events. Useful for tests and the snapshot writer.
   */
  protected snapshotStats(): {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalReasoningTokens: number;
    estimatedCostUsd: number;
    lastError: string | undefined;
    createdAt: string;
  } {
    return {
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalReasoningTokens: this.totalReasoningTokens,
      estimatedCostUsd: this.estimatedCostUsd,
      lastError: this.lastError,
      createdAt: this.snapshotCreatedAt,
    };
  }

  /**
   * Restore mutable driver state from a previously-saved snapshot. Called
   * by subclasses inside start() when resuming after a runtime restart.
   *
   * Only resumes non-terminal sessions/turns. If the snapshot says the
   * session is stopped/error or the turn is done/failed, those are left as
   * fresh-start.
   */
  protected restoreFromSnapshot(snap: HarnessSnapshot): void {
    this.totalInputTokens = snap.totalInputTokens;
    this.totalOutputTokens = snap.totalOutputTokens;
    this.totalReasoningTokens = snap.totalReasoningTokens;
    this.estimatedCostUsd = snap.estimatedCostUsd;
    this.lastError = snap.lastError;
    this.snapshotCreatedAt = snap.createdAt;
    this.seq = snap.lastEventSeq;

    if (snap.sessionState !== "stopped" && snap.sessionState !== "error") {
      // Replace the session machine at the saved state.
      (this as unknown as { session: SessionMachine }).session = new SessionMachine(snap.sessionState);
    }
    if (
      snap.currentTurnId &&
      snap.currentTurnState &&
      snap.currentTurnState !== "done" &&
      snap.currentTurnState !== "failed"
    ) {
      this.currentTurnId = snap.currentTurnId;
      this.currentTurn = new TurnMachine(snap.currentTurnState as TurnState);
    }
  }

  /**
   * Returns the persisted snapshot for this session if one exists. Subclasses
   * call this inside start() to decide whether to resume or start fresh.
   */
  protected loadSnapshot(): Promise<HarnessSnapshot | null> {
    if (!this.config.snapshotStore) return Promise.resolve(null);
    return this.config.snapshotStore.load(this.config.sessionId);
  }

  private maybeUpdateSnapshot(event: ProviderRuntimeEvent): void {
    // Bookkeeping for cumulative counters happens for every event; the
    // disk write only happens for state-changing events.
    if (event.type === "usage.updated") {
      this.totalInputTokens += event.inputTokens;
      this.totalOutputTokens += event.outputTokens;
      this.totalReasoningTokens += event.reasoningTokens ?? 0;
      this.estimatedCostUsd += event.estimatedCostUsd ?? 0;
    }
    if (event.type === "diagnostic.error") {
      this.lastError = event.message;
    }
    if (!this.config.snapshotStore) return;

    const interesting =
      event.type === "session.state.changed" ||
      event.type === "turn.state.changed" ||
      event.type === "turn.completed" ||
      event.type === "session.shutdown" ||
      event.type === "usage.updated" ||
      event.type === "diagnostic.error";
    if (!interesting) return;

    // Fire-and-forget write. Multiple writes for the same session are
    // safe — the FileSnapshotStore uses atomic write-then-rename, and
    // the MemorySnapshotStore is just a Map.set. We chain through
    // snapshotWriteInflight so the writes happen in event order even
    // though they're async.
    const snap = buildSnapshot({
      sessionId: this.config.sessionId,
      harnessId: this.config.harnessId,
      threadId: this.config.threadId,
      sessionState: this.session.current(),
      currentTurnId: this.currentTurnId ?? undefined,
      currentTurnState: this.currentTurn?.current(),
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalReasoningTokens: this.totalReasoningTokens,
      estimatedCostUsd: this.estimatedCostUsd,
      lastError: this.lastError,
      lastEventSeq: this.seq,
      createdAt: this.snapshotCreatedAt,
    });

    const store = this.config.snapshotStore;
    const previous = this.snapshotWriteInflight ?? Promise.resolve();
    this.snapshotWriteInflight = previous
      .then(() => store.save(snap))
      .catch((error) => {
        // Silently log via diagnostic; never propagate disk errors to the
        // event stream's consumers (snapshotting is best-effort).
        try {
          // Avoid recursive snapshot writes by emitting through the raw
          // subscriber loop instead of this.emit().
          for (const sub of this.subscribers) {
            sub({
              ...this.envelope(),
              type: "diagnostic.warn",
              message: `snapshot write failed: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        } catch {
          // ignore
        }
      });
  }

  protected emitToolStarted(toolCallId: ToolCallId, tool: string, args: unknown): void {
    const parent = this.traceForTurn(this.currentTurnId ?? undefined);
    const trace = createChildTraceContext(parent);
    this.toolTraces.set(toolCallId as unknown as string, trace);
    this.emit({ ...this.envelope({ trace }), type: "tool.call.started", toolCallId, tool, args });
  }

  protected emitToolOutput(
    toolCallId: ToolCallId,
    chunk: string,
    stream: "stdout" | "stderr" = "stdout",
  ): void {
    const trace = this.toolTraces.get(toolCallId as unknown as string)
      ?? this.traceForTurn(this.currentTurnId ?? undefined);
    this.emit({ ...this.envelope({ trace }), type: "tool.call.output", toolCallId, chunk, stream });
  }

  protected emitToolCompleted(
    toolCallId: ToolCallId,
    ok: boolean,
    elapsedMs: number,
    extras?: { result?: unknown; error?: string },
  ): void {
    const key = toolCallId as unknown as string;
    const trace = this.toolTraces.get(key)
      ?? this.traceForTurn(this.currentTurnId ?? undefined);
    this.emit({
      ...this.envelope({ trace }),
      type: "tool.call.completed",
      toolCallId,
      ok,
      elapsedMs,
      ...(extras ?? {}),
    });
    this.toolTraces.delete(key);
  }

  protected emitMessageDelta(delta: string): void {
    this.emit({ ...this.envelope(), type: "message.assistant.delta", delta });
  }

  protected emitMessageComplete(text: string): void {
    this.emit({ ...this.envelope(), type: "message.assistant.complete", text });
  }

  protected emitUserMessage(text: string): void {
    this.emit({ ...this.envelope(), type: "message.user", text });
  }

  protected emitDiagnostic(level: "warn" | "error", message: string, data?: unknown): void {
    this.emit({
      ...this.envelope(),
      type: level === "warn" ? "diagnostic.warn" : "diagnostic.error",
      message,
      data,
    });
  }

  recordModelChange(input: {
    readonly from: ModelRef;
    readonly to: ModelRef;
    readonly reason: string;
  }): void {
    this.emit({
      ...this.envelope(),
      type: "model.changed",
      ...input,
    });
  }

  recordModelHandoff(input: {
    readonly handoffId: string;
    readonly phase: "requested" | "accepted" | "rejected" | "started" | "completed" | "failed" | "cancelled";
    readonly from: ModelRef;
    readonly to: ModelRef;
    readonly reason?: string;
  }): void {
    this.emit({
      ...this.envelope(),
      type: "model.handoff",
      ...input,
    });
  }

  protected emitSessionStateChange(toState: SessionState, reason?: string): void {
    const fromState = this.lastEmittedSessionState;
    this.lastEmittedSessionState = toState;
    this.emit({
      ...this.envelope(),
      type: "session.state.changed",
      from: fromState,
      to: toState,
      reason,
    });
  }

  protected emitTurnStateChange(
    fromState: "pending" | "running" | "done" | "failed",
    toState: "pending" | "running" | "done" | "failed",
    turnId?: TurnId,
  ): void {
    this.emit({
      ...this.envelope({ turnId }),
      type: "turn.state.changed",
      from: fromState,
      to: toState,
    });
  }

  protected wrapError(unknown: unknown, turnId?: TurnId): HarnessError {
    return fromUnknown(unknown, {
      harnessId: this.config.harnessId,
      sessionId: this.config.sessionId,
      turnId,
    });
  }

  protected finalize(): void {
    this.finalized = true;
    this.subscribers.clear();
  }
}

function providerIdForHarness(harnessId: HarnessId): string {
  const normalized = String(harnessId).replace(/^hns_/, "");
  if (normalized === "codex") return "openai";
  if (normalized === "claude-code") return "anthropic";
  if (normalized === "gemini") return "google";
  if (normalized === "ollama") return "local";
  if (normalized === "memoire") return "memoire";
  return normalized;
}

function contentTrustForEvent(event: ProviderRuntimeEvent): ProviderRuntimeEventBase["contentTrust"] {
  if (event.type === "message.user" || event.type === "turn.created") return "user";
  if (
    event.type.startsWith("message.assistant")
    || event.type.startsWith("reasoning.")
  ) return "model_generated";
  if (
    event.type.startsWith("tool.")
    || event.type.startsWith("diagnostic.")
  ) return "tool_untrusted";
  return "trusted";
}
