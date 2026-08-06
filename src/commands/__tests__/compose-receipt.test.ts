import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deriveComposeStopReason, reserveReceiptSequence } from "../compose-receipt.js";

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
});
