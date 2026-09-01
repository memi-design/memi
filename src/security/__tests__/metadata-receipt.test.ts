import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutionPolicy, MemiExecutionPolicy } from "../execution-policy.js";
import { createMetadataReceipt, writeMetadataReceipt } from "../metadata-receipt.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("metadata-only receipts", () => {
  it("emits only allowlisted evidence fields", () => {
    const policy = createExecutionPolicy({ projectRoot: "/private/company/project" });
    const receipt = createMetadataReceipt({
      command: "diagnose",
      version: "2.8.0-beta.1",
      commit: "0123456789abcdef",
      policy,
      ruleIds: ["MEMI-COLOR-001"],
      counts: { files: 4, findings: 2 },
      hashes: { artifact: "a".repeat(64) },
      durationMs: 15,
      source: "const privateCompanySecret = true",
      prompt: "upload the private repository",
      environment: { DUALENTRY_TOKEN: "secret" },
    } as Parameters<typeof createMetadataReceipt>[0] & Record<string, unknown>);
    const serialized = JSON.stringify(receipt);

    expect(receipt).toMatchObject({
      schemaVersion: "memi.receipt.v1",
      command: "diagnose",
      artifact: { version: "2.8.0-beta.1", commit: "0123456789abcdef" },
      policy: { profile: "locked", effectiveCapabilities: [] },
      evidence: {
        ruleIds: ["MEMI-COLOR-001"],
        counts: { files: 4, findings: 2 },
        hashes: { artifact: "a".repeat(64) },
        durationMs: 15,
      },
    });
    expect(serialized).not.toContain("/private/company/project");
    expect(serialized).not.toContain("privateCompanySecret");
    expect(serialized).not.toContain("DUALENTRY_TOKEN");
    expect(serialized).not.toContain("upload the private repository");
  });

  it("requires an explicit output path and project-write permission to persist", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-receipt-"));
    cleanup.push(projectRoot);
    const locked = createExecutionPolicy({ projectRoot });
    const local = createExecutionPolicy({ projectRoot, profile: "local" });
    const receipt = createMetadataReceipt({
      command: "doctor",
      version: "2.8.0-beta.1",
      commit: "unknown",
      policy: locked,
    });

    await expect(writeMetadataReceipt(undefined, receipt, local)).rejects.toThrow("An explicit receipt output path is required");
    await expect(writeMetadataReceipt(join(projectRoot, ".memi", "doctor-receipt.json"), receipt, locked)).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "project-write",
    });

    const outputPath = join(projectRoot, ".memi", "doctor-receipt.json");
    await writeMetadataReceipt(outputPath, receipt, local);
    expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(receipt);
  });

  it("rejects a receipt parent swapped to a symlink after policy validation", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-receipt-race-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "memi-receipt-race-outside-"));
    cleanup.push(projectRoot, outsideRoot);
    const receiptDirectory = join(projectRoot, ".memi", "receipts");
    const parkedDirectory = join(projectRoot, ".memi", "receipts-safe");
    const outputPath = join(receiptDirectory, "doctor.json");
    const outsidePath = join(outsideRoot, "doctor.json");
    await mkdir(receiptDirectory, { recursive: true });

    const policy = createExecutionPolicy({ projectRoot, profile: "local" });
    const receipt = createMetadataReceipt({
      command: "doctor",
      version: "2.8.0-beta.1",
      commit: "unknown",
      policy,
    });
    const originalAssert = MemiExecutionPolicy.prototype.assertProjectWrite;
    let swapped = false;
    const assertion = vi.spyOn(MemiExecutionPolicy.prototype, "assertProjectWrite")
      .mockImplementation(async function (targetPath, operation) {
        await originalAssert.call(this, targetPath, operation);
        if (this === policy && !swapped) {
          swapped = true;
          await rename(receiptDirectory, parkedDirectory);
          await symlink(outsideRoot, receiptDirectory, "dir");
        }
      });

    try {
      await expect(writeMetadataReceipt(outputPath, receipt, policy)).rejects.toMatchObject({
        code: "MEMI_CAPABILITY_DENIED",
        capability: "project-write",
        operation: "persist metadata receipt",
      });
      await expect(readFile(outsidePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      assertion.mockRestore();
    }
  });

  it("rejects a symlinked local receipt root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-receipt-root-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "memi-receipt-root-outside-"));
    cleanup.push(projectRoot, outsideRoot);
    await symlink(outsideRoot, join(projectRoot, ".memi"), "dir");
    const outputPath = join(projectRoot, ".memi", "doctor.json");
    const policy = createExecutionPolicy({ projectRoot, profile: "local" });
    const receipt = createMetadataReceipt({
      command: "doctor",
      version: "2.8.0-beta.1",
      commit: "unknown",
      policy,
    });

    await expect(writeMetadataReceipt(outputPath, receipt, policy)).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "project-write",
    });
    await expect(readFile(join(outsideRoot, "doctor.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not create outside directories when a missing root is swapped after validation", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-receipt-mkdir-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "memi-receipt-mkdir-outside-"));
    cleanup.push(projectRoot, outsideRoot);
    const receiptRoot = join(projectRoot, ".memi");
    const outputPath = join(receiptRoot, "receipts", "doctor.json");
    const policy = createExecutionPolicy({ projectRoot, profile: "local" });
    const receipt = createMetadataReceipt({
      command: "doctor",
      version: "2.8.0-beta.1",
      commit: "unknown",
      policy,
    });
    const originalAssert = MemiExecutionPolicy.prototype.assertProjectWrite;
    let swapped = false;
    const assertion = vi.spyOn(MemiExecutionPolicy.prototype, "assertProjectWrite")
      .mockImplementation(async function (targetPath, operation) {
        await originalAssert.call(this, targetPath, operation);
        if (this === policy && !swapped) {
          swapped = true;
          await symlink(outsideRoot, receiptRoot, "dir");
        }
      });

    try {
      await expect(writeMetadataReceipt(outputPath, receipt, policy)).rejects.toMatchObject({
        code: "MEMI_CAPABILITY_DENIED",
        capability: "project-write",
      });
      await expect(lstat(join(outsideRoot, "receipts"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      assertion.mockRestore();
    }
  });
});
