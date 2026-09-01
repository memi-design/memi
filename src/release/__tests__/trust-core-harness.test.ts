// @ts-nocheck
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCapabilityDenied,
  assertMetadataOnlyReceipt,
  assertPathContained,
  runProcess,
} from "../../../scripts/lib/trust-core-e2e.mjs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Trust Core packed-artifact harness helpers", () => {
  it("accepts a structured capability denial and rejects an ambiguous failure", () => {
    expect(assertCapabilityDenied({
      exitCode: 1,
      stdout: "",
      stderr: JSON.stringify({
        code: "MEMI_CAPABILITY_DENIED",
        command: "self-update",
        capability: "network",
      }),
    }, {
      command: "self-update",
      capability: "network",
    })).toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      command: "self-update",
      capability: "network",
    });

    expect(() => assertCapabilityDenied({
      exitCode: 1,
      stdout: "",
      stderr: "request failed",
    }, {
      command: "self-update",
      capability: "network",
    })).toThrow("structured MEMI_CAPABILITY_DENIED");
  });

  it("rejects source, prompt, secret, and absolute private path disclosure", () => {
    const safeReceipt = JSON.stringify({
      version: "2.8.0-beta.1",
      profile: "locked",
      counts: { files: 1, issues: 0 },
      sha256: "a".repeat(64),
      durationMs: 42,
      decisions: [{ capability: "network", allowed: false }],
    });

    expect(() => assertMetadataOnlyReceipt(safeReceipt, {
      secrets: ["dualentry-secret"],
      privatePaths: ["/private/company/repo"],
      sourceSnippets: ["const privateLedger = true"],
      prompts: ["audit our unreleased ledger"],
    })).not.toThrow();

    for (const leaked of [
      "dualentry-secret",
      "/private/company/repo",
      "const privateLedger = true",
      "audit our unreleased ledger",
    ]) {
      expect(() => assertMetadataOnlyReceipt(`${safeReceipt}\n${leaked}`, {
        secrets: ["dualentry-secret"],
        privatePaths: ["/private/company/repo"],
        sourceSnippets: ["const privateLedger = true"],
        prompts: ["audit our unreleased ledger"],
      })).toThrow("metadata-only receipt");
    }
  });

  it("accepts only real paths contained by .memi and rejects traversal and symlink escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-trust-containment-"));
    roots.push(root);
    const memiRoot = join(root, "project", ".memi");
    const outside = join(root, "outside");
    await mkdir(memiRoot, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(memiRoot, "escape"), "dir");

    await expect(assertPathContained(memiRoot, join(memiRoot, "receipt.json"))).resolves.toBe(
      join(memiRoot, "receipt.json"),
    );
    await expect(assertPathContained(memiRoot, join(memiRoot, "..", "outside.json"))).rejects.toThrow(
      "escapes .memi",
    );
    await expect(assertPathContained(memiRoot, join(memiRoot, "escape", "receipt.json"))).rejects.toThrow(
      "symlink",
    );
  });

  it("bounds hostile output and terminates timed-out subprocesses", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-trust-process-"));
    roots.push(root);
    const outputScript = join(root, "output.mjs");
    const timeoutScript = join(root, "timeout.mjs");
    await writeFile(outputScript, "process.stdout.write('x'.repeat(4096));\n", "utf8");
    await writeFile(timeoutScript, "setInterval(() => {}, 1000);\n", "utf8");

    await expect(runProcess(process.execPath, [outputScript], {
      cwd: root,
      maxOutputBytes: 1024,
      timeoutMs: 2_000,
    })).rejects.toThrow("output limit");

    const started = Date.now();
    await expect(runProcess(process.execPath, [timeoutScript], {
      cwd: root,
      maxOutputBytes: 1024,
      timeoutMs: 100,
    })).rejects.toThrow("timed out");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("does not leave hostile fixture bytes in a metadata-only receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-trust-hostile-"));
    roots.push(root);
    const hostileName = "quote-' newline-\n unicode-雪.tsx";
    const hostilePath = join(root, hostileName);
    await writeFile(hostilePath, "export const neverPersistMe = 'dualentry-secret';\n", "utf8");
    expect(await readFile(hostilePath, "utf8")).toContain("neverPersistMe");

    expect(() => assertMetadataOnlyReceipt(JSON.stringify({
      counts: { files: 1 },
      pathHash: "b".repeat(64),
    }), {
      secrets: ["dualentry-secret"],
      privatePaths: [root, hostilePath],
      sourceSnippets: ["neverPersistMe"],
      prompts: [],
    })).not.toThrow();
  });
});
