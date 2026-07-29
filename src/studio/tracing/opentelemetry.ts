import type {
  ProviderRuntimeEvent,
  RuntimeTraceContext,
} from "../contracts/provider-runtime.js";

export interface OpenTelemetryProjection {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly timestamp: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface TelemetrySink {
  emit(projection: OpenTelemetryProjection): Promise<void>;
}

export class NoopTelemetrySink implements TelemetrySink {
  async emit(_projection: OpenTelemetryProjection): Promise<void> {}
}

export class MemoryTelemetrySink implements TelemetrySink {
  readonly projections: OpenTelemetryProjection[] = [];

  async emit(projection: OpenTelemetryProjection): Promise<void> {
    this.projections.push(Object.freeze({
      ...projection,
      attributes: Object.freeze({ ...projection.attributes }),
    }));
  }
}

export function buildTraceParent(
  trace: RuntimeTraceContext,
  sampled = true,
): string {
  if (!/^[0-9a-f]{32}$/.test(trace.traceId) || !/^[0-9a-f]{16}$/.test(trace.spanId)) {
    throw new Error("invalid W3C trace context");
  }
  return `00-${trace.traceId}-${trace.spanId}-${sampled ? "01" : "00"}`;
}

export function projectRuntimeEventToOpenTelemetry(
  event: ProviderRuntimeEvent,
): OpenTelemetryProjection {
  if (!event.trace) {
    throw new Error(`runtime event ${event.eventId} has no trace context`);
  }
  const attributes: Record<string, string | number | boolean> = {
    "memi.schema.version": event.schemaVersion ?? 1,
    "memi.run.id": event.trace.runId,
    "memi.event.type": event.type,
    "memi.event.sequence": event.seq,
    "memi.harness.id": String(event.harnessId),
    "memi.provider.instance.id": String(event.providerInstanceId),
    "gen_ai.operation.name": operationName(event),
  };

  if (event.type === "model.selected") {
    attributes["gen_ai.provider.name"] = event.providerId;
    attributes["gen_ai.request.model"] = event.resolvedModel;
    attributes["memi.model.selection.reason"] = event.reason;
  } else if (event.type === "usage.updated") {
    attributes["gen_ai.usage.input_tokens"] = event.inputTokens;
    if (event.cachedInputTokens !== undefined) {
      attributes["gen_ai.usage.cached_input_tokens"] = event.cachedInputTokens;
    }
    attributes["gen_ai.usage.output_tokens"] = event.outputTokens;
    if (event.reasoningTokens !== undefined) {
      attributes["gen_ai.usage.reasoning_tokens"] = event.reasoningTokens;
    }
  } else if (
    event.type === "tool.call.started"
    || event.type === "tool.call.output"
    || event.type === "tool.call.completed"
  ) {
    attributes["gen_ai.tool.call.id"] = String(event.toolCallId);
    if (event.type === "tool.call.started") attributes["gen_ai.tool.name"] = event.tool;
  } else if (event.type === "model.changed") {
    attributes["gen_ai.provider.name"] = event.to.providerId;
    attributes["gen_ai.request.model"] = event.to.modelId;
    attributes["memi.model.previous.provider"] = event.from.providerId;
    attributes["memi.model.previous.id"] = event.from.modelId;
  } else if (event.type === "model.handoff") {
    attributes["memi.handoff.id"] = event.handoffId;
    attributes["memi.handoff.phase"] = event.phase;
    attributes["gen_ai.provider.name"] = event.to.providerId;
    attributes["gen_ai.request.model"] = event.to.modelId;
  }

  return Object.freeze({
    name: event.type,
    traceId: event.trace.traceId,
    spanId: event.trace.spanId,
    parentSpanId: event.trace.parentSpanId,
    timestamp: event.createdAt,
    attributes: Object.freeze(attributes),
  });
}

export async function exportRuntimeEvent(
  event: ProviderRuntimeEvent,
  sink: TelemetrySink = new NoopTelemetrySink(),
): Promise<void> {
  await sink.emit(projectRuntimeEventToOpenTelemetry(event));
}

function operationName(event: ProviderRuntimeEvent): string {
  if (event.type.startsWith("tool.")) return "execute_tool";
  if (event.type.startsWith("model.handoff")) return "invoke_agent";
  if (event.type.startsWith("model.") || event.type.startsWith("message.")) return "chat";
  if (event.type.startsWith("session.")) return "invoke_workflow";
  return "invoke_agent";
}
