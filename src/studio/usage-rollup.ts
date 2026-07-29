import type { EventBus, EventBusSubscription } from "./event-bus.js";
import type { HarnessId, SessionId, ToolCallId } from "./contracts/ids.js";
import type { ProviderRuntimeEvent } from "./contracts/provider-runtime.js";

export interface UsageSnapshot {
  readonly sessionId: SessionId;
  readonly harnessId: HarnessId;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
  readonly toolCallCount: number;
  readonly toolErrorCount: number;
  readonly totalToolMs: number;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly lastUpdatedAt: string;
}

export interface ToolLatency {
  readonly toolCallId: ToolCallId;
  readonly tool: string;
  readonly ok: boolean;
  readonly elapsedMs: number;
  readonly at: string;
}

export interface HarnessTotals {
  readonly harnessId: HarnessId;
  readonly sessionCount: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
  readonly toolCallCount: number;
  readonly toolErrorCount: number;
  readonly totalToolMs: number;
}

/**
 * Reduce canonical runtime events into immutable usage projections.
 *
 * The internal maps are replaced on every event. Returned records and arrays
 * are frozen copies, so a UI, exporter, or benchmark reporter cannot corrupt
 * the durable accounting state by retaining and mutating a reference.
 */
export class UsageRollup {
  private sessions: ReadonlyMap<string, Readonly<UsageSnapshot>> = new Map();
  private toolLatencies: ReadonlyMap<string, readonly Readonly<ToolLatency>[]> = new Map();
  private toolNames: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map();
  private subscription: EventBusSubscription | null = null;

  constructor(bus?: EventBus) {
    if (bus) this.subscribe(bus);
  }

  subscribe(bus: EventBus): EventBusSubscription {
    this.subscription?.unsubscribe();
    this.subscription = bus.subscribe((event) => this.consume(event));
    return this.subscription;
  }

  detach(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  reset(): void {
    this.sessions = new Map();
    this.toolLatencies = new Map();
    this.toolNames = new Map();
  }

  consume(event: ProviderRuntimeEvent): void {
    const key = String(event.sessionId);

    if (event.type === "tool.call.started") {
      const sessionNames = new Map(this.toolNames.get(key) ?? []);
      sessionNames.set(String(event.toolCallId), event.tool);
      const nextNames = new Map(this.toolNames);
      nextNames.set(key, sessionNames);
      this.toolNames = nextNames;
    }

    const current = this.sessions.get(key) ?? emptySnapshot(event);
    const next = reduceUsageSnapshot(current, event);
    const nextSessions = new Map(this.sessions);
    nextSessions.set(key, next);
    this.sessions = nextSessions;

    if (event.type === "tool.call.completed") {
      const latency = Object.freeze({
        toolCallId: event.toolCallId,
        tool: this.toolNames.get(key)?.get(String(event.toolCallId)) ?? "unknown",
        ok: event.ok,
        elapsedMs: event.elapsedMs,
        at: event.createdAt,
      });
      const nextTimeline = Object.freeze([
        ...(this.toolLatencies.get(key) ?? []),
        latency,
      ]);
      const nextLatencies = new Map(this.toolLatencies);
      nextLatencies.set(key, nextTimeline);
      this.toolLatencies = nextLatencies;
    }
  }

  sessionUsage(sessionId: SessionId): Readonly<UsageSnapshot> | null {
    const snapshot = this.sessions.get(String(sessionId));
    return snapshot ? frozenSnapshot(snapshot) : null;
  }

  toolTimeline(sessionId: SessionId, toolName?: string): readonly Readonly<ToolLatency>[] {
    const timeline = this.toolLatencies.get(String(sessionId)) ?? [];
    const selected = toolName
      ? timeline.filter((entry) => entry.tool === toolName)
      : [...timeline];
    return Object.freeze(selected.map((entry) => Object.freeze({ ...entry })));
  }

  harnessTotals(harnessId: HarnessId): Readonly<HarnessTotals> {
    let sessionCount = 0;
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let estimatedCostUsd = 0;
    let toolCallCount = 0;
    let toolErrorCount = 0;
    let totalToolMs = 0;

    for (const snapshot of this.sessions.values()) {
      if (snapshot.harnessId !== harnessId) continue;
      sessionCount += 1;
      inputTokens += snapshot.inputTokens;
      cachedInputTokens += snapshot.cachedInputTokens;
      outputTokens += snapshot.outputTokens;
      reasoningTokens += snapshot.reasoningTokens;
      estimatedCostUsd += snapshot.estimatedCostUsd;
      toolCallCount += snapshot.toolCallCount;
      toolErrorCount += snapshot.toolErrorCount;
      totalToolMs += snapshot.totalToolMs;
    }

    return Object.freeze({
      harnessId,
      sessionCount,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens: inputTokens + outputTokens + reasoningTokens,
      estimatedCostUsd,
      toolCallCount,
      toolErrorCount,
      totalToolMs,
    });
  }

  all(): readonly Readonly<UsageSnapshot>[] {
    return Object.freeze(
      Array.from(this.sessions.values(), (snapshot) => frozenSnapshot(snapshot)),
    );
  }
}

function emptySnapshot(event: ProviderRuntimeEvent): Readonly<UsageSnapshot> {
  return Object.freeze({
    sessionId: event.sessionId,
    harnessId: event.harnessId,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    toolCallCount: 0,
    toolErrorCount: 0,
    totalToolMs: 0,
    lastUpdatedAt: event.createdAt,
  });
}

function reduceUsageSnapshot(
  current: Readonly<UsageSnapshot>,
  event: ProviderRuntimeEvent,
): Readonly<UsageSnapshot> {
  let next: UsageSnapshot = {
    ...current,
    lastUpdatedAt: event.createdAt,
  };

  if (event.type === "session.created") {
    next = { ...next, startedAt: event.createdAt };
  } else if (event.type === "session.shutdown") {
    next = { ...next, endedAt: event.createdAt };
  } else if (event.type === "usage.updated") {
    const inputTokens = current.inputTokens + event.inputTokens;
    const outputTokens = current.outputTokens + event.outputTokens;
    const reasoningTokens = current.reasoningTokens + (event.reasoningTokens ?? 0);
    next = {
      ...next,
      inputTokens,
      cachedInputTokens: current.cachedInputTokens + (event.cachedInputTokens ?? 0),
      outputTokens,
      reasoningTokens,
      totalTokens: inputTokens + outputTokens + reasoningTokens,
      estimatedCostUsd: current.estimatedCostUsd + (event.estimatedCostUsd ?? 0),
    };
  } else if (event.type === "tool.call.completed") {
    next = {
      ...next,
      toolCallCount: current.toolCallCount + 1,
      toolErrorCount: current.toolErrorCount + (event.ok ? 0 : 1),
      totalToolMs: current.totalToolMs + event.elapsedMs,
    };
  }

  return frozenSnapshot(next);
}

function frozenSnapshot(snapshot: Readonly<UsageSnapshot>): Readonly<UsageSnapshot> {
  return Object.freeze({ ...snapshot });
}
