import { describe, expect, it } from "vitest";
import { asId, makeId } from "../../contracts/ids.js";
import type { ProviderRuntimeEvent } from "../../contracts/provider-runtime.js";
import {
  DEFAULT_TRACE_PRIVACY_POLICY,
  sanitizeRuntimeEvent,
} from "../../tracing/privacy.js";

function event(overrides: Partial<ProviderRuntimeEvent>): ProviderRuntimeEvent {
  return {
    eventId: asId("EventId", makeId("EventId")),
    seq: 1,
    harnessId: asId("HarnessId", "hns_codex"),
    providerInstanceId: asId("ProviderInstanceId", "prv_x"),
    sessionId: asId("SessionId", "ses_x"),
    createdAt: new Date().toISOString(),
    type: "stream.heartbeat",
    ...overrides,
  } as ProviderRuntimeEvent;
}

describe("tracing/privacy", () => {
  it("defaults durable traces to metadata-only content", () => {
    const sanitized = sanitizeRuntimeEvent(event({
      type: "message.user",
      text: "Design this. OPENAI_API_KEY=sk-proj-secret person@example.com",
    }), DEFAULT_TRACE_PRIVACY_POLICY);

    expect(sanitized).toMatchObject({
      type: "message.user",
      text: "[content omitted]",
    });
    expect(JSON.stringify(sanitized)).not.toContain("sk-proj-secret");
    expect(JSON.stringify(sanitized)).not.toContain("person@example.com");
  });

  it("recursively redacts secrets from structured tool payloads", () => {
    const sanitized = sanitizeRuntimeEvent(event({
      type: "tool.call.started",
      toolCallId: asId("ToolCallId", "tcl_x"),
      tool: "Bash",
      args: {
        command: "echo safe",
        env: {
          OPENAI_API_KEY: "sk-proj-secret",
          cookie: "session=private",
        },
      },
    }), {
      ...DEFAULT_TRACE_PRIVACY_POLICY,
      captureMode: "local_content",
    });

    const serialized = JSON.stringify(sanitized);
    expect(serialized).toContain("echo safe");
    expect(serialized).not.toContain("sk-proj-secret");
    expect(serialized).not.toContain("session=private");
  });

  it("never persists hidden reasoning text", () => {
    const sanitized = sanitizeRuntimeEvent(event({
      type: "reasoning.complete",
      text: "private chain of thought",
    }), {
      ...DEFAULT_TRACE_PRIVACY_POLICY,
      captureMode: "export_content",
    });
    expect(sanitized).toMatchObject({
      type: "reasoning.complete",
      text: "[reasoning omitted]",
    });
  });
});
