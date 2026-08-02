import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
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
const PROCESS_TERMINATION_GRACE_MS = 250;

export interface WorkflowAdapterOptions {
  readonly executable: string;
  readonly executableArgs?: readonly string[];
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
          args: [
            ...(options.executableArgs ?? []),
            ...buildCodexWorkflowArgs({
              workspaceRoot: input.workspaceRoot,
              modelId: options.modelId,
              reasoningEffort: options.reasoningEffort,
            }),
          ],
          cwd: input.workspaceRoot,
          env: buildPreparedToolEnvironment(
            buildIsolatedCodexEnvironment(process.env, isolatedHome),
            isolatedHome,
          ),
          stdin: input.prompt,
          timeoutMs: input.timeoutMs,
          maximumToolCalls: input.maximumToolCalls,
          maximumToolOutputBytes: input.maximumToolOutputBytes,
          maximumInputTokens: input.maximumInputTokens,
          maximumOutputTokens: input.maximumOutputTokens,
          maximumReasoningTokens: input.maximumReasoningTokens,
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
          tools: {
            calls: Math.max(trace.tools.calls, execution.observedToolCalls),
            outputBytes: execution.observedToolOutputBytes,
            errors: trace.tools.errors + (execution.budgetExceeded ? 1 : 0),
            retries: trace.tools.retries,
          },
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
        const oauthToken = await resolveClaudeOAuthToken(authHome);
        const execution = await executeProcess({
          command: options.executable,
          args: [
            ...(options.executableArgs ?? []),
            ...buildClaudeWorkflowArgs({
              modelId: options.modelId,
              reasoningEffort: options.reasoningEffort,
            }),
          ],
          cwd: input.workspaceRoot,
          env: {
            ...buildPreparedToolEnvironment(process.env, isolatedHome),
            CLAUDE_CONFIG_DIR: path.join(isolatedHome, ".claude"),
            ...(oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: oauthToken } : {}),
          },
          stdin: input.prompt,
          timeoutMs: input.timeoutMs,
          maximumToolCalls: input.maximumToolCalls,
          maximumToolOutputBytes: input.maximumToolOutputBytes,
          maximumInputTokens: input.maximumInputTokens,
          maximumOutputTokens: input.maximumOutputTokens,
          maximumReasoningTokens: input.maximumReasoningTokens,
        });
        const trace = parseClaudeStreamJson(execution.stdout);
        return freeze({
          exitCode: execution.exitCode === 0 && trace.failed
            ? 1
            : execution.exitCode,
          stdout: execution.stdout,
          stderr: execution.stderr,
          usage: trace.usage,
          tools: {
            calls: Math.max(trace.tools.calls, execution.observedToolCalls),
            outputBytes: execution.observedToolOutputBytes,
            errors: trace.tools.errors + (execution.budgetExceeded ? 1 : 0),
            retries: trace.tools.retries,
          },
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
  failed: boolean;
  failure: string | null;
  usage: WorkflowAdapterResult["usage"];
  tools: WorkflowAdapterResult["tools"];
}> {
  let finalResponse = "";
  let failure: string | null = null;
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
    if (typeof event.error === "string") {
      failure = event.error;
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
      if (event.is_error === true) {
        failure ??= typeof event.subtype === "string"
          ? event.subtype
          : "provider-error";
      }
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
    failed: failure !== null,
    failure,
    usage,
    tools: {
      calls: toolNames.length,
      errors,
      retries: 0,
    },
  });
}

export function parseClaudeOAuthCredential(
  serialized: string,
  now: number = Date.now(),
): string | null {
  try {
    const root = JSON.parse(serialized) as Record<string, unknown>;
    const oauth = asRecord(root.claudeAiOauth);
    const accessToken = typeof oauth?.accessToken === "string"
      ? oauth.accessToken.trim()
      : "";
    const expiresAt = typeof oauth?.expiresAt === "number"
      ? oauth.expiresAt
      : 0;
    return accessToken && expiresAt > now ? accessToken : null;
  } catch {
    return null;
  }
}

async function resolveClaudeOAuthToken(authHome: string): Promise<string | null> {
  const environmentToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (environmentToken) return environmentToken;
  const fileCredential = await readFile(
    path.join(authHome, ".credentials.json"),
    "utf8",
  ).catch(() => null);
  const fileToken = fileCredential
    ? parseClaudeOAuthCredential(fileCredential)
    : null;
  if (fileToken) return fileToken;
  if (process.platform !== "darwin") return null;
  const keychain = await executeProcess({
    command: "/usr/bin/security",
    args: [
      "find-generic-password",
      "-s",
      "Claude Code-credentials",
      "-w",
    ],
    cwd: homedir(),
    env: process.env,
    stdin: "",
    timeoutMs: 10_000,
  }).catch(() => null);
  return keychain?.exitCode === 0
    ? parseClaudeOAuthCredential(keychain.stdout)
    : null;
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
  readonly maximumToolCalls?: number;
  readonly maximumToolOutputBytes?: number;
  readonly maximumInputTokens?: number;
  readonly maximumOutputTokens?: number;
  readonly maximumReasoningTokens?: number;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  observedToolCalls: number;
  observedToolOutputBytes: number;
  budgetExceeded: boolean;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminationReason: "timeout" | "budget" | null = null;
    let timeout: NodeJS.Timeout | undefined;
    let killTimeout: NodeJS.Timeout | undefined;
    const toolMonitor = createToolCallBudgetMonitor({
      maximumToolCalls: input.maximumToolCalls,
      maximumToolOutputBytes: input.maximumToolOutputBytes,
      maximumInputTokens: input.maximumInputTokens,
      maximumOutputTokens: input.maximumOutputTokens,
      maximumReasoningTokens: input.maximumReasoningTokens,
    });

    const cleanup = (): void => {
      if (timeout) clearTimeout(timeout);
      if (killTimeout) clearTimeout(killTimeout);
      child.stdout.off("data", onStdoutData);
      child.stderr.off("data", onStderrData);
      child.off("error", onError);
      child.off("close", onClose);
    };
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const resolveOnce = (result: {
      exitCode: number;
      stdout: string;
      stderr: string;
      observedToolCalls: number;
      observedToolOutputBytes: number;
      budgetExceeded: boolean;
    }): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const terminate = (reason: "timeout" | "budget"): void => {
      if (settled || terminationReason !== null) return;
      terminationReason = reason;
      child.kill("SIGTERM");
      killTimeout = setTimeout(() => {
        if (settled || child.exitCode !== null || child.signalCode !== null) return;
        child.kill("SIGKILL");
      }, PROCESS_TERMINATION_GRACE_MS);
    };
    function onStdoutData(chunk: string): void {
      stdout = appendBounded(stdout, chunk);
      if (toolMonitor.ingest(chunk)) terminate("budget");
    }
    function onStderrData(chunk: string): void {
      stderr = appendBounded(stderr, chunk);
    }
    function onError(error: Error): void {
      rejectOnce(error);
    }
    function onClose(code: number | null): void {
      toolMonitor.finish();
      const budget = toolMonitor.snapshot();
      const budgetReason = budget.exceededDimensions[0] ?? "max-tool-calls";
      if (terminationReason === "timeout") {
        resolveOnce({
          exitCode: 1,
          stdout,
          stderr: `${stderr}\ntimeout-exhausted:${input.timeoutMs}ms`.trim(),
          observedToolCalls: budget.observedToolCalls,
          observedToolOutputBytes: budget.observedToolOutputBytes,
          budgetExceeded: budget.exceeded,
        });
        return;
      }
      const exhaustedBudget = terminationReason === "budget" || budget.exceeded;
      resolveOnce({
        exitCode: exhaustedBudget ? 1 : code ?? 1,
        stdout,
        stderr: exhaustedBudget
          ? `${stderr}\nbudget-exhausted:${budgetReason}`.trim()
          : stderr,
        observedToolCalls: budget.observedToolCalls,
        observedToolOutputBytes: budget.observedToolOutputBytes,
        budgetExceeded: budget.exceeded,
      });
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", onStdoutData);
    child.stderr.on("data", onStderrData);
    child.on("error", onError);
    child.on("close", onClose);
    timeout = setTimeout(() => terminate("timeout"), input.timeoutMs);
    child.stdin.end(input.stdin);
  });
}

export function createToolCallBudgetMonitor(input: number | Readonly<{
  maximumToolCalls?: number;
  maximumToolOutputBytes?: number;
  maximumInputTokens?: number;
  maximumOutputTokens?: number;
  maximumReasoningTokens?: number;
}>): {
  ingest(chunk: string): boolean;
  finish(): boolean;
  snapshot(): Readonly<{
    observedToolCalls: number;
    observedToolOutputBytes: number;
    exceeded: boolean;
    exceededDimensions: readonly WorkflowExecutionBudgetDimension[];
  }>;
} {
  const limits = typeof input === "number"
    ? { maximumToolCalls: input }
    : input;
  const seenToolIds = new Set<string>();
  let remainder = "";
  let observedToolCalls = 0;
  let observedToolOutputBytes = 0;
  let observedInputTokens = 0;
  let observedOutputTokens = 0;
  let observedReasoningTokens = 0;
  const exceededDimensions = new Set<WorkflowExecutionBudgetDimension>();
  const processLine = (line: string): void => {
    let event: Record<string, unknown> | null = null;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      event = null;
    }
    for (const toolId of event ? toolIds(event) : []) {
      if (seenToolIds.has(toolId)) continue;
      seenToolIds.add(toolId);
      observedToolCalls += 1;
    }
    for (const output of toolOutputs(event)) {
      observedToolOutputBytes += Buffer.byteLength(output);
    }
    const usage = usageSnapshot(event);
    if (usage) {
      observedInputTokens = Math.max(observedInputTokens, usage.inputTokens);
      observedOutputTokens = Math.max(observedOutputTokens, usage.outputTokens);
      observedReasoningTokens = Math.max(observedReasoningTokens, usage.reasoningTokens);
    }
    if (
      limits.maximumToolCalls !== undefined
      && observedToolCalls > limits.maximumToolCalls
    ) {
      exceededDimensions.add("max-tool-calls");
    }
    if (
      limits.maximumToolOutputBytes !== undefined
      && observedToolOutputBytes > limits.maximumToolOutputBytes
    ) {
      exceededDimensions.add("max-tool-output-bytes");
    }
    if (
      limits.maximumInputTokens !== undefined
      && observedInputTokens > limits.maximumInputTokens
    ) {
      exceededDimensions.add("max-input-tokens");
    }
    if (
      limits.maximumOutputTokens !== undefined
      && observedOutputTokens > limits.maximumOutputTokens
    ) {
      exceededDimensions.add("max-output-tokens");
    }
    if (
      limits.maximumReasoningTokens !== undefined
      && observedReasoningTokens > limits.maximumReasoningTokens
    ) {
      exceededDimensions.add("max-reasoning-tokens");
    }
  };
  return {
    ingest(chunk) {
      remainder += chunk;
      let newline = remainder.indexOf("\n");
      while (newline >= 0) {
        const line = remainder.slice(0, newline).trim();
        remainder = remainder.slice(newline + 1);
        if (line) processLine(line);
        newline = remainder.indexOf("\n");
      }
      return exceededDimensions.size > 0;
    },
    finish() {
      const line = remainder.trim();
      remainder = "";
      if (line) processLine(line);
      return exceededDimensions.size > 0;
    },
    snapshot() {
      return freeze({
        observedToolCalls,
        observedToolOutputBytes,
        exceeded: exceededDimensions.size > 0,
        exceededDimensions: [...exceededDimensions],
      });
    },
  };
}

type WorkflowExecutionBudgetDimension =
  | "max-tool-calls"
  | "max-tool-output-bytes"
  | "max-input-tokens"
  | "max-output-tokens"
  | "max-reasoning-tokens";

function usageSnapshot(event: Record<string, unknown>): {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
} | null {
  const usage = asRecord(event.usage);
  if (!usage) return null;
  if (event.type !== "turn.completed" && event.type !== "result") return null;
  return {
    inputTokens: numberOrZero(usage.input_tokens),
    outputTokens: numberOrZero(usage.output_tokens),
    reasoningTokens: numberOrZero(usage.reasoning_output_tokens),
  };
}

function toolOutputs(event: Record<string, unknown> | null): readonly string[] {
  const item = event ? asRecord(event.item) : null;
  if (event?.type === "item.completed"
    && item?.type === "command_execution"
    && typeof item.aggregated_output === "string") {
    return [item.aggregated_output];
  }
  if (event?.type !== "user") return [];
  const message = asRecord(event.message);
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.flatMap((block) => {
    const result = asRecord(block);
    if (result?.type !== "tool_result") return [];
    const rawOutput = result.content ?? result.text ?? result.result;
    if (typeof rawOutput === "string") return [rawOutput];
    if (!Array.isArray(rawOutput)) return [];
    return rawOutput.flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      const output = asRecord(entry);
      return typeof output?.text === "string" ? [output.text] : [];
    });
  });
}

function toolIds(event: Record<string, unknown>): readonly string[] {
  const item = asRecord(event.item);
  if (
    event.type === "item.started"
    && item?.type === "command_execution"
    && typeof item.id === "string"
  ) {
    return [`codex:${item.id}`];
  }
  if (event.type !== "assistant") return [];
  const message = asRecord(event.message);
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.flatMap((block) => {
    const item = asRecord(block);
    return item?.type === "tool_use" && typeof item.id === "string"
      ? [`claude:${item.id}`]
      : [];
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
