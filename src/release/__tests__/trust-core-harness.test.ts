// @ts-nocheck
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCapabilityDenied,
  assertMetadataOnlyReceipt,
  assertPathContained,
  cleanHarnessEnvironment,
  createPackedInstallation,
  npmExecutable,
  resolveNpmInvocation,
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
        capability: "network",
        operation: "check npm for updates",
      }),
    }, {
      capability: "network",
      operation: "check npm for updates",
    })).toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "network",
      operation: "check npm for updates",
    });

    expect(() => assertCapabilityDenied({
      exitCode: 1,
      stdout: "",
      stderr: "request failed",
    }, {
      capability: "network",
      operation: "check npm for updates",
    })).toThrow("structured MEMI_CAPABILITY_DENIED");

    expect(assertCapabilityDenied({
      exitCode: 1,
      stdout: `not-json\n${JSON.stringify({
        code: "MEMI_CAPABILITY_DENIED",
        capability: "network",
        operation: "check npm for updates",
      })}`,
      stderr: "not-json",
    }, {
      capability: "network",
      operation: "check npm for updates",
    })).toMatchObject({ capability: "network" });

    expect(assertCapabilityDenied({
      exitCode: 1,
      stdout: JSON.stringify({
        status: "failed",
        error: {
          code: "MEMI_CAPABILITY_DENIED",
          capability: "network",
          operation: "check npm for updates",
        },
      }),
      stderr: "",
    }, {
      capability: "network",
      operation: "check npm for updates",
    })).toMatchObject({ capability: "network" });
  });

  it("builds a minimal, secret-free subprocess environment", () => {
    expect(npmExecutable("win32")).toBe("npm.cmd");
    expect(npmExecutable("linux")).toBe("npm");
    const env = cleanHarnessEnvironment({
      PATH: "/bin",
      DUALENTRY_TOKEN: "private",
      DATABASE_PASSWORD: "private",
      GITHUB_PAT: "private",
      OPENAI_KEY: "private",
      SAFE_VALUE: "retained",
    });

    expect(env).toMatchObject({
      PATH: "/bin",
      CI: "1",
      MEMI_TELEMETRY_DISABLED: "1",
      npm_config_ignore_scripts: "true",
    });
    expect(env).not.toHaveProperty("DUALENTRY_TOKEN");
    expect(env).not.toHaveProperty("DATABASE_PASSWORD");
    expect(env).not.toHaveProperty("GITHUB_PAT");
    expect(env).not.toHaveProperty("OPENAI_KEY");
    expect(env).not.toHaveProperty("SAFE_VALUE");
  });

  it("runs npm through Node without a shell when Windows lacks npm_execpath", () => {
    expect(resolveNpmInvocation({
      platform: "win32",
      nodeExecutable: "C:\\node\\node.exe",
      npmExecPath: undefined,
    })).toEqual({
      command: "C:\\node\\node.exe",
      prefix: ["C:\\node\\node_modules\\npm\\bin\\npm-cli.js"],
    });

    expect(resolveNpmInvocation({
      platform: "win32",
      nodeExecutable: "C:\\node\\node.exe",
      npmExecPath: "C:\\npm\\npm-cli.js",
    })).toEqual({
      command: "C:\\node\\node.exe",
      prefix: ["C:\\npm\\npm-cli.js"],
    });
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
    expect(assertMetadataOnlyReceipt("{}")).toEqual({});
    expect(assertMetadataOnlyReceipt("{}", {
      secrets: ["", 42 as never],
    })).toEqual({});

    for (const leaked of [
      "dualentry-secret",
      "/private/company/repo",
      "const privateLedger = true",
      "audit our unreleased ledger",
    ]) {
      expect(() => assertMetadataOnlyReceipt(JSON.stringify({ leaked }), {
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
    const outsideReceipt = join(outside, "receipt.json");
    await writeFile(outsideReceipt, "{}\n", "utf8");
    await symlink(outsideReceipt, join(memiRoot, "leaf-receipt.json"), "file");

    await expect(assertPathContained(memiRoot, join(memiRoot, "receipt.json"))).resolves.toBe(
      join(await realpath(memiRoot), "receipt.json"),
    );
    await expect(assertPathContained(memiRoot, join(memiRoot, "..", "outside.json"))).rejects.toThrow(
      "escapes .memi",
    );
    await expect(assertPathContained(memiRoot, join(memiRoot, ".."))).rejects.toThrow("escapes .memi");
    await expect(assertPathContained(memiRoot, join(memiRoot, "escape", "receipt.json"))).rejects.toThrow(
      "symlink",
    );
    await expect(assertPathContained(memiRoot, join(memiRoot, "leaf-receipt.json"))).rejects.toThrow(
      "symlink",
    );
    await expect(assertPathContained(memiRoot, join(memiRoot, "future", "nested", "receipt.json"))).resolves.toBe(
      join(await realpath(memiRoot), "future", "nested", "receipt.json"),
    );
    await expect(assertPathContained(memiRoot, "relative.json")).rejects.toThrow("absolute path");
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

    const controller = new AbortController();
    const interrupted = runProcess(process.execPath, [timeoutScript], {
      cwd: root,
      signal: controller.signal,
      timeoutMs: 2_000,
    });
    controller.abort();
    await expect(interrupted).rejects.toMatchObject({ name: "AbortError" });
  });

  it("waits for child close before settling an aborted process", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true,
    });
    const controller = new AbortController();
    const abortError = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    const spawnProcess = (_command: string, _args: string[], spawnOptions: { signal?: AbortSignal }) => {
      spawnOptions.signal?.addEventListener("abort", () => {
        child.emit("error", abortError);
      }, { once: true });
      return child;
    };
    let settled = false;
    const observed = runProcess("fixture-command", [], {
      signal: controller.signal,
      spawnProcess,
      timeoutMs: 2_000,
    }).then(
      (value) => {
        settled = true;
        return { value };
      },
      (error) => {
        settled = true;
        return { error };
      },
    );

    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    child.stdout.end();
    child.stderr.end();
    child.emit("close", null, "SIGTERM");
    await expect(observed).resolves.toEqual({ error: abortError });
    expect(settled).toBe(true);
  });

  it("does not leave hostile fixture bytes in a metadata-only receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-trust-hostile-"));
    roots.push(root);
    const hostileName = "quote-' unicode-雪.tsx";
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

  it("packs and installs the consumer binary from an isolated minimal package", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-trust-minimal-package-"));
    roots.push(root);
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "package.json"), `${JSON.stringify({
      name: "@memi-test/trust-fixture",
      version: "1.0.0",
      type: "module",
      bin: { memi: "dist/index.js" },
      files: ["dist"],
    }, null, 2)}\n`, "utf8");
    await writeFile(join(root, "dist", "index.js"), "#!/usr/bin/env node\nconsole.log('1.0.0');\n", "utf8");

    const installation = await createPackedInstallation({ packageRoot: root });
    try {
      await expect(access(installation.artifact)).resolves.toBeUndefined();
      await expect(access(installation.binary)).resolves.toBeUndefined();
      expect(installation.version).toBe("1.0.0");
      const invoked = await runProcess(process.execPath, [installation.binary, "--version"], {
        cwd: installation.consumerRoot,
        timeoutMs: 2_000,
      });
      expect(invoked).toMatchObject({ exitCode: 0, stdout: "1.0.0\n" });

      const copiedArtifact = join(root, "fixture.tgz");
      await writeFile(copiedArtifact, await readFile(installation.artifact));
      const fromArtifact = await createPackedInstallation({ packageRoot: root, artifact: copiedArtifact });
      try {
        expect(fromArtifact.version).toBe("1.0.0");
      } finally {
        await fromArtifact.cleanup();
      }

      await writeFile(join(root, "package.json"), `${JSON.stringify({
        name: "@memi-test/trust-fixture",
        version: "1.0.1",
        type: "module",
        bin: "dist/index.js",
        files: ["dist"],
      }, null, 2)}\n`, "utf8");
      const originalNpmExecPath = process.env.npm_execpath;
      delete process.env.npm_execpath;
      try {
        const stringBin = await createPackedInstallation({ packageRoot: root });
        try {
          expect(stringBin.version).toBe("1.0.1");
        } finally {
          await stringBin.cleanup();
        }
      } finally {
        if (originalNpmExecPath === undefined) delete process.env.npm_execpath;
        else process.env.npm_execpath = originalNpmExecPath;
      }

      await writeFile(join(root, "package.json"), `${JSON.stringify({
        name: "@memi-test/trust-fixture",
        version: "1.0.2",
        type: "module",
        files: ["dist"],
      }, null, 2)}\n`, "utf8");
      await expect(createPackedInstallation({ packageRoot: root })).rejects.toThrow(
        "does not expose the memi binary",
      );
    } finally {
      await installation.cleanup();
    }
  }, 20_000);

  it("validates subprocess and receipt input boundaries", async () => {
    await expect(runProcess(process.execPath, ["--version"], { timeoutMs: 0 })).rejects.toThrow(
      "timeout must be a positive integer",
    );
    await expect(runProcess(process.execPath, ["--version"], { maxOutputBytes: 0 })).rejects.toThrow(
      "output limit must be a positive integer",
    );
    await expect(runProcess("memi-command-that-does-not-exist", [], { timeoutMs: 100 })).rejects.toThrow();
    expect(() => assertMetadataOnlyReceipt("[]")).toThrow("JSON object");
    expect(() => assertMetadataOnlyReceipt("not-json")).toThrow("one valid JSON value");
    expect(() => assertCapabilityDenied({ exitCode: 0, stdout: "{}", stderr: "" }, {
      operation: "check npm for updates",
      capability: "network",
    })).toThrow("unexpectedly succeeded");
  });

  it("cleans the isolated consumer after a bad artifact install", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-trust-bad-package-"));
    roots.push(root);
    const missingArtifact = join(root, "missing.tgz");
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "@memi-test/bad-fixture",
      version: "1.0.0",
      bin: { memi: "dist/index.js" },
    }), "utf8");

    await expect(createPackedInstallation({
      packageRoot: root,
      artifact: missingArtifact,
    })).rejects.toThrow("packed artifact install failed");
  }, 20_000);
});
