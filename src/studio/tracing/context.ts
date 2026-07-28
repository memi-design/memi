import { randomBytes, randomUUID } from "node:crypto";
import type { RuntimeTraceContext } from "../contracts/provider-runtime.js";

export function createTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function createSpanId(): string {
  return randomBytes(8).toString("hex");
}

export function createRuntimeTraceContext(
  input: {
    runId?: string;
    traceId?: string;
    parentSpanId?: string;
    traceState?: string;
  } = {},
): RuntimeTraceContext {
  return Object.freeze({
    runId: input.runId ?? `run_${randomUUID().replaceAll("-", "")}`,
    traceId: input.traceId ?? createTraceId(),
    spanId: createSpanId(),
    parentSpanId: input.parentSpanId,
    traceState: input.traceState,
  });
}

export function createChildTraceContext(
  parent: RuntimeTraceContext,
): RuntimeTraceContext {
  return createRuntimeTraceContext({
    runId: parent.runId,
    traceId: parent.traceId,
    parentSpanId: parent.spanId,
    traceState: parent.traceState,
  });
}
