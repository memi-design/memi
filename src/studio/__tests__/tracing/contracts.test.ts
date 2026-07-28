import { describe, expect, it } from "vitest";
import {
  createRunRecord,
  createSpanRecord,
  runRecordSchema,
  spanRecordSchema,
} from "../../tracing/contracts.js";

describe("tracing/contracts", () => {
  it("creates a versioned run record suitable for TypeScript, Rust, and GUI consumers", () => {
    const run = createRunRecord({
      workflowName: "design-audit",
      providerId: "openai-compatible",
      modelId: "custom-design-model",
      privacyMode: "metadata_only",
      capabilities: ["chat.text", "tool.call"],
    });

    expect(runRecordSchema.parse(run)).toMatchObject({
      schemaVersion: 1,
      workflowName: "design-audit",
      providerId: "openai-compatible",
      modelId: "custom-design-model",
    });
    expect(run.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("creates linked child spans with stable operation categories", () => {
    const run = createRunRecord({
      workflowName: "design-audit",
      providerId: "openai",
      modelId: "gpt-5",
      privacyMode: "metadata_only",
      capabilities: ["chat.text"],
    });
    const parent = createSpanRecord(run, { operation: "invoke_agent", name: "audit-agent" });
    const child = createSpanRecord(run, {
      operation: "evaluate",
      name: "design-quality",
      parentSpanId: parent.spanId,
    });

    expect(spanRecordSchema.parse(child)).toMatchObject({
      schemaVersion: 1,
      traceId: run.traceId,
      parentSpanId: parent.spanId,
      operation: "evaluate",
    });
  });
});
