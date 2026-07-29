import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  chmod,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BenchmarkCondition } from "./contracts.js";
import {
  buildWorkflowPrompt,
  workflowTaskSchema,
  type WorkflowTask,
} from "./workflow.js";

const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface WorkflowAdapterResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly outputTokens: number;
    readonly reasoningTokens: number;
    readonly estimatedCostUsd: number | null;
  };
  readonly tools: {
    readonly calls: number;
    readonly errors: number;
    readonly retries: number;
  };
}

export interface WorkflowAdapter {
  readonly id: string;
  execute(input: {
    readonly workspaceRoot: string;
    readonly prompt: string;
    readonly timeoutMs: number;
  }): Promise<Readonly<WorkflowAdapterResult>>;
}

export interface WorkflowVerificationResult {
  readonly kind: WorkflowTask["verification"][number]["kind"];
  readonly command: string;
  readonly args: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly passed: boolean;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface WorkflowPreparationResult {
  readonly command: string;
  readonly args: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly passed: boolean;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface WorkflowTrialResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly condition: BenchmarkCondition;
  readonly adapterId: string;
  readonly accepted: boolean;
  readonly sourceRevision: string;
  readonly fixtureHash: string;
  readonly evidenceDirectory: string;
  readonly patch: string;
  readonly adapter: Readonly<WorkflowAdapterResult>;
  readonly preparation: readonly WorkflowPreparationResult[];
  readonly verification: readonly WorkflowVerificationResult[];
  readonly durationMs: number;
}

export async function runWorkflowTrial(input: {
  readonly sourceRepository: string;
  readonly evidenceRoot: string;
  readonly task: WorkflowTask;
  readonly condition: BenchmarkCondition;
  readonly routedContext: string;
  readonly adapter: WorkflowAdapter;
}): Promise<Readonly<WorkflowTrialResult>> {
  const task = workflowTaskSchema.parse(input.task);
  const sourceRepository = path.resolve(input.sourceRepository);
  const sourceRevision = (await runProcess({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: sourceRepository,
    timeoutMs: 30_000,
  })).stdout.trim();
  if (!sourceRevision) throw new Error("source repository has no HEAD revision");
  const sourceStatus = (await runProcess({
    command: "git",
    args: ["status", "--porcelain=v1", "--untracked-files=all"],
    cwd: sourceRepository,
    timeoutMs: 30_000,
  })).stdout.trim();
  if (sourceStatus) throw new Error(`source repository must be clean: ${sourceRepository}`);

  await mkdir(path.resolve(input.evidenceRoot), { recursive: true, mode: 0o700 });
  const runId = `${task.id}-${input.adapter.id}-${input.condition}-${randomUUID()}`;
  const evidenceDirectory = path.join(path.resolve(input.evidenceRoot), runId);
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  const workspaceParent = await mkdtemp(path.join(tmpdir(), "memi-workflow-"));
  const workspaceRoot = path.join(workspaceParent, "workspace");
  const events: Record<string, unknown>[] = [];
  const startedAt = new Date();
  const start = performance.now();

  try {
    events.push(event("workflow.started", {
      runId,
      taskId: task.id,
      condition: input.condition,
      adapterId: input.adapter.id,
      sourceRevision,
    }));
    await requireSuccessfulProcess({
      command: "git",
      args: ["clone", "--quiet", "--no-hardlinks", sourceRepository, workspaceRoot],
      cwd: workspaceParent,
      timeoutMs: 2 * 60_000,
    });
    await requireSuccessfulProcess({
      command: "git",
      args: ["checkout", "--quiet", "--detach", sourceRevision],
      cwd: workspaceRoot,
      timeoutMs: 30_000,
    });
    for (const fixture of task.fixtures) {
      const target = path.resolve(workspaceRoot, fixture.path);
      const relative = path.relative(workspaceRoot, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`fixture escapes disposable checkout: ${fixture.path}`);
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, fixture.content, { mode: fixture.executable ? 0o700 : 0o600 });
      if (fixture.executable) await chmod(target, 0o700);
    }
    const fixtureHash = `sha256:${createHash("sha256")
      .update(JSON.stringify(task.fixtures))
      .digest("hex")}`;
    events.push(event("workflow.fixtures.applied", {
      fixtureHash,
      fixtureCount: task.fixtures.length,
    }));

    const preparation: WorkflowPreparationResult[] = [];
    for (const command of task.preparation) {
      const commandStartedAt = new Date();
      const commandStart = performance.now();
      const processResult = await runProcess({
        command: command.command,
        args: command.args,
        cwd: workspaceRoot,
        timeoutMs: command.timeoutMs,
      });
      const result: WorkflowPreparationResult = {
        command: command.command,
        args: [...command.args],
        startedAt: commandStartedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - commandStart),
        exitCode: processResult.exitCode,
        passed: processResult.exitCode === 0 && !processResult.timedOut,
        timedOut: processResult.timedOut,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
      };
      preparation.push(result);
      events.push(event("workflow.preparation.completed", { ...result }));
      if (!result.passed) {
        throw new Error(
          `workflow preparation failed: ${command.command} ${command.args.join(" ")}`,
        );
      }
    }

    const prompt = buildWorkflowPrompt({
      task,
      condition: input.condition,
      routedContext: input.routedContext,
    });
    const adapterStarted = performance.now();
    const adapterResult = await withTimeout(
      input.adapter.execute({
        workspaceRoot,
        prompt,
        timeoutMs: task.maximumDurationMs,
      }),
      task.maximumDurationMs,
      `workflow adapter ${input.adapter.id}`,
    );
    events.push(event("workflow.adapter.completed", {
      exitCode: adapterResult.exitCode,
      durationMs: Math.round(performance.now() - adapterStarted),
      usage: adapterResult.usage,
      tools: adapterResult.tools,
    }));

    const verification: WorkflowVerificationResult[] = [];
    for (const check of task.verification) {
      const checkStartedAt = new Date();
      const checkStart = performance.now();
      const processResult = await runProcess({
        command: check.command,
        args: [...check.args],
        cwd: workspaceRoot,
        timeoutMs: check.timeoutMs,
      });
      const result: WorkflowVerificationResult = {
        kind: check.kind,
        command: check.command,
        args: [...check.args],
        startedAt: checkStartedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - checkStart),
        exitCode: processResult.exitCode,
        passed: processResult.exitCode === 0 && !processResult.timedOut,
        timedOut: processResult.timedOut,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
      };
      verification.push(result);
      events.push(event("workflow.verification.completed", { ...result }));
    }

    await runProcess({
      command: "git",
      args: ["add", "-N", "--", "."],
      cwd: workspaceRoot,
      timeoutMs: 30_000,
    });
    const patch = (await runProcess({
      command: "git",
      args: ["diff", "--binary", "--no-ext-diff"],
      cwd: workspaceRoot,
      timeoutMs: 30_000,
    })).stdout;
    const accepted = adapterResult.exitCode === 0
      && verification.every((entry) => entry.passed)
      && task.requiredArtifacts.every((artifact) =>
        ["git.patch", "verification.json", "events.jsonl"].includes(artifact));
    const durationMs = Math.round(performance.now() - start);
    events.push(event("workflow.completed", {
      accepted,
      durationMs,
      patchBytes: Buffer.byteLength(patch),
    }));
    await Promise.all([
      writeFile(path.join(evidenceDirectory, "git.patch"), patch, { mode: 0o600 }),
      writeFile(
        path.join(evidenceDirectory, "preparation.json"),
        `${JSON.stringify(preparation, null, 2)}\n`,
        { mode: 0o600 },
      ),
      writeFile(
        path.join(evidenceDirectory, "verification.json"),
        `${JSON.stringify(verification, null, 2)}\n`,
        { mode: 0o600 },
      ),
      writeFile(
        path.join(evidenceDirectory, "events.jsonl"),
        `${events.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        { mode: 0o600 },
      ),
      writeFile(path.join(evidenceDirectory, "adapter.stdout.log"), adapterResult.stdout, {
        mode: 0o600,
      }),
      writeFile(path.join(evidenceDirectory, "adapter.stderr.log"), adapterResult.stderr, {
        mode: 0o600,
      }),
    ]);
    return deepFreeze({
      schemaVersion: 1,
      runId,
      condition: input.condition,
      adapterId: input.adapter.id,
      accepted,
      sourceRevision,
      fixtureHash,
      evidenceDirectory,
      patch,
      adapter: adapterResult,
      preparation,
      verification,
      durationMs,
    });
  } finally {
    await rm(workspaceParent, { recursive: true, force: true });
  }
}

interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

async function requireSuccessfulProcess(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
}): Promise<ProcessResult> {
  const result = await runProcess(input);
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(
      `${input.command} ${input.args.join(" ")} failed: ${result.stderr.trim()}`,
    );
  }
  return result;
}

async function runProcess(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function appendBounded(current: string, chunk: string): string {
  if (Buffer.byteLength(current) >= MAX_PROCESS_OUTPUT_BYTES) return current;
  const remaining = MAX_PROCESS_OUTPUT_BYTES - Buffer.byteLength(current);
  return current + Buffer.from(chunk).subarray(0, remaining).toString("utf8");
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function event(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type,
    createdAt: new Date().toISOString(),
    ...payload,
  };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
