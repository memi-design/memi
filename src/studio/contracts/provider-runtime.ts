/**
 * ProviderRuntime event union — the canonical contract every harness driver
 * emits into.
 *
 * Pattern adapted from pingdotgg/t3code (`packages/contracts/src/providerRuntime.ts`).
 * Every event carries the same base envelope so consumers (UI, telemetry,
 * snapshot store, journal, RPC subscribers) can treat the stream uniformly.
 */

import { z } from "zod";
import type {
  EventId,
  HarnessId,
  ProviderInstanceId,
  SessionId,
  ThreadId,
  ToolCallId,
  TurnId,
} from "./ids.js";

export type SessionState =
  | "idle"
  | "starting"
  | "running"
  | "ready"
  | "interrupted"
  | "stopped"
  | "error";

export type TurnState = "pending" | "running" | "done" | "failed";

export type AuthStatus =
  | "missing"
  | "needs_login"
  | "signed_in"
  | "ready"
  | "not_required";

export type ContentTrust =
  | "trusted"
  | "user"
  | "tool_untrusted"
  | "web_untrusted"
  | "model_generated";

export interface RuntimeTraceContext {
  readonly runId: string;
  /** W3C-compatible 16-byte trace id rendered as 32 lowercase hex chars. */
  readonly traceId: string;
  /** W3C-compatible 8-byte span id rendered as 16 lowercase hex chars. */
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly traceState?: string;
}

export interface ProviderRuntimeEventBase {
  readonly schemaVersion?: 1;
  readonly eventId: EventId;
  readonly seq: number;
  readonly harnessId: HarnessId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly sessionId: SessionId;
  readonly threadId?: ThreadId;
  readonly turnId?: TurnId;
  readonly createdAt: string;
  readonly trace?: RuntimeTraceContext;
  readonly contentTrust?: ContentTrust;
}

export type ProviderRuntimeEvent =
  | SessionLifecycleEvent
  | TurnLifecycleEvent
  | MessageEvent
  | ReasoningEvent
  | ToolEvent
  | ApprovalEvent
  | AuthEvent
  | RateLimitEvent
  | UsageEvent
  | ModelEvent
  | McpEvent
  | DiagnosticEvent
  | StreamEvent;

export type SessionLifecycleEvent = ProviderRuntimeEventBase &
  (
    | { type: "session.created"; harnessConfigSummary: { harness: HarnessId; model?: string; effort?: string } }
    | { type: "session.state.changed"; from: SessionState; to: SessionState; reason?: string }
    | { type: "session.shutdown"; reason: "user" | "error" | "system" }
  );

export type TurnLifecycleEvent = ProviderRuntimeEventBase &
  (
    | { type: "turn.created"; promptPreview: string }
    | { type: "turn.state.changed"; from: TurnState; to: TurnState }
    | { type: "turn.completed"; outcome: "success" | "cancelled" | "error"; error?: string }
  );

export type MessageEvent = ProviderRuntimeEventBase &
  (
    | { type: "message.user"; text: string }
    | { type: "message.assistant.delta"; delta: string }
    | { type: "message.assistant.complete"; text: string }
  );

export type ReasoningEvent = ProviderRuntimeEventBase &
  (
    | { type: "reasoning.delta"; delta: string; effort?: string }
    | { type: "reasoning.complete"; text: string }
  );

export type ToolEvent = ProviderRuntimeEventBase &
  (
    | { type: "tool.call.started"; toolCallId: ToolCallId; tool: string; args: unknown }
    | { type: "tool.call.output"; toolCallId: ToolCallId; chunk: string; stream: "stdout" | "stderr" }
    | { type: "tool.call.completed"; toolCallId: ToolCallId; ok: boolean; result?: unknown; error?: string; elapsedMs: number }
  );

export type ApprovalEvent = ProviderRuntimeEventBase &
  (
    | { type: "approval.requested"; approvalId: string; tool: string; args: unknown; reason: string }
    | { type: "approval.resolved"; approvalId: string; decision: "approved" | "denied"; reason?: string }
  );

export type AuthEvent = ProviderRuntimeEventBase &
  (
    | { type: "auth.status.updated"; status: AuthStatus; message?: string }
  );

export type RateLimitEvent = ProviderRuntimeEventBase &
  (
    | { type: "rate_limit.updated"; state: "ok" | "warning" | "limited" | "unknown"; retryAfterMs?: number; remainingTokens?: number }
  );

export type UsageEvent = ProviderRuntimeEventBase &
  (
    | { type: "usage.updated"; inputTokens: number; outputTokens: number; reasoningTokens?: number; estimatedCostUsd?: number }
  );

export type ModelRef = {
  readonly providerId: string;
  readonly modelId: string;
};

export type ModelEvent = ProviderRuntimeEventBase &
  (
    | {
      type: "model.selected";
      providerId: string;
      requestedModel?: string;
      resolvedModel: string;
      reason: "requested" | "default" | "fallback" | "handoff";
      capabilities: readonly string[];
    }
    | {
      type: "model.changed";
      from: ModelRef;
      to: ModelRef;
      reason: string;
    }
    | {
      type: "model.handoff";
      handoffId: string;
      phase: "requested" | "accepted" | "rejected" | "started" | "completed" | "failed" | "cancelled";
      from: ModelRef;
      to: ModelRef;
      reason?: string;
    }
  );

export type McpEvent = ProviderRuntimeEventBase &
  (
    | { type: "mcp.status.updated"; serverName: string; status: "connecting" | "ready" | "error" | "disconnected"; message?: string }
    | { type: "mcp.tool.registered"; serverName: string; toolName: string; description?: string }
  );

export type DiagnosticEvent = ProviderRuntimeEventBase &
  (
    | { type: "diagnostic.warn"; message: string; data?: unknown }
    | { type: "diagnostic.error"; message: string; data?: unknown }
  );

export type StreamEvent = ProviderRuntimeEventBase &
  (
    | { type: "stream.heartbeat" }
  );

export type ProviderRuntimeEventType = ProviderRuntimeEvent["type"];

export const PROVIDER_RUNTIME_EVENT_TYPES: readonly ProviderRuntimeEventType[] = [
  "session.created",
  "session.state.changed",
  "session.shutdown",
  "turn.created",
  "turn.state.changed",
  "turn.completed",
  "message.user",
  "message.assistant.delta",
  "message.assistant.complete",
  "reasoning.delta",
  "reasoning.complete",
  "tool.call.started",
  "tool.call.output",
  "tool.call.completed",
  "approval.requested",
  "approval.resolved",
  "auth.status.updated",
  "rate_limit.updated",
  "usage.updated",
  "model.selected",
  "model.changed",
  "model.handoff",
  "mcp.status.updated",
  "mcp.tool.registered",
  "diagnostic.warn",
  "diagnostic.error",
  "stream.heartbeat",
] as const;

const idString = z.string().min(1);
const isoTimestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "must be an ISO-8601 timestamp",
});

const traceId = z.string().regex(/^[0-9a-f]{32}$/);
const spanId = z.string().regex(/^[0-9a-f]{16}$/);
const traceContextSchema = z.object({
  runId: idString,
  traceId,
  spanId,
  parentSpanId: spanId.optional(),
  traceState: z.string().max(512).optional(),
});

const baseSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  eventId: idString,
  seq: z.number().int().nonnegative(),
  harnessId: idString,
  providerInstanceId: idString,
  sessionId: idString,
  threadId: idString.optional(),
  turnId: idString.optional(),
  createdAt: isoTimestamp,
  trace: traceContextSchema.optional(),
  contentTrust: z.enum([
    "trusted",
    "user",
    "tool_untrusted",
    "web_untrusted",
    "model_generated",
  ]).optional(),
});

const event = <T extends z.ZodRawShape>(type: ProviderRuntimeEventType, shape?: T) =>
  baseSchema.extend({
    type: z.literal(type),
    ...(shape ?? {} as T),
  }).passthrough();

const modelRefSchema = z.object({
  providerId: idString,
  modelId: idString,
});

export const providerRuntimeEventSchema = z.discriminatedUnion("type", [
  event("session.created", {
    harnessConfigSummary: z.object({
      harness: idString,
      model: z.string().optional(),
      effort: z.string().optional(),
    }),
  }),
  event("session.state.changed", {
    from: z.enum(["idle", "starting", "running", "ready", "interrupted", "stopped", "error"]),
    to: z.enum(["idle", "starting", "running", "ready", "interrupted", "stopped", "error"]),
    reason: z.string().optional(),
  }),
  event("session.shutdown", { reason: z.enum(["user", "error", "system"]) }),
  event("turn.created", { promptPreview: z.string() }),
  event("turn.state.changed", {
    from: z.enum(["pending", "running", "done", "failed"]),
    to: z.enum(["pending", "running", "done", "failed"]),
  }),
  event("turn.completed", {
    outcome: z.enum(["success", "cancelled", "error"]),
    error: z.string().optional(),
  }),
  event("message.user", { text: z.string() }),
  event("message.assistant.delta", { delta: z.string() }),
  event("message.assistant.complete", { text: z.string() }),
  event("reasoning.delta", { delta: z.string(), effort: z.string().optional() }),
  event("reasoning.complete", { text: z.string() }),
  event("tool.call.started", {
    toolCallId: idString,
    tool: idString,
    args: z.unknown(),
  }),
  event("tool.call.output", {
    toolCallId: idString,
    chunk: z.string(),
    stream: z.enum(["stdout", "stderr"]),
  }),
  event("tool.call.completed", {
    toolCallId: idString,
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    elapsedMs: z.number().nonnegative(),
  }),
  event("approval.requested", {
    approvalId: idString,
    tool: idString,
    args: z.unknown(),
    reason: z.string(),
  }),
  event("approval.resolved", {
    approvalId: idString,
    decision: z.enum(["approved", "denied"]),
    reason: z.string().optional(),
  }),
  event("auth.status.updated", {
    status: z.enum(["missing", "needs_login", "signed_in", "ready", "not_required"]),
    message: z.string().optional(),
  }),
  event("rate_limit.updated", {
    state: z.enum(["ok", "warning", "limited", "unknown"]),
    retryAfterMs: z.number().nonnegative().optional(),
    remainingTokens: z.number().nonnegative().optional(),
  }),
  event("usage.updated", {
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    reasoningTokens: z.number().nonnegative().optional(),
    estimatedCostUsd: z.number().nonnegative().optional(),
  }),
  event("model.selected", {
    providerId: idString,
    requestedModel: z.string().optional(),
    resolvedModel: idString,
    reason: z.enum(["requested", "default", "fallback", "handoff"]),
    capabilities: z.array(z.string()),
  }),
  event("model.changed", {
    from: modelRefSchema,
    to: modelRefSchema,
    reason: z.string(),
  }),
  event("model.handoff", {
    handoffId: idString,
    phase: z.enum(["requested", "accepted", "rejected", "started", "completed", "failed", "cancelled"]),
    from: modelRefSchema,
    to: modelRefSchema,
    reason: z.string().optional(),
  }),
  event("mcp.status.updated", {
    serverName: idString,
    status: z.enum(["connecting", "ready", "error", "disconnected"]),
    message: z.string().optional(),
  }),
  event("mcp.tool.registered", {
    serverName: idString,
    toolName: idString,
    description: z.string().optional(),
  }),
  event("diagnostic.warn", { message: z.string(), data: z.unknown().optional() }),
  event("diagnostic.error", { message: z.string(), data: z.unknown().optional() }),
  event("stream.heartbeat"),
]);

export function parseProviderRuntimeEvent(raw: unknown): ProviderRuntimeEvent {
  const parsed = providerRuntimeEventSchema.parse(raw);
  return parsed as unknown as ProviderRuntimeEvent;
}

export function safeParseProviderRuntimeEvent(
  raw: unknown,
):
  | { ok: true; event: ProviderRuntimeEvent }
  | { ok: false; error: string } {
  const result = providerRuntimeEventSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, event: result.data as unknown as ProviderRuntimeEvent };
  }
  return { ok: false, error: result.error.message };
}
