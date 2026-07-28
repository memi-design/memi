import { describe, expect, it } from "vitest";
import {
  PROVIDER_RUNTIME_EVENT_TYPES,
  parseProviderRuntimeEvent,
  safeParseProviderRuntimeEvent,
} from "../../contracts/provider-runtime.js";
import { makeId } from "../../contracts/ids.js";

function envelope() {
  return {
    eventId: makeId("EventId"),
    seq: 1,
    harnessId: makeId("HarnessId"),
    providerInstanceId: makeId("ProviderInstanceId"),
    sessionId: makeId("SessionId"),
    createdAt: new Date().toISOString(),
  };
}

describe("contracts/provider-runtime", () => {
  it("event-type constant covers all event variants", () => {
    expect(PROVIDER_RUNTIME_EVENT_TYPES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(PROVIDER_RUNTIME_EVENT_TYPES).size).toBe(PROVIDER_RUNTIME_EVENT_TYPES.length);
  });

  it("parses a valid session.created event", () => {
    const event = parseProviderRuntimeEvent({
      ...envelope(),
      type: "session.created",
      harnessConfigSummary: { harness: "hns_x", model: "gpt-5.5" },
    });
    expect(event.type).toBe("session.created");
  });

  it("parses tool lifecycle events", () => {
    const started = parseProviderRuntimeEvent({
      ...envelope(),
      type: "tool.call.started",
      toolCallId: makeId("ToolCallId"),
      tool: "Bash",
      args: { command: "ls" },
    });
    expect(started.type).toBe("tool.call.started");

    const completed = parseProviderRuntimeEvent({
      ...envelope(),
      type: "tool.call.completed",
      toolCallId: makeId("ToolCallId"),
      ok: true,
      elapsedMs: 42,
    });
    expect(completed.type).toBe("tool.call.completed");
  });

  it("rejects unknown event types via safeParse", () => {
    const result = safeParseProviderRuntimeEvent({ ...envelope(), type: "completely.made.up" });
    expect(result.ok).toBe(false);
  });

  it("rejects missing envelope fields", () => {
    const result = safeParseProviderRuntimeEvent({ type: "session.created", harnessConfigSummary: { harness: "hns_x" } });
    expect(result.ok).toBe(false);
  });

  it("parses heartbeat as a minimal stream event", () => {
    const event = parseProviderRuntimeEvent({ ...envelope(), type: "stream.heartbeat" });
    expect(event.type).toBe("stream.heartbeat");
  });

  it("rejects bad timestamp format", () => {
    const result = safeParseProviderRuntimeEvent({
      ...envelope(),
      createdAt: "not-a-date",
      type: "stream.heartbeat",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects event variants whose required payload is missing", () => {
    const result = safeParseProviderRuntimeEvent({
      ...envelope(),
      type: "tool.call.started",
    });
    expect(result.ok).toBe(false);
  });

  it("validates model selection and model handoff receipts", () => {
    const selected = parseProviderRuntimeEvent({
      ...envelope(),
      type: "model.selected",
      providerId: "openai",
      requestedModel: "gpt-5",
      resolvedModel: "gpt-5",
      reason: "requested",
      capabilities: ["chat.text", "tool.call"],
    });
    expect(selected.type).toBe("model.selected");

    const handoff = parseProviderRuntimeEvent({
      ...envelope(),
      type: "model.handoff",
      handoffId: "handoff-1",
      phase: "completed",
      from: { providerId: "openai", modelId: "gpt-5" },
      to: { providerId: "anthropic", modelId: "claude" },
      reason: "visual-review",
    });
    expect(handoff.type).toBe("model.handoff");
  });

  it("validates W3C-compatible trace context when present", () => {
    const valid = safeParseProviderRuntimeEvent({
      ...envelope(),
      type: "stream.heartbeat",
      trace: {
        runId: "run-1",
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
      },
    });
    expect(valid.ok).toBe(true);

    const invalid = safeParseProviderRuntimeEvent({
      ...envelope(),
      type: "stream.heartbeat",
      trace: {
        runId: "run-1",
        traceId: "not-a-trace-id",
        spanId: "short",
      },
    });
    expect(invalid.ok).toBe(false);
  });
});
