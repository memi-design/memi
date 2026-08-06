import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkflowReceiptV3 } from "../../frontend/receipts/workflow-receipt-v3.js";
import { makeReceiptInput } from "../../frontend/receipts/__tests__/fixtures.js";
import { verifyWorkflowReceiptDirectory } from "../workflow-receipt-verify.js";

describe("verifyWorkflowReceiptDirectory", () => {
  it("reports admitted, excluded, invalid, and chronological receipt evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-workflow-receipts-"));
    await mkdir(root, { recursive: true });
    const valid = createWorkflowReceiptV3(makeReceiptInput());
    const invalid = structuredClone(valid);
    invalid.execution.usage.inputTokens += 1;
    await writeFile(path.join(root, "valid.json"), JSON.stringify(valid));
    await writeFile(path.join(root, "invalid.json"), JSON.stringify(invalid));

    const result = await verifyWorkflowReceiptDirectory(root);

    expect(result).toEqual(expect.objectContaining({
      schemaVersion: "workflow-receipt-directory-verification.v1",
      status: "invalid",
      receiptFiles: 2,
      validReceipts: 1,
      invalidReceipts: 1,
      admittedReceipts: 1,
      excludedReceipts: 0,
      chronologyValid: true,
    }));
    expect(result.failures[0]).toMatchObject({ file: "invalid.json" });
  });

  it("separates admitted evidence from candidate verification outcome", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-workflow-receipts-failed-"));
    const input = makeReceiptInput();
    const failed = createWorkflowReceiptV3({
      ...input,
      execution: {
        ...input.execution,
        stopReason: "verification-failed",
        attempts: input.execution.attempts.map((attempt) => ({
          ...attempt,
          outcome: "fatal-failure" as const,
        })),
      },
      verification: input.verification.map((entry) => ({
        ...entry,
        status: "failed" as const,
        exitCode: 1,
      })),
    });
    await writeFile(path.join(root, "failed.json"), JSON.stringify(failed));

    const result = await verifyWorkflowReceiptDirectory(root);

    expect(result).toMatchObject({
      status: "valid",
      admittedReceipts: 1,
      admittedButFailedReceipts: 1,
      excludedReceipts: 0,
    });
  });
});
