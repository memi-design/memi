import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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
import {
  profileWorkflowTools,
  type WorkflowToolProfile,
} from "./tool-profile.js";
import {
  assessWorkflowBudget,
  type WorkflowBudgetAssessment,
} from "./workflow-budget.js";

const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const WORKFLOW_ADAPTER_EVIDENCE_GRACE_MS = 1_000;

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
    readonly outputBytes?: number;
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
    readonly maximumToolCalls: number;
    readonly maximumToolOutputBytes: number;
    readonly maximumInputTokens?: number;
    readonly maximumOutputTokens?: number;
    readonly maximumReasoningTokens?: number;
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

export interface WorkflowNativeCaptureResult {
  readonly kind: WorkflowTask["nativeCaptures"][number]["kind"];
  readonly artifactName: string;
  readonly sourcePath: string;
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
  readonly toolProfile: Readonly<WorkflowToolProfile>;
  readonly preparation: readonly WorkflowPreparationResult[];
  readonly verification: readonly WorkflowVerificationResult[];
  readonly nativeCaptures: readonly WorkflowNativeCaptureResult[];
  readonly verificationIsolation: {
    readonly mode: "fresh-clone-post-patch";
    readonly patchApplied: boolean;
    readonly fixturesUnchanged: boolean;
    readonly preparationPassed: boolean;
  };
  readonly budget: Readonly<WorkflowBudgetAssessment>;
  readonly adapterWallTimeMs: number;
  readonly durationMs: number;
}

export async function runWorkflowTrial(input: {
  readonly sourceRepository: string;
  readonly evidenceRoot: string;
  readonly task: WorkflowTask;
  readonly condition: BenchmarkCondition;
  readonly routedContext: string;
  readonly adapter: WorkflowAdapter;
  readonly captureRoot?: string;
}): Promise<Readonly<WorkflowTrialResult>> {
  const task = workflowTaskSchema.parse(input.task);
  if (task.nativeCaptures.length > 0 && !input.captureRoot) {
    throw new Error("native workflow captures require a bounded capture root");
  }
  const sourceRepository = path.resolve(input.sourceRepository);
  const captureRoot = input.captureRoot ? path.resolve(input.captureRoot) : null;
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
  let verificationParent: string | null = null;
  let verificationRoot: string | null = null;
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
      args: ["clone", "--quiet", "--no-checkout", "--no-hardlinks", sourceRepository, workspaceRoot],
      cwd: workspaceParent,
      timeoutMs: 2 * 60_000,
      retries: 2,
      retryDelayMs: 2_000,
    });
    await requireSuccessfulProcess({
      command: "git",
      args: ["config", "core.autocrlf", "false"],
      cwd: workspaceRoot,
      timeoutMs: 30_000,
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
        events.push(event("workflow.preparation.failed", {
          command: command.command,
          args: command.args,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
        }));
        break;
      }
    }
    const failedPreparation = preparation.find((result) => !result.passed);
    if (failedPreparation) {
      const adapterResult = deepFreeze({
        exitCode: 1,
        stdout: "",
        stderr: `preparation-failed:${failedPreparation.command} exited ${failedPreparation.exitCode}`,
        usage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          estimatedCostUsd: null,
        },
        tools: {
          calls: 0,
          errors: 1,
          retries: 0,
        },
      });
      const toolProfile = profileWorkflowTools(
        input.adapter.id,
        adapterResult.stdout,
      );
      const budget = assessWorkflowBudget(task.agentBudget, adapterResult);
      const durationMs = Math.round(performance.now() - start);
      const verificationIsolation = {
        mode: "fresh-clone-post-patch" as const,
        preparationPassed: false,
        patchApplied: false,
        fixturesUnchanged: false,
      };
      events.push(event("workflow.completed", {
        accepted: false,
        durationMs,
        patchBytes: 0,
        reason: "preparation-failed",
      }));
      await persistWorkflowEvidence({
        evidenceDirectory,
        patch: "",
        preparation,
        verification: [],
        nativeCaptures: [],
        events,
        adapterResult,
        toolProfile,
        budget,
      });
      return deepFreeze({
        schemaVersion: 1,
        runId,
        condition: input.condition,
        adapterId: input.adapter.id,
        accepted: false,
        sourceRevision,
        fixtureHash,
        evidenceDirectory,
        patch: "",
        adapter: adapterResult,
        toolProfile,
        preparation,
        verification: [],
        nativeCaptures: [],
        verificationIsolation,
        budget,
        adapterWallTimeMs: 0,
        durationMs,
      });
    }
    await requireSuccessfulProcess({
      command: "git",
      args: ["add", "-A", "--", "."],
      cwd: workspaceRoot,
      timeoutMs: 30_000,
    });
    await requireSuccessfulProcess({
      command: "git",
      args: [
        "-c",
        "user.name=Memi Workflow",
        "-c",
        "user.email=workflow@memi.invalid",
        "commit",
        "--quiet",
        "--allow-empty",
        "--no-gpg-sign",
        "-m",
        "memi workflow baseline",
      ],
      cwd: workspaceRoot,
      timeoutMs: 30_000,
    });
    const workflowBaselineRevision = (await requireSuccessfulProcess({
      command: "git",
      args: ["rev-parse", "HEAD"],
      cwd: workspaceRoot,
      timeoutMs: 30_000,
    })).stdout.trim();
    events.push(event("workflow.baseline.captured", {
      workflowBaselineRevision,
      fixtureHash,
    }));

    const prompt = buildWorkflowPrompt({
      task,
      condition: input.condition,
      routedContext: input.routedContext,
    });
    const adapterStarted = performance.now();
    let adapterResult: WorkflowAdapterResult;
    try {
      adapterResult = await withTimeout(
        input.adapter.execute({
          workspaceRoot,
          prompt,
          timeoutMs: task.maximumDurationMs,
          maximumToolCalls: task.agentBudget.maxToolCalls,
          maximumToolOutputBytes: task.agentBudget.maxToolOutputBytes ?? 160_000,
          maximumInputTokens: task.agentBudget.maxInputTokens,
          maximumOutputTokens: task.agentBudget.maxOutputTokens,
          maximumReasoningTokens: task.agentBudget.maxReasoningTokens,
        }),
        workflowAdapterWatchdogMs(task.maximumDurationMs),
        `workflow adapter ${input.adapter.id}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      adapterResult = deepFreeze({
        exitCode: 1,
        stdout: "",
        stderr: `adapter-exception:${message}`,
        usage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          estimatedCostUsd: null,
        },
        tools: {
          calls: 0,
          errors: 1,
          retries: 0,
        },
      });
      events.push(event("workflow.adapter.failed", {
        durationMs: Math.round(performance.now() - adapterStarted),
        failure: message,
      }));
    }
    const adapterWallTimeMs = Math.round(performance.now() - adapterStarted);
    const toolProfile = profileWorkflowTools(input.adapter.id, adapterResult.stdout);
    const budget = assessWorkflowBudget(task.agentBudget, adapterResult);
    events.push(event("workflow.adapter.completed", {
      exitCode: adapterResult.exitCode,
      durationMs: adapterWallTimeMs,
      usage: adapterResult.usage,
      tools: adapterResult.tools,
    }));
    events.push(event("workflow.budget.assessed", budget));
    events.push(event("workflow.tools.profiled", {
      ...toolProfile,
    }));

    await runProcess({
      command: "git",
      args: ["add", "-N", "--", "."],
      cwd: workspaceRoot,
      timeoutMs: 30_000,
    });
    const patch = (await runProcess({
      command: "git",
      args: [
        "diff",
        "--binary",
        "--no-ext-diff",
        workflowBaselineRevision,
        "--",
        ".",
      ],
      cwd: workspaceRoot,
      timeoutMs: 30_000,
    })).stdout;
    const fixturesUnchanged = await verifyFixtures(workspaceRoot, task.fixtures);
    events.push(event("workflow.patch.captured", {
      patchBytes: Buffer.byteLength(patch),
      fixturesUnchanged,
    }));

    const patchPath = path.join(evidenceDirectory, "git.patch");
    await writeFile(patchPath, patch, { mode: 0o600 });
    const verification: WorkflowVerificationResult[] = [];
    let verificationPreparationPassed = false;
    let verificationPatchApplied = false;
    let verificationFixturesUnchanged = false;
    if (adapterResult.exitCode === 0) {
      verificationParent = await mkdtemp(path.join(
        tmpdir(),
        "memi-workflow-verification-",
      ));
      verificationRoot = path.join(verificationParent, "workspace");
      await requireSuccessfulProcess({
        command: "git",
        args: ["clone", "--quiet", "--no-checkout", "--no-hardlinks", sourceRepository, verificationRoot],
        cwd: verificationParent,
        timeoutMs: 2 * 60_000,
        retries: 2,
        retryDelayMs: 2_000,
      });
      await requireSuccessfulProcess({
        command: "git",
        args: ["config", "core.autocrlf", "false"],
        cwd: verificationRoot,
        timeoutMs: 30_000,
      });
      await requireSuccessfulProcess({
        command: "git",
        args: ["checkout", "--quiet", "--detach", sourceRevision],
        cwd: verificationRoot,
        timeoutMs: 30_000,
      });
      for (const fixture of task.fixtures) {
        const target = path.resolve(verificationRoot, fixture.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, fixture.content, {
          mode: fixture.executable ? 0o700 : 0o600,
        });
        if (fixture.executable) await chmod(target, 0o700);
      }
      verificationPreparationPassed = true;
      for (const command of task.preparation) {
        const processResult = await runProcess({
          command: command.command,
          args: command.args,
          cwd: verificationRoot,
          timeoutMs: command.timeoutMs,
        });
        if (processResult.exitCode !== 0 || processResult.timedOut) {
          verificationPreparationPassed = false;
          events.push(event("workflow.verification.preparation_failed", {
            command: command.command,
            args: command.args,
            exitCode: processResult.exitCode,
            timedOut: processResult.timedOut,
          }));
          break;
        }
      }
      if (verificationPreparationPassed) {
        if (patch.trim()) {
          const apply = await runProcess({
            command: "git",
            args: ["apply", "--binary", "--whitespace=nowarn", patchPath],
            cwd: verificationRoot,
            timeoutMs: 60_000,
          });
          verificationPatchApplied = apply.exitCode === 0 && !apply.timedOut;
          if (!verificationPatchApplied) {
            events.push(event("workflow.verification.patch_failed", {
              exitCode: apply.exitCode,
              timedOut: apply.timedOut,
              stderr: apply.stderr,
            }));
          }
        } else {
          verificationPatchApplied = true;
        }
      }
      verificationFixturesUnchanged = verificationPatchApplied
        && await verifyFixtures(verificationRoot, task.fixtures);
      events.push(event("workflow.verification.isolated", {
        mode: "fresh-clone-post-patch",
        preparationPassed: verificationPreparationPassed,
        patchApplied: verificationPatchApplied,
        fixturesUnchanged: verificationFixturesUnchanged,
      }));
      if (
        verificationPreparationPassed
        && verificationPatchApplied
        && verificationFixturesUnchanged
      ) {
        for (const check of task.verification) {
          const checkStartedAt = new Date();
          const checkStart = performance.now();
          const processResult = await runProcess({
            command: check.command,
            args: [...check.args],
            cwd: verificationRoot,
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
      }
    } else {
      events.push(event("workflow.verification.skipped", {
        reason: "provider-execution-failed",
        providerExitCode: adapterResult.exitCode,
      }));
    }

    const acceptanceBeforeNativeCapture = adapterResult.exitCode === 0
      && fixturesUnchanged
      && verificationPreparationPassed
      && verificationPatchApplied
      && verificationFixturesUnchanged
      && verification.length === task.verification.length
      && verification.every((entry) => entry.passed)
      && budget.withinBudget
      && task.requiredArtifacts.every((artifact) =>
        ["git.patch", "verification.json", "events.jsonl"].includes(artifact));
    const nativeCaptures = acceptanceBeforeNativeCapture && captureRoot
      ? await runNativeCaptures({
        captures: task.nativeCaptures,
        verificationRoot,
        captureRoot,
        events,
      })
      : [];
    const accepted = acceptanceBeforeNativeCapture
      && nativeCaptures.length === task.nativeCaptures.length
      && nativeCaptures.every((capture) => capture.passed);
    const durationMs = Math.round(performance.now() - start);
    events.push(event("workflow.completed", {
      accepted,
      durationMs,
      patchBytes: Buffer.byteLength(patch),
    }));
    await persistWorkflowEvidence({
      evidenceDirectory,
      patch,
      preparation,
      verification,
      nativeCaptures,
      events,
      adapterResult,
      toolProfile,
      budget,
    });
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
      toolProfile,
      preparation,
      verification,
      nativeCaptures,
      verificationIsolation: {
        mode: "fresh-clone-post-patch",
        preparationPassed: verificationPreparationPassed,
        patchApplied: verificationPatchApplied,
        fixturesUnchanged: verificationFixturesUnchanged,
      },
      budget,
      adapterWallTimeMs,
      durationMs,
    });
  } finally {
    await rm(workspaceParent, { recursive: true, force: true });
    if (verificationParent) {
      await rm(verificationParent, { recursive: true, force: true });
    }
  }
}

async function persistWorkflowEvidence(input: {
  readonly evidenceDirectory: string;
  readonly patch: string;
  readonly preparation: readonly WorkflowPreparationResult[];
  readonly verification: readonly WorkflowVerificationResult[];
  readonly nativeCaptures: readonly WorkflowNativeCaptureResult[];
  readonly events: readonly Record<string, unknown>[];
  readonly adapterResult: Readonly<WorkflowAdapterResult>;
  readonly toolProfile: Readonly<WorkflowToolProfile>;
  readonly budget: Readonly<WorkflowBudgetAssessment>;
}): Promise<void> {
  await Promise.all([
    writeFile(path.join(input.evidenceDirectory, "git.patch"), input.patch, {
      mode: 0o600,
    }),
    writeFile(
      path.join(input.evidenceDirectory, "preparation.json"),
      `${JSON.stringify(input.preparation, null, 2)}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      path.join(input.evidenceDirectory, "verification.json"),
      `${JSON.stringify(input.verification, null, 2)}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      path.join(input.evidenceDirectory, "native-capture.json"),
      `${JSON.stringify(input.nativeCaptures, null, 2)}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      path.join(input.evidenceDirectory, "events.jsonl"),
      `${input.events.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      path.join(input.evidenceDirectory, "adapter.stdout.log"),
      input.adapterResult.stdout,
      { mode: 0o600 },
    ),
    writeFile(
      path.join(input.evidenceDirectory, "adapter.stderr.log"),
      input.adapterResult.stderr,
      { mode: 0o600 },
    ),
    writeFile(
      path.join(input.evidenceDirectory, "tool-profile.json"),
      `${JSON.stringify(input.toolProfile, null, 2)}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      path.join(input.evidenceDirectory, "budget.json"),
      `${JSON.stringify(input.budget, null, 2)}\n`,
      { mode: 0o600 },
    ),
  ]);
}

async function runNativeCaptures(input: {
  readonly captures: WorkflowTask["nativeCaptures"];
  readonly verificationRoot: string | null;
  readonly captureRoot: string;
  readonly events: Record<string, unknown>[];
}): Promise<WorkflowNativeCaptureResult[]> {
  if (input.captures.length === 0) return [];
  if (!input.verificationRoot) {
    throw new Error("native captures require an isolated verification checkout");
  }
  await mkdir(input.captureRoot, { recursive: true, mode: 0o700 });
  const results: WorkflowNativeCaptureResult[] = [];
  for (const capture of input.captures) {
    const startedAt = new Date();
    const start = performance.now();
    const processResult = await runProcess({
      command: capture.command,
      args: capture.args,
      cwd: input.verificationRoot,
      timeoutMs: capture.timeoutMs,
    });
    let passed = processResult.exitCode === 0 && !processResult.timedOut;
    let stderr = processResult.stderr;
    if (passed) {
      const source = path.resolve(input.verificationRoot, capture.sourcePath);
      const relative = path.relative(input.verificationRoot, source);
      const stats = !relative.startsWith("..") && !path.isAbsolute(relative)
        ? await lstat(source).catch(() => null)
        : null;
      if (!stats?.isFile()) {
        passed = false;
        stderr = appendBounded(
          stderr,
          `\nnative capture source is not a regular file: ${capture.sourcePath}`,
        );
      } else {
        const target = path.join(input.captureRoot, capture.artifactName);
        const existing = await lstat(target).catch(() => null);
        if (existing) {
          passed = false;
          stderr = appendBounded(
            stderr,
            `\nnative capture artifact already exists: ${capture.artifactName}`,
          );
        } else {
          await copyFile(source, target);
          await chmod(target, 0o600);
        }
      }
    }
    const result: WorkflowNativeCaptureResult = {
      kind: capture.kind,
      artifactName: capture.artifactName,
      sourcePath: capture.sourcePath,
      command: capture.command,
      args: [...capture.args],
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - start),
      exitCode: processResult.exitCode,
      passed,
      timedOut: processResult.timedOut,
      stdout: processResult.stdout,
      stderr,
    };
    results.push(result);
    input.events.push(event("workflow.native-capture.completed", {
      kind: result.kind,
      artifactName: result.artifactName,
      exitCode: result.exitCode,
      passed: result.passed,
      timedOut: result.timedOut,
    }));
  }
  return results;
}

async function verifyFixtures(
  workspaceRoot: string,
  fixtures: WorkflowTask["fixtures"],
): Promise<boolean> {
  const checks = await Promise.all(fixtures.map(async (fixture) => {
    const target = path.resolve(workspaceRoot, fixture.path);
    const content = await readFile(target, "utf8").catch(() => null);
    return content === fixture.content;
  }));
  return checks.every(Boolean);
}

interface ProcessResult {
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export async function requireSuccessfulProcess(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly retries?: number;
  readonly retryDelayMs?: number;
}): Promise<ProcessResult> {
  return requireSuccessfulProcessAttempt(input, 0);
}

async function requireSuccessfulProcessAttempt(
  input: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly timeoutMs: number;
    readonly retries?: number;
    readonly retryDelayMs?: number;
  },
  attempt: number,
): Promise<ProcessResult> {
  const result = await runProcess(input);
  if (result.exitCode !== 0 || result.timedOut) {
    if (attempt < (input.retries ?? 0)) {
      await delay(input.retryDelayMs ?? 0);
      return requireSuccessfulProcessAttempt(input, attempt + 1);
    }
    const output = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    throw new Error(
      `${input.command} ${input.args.join(" ")} failed`
      + ` (exit=${result.exitCode}, signal=${result.signal ?? "none"},`
      + ` timedOut=${result.timedOut}, attempts=${attempt + 1})`
      + `${output ? `: ${output}` : ""}`,
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
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        exitCode: code ?? 1,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
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

export function workflowAdapterWatchdogMs(timeoutMs: number): number {
  return timeoutMs + WORKFLOW_ADAPTER_EVIDENCE_GRACE_MS;
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
