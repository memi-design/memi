import { describe, expect, it } from "vitest";
import {
  buildClaudeWorkflowArgs,
  buildCodexWorkflowArgs,
  parseClaudeStreamJson,
} from "../workflow-adapters.js";

describe("model-agnostic workflow adapters", () => {
  it("builds isolated writable Codex arguments", () => {
    const args = buildCodexWorkflowArgs({
      workspaceRoot: "/tmp/workspace",
      modelId: "gpt-5.6-sol",
      reasoningEffort: "medium",
    });

    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("workspace-write");
    expect(args).toContain("--ephemeral");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("builds non-persistent Claude arguments with skills and MCP disabled", () => {
    const args = buildClaudeWorkflowArgs({
      modelId: "claude-sonnet-4-6",
      reasoningEffort: "medium",
    });

    expect(args).toContain("--disable-slash-commands");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("acceptEdits");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("normalizes Claude usage, cost, tool calls, and failed tools", () => {
    const parsed = parseClaudeStreamJson([
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tool-1", name: "Read" },
            { type: "tool_use", id: "tool-2", name: "Bash" },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tool-2",
            is_error: true,
          }],
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Implemented and verified.",
        total_cost_usd: 0.42,
        usage: {
          input_tokens: 1000,
          cache_read_input_tokens: 400,
          output_tokens: 200,
        },
      }),
    ].join("\n"));

    expect(parsed.finalResponse).toBe("Implemented and verified.");
    expect(parsed.usage).toEqual({
      inputTokens: 1000,
      cachedInputTokens: 400,
      outputTokens: 200,
      reasoningTokens: 0,
      estimatedCostUsd: 0.42,
    });
    expect(parsed.tools).toEqual({ calls: 2, errors: 1, retries: 0 });
  });
});
