import { describe, expect, it } from "vitest";
import { createToolCallBudgetMonitor } from "../workflow-adapters.js";
import { assessWorkflowBudget } from "../workflow-budget.js";

describe("workflow agent budgets", () => {
  it("records every exceeded budget dimension instead of accepting an expensive run", () => {
    const result = assessWorkflowBudget({
      maxToolCalls: 12,
      maxInputTokens: 300_000,
      maxOutputTokens: 8_000,
      maxReasoningTokens: 4_000,
    }, {
      usage: {
        inputTokens: 300_001,
        cachedInputTokens: 250_000,
        outputTokens: 8_001,
        reasoningTokens: 4_001,
        estimatedCostUsd: null,
      },
      tools: { calls: 13, errors: 0, retries: 0 },
    });

    expect(result).toEqual({
      withinBudget: false,
      exceeded: [
        "max-tool-calls",
        "max-input-tokens",
        "max-output-tokens",
        "max-reasoning-tokens",
      ],
      observed: {
        toolCalls: 13,
        toolOutputBytes: 0,
        inputTokens: 300_001,
        outputTokens: 8_001,
        reasoningTokens: 4_001,
      },
    });
  });

  it("accepts a run exactly at each limit", () => {
    expect(assessWorkflowBudget({
      maxToolCalls: 12,
      maxInputTokens: 300_000,
      maxOutputTokens: 8_000,
      maxReasoningTokens: 4_000,
    }, {
      usage: {
        inputTokens: 300_000,
        cachedInputTokens: 250_000,
        outputTokens: 8_000,
        reasoningTokens: 4_000,
        estimatedCostUsd: null,
      },
      tools: { calls: 12, errors: 0, retries: 0 },
    }).withinBudget).toBe(true);
  });

  it("stops an adapter once its streamed provider events exceed the tool-call cap", () => {
    const monitor = createToolCallBudgetMonitor(2);

    monitor.ingest('{"type":"item.started","item":{"id":"cmd-1","type":"command_execution"}}\n');
    monitor.ingest('{"type":"item.started","item":{"id":"cmd-2","type":"command_execution"}}\n');
    monitor.ingest('{"type":"item.started","item":{"id":"cmd-3","type":"command_execution"}}\n');

    expect(monitor.snapshot()).toEqual({
      observedToolCalls: 3,
      observedToolOutputBytes: 0,
      exceeded: true,
      exceededDimensions: ["max-tool-calls"],
    });
  });

  it("halts an adapter once an oversized command transcript is observed", () => {
    const monitor = createToolCallBudgetMonitor({
      maximumToolCalls: 2,
      maximumToolOutputBytes: 8,
    });

    monitor.ingest('{"type":"item.started","item":{"id":"cmd-1","type":"command_execution"}}\n');
    const stopped = monitor.ingest('{"type":"item.completed","item":{"id":"cmd-1","type":"command_execution","aggregated_output":"123456789"}}\n');

    expect(stopped).toBe(true);
    expect(monitor.snapshot()).toMatchObject({
      observedToolCalls: 1,
      observedToolOutputBytes: 9,
      exceeded: true,
      exceededDimensions: ["max-tool-output-bytes"],
    });
  });
});
