import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { hashValue } from "../frontend/foundation.js";
import { replayWorkflowReceiptsChronologically } from "../frontend/receipts/chronological-replay.js";
import {
  WorkflowReceiptV3Schema,
  type WorkflowReceiptV3,
} from "../frontend/receipts/workflow-receipt-v3.js";

export interface WorkflowReceiptDirectoryVerification {
  readonly schemaVersion: "workflow-receipt-directory-verification.v1";
  readonly status: "valid" | "invalid" | "empty";
  readonly receiptFiles: number;
  readonly validReceipts: number;
  readonly invalidReceipts: number;
  readonly admittedReceipts: number;
  readonly admittedButFailedReceipts: number;
  readonly excludedReceipts: number;
  readonly chronologyValid: boolean;
  readonly failures: readonly {
    readonly file: string;
    readonly reasons: readonly string[];
  }[];
  readonly receiptSha256s: readonly string[];
  readonly verificationSha256: string;
}

export async function verifyWorkflowReceiptDirectory(
  receiptRoot: string,
): Promise<Readonly<WorkflowReceiptDirectoryVerification>> {
  const root = path.resolve(receiptRoot);
  const files = (await readdir(root))
    .filter((file) => file.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));
  const receipts: WorkflowReceiptV3[] = [];
  const failures: Array<{ file: string; reasons: string[] }> = [];
  for (const file of files) {
    let input: unknown;
    try {
      input = JSON.parse(await readFile(path.join(root, file), "utf8"));
    } catch (error) {
      failures.push({ file, reasons: [`unreadable-json:${errorName(error)}`] });
      continue;
    }
    const parsed = WorkflowReceiptV3Schema.safeParse(input);
    if (!parsed.success) {
      failures.push({
        file,
        reasons: parsed.error.issues.map((issue) =>
          `${issue.path.length > 0 ? issue.path.join(".") : "receipt"}:${issue.message}`),
      });
      continue;
    }
    receipts.push(parsed.data);
  }
  let chronologyValid = true;
  try {
    replayWorkflowReceiptsChronologically({
      receipts,
      initialState: { receipts: 0 },
      reduce: ({ state }) => ({ receipts: state.receipts + 1 }),
    });
  } catch (error) {
    chronologyValid = false;
    failures.push({ file: "<ledger>", reasons: [`chronology-invalid:${errorName(error)}`] });
  }
  const admittedReceipts = receipts.filter((receipt) =>
    receipt.nativeEvidence.status === "admitted").length;
  const admittedButFailedReceipts = receipts.filter((receipt) =>
    receipt.nativeEvidence.status === "admitted" && !isSuccessfulReceipt(receipt)).length;
  const excludedReceipts = receipts.filter((receipt) =>
    receipt.nativeEvidence.status === "excluded").length;
  const content = {
    schemaVersion: "workflow-receipt-directory-verification.v1" as const,
    status: files.length === 0
      ? "empty" as const
      : failures.length > 0 ? "invalid" as const : "valid" as const,
    receiptFiles: files.length,
    validReceipts: receipts.length,
    invalidReceipts: files.length - receipts.length,
    admittedReceipts,
    admittedButFailedReceipts,
    excludedReceipts,
    chronologyValid,
    failures,
    receiptSha256s: receipts.map((receipt) => receipt.receiptSha256).sort(),
  };
  return Object.freeze({
    ...content,
    failures: Object.freeze(content.failures.map((failure) => Object.freeze({
      ...failure,
      reasons: Object.freeze([...failure.reasons]),
    }))),
    receiptSha256s: Object.freeze([...content.receiptSha256s]),
    verificationSha256: hashValue(content),
  });
}

function isSuccessfulReceipt(receipt: WorkflowReceiptV3): boolean {
  return receipt.execution.stopReason === "verification-passed"
    && receipt.verification.every((verification) => verification.status === "passed");
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "unknown";
}
