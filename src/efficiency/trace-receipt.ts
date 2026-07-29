import { createHash } from "node:crypto";
import type { ProviderRuntimeEvent } from "../studio/contracts/provider-runtime.js";
import { UsageRollup } from "../studio/usage-rollup.js";
import { sanitizeRuntimeEvent } from "../studio/tracing/privacy.js";

export interface TraceReceipt {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly eventCount: number;
  readonly firstEventAt: string | null;
  readonly lastEventAt: string | null;
  readonly traceIds: readonly string[];
  readonly contentIncluded: false;
  readonly sha256: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly outputTokens: number;
    readonly reasoningTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostUsd: number;
    readonly toolCallCount: number;
    readonly toolErrorCount: number;
    readonly totalToolMs: number;
  };
}

export function buildTraceReceipt(
  sessionId: string,
  inputEvents: readonly ProviderRuntimeEvent[],
): {
  readonly receipt: Readonly<TraceReceipt>;
  readonly events: readonly ProviderRuntimeEvent[];
} {
  const events = Object.freeze(inputEvents.map((event) =>
    Object.freeze(sanitizeRuntimeEvent(event))));
  const rollup = new UsageRollup();
  for (const event of events) rollup.consume(event);
  const snapshot = rollup.all().at(-1);
  const serialized = events.map((event) => JSON.stringify(event)).join("\n");
  const traceIds = Array.from(new Set(
    events.flatMap((event) => event.trace?.traceId ? [event.trace.traceId] : []),
  )).sort();

  const receipt = Object.freeze({
    schemaVersion: 1 as const,
    sessionId,
    eventCount: events.length,
    firstEventAt: events.at(0)?.createdAt ?? null,
    lastEventAt: events.at(-1)?.createdAt ?? null,
    traceIds: Object.freeze(traceIds),
    contentIncluded: false as const,
    sha256: `sha256:${createHash("sha256").update(serialized).digest("hex")}`,
    usage: Object.freeze({
      inputTokens: snapshot?.inputTokens ?? 0,
      cachedInputTokens: snapshot?.cachedInputTokens ?? 0,
      outputTokens: snapshot?.outputTokens ?? 0,
      reasoningTokens: snapshot?.reasoningTokens ?? 0,
      totalTokens: snapshot?.totalTokens ?? 0,
      estimatedCostUsd: snapshot?.estimatedCostUsd ?? 0,
      toolCallCount: snapshot?.toolCallCount ?? 0,
      toolErrorCount: snapshot?.toolErrorCount ?? 0,
      totalToolMs: snapshot?.totalToolMs ?? 0,
    }),
  });

  return Object.freeze({ receipt, events });
}
