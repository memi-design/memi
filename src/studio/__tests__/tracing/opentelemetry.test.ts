import { describe, expect, it } from "vitest";
import { asId, makeId } from "../../contracts/ids.js";
import {
  buildTraceParent,
  projectRuntimeEventToOpenTelemetry,
} from "../../tracing/opentelemetry.js";

describe("tracing/opentelemetry", () => {
  const trace = {
    runId: "run-1",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
  } as const;

  it("builds a W3C traceparent header", () => {
    expect(buildTraceParent(trace)).toBe(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    );
  });

  it("maps canonical model events without exporting prompts or tool payloads", () => {
    const event = {
      schemaVersion: 1,
      eventId: asId("EventId", makeId("EventId")),
      seq: 1,
      harnessId: asId("HarnessId", "hns_codex"),
      providerInstanceId: asId("ProviderInstanceId", "prv_x"),
      sessionId: asId("SessionId", "ses_x"),
      createdAt: new Date().toISOString(),
      trace,
      type: "model.selected",
      providerId: "openai",
      resolvedModel: "gpt-5",
      reason: "requested",
      capabilities: ["chat.text"],
    } as const;
    const projected = projectRuntimeEventToOpenTelemetry(event);
    expect(projected.attributes).toMatchObject({
      "gen_ai.provider.name": "openai",
      "gen_ai.request.model": "gpt-5",
      "gen_ai.operation.name": "chat",
      "memi.run.id": "run-1",
    });
    expect(JSON.stringify(projected)).not.toContain("prompt");
    expect(JSON.stringify(projected)).not.toContain("args");
  });
});
