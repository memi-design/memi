import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  requireSuccessfulProcess,
  runWorkflowTrial,
  workflowAdapterWatchdogMs,
  type WorkflowAdapter,
} from "../workflow-runner.js";
import { workflowTaskSchema } from "../workflow.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("workflow trial runner", () => {
  it("leaves room for the adapter to seal timeout evidence after termination", () => {
    expect(workflowAdapterWatchdogMs(120_000)).toBeGreaterThanOrEqual(120_250);
  });

  it("retries a safe setup process after a transient child failure", async () => {
    const root = await temporaryDirectory("memi-process-retry-");
    const counterPath = path.join(root, "attempts.txt");
    const script = [
      "const fs=require('fs');",
      `const p=${JSON.stringify(counterPath)};`,
      "const n=fs.existsSync(p)?Number(fs.readFileSync(p,'utf8')):0;",
      "fs.writeFileSync(p,String(n+1));",
      "process.exit(n===0?1:0);",
    ].join("");

    const result = await requireSuccessfulProcess({
      command: process.execPath,
      args: ["-e", script],
      cwd: root,
      timeoutMs: 30_000,
      retries: 1,
    });

    expect(result.exitCode).toBe(0);
    expect(await readFile(counterPath, "utf8")).toBe("2");
  });

  it("uses a disposable clone, verifies the product flow, and preserves source", async () => {
    const source = await fixtureRepository();
    const evidenceRoot = await temporaryDirectory("memi-workflow-evidence-");
    const task = workflowTaskSchema.parse({
      schemaVersion: 1,
      id: "rendered-feature",
      intent: "Implement and verify a rendered product feature end to end",
      maximumDurationMs: 10 * 60_000,
      steps: ["inspect", "implement", "build", "launch", "verify"],
      preparation: [{
        command: process.execPath,
        args: ["-e", "require('fs').writeFileSync('prepared.txt','yes\\n')"],
        timeoutMs: 60_000,
      }],
      fixtures: [{
        path: "contracts/expected.txt",
        content: "ready\n",
      }],
      verification: [
        {
          kind: "build",
          command: process.execPath,
          args: ["-e", "require('fs').accessSync('implemented.txt')"],
          timeoutMs: 60_000,
        },
        {
          kind: "rendered-flow",
          command: process.execPath,
          args: [
            "-e",
            "const fs=require('fs');if(fs.readFileSync('implemented.txt','utf8')!=='ready\\n')process.exit(1);fs.writeFileSync('verification-generated.txt','runtime\\n')",
          ],
          timeoutMs: 60_000,
        },
      ],
      requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
    });
    const adapter: WorkflowAdapter = {
      id: "fixture",
      async execute(input) {
        expect(await readFile(path.join(input.workspaceRoot, "prepared.txt"), "utf8"))
          .toBe("yes\n");
        expect(await readFile(
          path.join(input.workspaceRoot, "contracts/expected.txt"),
          "utf8",
        )).toBe("ready\n");
        await writeFile(path.join(input.workspaceRoot, "implemented.txt"), "ready\n");
        return {
          exitCode: 0,
          stdout: "implemented",
          stderr: "",
          usage: {
            inputTokens: 100,
            cachedInputTokens: 0,
            outputTokens: 20,
            reasoningTokens: 10,
            estimatedCostUsd: null,
          },
          tools: { calls: 2, errors: 0, retries: 0 },
        };
      },
    };

    const result = await runWorkflowTrial({
      sourceRepository: source,
      evidenceRoot,
      task,
      condition: "memi",
      routedContext: "{\"decision\":\"single\"}",
      adapter,
    });

    expect(result.accepted).toBe(true);
    expect(result.verification).toHaveLength(2);
    expect(result.verificationIsolation).toMatchObject({
      mode: "fresh-clone-post-patch",
      patchApplied: true,
      fixturesUnchanged: true,
    });
    expect(result.preparation).toHaveLength(1);
    expect(result.fixtureHash).toMatch(/^sha256:/);
    expect(result.verification.every((entry) => entry.passed)).toBe(true);
    expect(result.patch).toContain("implemented.txt");
    expect(result.patch).not.toContain("contracts/expected.txt");
    expect(result.patch).not.toContain("prepared.txt");
    expect(result.patch).not.toContain("verification-generated.txt");
    await expect(readFile(path.join(source, "implemented.txt"), "utf8")).rejects.toThrow();
    expect(await readFile(path.join(result.evidenceDirectory, "verification.json"), "utf8"))
      .toContain("\"passed\": true");
    const toolProfile = JSON.parse(
      await readFile(path.join(result.evidenceDirectory, "tool-profile.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(toolProfile).toMatchObject({
      schemaVersion: 1,
      provider: "unknown",
      totalCalls: 0,
    });
  });

  it("records a failed rendered flow without hiding the build result", async () => {
    const source = await fixtureRepository();
    const evidenceRoot = await temporaryDirectory("memi-workflow-evidence-");
    const task = workflowTaskSchema.parse({
      schemaVersion: 1,
      id: "rendered-feature",
      intent: "Implement and verify a rendered product feature end to end",
      maximumDurationMs: 10 * 60_000,
      steps: ["inspect", "implement", "build", "launch", "verify"],
      verification: [
        {
          kind: "build",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          timeoutMs: 60_000,
        },
        {
          kind: "rendered-flow",
          command: process.execPath,
          args: ["-e", "process.exit(2)"],
          timeoutMs: 60_000,
        },
      ],
      requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
    });
    const adapter: WorkflowAdapter = {
      id: "fixture",
      async execute() {
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          usage: {
            inputTokens: 1,
            cachedInputTokens: 0,
            outputTokens: 1,
            reasoningTokens: 0,
            estimatedCostUsd: null,
          },
          tools: { calls: 0, errors: 0, retries: 0 },
        };
      },
    };

    const result = await runWorkflowTrial({
      sourceRepository: source,
      evidenceRoot,
      task,
      condition: "baseline",
      routedContext: "",
      adapter,
    });

    expect(result.accepted).toBe(false);
    expect(result.verification.map((entry) => entry.passed)).toEqual([true, false]);
  });

  it("rejects a technically passing workflow when the agent exceeds its frozen budget", async () => {
    const source = await fixtureRepository();
    const evidenceRoot = await temporaryDirectory("memi-workflow-evidence-");
    const task = workflowTaskSchema.parse({
      schemaVersion: 1,
      id: "budgeted-feature",
      intent: "Implement and verify a rendered feature within a bounded agent budget.",
      maximumDurationMs: 10 * 60_000,
      agentBudget: {
        maxToolCalls: 4,
        maxInputTokens: 1_000,
        maxOutputTokens: 100,
        maxReasoningTokens: 10,
      },
      steps: ["inspect", "implement", "build", "launch", "verify"],
      verification: [
        { kind: "build", command: process.execPath, args: ["-e", "process.exit(0)"], timeoutMs: 60_000 },
        { kind: "rendered-flow", command: process.execPath, args: ["-e", "process.exit(0)"], timeoutMs: 60_000 },
      ],
      requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
    });
    const adapter: WorkflowAdapter = {
      id: "over-budget-fixture",
      async execute(input) {
        await writeFile(path.join(input.workspaceRoot, "implemented.txt"), "ready\n");
        return {
          exitCode: 0,
          stdout: "implemented",
          stderr: "",
          usage: {
            inputTokens: 1_001,
            cachedInputTokens: 0,
            outputTokens: 100,
            reasoningTokens: 10,
            estimatedCostUsd: null,
          },
          tools: { calls: 4, errors: 0, retries: 0 },
        };
      },
    };

    const result = await runWorkflowTrial({
      sourceRepository: source,
      evidenceRoot,
      task,
      condition: "baseline",
      routedContext: "",
      adapter,
    });

    expect(result.accepted).toBe(false);
    expect(result.budget).toMatchObject({
      withinBudget: false,
      exceeded: ["max-input-tokens"],
    });
    await expect(readFile(path.join(result.evidenceDirectory, "budget.json"), "utf8"))
      .resolves.toContain("max-input-tokens");
  });

  it("keeps ignored adapter residue out of the post-patch acceptance checkout", async () => {
    const source = await fixtureRepository();
    const evidenceRoot = await temporaryDirectory("memi-workflow-evidence-");
    const task = workflowTaskSchema.parse({
      schemaVersion: 1,
      id: "isolated-acceptance",
      intent: "Implement a rendered feature and verify it in an isolated checkout",
      maximumDurationMs: 10 * 60_000,
      steps: ["inspect", "implement", "capture", "isolate", "verify"],
      verification: [
        {
          kind: "build",
          command: process.execPath,
          args: [
            "-e",
            "const fs=require('fs');fs.accessSync('implemented.txt');if(fs.existsSync('.cache/poison'))process.exit(9)",
          ],
          timeoutMs: 60_000,
        },
        {
          kind: "rendered-flow",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          timeoutMs: 60_000,
        },
      ],
      requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
    });
    const adapter: WorkflowAdapter = {
      id: "fixture",
      async execute(input) {
        await mkdir(path.join(input.workspaceRoot, ".cache"), { recursive: true });
        await writeFile(path.join(input.workspaceRoot, ".cache", "poison"), "ignored\n");
        await writeFile(path.join(input.workspaceRoot, "implemented.txt"), "ready\n");
        return {
          exitCode: 0,
          stdout: "implemented",
          stderr: "",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 2,
            reasoningTokens: 1,
            estimatedCostUsd: null,
          },
          tools: { calls: 2, errors: 0, retries: 0 },
        };
      },
    };

    const result = await runWorkflowTrial({
      sourceRepository: source,
      evidenceRoot,
      task,
      condition: "baseline",
      routedContext: "",
      adapter,
    });

    expect(result.accepted).toBe(true);
    expect(result.verificationIsolation.mode).toBe("fresh-clone-post-patch");
  });

  it("does not spend verification time after the provider itself fails", async () => {
    const source = await fixtureRepository();
    const evidenceRoot = await temporaryDirectory("memi-workflow-evidence-");
    const task = workflowTaskSchema.parse({
      schemaVersion: 1,
      id: "provider-failure",
      intent: "Implement and verify a rendered product feature end to end",
      maximumDurationMs: 10 * 60_000,
      steps: ["inspect", "implement", "build", "launch", "verify"],
      verification: [
        {
          kind: "build",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          timeoutMs: 60_000,
        },
        {
          kind: "rendered-flow",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          timeoutMs: 60_000,
        },
      ],
      requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
    });
    const adapter: WorkflowAdapter = {
      id: "failed-provider",
      async execute() {
        return {
          exitCode: 1,
          stdout: "authentication_failed",
          stderr: "",
          usage: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            estimatedCostUsd: null,
          },
          tools: { calls: 0, errors: 1, retries: 0 },
        };
      },
    };

    const result = await runWorkflowTrial({
      sourceRepository: source,
      evidenceRoot,
      task,
      condition: "baseline",
      routedContext: "",
      adapter,
    });

    expect(result.accepted).toBe(false);
    expect(result.verification).toEqual([]);
  });

  it("retains a complete failed trial when the provider throws or times out", async () => {
    const source = await fixtureRepository();
    const evidenceRoot = await temporaryDirectory("memi-workflow-evidence-");
    const task = workflowTaskSchema.parse({
      schemaVersion: 1,
      id: "provider-timeout",
      intent: "Retain a failed provider execution as immutable evidence",
      maximumDurationMs: 10 * 60_000,
      steps: ["inspect", "invoke", "capture", "classify", "retain"],
      verification: [
        {
          kind: "build",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          timeoutMs: 60_000,
        },
        {
          kind: "rendered-flow",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          timeoutMs: 60_000,
        },
      ],
      requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
    });
    const adapter: WorkflowAdapter = {
      id: "throwing-provider",
      async execute() {
        throw new Error("provider timed out after 600000ms");
      },
    };

    const result = await runWorkflowTrial({
      sourceRepository: source,
      evidenceRoot,
      task,
      condition: "baseline",
      routedContext: "",
      adapter,
    });

    expect(result.accepted).toBe(false);
    expect(result.adapter).toMatchObject({
      exitCode: 1,
      tools: { calls: 0, errors: 1, retries: 0 },
    });
    expect(result.adapter.stderr).toContain("provider timed out");
    expect(result.verification).toEqual([]);
    await expect(readFile(
      path.join(result.evidenceDirectory, "events.jsonl"),
      "utf8",
    )).resolves.toContain("workflow.adapter.failed");
  });

  it("retains preparation failures without invoking the provider", async () => {
    const source = await fixtureRepository();
    const evidenceRoot = await temporaryDirectory("memi-workflow-evidence-");
    let invoked = false;
    const task = workflowTaskSchema.parse({
      schemaVersion: 1,
      id: "preparation-failure",
      intent: "Retain a failed dependency preparation as immutable evidence",
      maximumDurationMs: 10 * 60_000,
      steps: ["clone", "prepare", "capture", "classify", "retain"],
      preparation: [{
        command: process.execPath,
        args: ["-e", "process.stderr.write('registry unavailable');process.exit(23)"],
        timeoutMs: 60_000,
      }],
      verification: [
        {
          kind: "build",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          timeoutMs: 60_000,
        },
        {
          kind: "rendered-flow",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          timeoutMs: 60_000,
        },
      ],
      requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
    });
    const adapter: WorkflowAdapter = {
      id: "must-not-run",
      async execute() {
        invoked = true;
        throw new Error("adapter should not run");
      },
    };

    const result = await runWorkflowTrial({
      sourceRepository: source,
      evidenceRoot,
      task,
      condition: "baseline",
      routedContext: "",
      adapter,
    });

    expect(invoked).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.preparation).toMatchObject([{
      exitCode: 23,
      passed: false,
      stderr: "registry unavailable",
    }]);
    expect(result.adapter.stderr).toContain("preparation-failed");
    expect(result.verification).toEqual([]);
    await expect(readFile(
      path.join(result.evidenceDirectory, "events.jsonl"),
      "utf8",
    )).resolves.toContain("workflow.preparation.failed");
  });
});

async function fixtureRepository(): Promise<string> {
  const root = await temporaryDirectory("memi-workflow-source-");
  await writeFile(path.join(root, "README.md"), "# Fixture\n");
  await writeFile(path.join(root, ".gitignore"), ".cache/\n");
  await run(root, "git", ["init"]);
  await run(root, "git", ["add", "README.md", ".gitignore"]);
  await run(root, "git", [
    "-c",
    "user.name=Memi Test",
    "-c",
    "user.email=test@memi.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  return root;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(directory);
  await mkdir(directory, { recursive: true });
  return directory;
}

async function run(cwd: string, command: string, args: string[]): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
