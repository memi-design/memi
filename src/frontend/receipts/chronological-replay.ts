import { z } from "zod";
import {
  TimestampSchema,
  cloneSerializable,
  deepFreeze,
  hashValue,
  timestampMillis,
} from "./foundation.js";
import {
  WorkflowReceiptV3Schema,
  type WorkflowReceiptV3,
} from "./workflow-receipt-v3.js";

export interface ChronologicalReplayReducerInput<State> {
  readonly state: Readonly<State>;
  readonly current: Readonly<WorkflowReceiptV3>;
  readonly priorReceipts: readonly Readonly<WorkflowReceiptV3>[];
}

export interface ChronologicalReplayInput<State> {
  readonly receipts: readonly unknown[];
  readonly asOf?: string;
  readonly initialState: State;
  readonly reduce: (input: ChronologicalReplayReducerInput<State>) => State;
}

export interface ChronologicalReplayResult<State> {
  readonly asOf: string | null;
  readonly receiptsAvailable: number;
  readonly receiptsReplayed: number;
  readonly finalState: Readonly<State>;
  readonly timeline: readonly Readonly<{
    receiptId: string;
    receiptSha256: string;
    recordedAt: string;
    sequence: number;
    priorReceiptIds: readonly string[];
    stateAfterSha256: string;
  }>[];
}

const ReplayEnvelopeSchema = z.object({
  receipts: z.array(z.unknown()),
  asOf: TimestampSchema.optional(),
  initialState: z.unknown(),
  reduce: z.custom<(...args: never[]) => unknown>((value) => typeof value === "function", {
    message: "reduce must be a function",
  }),
}).strict();

export function replayWorkflowReceiptsChronologically<State>(
  input: ChronologicalReplayInput<State>,
): Readonly<ChronologicalReplayResult<State>> {
  const envelope = ReplayEnvelopeSchema.parse(input);
  const receipts = envelope.receipts.map((receipt) =>
    deepFreeze(WorkflowReceiptV3Schema.parse(receipt)));
  assertUnique(receipts.map((receipt) => receipt.receiptId), "receipt id");
  assertUnique(receipts.map((receipt) => String(receipt.sequence)), "sequence");
  receipts.sort(compareReceipts);
  for (let index = 1; index < receipts.length; index += 1) {
    if (receipts[index]!.sequence <= receipts[index - 1]!.sequence) {
      throw new Error("Receipt sequence must increase with chronological order");
    }
  }

  const eligible = envelope.asOf
    ? receipts.filter((receipt) =>
      timestampMillis(receipt.recordedAt) <= timestampMillis(envelope.asOf!))
    : receipts;
  let state = deepFreeze(cloneSerializable(envelope.initialState as State));
  const priorReceipts: Readonly<WorkflowReceiptV3>[] = [];
  const timeline: ChronologicalReplayResult<State>["timeline"][number][] = [];

  for (const current of eligible) {
    const nextState = (envelope.reduce as ChronologicalReplayInput<State>["reduce"])({
      state,
      current,
      priorReceipts: deepFreeze([...priorReceipts]),
    });
    state = deepFreeze(cloneSerializable(nextState));
    timeline.push(deepFreeze({
      receiptId: current.receiptId,
      receiptSha256: current.receiptSha256,
      recordedAt: current.recordedAt,
      sequence: current.sequence,
      priorReceiptIds: priorReceipts.map((receipt) => receipt.receiptId),
      stateAfterSha256: hashValue(state),
    }));
    priorReceipts.push(current);
  }

  return deepFreeze({
    asOf: envelope.asOf ?? null,
    receiptsAvailable: receipts.length,
    receiptsReplayed: eligible.length,
    finalState: state,
    timeline,
  });
}

function compareReceipts(left: WorkflowReceiptV3, right: WorkflowReceiptV3): number {
  return timestampMillis(left.recordedAt) - timestampMillis(right.recordedAt)
    || left.sequence - right.sequence
    || left.receiptId.localeCompare(right.receiptId);
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}
