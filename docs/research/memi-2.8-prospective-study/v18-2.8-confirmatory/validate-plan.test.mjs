import assert from "node:assert/strict";
import test from "node:test";

import { loadPackage, validatePackage } from "./validate-plan.mjs";

test("the preregistration encodes exactly 152 unexecuted cells", async () => {
  const pkg = await loadPackage(import.meta.dirname);
  const result = validatePackage(pkg);

  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.phaseCounts, {
    aa: 6,
    calibration: 6,
    confirmatory: 120,
    holdout: 20,
  });
});

test("confirmatory cells are 12 tasks by five matched pairs by two conditions", async () => {
  const pkg = await loadPackage(import.meta.dirname);
  const confirmatory = pkg.plan.cells.filter((cell) => cell.phase === "confirmatory");
  const taskIds = [...new Set(confirmatory.map((cell) => cell.taskId))];

  assert.equal(taskIds.length, 12);
  for (const taskId of taskIds) {
    const cells = confirmatory.filter((cell) => cell.taskId === taskId);
    assert.equal(cells.length, 10);
    assert.equal(new Set(cells.map((cell) => cell.pairId)).size, 5);
    for (const pairId of new Set(cells.map((cell) => cell.pairId))) {
      assert.deepEqual(
        cells
          .filter((cell) => cell.pairId === pairId)
          .map((cell) => cell.condition)
          .sort(),
        ["baseline", "candidate"],
      );
    }
  }
});

test("the validator rejects a fabricated completed receipt", async () => {
  const pkg = structuredClone(await loadPackage(import.meta.dirname));
  pkg.receiptLedger.entries[0].status = "admitted";
  pkg.receiptLedger.entries[0].receiptPath = "receipts/fabricated.json";

  const result = validatePackage(pkg);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /must remain not-run until execution/);
});

test("the validator rejects a missing confirmatory cell", async () => {
  const pkg = structuredClone(await loadPackage(import.meta.dirname));
  const index = pkg.plan.cells.findIndex((cell) => cell.phase === "confirmatory");
  pkg.plan.cells.splice(index, 1);

  const result = validatePackage(pkg);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /expected 152 total cells/);
});

test("the foundation preserves claim, grading, and predecessor boundaries", async () => {
  const pkg = await loadPackage(import.meta.dirname);

  assert.equal(pkg.rubric.totalPoints, 100);
  assert.equal(pkg.graderPlan.modelPanel.gradersPerArtifact, 3);
  assert.equal(pkg.priceCard.usdClaimPlanned, false);
  assert.deepEqual(
    pkg.predecessorStatus.predecessors.map((study) => study.statusForV18),
    ["excluded-calibration-history", "superseded-before-execution"],
  );
  assert.equal(pkg.freezeReadiness.readyForProviderInvocation, false);
});

test("the validator rejects a receipt ledger that does not match the cell matrix", async () => {
  const pkg = structuredClone(await loadPackage(import.meta.dirname));
  pkg.receiptLedger.entries[0].cellId = "unknown-cell";

  const result = validatePackage(pkg);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /receipt-ledger cell IDs must exactly match/);
});
