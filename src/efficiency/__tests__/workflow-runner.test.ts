import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runWorkflowTrial,
  type WorkflowAdapter,
} from "../workflow-runner.js";
import { workflowTaskSchema } from "../workflow.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("workflow trial runner", () => {
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
          args: ["-e", "if(require('fs').readFileSync('implemented.txt','utf8')!=='ready\\n')process.exit(1)"],
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
    expect(result.preparation).toHaveLength(1);
    expect(result.fixtureHash).toMatch(/^sha256:/);
    expect(result.verification.every((entry) => entry.passed)).toBe(true);
    expect(result.patch).toContain("implemented.txt");
    await expect(readFile(path.join(source, "implemented.txt"), "utf8")).rejects.toThrow();
    expect(await readFile(path.join(result.evidenceDirectory, "verification.json"), "utf8"))
      .toContain("\"passed\": true");
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
});

async function fixtureRepository(): Promise<string> {
  const root = await temporaryDirectory("memi-workflow-source-");
  await writeFile(path.join(root, "README.md"), "# Fixture\n");
  await run(root, "git", ["init"]);
  await run(root, "git", ["add", "README.md"]);
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
