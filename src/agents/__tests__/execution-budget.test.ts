import { describe, expect, it, vi } from "vitest";
import {
  ExecutionBudgetExceededError,
  ExecutionBudgetGuard,
} from "../execution-budget.js";

const ceilings = {
  inputTokens: 100,
  outputTokens: 50,
  reasoningTokens: 20,
  wallTimeMs: 25,
  toolCalls: 2,
  implementationAttempts: 1 as const,
};

describe("ExecutionBudgetGuard", () => {
  it("fails closed on every measurable post-response ceiling", () => {
    const guard = new ExecutionBudgetGuard(ceilings);

    guard.observeUsage({
      inputTokens: 101,
      outputTokens: 51,
      reasoningTokens: 21,
      toolCalls: 3,
    }, {
      reasoningTokens: "measured",
      toolCalls: "measured",
    });

    expect(() => guard.assertWithinLimits()).toThrow(ExecutionBudgetExceededError);
    expect(guard.report()).toMatchObject({
      stopReason: "token-budget-exhausted",
      exceededDimensions: [
        "input-tokens",
        "output-tokens",
        "reasoning-tokens",
        "tool-calls",
      ],
      observed: {
        inputTokens: 101,
        outputTokens: 51,
        reasoningTokens: 21,
        toolCalls: 3,
      },
    });
  });

  it("times out, aborts the orchestration signal, and records the cancellation boundary", async () => {
    vi.useFakeTimers();
    const guard = new ExecutionBudgetGuard(ceilings);
    let observedAbort = false;

    const execution = guard.runWithinWallTime(async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          observedAbort = true;
          resolve();
        }, { once: true });
      });
      return "late";
    });

    await vi.advanceTimersByTimeAsync(ceilings.wallTimeMs);
    await expect(execution).rejects.toMatchObject({
      name: "ExecutionBudgetExceededError",
      stopReason: "time-budget-exhausted",
    });
    expect(observedAbort).toBe(true);
    expect(guard.report()).toMatchObject({
      stopReason: "time-budget-exhausted",
      limitations: ["provider-request-cancellation-unavailable"],
    });
    vi.useRealTimers();
  });

  it("records unavailable reasoning telemetry without fabricating usage", () => {
    const guard = new ExecutionBudgetGuard(ceilings);

    guard.observeUsage({
      inputTokens: 90,
      outputTokens: 40,
      reasoningTokens: 0,
      toolCalls: 0,
    }, {
      reasoningTokens: "unavailable",
      toolCalls: "measured",
    });

    expect(guard.report()).toMatchObject({
      stopReason: null,
      measurement: {
        inputTokens: "measured",
        outputTokens: "measured",
        reasoningTokens: "unavailable",
        toolCalls: "measured",
      },
      limitations: [
        "provider-request-cancellation-unavailable",
        "reasoning-token-usage-unavailable",
      ],
    });
  });
});
