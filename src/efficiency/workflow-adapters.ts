import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseCodexJsonl } from "./codex-evidence.js";
import {
  buildIsolatedCodexEnvironment,
} from "./codex-runner.js";
import type {
  WorkflowAdapter,
  WorkflowAdapterResult,
} from "./workflow-runner.js";

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface WorkflowAdapterOptions {
  readonly executable: string;
  readonly modelId: string;
  readonly reasoningEffort: string;
  readonly authHome?: string;
}

export function createCodexWorkflowAdapter(
  options: WorkflowAdapterOptions,
): WorkflowAdapter {
  return {
    id: `codex:${options.modelId}:${options.reasoningEffort}`,
    async execute(input) {
      const isolatedHome = await mkdtemp(path.join(tmpdir(), "memi-workflow-codex-"));
      try {
        await chmod(isolatedHome, 0o700);
        const authHome = path.resolve(
          options.authHome
            ?? process.env.CODEX_HOME
            ?? path.join(homedir(), ".codex"),
        );
        await copyPrivateFile(
          path.join(authHome, "auth.json"),
          path.join(isolatedHome, "auth.json"),
        );
        const execution = await executeProcess({
          command: options.executable,
          args: buildCodexWorkflowArgs({
            workspaceRoot: input.workspaceRoot,
            modelId: options.modelId,
            reasoningEffort: options.reasoningEffort,
          }),
          cwd: input.workspaceRoot,
          env: buildPreparedToolEnvironment(
            buildIsolatedCodexEnvironment(process.env, isolatedHome),
            isolatedHome,
          ),
          stdin: input.prompt,
          timeoutMs: input.timeoutMs,
        });
        const trace = parseCodexJsonl(execution.stdout);
        return freeze({
          exitCode: execution.exitCode,
          stdout: execution.stdout,
          stderr: execution.stderr,
          usage: {
            ...trace.usage,
            estimatedCostUsd: null,
          },
          tools: trace.tools,
        });
      } finally {
        await rm(isolatedHome, { recursive: true, force: true });
      }
    },
  };
}

export function createClaudeWorkflowAdapter(
  options: WorkflowAdapterOptions,
): WorkflowAdapter {
  return {
    id: `claude:${options.modelId}:${options.reasoningEffort}`,
    async execute(input) {
      const isolatedHome = await mkdtemp(path.join(tmpdir(), "memi-workflow-claude-"));
      try {
        await chmod(isolatedHome, 0o700);
        const authHome = path.resolve(
          options.authHome ?? path.join(homedir(), ".claude"),
        );
        await copyPrivateFile(
          path.join(authHome, ".credentials.json"),
          path.join(isolatedHome, ".claude", ".credentials.json"),
        );
        const execution = await executeProcess({
          command: options.executable,
          args: buildClaudeWorkflowArgs({
            modelId: options.modelId,
            reasoningEffort: options.reasoningEffort,
          }),
          cwd: input.workspaceRoot,
          env: {
            ...buildPreparedToolEnvironment(process.env, isolatedHome),
            CLAUDE_CONFIG_DIR: path.join(isolatedHome, ".claude"),
          },
          stdin: input.prompt,
          timeoutMs: input.timeoutMs,
        });
        const trace = parseClaudeStreamJson(execution.stdout);
        return freeze({
          exitCode: execution.exitCode,
          stdout: execution.stdout,
          stderr: execution.stderr,
          usage: trace.usage,
          tools: trace.tools,
        });
      } finally {
        await rm(isolatedHome, { recursive: true, force: true });
      }
    },
  };
}

export function buildPreparedToolEnvironment(
  base: Readonly<NodeJS.ProcessEnv>,
  isolatedHome: string,
  hostHome: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  return {
    ...base,
    HOME: isolatedHome,
    PLAYWRIGHT_BROWSERS_PATH: base.PLAYWRIGHT_BROWSERS_PATH
      ?? defaultPlaywrightBrowsersPath(base, hostHome, platform),
  };
}

export function buildCodexWorkflowArgs(input: {
  readonly workspaceRoot: string;
  readonly modelId: string;
  readonly reasoningEffort: string;
}): readonly string[] {
  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--model",
    input.modelId,
    "-c",
    `model_reasoning_effort="${input.reasoningEffort}"`,
    "--sandbox",
    "workspace-write",
    "--json",
    "-C",
    input.workspaceRoot,
    "-",
  ];
}

function defaultPlaywrightBrowsersPath(
  environment: Readonly<NodeJS.ProcessEnv>,
  hostHome: string,
  platform: NodeJS.Platform,
): string {
  if (platform === "darwin") {
    return path.join(hostHome, "Library", "Caches", "ms-playwright");
  }
  if (platform === "win32") {
    return path.join(
      environment.LOCALAPPDATA ?? path.join(hostHome, "AppData", "Local"),
      "ms-playwright",
    );
  }
  return path.join(hostHome, ".cache", "ms-playwright");
}

export function buildClaudeWorkflowArgs(input: {
  readonly modelId: string;
  readonly reasoningEffort: string;
}): readonly string[] {
  return [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    input.modelId,
    "--effort",
    input.reasoningEffort,
    "--permission-mode",
    "acceptEdits",
    "--tools",
    "Bash,Edit,Read,Write,Glob,Grep",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--no-chrome",
  ];
}

export function parseClaudeStreamJson(jsonl: string): Readonly<{
  finalResponse: string;
  usage: WorkflowAdapterResult["usage"];
  tools: WorkflowAdapterResult["tools"];
}> {
  let finalResponse = "";
  let usage: WorkflowAdapterResult["usage"] = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    estimatedCostUsd: null,
  };
  const toolNames: string[] = [];
  let errors = 0;
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === "assistant") {
      const message = asRecord(event.message);
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const block of content) {
        const item = asRecord(block);
        if (item?.type === "tool_use") toolNames.push(String(item.name ?? "unknown"));
      }
    }
    if (event.type === "user") {
      const message = asRecord(event.message);
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const block of content) {
        const item = asRecord(block);
        if (item?.type === "tool_result" && item.is_error === true) errors += 1;
      }
    }
    if (event.type === "result") {
      finalResponse = typeof event.result === "string" ? event.result : finalResponse;
      const rawUsage = asRecord(event.usage);
      usage = {
        inputTokens: numberOrZero(rawUsage?.input_tokens),
        cachedInputTokens: numberOrZero(rawUsage?.cache_read_input_tokens),
        outputTokens: numberOrZero(rawUsage?.output_tokens),
        reasoningTokens: 0,
        estimatedCostUsd: typeof event.total_cost_usd === "number"
          ? event.total_cost_usd
          : null,
      };
    }
  }
  return freeze({
    finalResponse,
    usage,
    tools: {
      calls: toolNames.length,
      errors,
      retries: 0,
    },
  });
}

async function copyPrivateFile(source: string, target: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
  await chmod(target, 0o600);
}

async function executeProcess(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: string;
  readonly timeoutMs: number;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
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
      if (timedOut) {
        reject(new Error(`${input.command} timed out after ${input.timeoutMs}ms`));
        return;
      }
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    child.stdin.end(input.stdin);
  });
}

function appendBounded(current: string, chunk: string): string {
  if (Buffer.byteLength(current) >= MAX_OUTPUT_BYTES) return current;
  const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(current);
  return current + Buffer.from(chunk).subarray(0, remaining).toString("utf8");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
