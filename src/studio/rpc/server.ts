/**
 * RpcServer — in-process RPC dispatcher for the new typed surface.
 *
 * This is the dispatch core. The wire layer (WebSocket framing,
 * heartbeats, backpressure) lands when we mount this on the HTTP server's
 * upgrade path in a follow-up commit. Until then, callers can use the
 * dispatcher directly (memi-studio's Tauri shell can speak to it via
 * a thin in-process bridge as a stepping stone).
 *
 * The dispatcher operates on:
 *   - a SessionResolver: finds the right HarnessDriver for a sessionId
 *   - an EventJournal: serves replayEvents()
 *
 * Both are injected so tests can use mock implementations.
 */

import { Effect, Fiber, Stream } from "effect";
import { asId } from "../contracts/ids.js";
import type { HarnessId, SessionId, ThreadId, TurnId } from "../contracts/ids.js";
import type { HarnessDriver, HarnessTurnRequest } from "../drivers/base.js";
import type { EventJournal } from "../journal/event-journal.js";
import type { ProviderRuntimeEvent } from "../contracts/provider-runtime.js";
import { sanitizeRuntimeEvent } from "../tracing/privacy.js";
import {
  parseRpcRequest,
  type RpcRequest,
  type RpcResponse,
} from "./protocol.js";

export interface SessionResolver {
  /** Look up the live driver for a session, or null if no live driver exists. */
  resolveDriver(sessionId: SessionId): HarnessDriver | null;
  /**
   * Look up the most recent harnessId attached to a session — used by
   * dispatchCommand to construct a fresh driver if `start` arrives for
   * a session that doesn't have a live driver yet.
   */
  resolveHarnessId(sessionId: SessionId): HarnessId | null;
  /**
   * Construct + register a fresh HarnessDriver for the given session.
   * Called by dispatchCommand("start") when no live driver exists.
   */
  createDriver(input: {
    sessionId: SessionId;
    harnessId: HarnessId;
    threadId?: ThreadId;
    options?: Record<string, unknown>;
  }): HarnessDriver;
  /**
   * Optional bridge for live canonical events produced by an existing
   * runtime that has not yet moved execution into HarnessDriver.
   */
  subscribeEvents?(
    sessionId: SessionId,
    onEvent: (event: ProviderRuntimeEvent) => void,
  ): { unsubscribe(): void };
}

export interface RpcServerConfig {
  readonly resolver: SessionResolver;
  readonly journal?: EventJournal;
}

export class RpcServer {
  constructor(private readonly config: RpcServerConfig) {}

  /**
   * Dispatch a single RPC request. Returns an async iterable of responses
   * — single-shot ops yield one response, streaming ops yield many until
   * the consumer calls `cancel()` on the returned subscription.
   */
  dispatch(rawRequest: unknown): RpcSubscription {
    let req: RpcRequest;
    try {
      req = parseRpcRequest(rawRequest);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const requestId =
        rawRequest && typeof rawRequest === "object" && "requestId" in rawRequest
          ? String((rawRequest as Record<string, unknown>).requestId)
          : "(unknown)";
      return RpcSubscription.singleShot({
        kind: "error",
        requestId,
        error: `invalid rpc request: ${message}`,
      });
    }

    switch (req.op) {
      case "dispatchCommand":
        return this.handleDispatchCommand(req);
      case "subscribeThread":
        return this.handleSubscribeThread(req);
      case "replayEvents":
        return this.handleReplayEvents(req);
      case "subscribeShell":
        return this.handleSubscribeShell(req);
      case "getTurnDiff":
        return this.handleGetTurnDiff(req);
    }
  }

  private handleDispatchCommand(
    req: Extract<RpcRequest, { op: "dispatchCommand" }>,
  ): RpcSubscription {
    const sessionId = req.sessionId as SessionId;
    let driver = this.config.resolver.resolveDriver(sessionId);

    if (!driver && req.command === "start") {
      const harnessId = this.config.resolver.resolveHarnessId(sessionId);
      if (!harnessId) {
        return RpcSubscription.singleShot({
          kind: "error",
          requestId: req.requestId,
          error: `no harness id known for session ${sessionId}`,
          errorTag: "HarnessConfigError",
        });
      }
      driver = this.config.resolver.createDriver({
        sessionId,
        harnessId,
        threadId: req.threadId as ThreadId | undefined,
        options: (req.payload?.options as Record<string, unknown> | undefined) ?? undefined,
      });
    }

    if (!driver) {
      return RpcSubscription.singleShot({
        kind: "error",
        requestId: req.requestId,
        error: `no live driver for session ${sessionId}`,
        errorTag: "SessionNotFound",
      });
    }

    return RpcSubscription.fromEffect(req.requestId, this.runCommand(driver, req));
  }

  private runCommand(
    driver: HarnessDriver,
    req: Extract<RpcRequest, { op: "dispatchCommand" }>,
  ): Effect.Effect<unknown, unknown> {
    switch (req.command) {
      case "start":
        return driver.start();
      case "interrupt":
        return driver.interrupt(req.payload?.reason as string | undefined);
      case "shutdown":
        return driver.shutdown();
      case "sendTurn": {
        const turn: HarnessTurnRequest = {
          turnId: asId("TurnId", String(req.payload?.turnId ?? "")),
          prompt: String(req.payload?.prompt ?? ""),
          attachments: req.payload?.attachments as HarnessTurnRequest["attachments"],
        };
        return driver.sendTurn(turn);
      }
    }
  }

  private handleSubscribeThread(
    req: Extract<RpcRequest, { op: "subscribeThread" }>,
  ): RpcSubscription {
    const sessionId = req.sessionId as SessionId;
    const driver = this.config.resolver.resolveDriver(sessionId);
    const canBridge = Boolean(this.config.resolver.subscribeEvents);
    if (!driver && !canBridge) {
      return RpcSubscription.singleShot({
        kind: "error",
        requestId: req.requestId,
        error: `no live driver for session ${sessionId}`,
        errorTag: "SessionNotFound",
      });
    }

    const sub = new RpcSubscription();
    const replayPending = req.fromSeq !== undefined && Boolean(this.config.journal);
    let bufferingLiveEvents = replayPending;
    const liveBuffer: ProviderRuntimeEvent[] = [];
    const pushLive = (event: ProviderRuntimeEvent) => {
      const sanitized = sanitizeRuntimeEvent(event);
      if (bufferingLiveEvents) {
        liveBuffer.push(sanitized);
        return;
      }
      sub.push({ kind: "event", requestId: req.requestId, event: sanitized });
    };

    if (this.config.resolver.subscribeEvents) {
      const bridge = this.config.resolver.subscribeEvents(sessionId, pushLive);
      sub.addCleanup(() => bridge.unsubscribe());
    } else if (driver) {
      const fiber = Effect.runFork(
        Stream.runForEach(driver.events(), (event) =>
          Effect.sync(() => pushLive(event))),
      );
      sub.addCleanup(() => {
        Effect.runFork(Fiber.interrupt(fiber));
      });
    }

    sub.push({ kind: "ack", requestId: req.requestId });
    if (replayPending && this.config.journal) {
      const journal = this.config.journal;
      void (async () => {
        let lastReplayedSeq = (req.fromSeq ?? 0) - 1;
        try {
          for await (const event of journal.replay(sessionId, req.fromSeq)) {
            const sanitized = sanitizeRuntimeEvent(event);
            lastReplayedSeq = Math.max(lastReplayedSeq, sanitized.seq);
            sub.push({ kind: "event", requestId: req.requestId, event: sanitized });
          }
        } catch (error) {
          sub.push({
            kind: "error",
            requestId: req.requestId,
            error: `replay failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        } finally {
          bufferingLiveEvents = false;
          const deduped = new Map<number, ProviderRuntimeEvent>();
          for (const event of liveBuffer) {
            if (event.seq > lastReplayedSeq) deduped.set(event.seq, event);
          }
          for (const event of [...deduped.values()].sort((a, b) => a.seq - b.seq)) {
            sub.push({ kind: "event", requestId: req.requestId, event });
          }
        }
      })();
    }
    return sub;
  }

  private handleReplayEvents(
    req: Extract<RpcRequest, { op: "replayEvents" }>,
  ): RpcSubscription {
    const sessionId = req.sessionId as SessionId;
    if (!this.config.journal) {
      return RpcSubscription.singleShot({
        kind: "error",
        requestId: req.requestId,
        error: "no event journal configured on this RpcServer",
        errorTag: "JournalUnavailable",
      });
    }

    const sub = new RpcSubscription();
    const journal = this.config.journal;
    void (async () => {
      try {
        for await (const event of journal.replay(sessionId, req.fromSeq)) {
          sub.push({ kind: "event", requestId: req.requestId, event });
        }
        sub.push({ kind: "end", requestId: req.requestId, reason: "replay-complete" });
        sub.close();
      } catch (error) {
        sub.push({
          kind: "error",
          requestId: req.requestId,
          error: `replay failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        sub.close();
      }
    })();
    return sub;
  }

  private handleSubscribeShell(
    req: Extract<RpcRequest, { op: "subscribeShell" }>,
  ): RpcSubscription {
    // Shell subscription is the live "what is the agent doing right now"
    // surface used by the workbench Activity tab. For this commit it's a
    // stub that acks immediately; the real wiring lands when we replace
    // the legacy SSE shell endpoint.
    const sub = RpcSubscription.singleShot({
      kind: "ack",
      requestId: req.requestId,
    });
    return sub;
  }

  private handleGetTurnDiff(
    req: Extract<RpcRequest, { op: "getTurnDiff" }>,
  ): RpcSubscription {
    // getTurnDiff returns the file-diff snapshot for a completed turn.
    // For this commit it's a stub that acks; real implementation routes
    // through the existing src/studio/design-changelog.ts.
    return RpcSubscription.singleShot({
      kind: "result",
      requestId: req.requestId,
      result: { turnId: req.turnId, diff: null, note: "diff resolver not yet mounted" },
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// RpcSubscription — async iterable response stream + cancel hook
// ────────────────────────────────────────────────────────────────────────────

export class RpcSubscription {
  private buffer: RpcResponse[] = [];
  private resolvers: Array<(response: IteratorResult<RpcResponse>) => void> = [];
  private closed = false;
  private readonly cleanup = new Set<() => void>();

  static singleShot(response: RpcResponse): RpcSubscription {
    const sub = new RpcSubscription();
    sub.push(response);
    sub.close();
    return sub;
  }

  static fromEffect(requestId: string, effect: Effect.Effect<unknown, unknown>): RpcSubscription {
    const sub = new RpcSubscription();
    void Effect.runPromise(effect)
      .then((result) => {
        sub.push({ kind: "result", requestId, result });
        sub.close();
      })
      .catch((error: unknown) => {
        sub.push({
          kind: "error",
          requestId,
          error: error instanceof Error ? error.message : String(error),
          errorTag:
            typeof (error as { _tag?: unknown })?._tag === "string"
              ? String((error as { _tag: string })._tag)
              : undefined,
        });
        sub.close();
      });
    return sub;
  }

  push(response: RpcResponse): void {
    if (this.closed) return;
    if (this.resolvers.length > 0) {
      const next = this.resolvers.shift()!;
      next({ value: response, done: false });
    } else {
      this.buffer.push(response);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const cleanup of this.cleanup) {
      try {
        cleanup();
      } catch {
        // Cleanup must not prevent subscription closure.
      }
    }
    this.cleanup.clear();
    while (this.resolvers.length > 0) {
      const next = this.resolvers.shift()!;
      next({ value: undefined as unknown as RpcResponse, done: true });
    }
  }

  cancel(): void {
    this.close();
  }

  addCleanup(cleanup: () => void): void {
    if (this.closed) {
      cleanup();
      return;
    }
    this.cleanup.add(cleanup);
  }

  [Symbol.asyncIterator](): AsyncIterator<RpcResponse> {
    return {
      next: () => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as RpcResponse, done: true });
        }
        return new Promise((resolve) => {
          this.resolvers.push(resolve);
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined as unknown as RpcResponse, done: true });
      },
    };
  }
}
