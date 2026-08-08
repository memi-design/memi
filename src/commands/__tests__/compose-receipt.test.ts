import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildComposeAttemptLedger,
  deriveComposeStopReason,
  reserveReceiptSequence,
} from "../compose-receipt.js";
import { ExecutionBudgetGuard } from "../../agents/execution-budget.js";

describe("compose receipt stop reasons", () => {
  it("distinguishes preflight, exhausted execution, and missing verification evidence", () => {
    expect(deriveComposeStopReason(true, "completed")).toBe("preflight-failed");
    expect(deriveComposeStopReason(false, "failed")).toBe("attempt-limit-reached");
    expect(deriveComposeStopReason(false, "partial")).toBe("attempt-limit-reached");
    expect(deriveComposeStopReason(false, "completed")).toBe("verification-failed");
    expect(deriveComposeStopReason(false, "completed", "token-budget-exhausted"))
      .toBe("token-budget-exhausted");
    expect(deriveComposeStopReason(false, "completed", "time-budget-exhausted"))
      .toBe("time-budget-exhausted");
    expect(deriveComposeStopReason(false, "completed", "tool-budget-exhausted"))
      .toBe("tool-budget-exhausted");
  });

  it("atomically reserves unique ledger sequences for concurrent writers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-receipt-sequence-"));
    const sequences = await Promise.all(Array.from({ length: 8 }, () =>
      reserveReceiptSequence(root)));

    expect([...sequences].sort((left, right) => left - right)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("maps the exact two-attempt budget history into one receipt retry", () => {
    const guard = new ExecutionBudgetGuard({
      inputTokens: 1_000,
      outputTokens: 200,
      reasoningTokens: 100,
      wallTimeMs: 60_000,
      toolCalls: 10,
      implementationAttempts: 2,
    });
    guard.startImplementationAttempt(1);
    guard.observeUsage(
      { inputTokens: 100, outputTokens: 20, reasoningTokens: 0, toolCalls: 0 },
      { reasoningTokens: "unavailable", toolCalls: "measured" },
    );
    guard.finishImplementationAttempt(1, "retryable-failure");
    guard.recordRetry(1, "provider-transient");
    guard.startImplementationAttempt(2);
    guard.observeUsage(
      { inputTokens: 180, outputTokens: 50, reasoningTokens: 0, toolCalls: 0 },
      { reasoningTokens: "unavailable", toolCalls: "measured" },
    );
    guard.finishImplementationAttempt(2, "completed");

    const ledger = buildComposeAttemptLedger(guard.report());
    expect(ledger.attempts).toHaveLength(2);
    expect(ledger.retries).toHaveLength(1);
    expect(ledger.retries[0]).toMatchObject({
      afterAttemptId: "attempt-1",
      reason: "provider-transient",
    });
    expect(ledger.attempts[0]?.usage.inputTokens).toBe(100);
    expect(ledger.attempts[1]?.usage.inputTokens).toBe(80);
  });
});
