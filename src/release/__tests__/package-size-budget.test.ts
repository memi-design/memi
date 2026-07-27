// @ts-nocheck
import { describe, expect, it } from "vitest";
import { evaluatePackageSizeBudget } from "../../../scripts/lib/package-size-budget.mjs";

describe("package size budget", () => {
  it("requires at least ten percent hard-budget headroom", () => {
    expect(evaluatePackageSizeBudget(1_285_614, {
      maxSizeBytes: 1_500_000,
      maxUtilization: 0.9,
    })).toMatchObject({
      passed: true,
      headroomBytes: 214_386,
      minHeadroomBytes: 150_000,
      utilization: 0.8571,
    });

    expect(evaluatePackageSizeBudget(1_350_001, {
      maxSizeBytes: 1_500_000,
      maxUtilization: 0.9,
    })).toMatchObject({
      passed: false,
      reason: "package size 1350001 exceeds the 90% utilization gate for the 1500000-byte hard budget",
    });
  });

  it("rejects invalid budgets instead of silently disabling the gate", () => {
    expect(() => evaluatePackageSizeBudget(100, {
      maxSizeBytes: Number.NaN,
      maxUtilization: 0.9,
    })).toThrow("maxSizeBytes");
    expect(() => evaluatePackageSizeBudget(100, {
      maxSizeBytes: 1_500_000,
      maxUtilization: 1,
    })).toThrow("maxUtilization");
  });
});
