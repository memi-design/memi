import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  benchmarkRunRecordSchema,
  type BenchmarkCondition,
  type BenchmarkRunRecord,
  type CodexCaseStudyTask,
} from "./contracts.js";
import {
  gradeCaseStudyResponse,
  parseCodexJsonl,
  type CaseStudyGrade,
} from "./codex-evidence.js";

export interface BuildCodexCasePromptOptions {
  readonly condition: BenchmarkCondition;
  readonly memiCliPath: string;
}

export interface CodexCaseRunOptions extends BuildCodexCasePromptOptions {
  readonly repositoryRoot: string;
  readonly task: CodexCaseStudyTask;
  readonly suiteId: string;
  readonly experimentId: string;
  readonly repeat: number;
  readonly evidenceDirectory: string;
  readonly codexPath: string;
  readonly modelId: string;
  readonly reasoningEffort: string;
  readonly harnessId: string;
  readonly authHome?: string;
  readonly timeoutMs?: number;
}

export interface CodexCaseRunResult {
  readonly record: BenchmarkRunRecord;
  readonly grade: Readonly<CaseStudyGrade>;
  readonly evidenceDirectory: string;
}

export function buildCodexCasePrompt(
  task: CodexCaseStudyTask,
  options: BuildCodexCasePromptOptions,
): string {
  const shared = [
    "You are evaluating a pinned repository read-only.",
    "Do not modify files. Work alone and do not delegate.",
    "Do not load user-installed skills, plugins, or external agent instructions; this benchmark task is self-contained.",
    task.intent,
    "Inspect only the source required for this task.",
    "Do not run unrelated tests or inspect dependency lockfile bodies unless the task requires them.",
    `Cover these required topics explicitly: ${task.rubric.requiredTerms.join(", ")}.`,
    `Return at least ${task.rubric.minimumValidCitations} distinct source-line citations as clickable Markdown file links.`,
    "Use repository-relative Markdown links exactly as the paths appear in source discovery; never synthesize or rename an absolute repository root.",
    "Separate confirmed evidence from assumptions, disclose unresolved gaps, and end with a `Verification commands` section containing a fenced shell block.",
  ].join("\n");
  const conditionInstruction = options.condition === "baseline"
    ? "Baseline condition: Do not use Memi or any external design-intelligence tool."
    : [
      "Memi-assisted condition: before broad repository searches, run this exact local, read-only preflight once:",
      `node ${options.memiCliPath} diagnose . --agent-context --context-files 20 --context-issues 12 --no-write --fail-on none`,
      "Read routing first: use full context only for `full`, treat `index-only` as a compact hint, and ignore expanded context for `abstain`.",
      "When routed, use its bounded file signals, findings, app graph, coverage, provenance, and explicit unassessed dimensions to narrow subsequent inspection.",
      "Treat sourceExcerpts as line-numbered source evidence and inspect a file only when its excerpt lacks context required by the task.",
      "Verify every material claim against the cited source line.",
    ].join("\n");
  return `${shared}\n\n${conditionInstruction}\n`;
}

export async function runCodexCaseStudy(
  options: CodexCaseRunOptions,
): Promise<Readonly<CodexCaseRunResult>> {
  const repositoryRoot = await realpath(options.repositoryRoot);
  const revision = await benchmarkRepositoryRevision(repositoryRoot);
  const dirty = (await benchmarkRepositoryStatus(repositoryRoot)).length > 0;
  if (dirty) {
    throw new Error(`benchmark repository must be clean: ${repositoryRoot}`);
  }
  const evidenceDirectory = path.resolve(options.evidenceDirectory);
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });

  const isolatedHome = await mkdtemp(
    path.join(tmpdir(), "memi-codex-benchmark-"),
  );
  await chmod(isolatedHome, 0o700);
  const authHome = path.resolve(
    options.authHome
      ?? process.env.CODEX_HOME
      ?? path.join(homedir(), ".codex"),
  );
  const authSource = path.join(authHome, "auth.json");
  const authTarget = path.join(isolatedHome, "auth.json");
  await copyFile(authSource, authTarget);
  await chmod(authTarget, 0o600);

  const prompt = buildCodexCasePrompt(options.task, options);
  const startedAt = new Date();
  const start = performance.now();
  let execution: Awaited<ReturnType<typeof executeCodex>>;
  try {
    execution = await executeCodex({
      codexPath: options.codexPath,
      repositoryRoot,
      isolatedHome,
      modelId: options.modelId,
      reasoningEffort: options.reasoningEffort,
      prompt,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
    });
  } finally {
    await rm(isolatedHome, { recursive: true, force: true });
  }
  const completedAt = new Date();
  const wallTimeMs = Math.round(performance.now() - start);
  const trace = parseCodexJsonl(execution.stdout);
  const grade = await gradeCaseStudyResponse({
    repositoryRoot,
    response: trace.finalResponse,
    minimumValidCitations: options.task.rubric.minimumValidCitations,
    requiredTerms: options.task.rubric.requiredTerms,
  });
  const runId = [
    options.experimentId,
    options.task.id,
    String(options.repeat),
    options.condition,
  ].join("-");
  const eventsPath = path.join(evidenceDirectory, "events.jsonl");
  const responsePath = path.join(evidenceDirectory, "response.md");
  const stderrPath = path.join(evidenceDirectory, "stderr.log");
  const gradePath = path.join(evidenceDirectory, "grade.json");
  const recordPath = path.join(evidenceDirectory, "run.json");
  await Promise.all([
    writeFile(eventsPath, execution.stdout, { mode: 0o600 }),
    writeFile(responsePath, `${trace.finalResponse}\n`, { mode: 0o600 }),
    writeFile(stderrPath, execution.stderr, { mode: 0o600 }),
    writeFile(gradePath, `${JSON.stringify(grade, null, 2)}\n`, { mode: 0o600 }),
  ]);

  const record = benchmarkRunRecordSchema.parse({
    schemaVersion: 1,
    runId,
    graderVersion: "source-citations-v2",
    experimentId: options.experimentId,
    suiteId: options.suiteId,
    taskId: options.task.id,
    repeat: options.repeat,
    condition: options.condition,
    invocation: "ci",
    repository: {
      pathHash: `sha256:${createHash("sha256").update(repositoryRoot).digest("hex")}`,
      revision,
      dirty,
    },
    harness: {
      id: options.harnessId,
      modelId: options.modelId,
      reasoningEffort: options.reasoningEffort,
    },
    timing: {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      wallTimeMs,
      toolTimeMs: 0,
    },
    usage: {
      ...trace.usage,
      estimatedCostUsd: null,
    },
    tools: trace.tools,
    outcome: {
      accepted: execution.exitCode === 0 && grade.accepted,
      testsPassed: grade.accepted,
      qualityScore: grade.qualityScore,
      defects: grade.defects,
      humanInterventions: 0,
    },
    evidenceRefs: [
      eventsPath,
      responsePath,
      stderrPath,
      gradePath,
      "estimatedCostUsd:unassessed-codex-subscription",
    ],
  });
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  return deepFreeze({ record, grade, evidenceDirectory });
}

export async function benchmarkRepositoryRevision(
  repositoryRoot: string,
): Promise<string> {
  return (await git(repositoryRoot, ["rev-parse", "HEAD"])).trim();
}

export async function benchmarkRepositoryStatus(
  repositoryRoot: string,
): Promise<string> {
  return (
    await git(repositoryRoot, [
      "status",
      "--short",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude).memoire",
    ])
  ).trim();
}

interface ExecuteCodexOptions {
  readonly codexPath: string;
  readonly repositoryRoot: string;
  readonly isolatedHome: string;
  readonly modelId: string;
  readonly reasoningEffort: string;
  readonly prompt: string;
  readonly timeoutMs: number;
}

async function executeCodex(options: ExecuteCodexOptions): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.codexPath, [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--model",
      options.modelId,
      "-c",
      `model_reasoning_effort="${options.reasoningEffort}"`,
      "--sandbox",
      "read-only",
      "--json",
      "-C",
      options.repositoryRoot,
      "-",
    ], {
      cwd: options.repositoryRoot,
      env: buildIsolatedCodexEnvironment(process.env, options.isolatedHome),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`Codex benchmark timed out after ${options.timeoutMs}ms`));
        return;
      }
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    child.stdin.end(options.prompt);
  });
}

export function buildIsolatedCodexEnvironment(
  base: Readonly<NodeJS.ProcessEnv>,
  isolatedHome: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...base };
  for (const key of [
    "CODEX_CI",
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
    "CODEX_PERMISSION_PROFILE",
    "CODEX_SHELL",
    "CODEX_THREAD_ID",
  ]) {
    delete environment[key];
  }
  return {
    ...environment,
    HOME: isolatedHome,
    CODEX_HOME: isolatedHome,
  };
}

async function git(repositoryRoot: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`));
    });
  });
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
