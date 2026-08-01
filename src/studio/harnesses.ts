import { accessSync, constants, existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  StudioCommandSpec,
  StudioConfig,
  StudioCodexConfig,
  StudioHarnessConfig,
  StudioHarnessAuthStatus,
  StudioHarnessId,
  StudioHarnessManifest,
  StudioHarnessStatus,
  StudioRunAction,
  StudioRunRequest,
} from "./types.js";
import { basicAgentContext, createDesignAgentEnvelope, createDesignAgentSystemPrompt } from "./agent-envelope.js";
import { packagePath } from "../utils/asset-path.js";

export interface ListHarnessOptions {
  resolveCommand?: (command: string) => string | null;
  probeAuth?: (harness: StudioHarnessConfig, resolvedPath: string | null) => HarnessAuthProbeResult;
  forceRefresh?: boolean;
}

export interface HarnessAuthProbeResult {
  authStatus: StudioHarnessAuthStatus;
  authMessage: string;
}

const HARNESS_MANIFEST = JSON.parse(readFileSync(resolveHarnessManifestPath(), "utf-8")) as StudioHarnessManifest;

const PROBE_TTL_MS = 5_000;
const DEFAULT_CODEX_CONFIG: StudioCodexConfig = {
  model: "gpt-5.5",
  reasoningEffort: "xhigh",
  approvalPolicy: "on-request",
  webSearch: false,
  skipGitRepoCheck: true,
  includeMemoireCommands: true,
  includeCodexCommands: true,
  planModeDefault: true,
};
const CODEX_WEB_SEARCH_ACTIONS = new Set<StudioRunAction>([
  "compose",
  "audit",
  "app-build",
  "self-design",
  "research",
  "browser-audit",
  "handoff",
]);
const commandProbeCache = new Map<string, { resolvedPath: string | null; checkedAt: number }>();
const authProbeCache = new Map<string, { result: HarnessAuthProbeResult; checkedAt: number }>();

export function clearHarnessProbeCaches(): void {
  commandProbeCache.clear();
  authProbeCache.clear();
}

export function getHarnessManifest(): StudioHarnessManifest {
  return HARNESS_MANIFEST;
}

function resolveHarnessManifestPath(): string {
  const candidates = [
    packagePath("studio", "harness-manifest.json"),
    packagePath("dist", "studio", "harness-manifest.json"),
    packagePath("src", "studio", "harness-manifest.json"),
    fileURLToPath(new URL("./harness-manifest.json", import.meta.url)),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Studio harness manifest is missing from package root: ${packagePath("studio", "harness-manifest.json")}`);
  }
  return found;
}

export function listHarnesses(config: StudioConfig, options: ListHarnessOptions = {}): StudioHarnessStatus[] {
  const now = Date.now();
  const resolveCommand = options.resolveCommand ?? ((command) => resolveCommandFromPathCached(command, options.forceRefresh ?? false));
  const projectRoot = config.workspaceRoots[0];
  return config.harnesses.map((harness) => {
    const localMemoire = harness.id === "memoire" && projectRoot
      ? resolveLocalMemoireCommand(projectRoot, [])
      : null;
    const resolvedPath = localMemoire?.command ?? resolveHarnessInstallPath(harness, resolveCommand);
    const checkedAt = Math.max(...harness.installProbe.map((command) => commandProbeCache.get(command)?.checkedAt ?? now), now);
    const installed = Boolean(resolvedPath);
    const auth = installed
      ? (options.probeAuth ?? ((candidate, path) => probeHarnessAuthCached(candidate, path, options.forceRefresh ?? false)))(harness, resolvedPath)
      : { authStatus: "missing" as const, authMessage: "Command not found" };
    return {
      ...harness,
      installed,
      resolvedPath,
      probeAgeMs: Math.max(0, now - checkedAt),
      ...auth,
    };
  });
}

function probeHarnessAuthCached(harness: StudioHarnessConfig, resolvedPath: string | null, forceRefresh: boolean): HarnessAuthProbeResult {
  if (!resolvedPath) return { authStatus: "missing", authMessage: "Command not found" };
  const now = Date.now();
  const cacheKey = `${harness.id}:${resolvedPath}`;
  const cached = authProbeCache.get(cacheKey);
  if (!forceRefresh && cached && now - cached.checkedAt < PROBE_TTL_MS) return cached.result;
  const result = probeHarnessAuth(harness, resolvedPath);
  authProbeCache.set(cacheKey, { result, checkedAt: now });
  return result;
}

function probeHarnessAuth(harness: StudioHarnessConfig, resolvedPath: string | null): HarnessAuthProbeResult {
  if (!resolvedPath) return { authStatus: "missing", authMessage: "Command not found" };
  if (harness.authProbe) return probeCliAuth(resolvedPath, harness.authProbe.args, harness.label);
  if (harness.id === "codex") return probeCliAuth(resolvedPath, ["login", "status"], "Codex");
  if (harness.id === "claude-code") return probeCliAuth(resolvedPath, ["auth", "status"], "Claude Code");
  if (harness.provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return { authStatus: "ready", authMessage: "ANTHROPIC_API_KEY available" };
  }
  if (harness.provider === "openai" && process.env.OPENAI_API_KEY) {
    return { authStatus: "ready", authMessage: "OPENAI_API_KEY available" };
  }
  if (harness.provider === "google" && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) {
    return { authStatus: "ready", authMessage: "Google provider key available" };
  }
  return harness.provider === "shell" || harness.provider === "local" || harness.provider === "memoire"
    ? { authStatus: "ready", authMessage: "No provider login required" }
    : { authStatus: "not_required", authMessage: "No auth probe configured" };
}

function probeCliAuth(command: string, args: string[], label: string): HarnessAuthProbeResult {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    timeout: 1500,
    shell: process.platform === "win32",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      LOGNAME: process.env.LOGNAME,
    },
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status === 0 && /logged in|authenticated|signed in|authorized|ok/i.test(output || "ok")) {
    return { authStatus: "signed_in", authMessage: output || `${label} signed in` };
  }
  if (result.status === 0) return { authStatus: "ready", authMessage: output || `${label} ready` };
  if (/error loading configuration|invalid configuration|unknown variant/i.test(output)) {
    return {
      authStatus: "config_error",
      authMessage: formatCliConfigError(label, output),
    };
  }
  return { authStatus: "needs_login", authMessage: output || `Run ${label.toLowerCase()} login` };
}

function formatCliConfigError(label: string, output: string): string {
  const firstLine = output.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? output.trim();
  return `Fix ${label} config before Studio can run live sessions: ${firstLine}`;
}

function resolveHarnessInstallPath(
  harness: StudioHarnessConfig,
  resolveCommand: (command: string) => string | null,
): string | null {
  const probes = Array.from(new Set([harness.command, ...harness.installProbe]));
  for (const probe of probes) {
    const resolvedPath = resolveCommand(probe);
    if (resolvedPath) return resolvedPath;
  }
  return null;
}

export function buildHarnessCommand(config: StudioConfig, request: StudioRunRequest): StudioCommandSpec {
  const harness = findHarness(config, request.harnessId);
  if (!harness.enabled) throw new Error(`Harness ${harness.id} is disabled`);
  const action = request.action ?? defaultActionFor(harness);
  const template = harness.commandTemplates[action] ?? harness.commandTemplates.raw;
  if (!template) throw new Error(`Harness ${harness.id} does not support action ${action}`);
  if (harness.id === "shell" && !config.enabledTools.shell) throw new Error("Shell harness is disabled in Studio config");
  assertCommandAllowed(config, harness, request.prompt);

  const baseAgentContext = request.agentContext ?? basicAgentContext({
    projectRoot: request.cwd,
    action,
    harness: harness.id,
    prompt: request.prompt,
    goal: request.goal,
    model: request.model,
    effort: request.effort,
    chatMode: request.chatMode,
    permissionMode: request.permissionMode,
    codex: config.codex,
  });
  const agentContext = {
    ...baseAgentContext,
    action,
    harness: harness.id,
    prompt: request.prompt,
    goal: request.goal ?? baseAgentContext.goal,
    model: request.model ?? baseAgentContext.model,
    effort: request.effort ?? baseAgentContext.effort,
    chatMode: request.chatMode ?? baseAgentContext.chatMode,
    permissionMode: request.permissionMode ?? baseAgentContext.permissionMode,
    codex: baseAgentContext.codex ?? config.codex,
  };
  const expandedArgs = applyHarnessRuntimeArgs(
    config,
    harness,
    template.map((part) => expandTemplate(part, request.prompt, config, request.cwd, agentContext)),
    agentContext.permissionMode,
    action,
    request.cwd,
  );
  const localCommand = harness.id === "memoire"
    ? resolveLocalMemoireCommand(request.cwd, expandedArgs)
    : null;

  return {
    command: localCommand?.command ?? harness.command,
    args: localCommand?.args ?? expandedArgs,
    cwd: request.cwd,
    action,
    harness: harness.id,
    outputParser: harness.outputParser,
    env: buildHarnessEnv(config, harness),
  };
}

function applyHarnessRuntimeArgs(
  config: StudioConfig,
  harness: StudioHarnessConfig,
  args: string[],
  permissionMode: StudioRunRequest["permissionMode"],
  action: StudioRunAction,
  cwd: string,
): string[] {
  if (harness.id !== "codex") return args;
  return applyCodexArgs(config.codex, stripCodexManagedArgs(args), permissionMode, action, cwd);
}

function stripCodexManagedArgs(args: string[]): string[] {
  const stripped: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--search" || arg === "--skip-git-repo-check" || arg === "--dangerously-bypass-approvals-and-sandbox") {
      continue;
    }
    if (arg === "--sandbox" || arg === "-s" || arg === "--model" || arg === "-m" || arg === "--ask-for-approval" || arg === "-a") {
      index += 1;
      continue;
    }
    if ((arg === "-c" || arg === "--config") && isManagedCodexConfigArg(args[index + 1])) {
      index += 1;
      continue;
    }
    stripped.push(arg);
  }
  return stripped;
}

function isManagedCodexConfigArg(value: string | undefined): boolean {
  return Boolean(value && /^(model_reasoning_effort|approval_policy)=/.test(value));
}

function applyCodexArgs(
  rawConfig: StudioCodexConfig | undefined,
  args: string[],
  permissionMode: StudioRunRequest["permissionMode"],
  action: StudioRunAction,
  cwd: string,
): string[] {
  const config = normalizeCodexConfig(rawConfig);
  const prompt = args.at(-1);
  const base = args.slice(0, -1);
  const execIndex = base.indexOf("exec");
  const globalArgs = config.webSearch && CODEX_WEB_SEARCH_ACTIONS.has(action) ? ["--search"] : [];
  const baseWithGlobal = execIndex >= 0
    ? [...base.slice(0, execIndex), ...globalArgs, ...base.slice(execIndex)]
    : [...globalArgs, ...base];
  const runtimeArgs = [
    "--model",
    config.model,
    "-c",
    `model_reasoning_effort="${config.reasoningEffort}"`,
    "-c",
    `approval_policy="${config.approvalPolicy}"`,
    "--cd",
    cwd,
    ...(config.skipGitRepoCheck ? ["--skip-git-repo-check"] : []),
  ];
  const prefix = [...baseWithGlobal, ...runtimeArgs];
  if (permissionMode === "full_access") {
    return [...prefix, "--dangerously-bypass-approvals-and-sandbox", ...(prompt ? [prompt] : [])];
  }
  const sandbox = permissionMode === "plan" ? "read-only" : "workspace-write";
  return [...prefix, "--sandbox", sandbox, ...(prompt ? [prompt] : [])];
}

function normalizeCodexConfig(config?: StudioCodexConfig): StudioCodexConfig {
  return { ...DEFAULT_CODEX_CONFIG, ...(config ?? {}) };
}

function resolveLocalMemoireCommand(cwd: string, args: string[]): { command: string; args: string[] } | null {
  const tsxBin = join(cwd, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const sourceEntry = join(cwd, "src", "index.ts");
  if (existsSync(sourceEntry) && canExecute(tsxBin)) {
    return { command: tsxBin, args: ["src/index.ts", ...args] };
  }

  const distEntry = join(cwd, "dist", "index.js");
  if (existsSync(distEntry)) {
    return { command: process.execPath, args: [distEntry, ...args] };
  }

  return null;
}

function findHarness(config: StudioConfig, harnessId: StudioHarnessId): StudioHarnessConfig {
  const harness = config.harnesses.find((candidate) => candidate.id === harnessId);
  if (!harness) throw new Error(`Unknown harness: ${harnessId}`);
  return harness;
}

function resolveCommandFromPath(command: string): string | null {
  if (command.includes("/")) return canExecute(command) ? command : null;
  const pathEntries = Array.from(new Set([
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
    join(homedir(), ".local", "bin"),
    join(homedir(), ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ]));
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
    : [""];

  for (const pathEntry of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(pathEntry, `${command}${extension}`);
      if (canExecute(candidate)) return candidate;
    }
  }
  return null;
}

function resolveCommandFromPathCached(command: string, forceRefresh = false): string | null {
  const now = Date.now();
  const cached = commandProbeCache.get(command);
  if (!forceRefresh && cached && now - cached.checkedAt < PROBE_TTL_MS) return cached.resolvedPath;
  const resolvedPath = resolveCommandFromPath(command);
  commandProbeCache.set(command, { resolvedPath, checkedAt: now });
  return resolvedPath;
}

export function harnessProbeCacheAgeMs(now = Date.now()): number {
  const entries = [...commandProbeCache.values(), ...authProbeCache.values()];
  if (entries.length === 0) return 0;
  return Math.max(...entries.map((entry) => Math.max(0, now - entry.checkedAt)));
}

function defaultActionFor(harness: StudioHarnessConfig) {
  return harness.id === "memoire" ? "compose" : "raw";
}

function expandTemplate(
  part: string,
  prompt: string,
  config: StudioConfig,
  cwd: string,
  context: NonNullable<StudioRunRequest["agentContext"]>,
): string {
  const systemPrompt = createDesignAgentSystemPrompt(context);
  const promptEnvelope = createDesignAgentEnvelope(context);
  return part
    .replaceAll("{{prompt}}", prompt)
    .replaceAll("{{promptEnvelope}}", promptEnvelope)
    .replaceAll("{{agentSystemPrompt}}", systemPrompt)
    .replaceAll("{{cwd}}", cwd)
    .replaceAll("{{action}}", context.action)
    .replaceAll("{{ollamaModel}}", config.providers.ollama.defaultModel);
}

function assertCommandAllowed(config: StudioConfig, harness: StudioHarnessConfig, prompt: string): void {
  if (harness.id !== "shell") return;
  for (const blocked of getHarnessManifest().hardlineBlockedPatterns) {
    const pattern = new RegExp(blocked.pattern, "iu");
    if (pattern.test(prompt)) throw new Error(`Blocked shell command: ${blocked.description}`);
  }
  if (!config.enabledTools.shell) throw new Error("Shell harness is disabled in Studio config");
}

function buildHarnessEnv(config: StudioConfig, harness: StudioHarnessConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "TERM"] as const) {
    if (process.env[key]) env[key] = process.env[key];
  }

  if (harness.provider === "anthropic") copyEnv(env, config.providers.anthropic.envKey);
  if (harness.provider === "openai") copyEnv(env, config.providers.openai.envKey);
  if (harness.provider === "google") {
    copyEnv(env, "GEMINI_API_KEY");
    copyEnv(env, "GOOGLE_API_KEY");
  }
  if (harness.provider === "memoire") {
    copyEnv(env, config.providers.anthropic.envKey);
    copyEnv(env, config.providers.openai.envKey);
    copyEnv(env, "FIGMA_TOKEN");
    env.NODE_OPTIONS = appendNodeOption(process.env.NODE_OPTIONS, "--no-warnings=MaxListenersExceededWarning");
  }
  if (config.providers.openaiCompatible.envKey) copyEnv(env, config.providers.openaiCompatible.envKey);
  env.MEMOIRE_STUDIO_SESSION = "1";
  env.MEMOIRE_STUDIO_HARNESS = harness.id;
  return env;
}

function appendNodeOption(current: string | undefined, option: string): string {
  if (!current) return option;
  if (current.split(/\s+/).includes(option)) return current;
  return `${current} ${option}`;
}

function copyEnv(env: NodeJS.ProcessEnv, key: string): void {
  if (process.env[key]) env[key] = process.env[key];
}

function canExecute(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
