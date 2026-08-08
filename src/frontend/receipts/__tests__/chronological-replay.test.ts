import { describe, expect, it, vi } from "vitest";
import {
  replayWorkflowReceiptsChronologically,
} from "../chronological-replay.js";
import {
  createWorkflowReceiptV3,
  type WorkflowReceiptV3,
} from "../workflow-receipt-v3.js";
import { makeReceiptInput } from "./fixtures.js";

function receipt(
  receiptId: string,
  recordedAt: string,
  sequence: number,
): WorkflowReceiptV3 {
  return createWorkflowReceiptV3(makeReceiptInput({ receiptId, recordedAt, sequence }));
}

describe("chronological WorkflowReceiptV3 replay", () => {
  it("sorts by instant and sequence while exposing no current or future receipts", () => {
    const later = receipt("later", "2026-08-06T12:00:00.500Z", 2);
    const first = receipt("first", "2026-08-06T07:00:00-05:00", 0);
    const sameInstant = receipt("same-instant", "2026-08-06T12:00:00.000Z", 1);

    const result = replayWorkflowReceiptsChronologically({
      receipts: [later, sameInstant, first],
      initialState: [] as readonly string[],
      reduce: ({ current, priorReceipts, state }) => {
        expect(priorReceipts.map((item) => item.receiptId)).toEqual(state);
        expect(priorReceipts).not.toContain(current);
        return [...state, current.receiptId];
      },
    });

    expect(result.timeline.map((step) => step.receiptId)).toEqual([
      "first",
      "same-instant",
      "later",
    ]);
    expect(result.finalState).toEqual(["first", "same-instant", "later"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.timeline)).toBe(true);
    expect(Object.isFrozen(result.finalState)).toBe(true);
  });

  it("honors an inclusive as-of cutoff without invoking the reducer for future receipts", () => {
    const reduce = vi.fn(({ state }: { state: number }) => state + 1);
    const result = replayWorkflowReceiptsChronologically({
      receipts: [
        receipt("first", "2026-08-06T12:00:00.000Z", 0),
        receipt("cutoff", "2026-08-06T12:00:01.000Z", 1),
        receipt("future", "2026-08-06T12:00:02.000Z", 2),
      ],
      asOf: "2026-08-06T12:00:01.000Z",
      initialState: 0,
      reduce,
    });

    expect(result).toMatchObject({
      receiptsAvailable: 3,
      receiptsReplayed: 2,
      asOf: "2026-08-06T12:00:01.000Z",
      finalState: 2,
    });
    expect(reduce).toHaveBeenCalledTimes(2);
  });

  it("supports an exact ledger-position cutoff for equal timestamps", () => {
    const result = replayWorkflowReceiptsChronologically({
      receipts: [
        receipt("first", "2026-08-06T12:00:00.000Z", 0),
        receipt("same-instant-future", "2026-08-06T12:00:00.000Z", 1),
      ],
      asOf: "2026-08-06T12:00:00.000Z",
      asOfSequence: 0,
      initialState: [] as string[],
      reduce: ({ current, state }) => [...state, current.receiptId],
    });

    expect(result.receiptsReplayed).toBe(1);
    expect(result.finalState).toEqual(["first"]);
    expect(result.asOfSequence).toBe(0);
  });


  it("rejects duplicate receipt IDs, duplicate sequence positions, and malformed cutoffs", () => {
    const first = receipt("duplicate", "2026-08-06T12:00:00.000Z", 0);
    const duplicateId = receipt("duplicate", "2026-08-06T12:00:01.000Z", 1);
    const duplicateSequence = receipt("other", "2026-08-06T12:00:01.000Z", 0);
    const run = (receipts: readonly WorkflowReceiptV3[], asOf?: string) =>
      replayWorkflowReceiptsChronologically({
        receipts,
        ...(asOf ? { asOf } : {}),
        initialState: null,
        reduce: () => null,
      });

    expect(() => run([first, duplicateId])).toThrow(/duplicate receipt id/i);
    expect(() => run([first, duplicateSequence])).toThrow(/duplicate sequence/i);
    expect(() => run([first], "not-a-date")).toThrow(/ISO-8601/i);
  });

  it("validates every external receipt and rejects tampering before replay starts", () => {
    const valid = receipt("valid", "2026-08-06T12:00:00.000Z", 0);
    const tampered = structuredClone(valid);
    tampered.candidate.candidateId = "post-hoc-candidate";
    const reduce = vi.fn(() => 1);

    expect(() => replayWorkflowReceiptsChronologically({
      receipts: [tampered],
      initialState: 0,
      reduce,
    })).toThrow();
    expect(reduce).not.toHaveBeenCalled();
  });

  it("rejects reducer output that cannot be deterministically serialized", () => {
    expect(() => replayWorkflowReceiptsChronologically({
      receipts: [receipt("valid", "2026-08-06T12:00:00.000Z", 0)],
      initialState: { count: 0 },
      reduce: () => ({ invalid: undefined }),
    })).toThrow(/deterministic|serializ/i);
  });
});
