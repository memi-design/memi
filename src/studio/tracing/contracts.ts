import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSpanId, createTraceId } from "./context.js";

export const tracePrivacyModeSchema = z.enum([
  "off",
  "metadata_only",
  "local_content",
  "export_content",
]);

export type TracePrivacyMode = z.infer<typeof tracePrivacyModeSchema>;

const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
const spanIdSchema = z.string().regex(/^[0-9a-f]{16}$/);
const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)));

export const traceOperationSchema = z.enum([
  "invoke_workflow",
  "invoke_agent",
  "chat",
  "execute_tool",
  "render",
  "figma",
  "handoff",
  "evaluate",
]);

export type TraceOperation = z.infer<typeof traceOperationSchema>;

export const runRecordSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  traceId: traceIdSchema,
  rootSpanId: spanIdSchema,
  workflowName: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  capabilities: z.array(z.string()),
  privacyMode: tracePrivacyModeSchema,
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  startedAt: timestampSchema,
  completedAt: timestampSchema.optional(),
  parentRunId: z.string().optional(),
});

export type RunRecord = z.infer<typeof runRecordSchema>;

export const spanRecordSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  traceId: traceIdSchema,
  spanId: spanIdSchema,
  parentSpanId: spanIdSchema.optional(),
  operation: traceOperationSchema,
  name: z.string().min(1),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  startedAt: timestampSchema,
  completedAt: timestampSchema.optional(),
  links: z.array(z.object({
    traceId: traceIdSchema,
    spanId: spanIdSchema,
  })).default([]),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export type SpanRecord = z.infer<typeof spanRecordSchema>;

export function createRunRecord(input: {
  workflowName: string;
  providerId: string;
  modelId: string;
  capabilities: readonly string[];
  privacyMode: TracePrivacyMode;
  parentRunId?: string;
  now?: string;
}): Readonly<RunRecord> {
  return Object.freeze(runRecordSchema.parse({
    schemaVersion: 1,
    runId: `run_${randomUUID().replaceAll("-", "")}`,
    traceId: createTraceId(),
    rootSpanId: createSpanId(),
    workflowName: input.workflowName,
    providerId: input.providerId,
    modelId: input.modelId,
    capabilities: [...input.capabilities],
    privacyMode: input.privacyMode,
    status: "running",
    startedAt: input.now ?? new Date().toISOString(),
    parentRunId: input.parentRunId,
  }));
}

export function createSpanRecord(
  run: RunRecord,
  input: {
    operation: TraceOperation;
    name: string;
    parentSpanId?: string;
    links?: ReadonlyArray<{ traceId: string; spanId: string }>;
    attributes?: Readonly<Record<string, string | number | boolean>>;
    now?: string;
  },
): Readonly<SpanRecord> {
  return Object.freeze(spanRecordSchema.parse({
    schemaVersion: 1,
    runId: run.runId,
    traceId: run.traceId,
    spanId: createSpanId(),
    parentSpanId: input.parentSpanId,
    operation: input.operation,
    name: input.name,
    status: "running",
    startedAt: input.now ?? new Date().toISOString(),
    links: input.links ? [...input.links] : [],
    attributes: input.attributes ? { ...input.attributes } : {},
  }));
}
