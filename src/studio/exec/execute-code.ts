/**
 * executeCode — the top-level entry point that ties protocol + server +
 * stub generator + child-process lifecycle into one call.
 *
 * Flow:
 *   1. Generate the memi_tools stub for the per-call allowlist
 *   2. Write the stub + the user's script to a temp directory
 *   3. Open a fresh Unix-socket-backed ToolsRpcServer
 *   4. Spawn a child Bun (or Node) process with:
 *        MEMI_TOOLS_SOCKET=<path>
 *        cwd=<projectRoot>
 *        scrubbed env (no API keys leaked into the script)
 *   5. Wait for the script to send `exit` or for stdout/stderr to close
 *   6. Tear everything down (kill the child if it's still running, remove
 *      the socket file, remove the temp dir)
 *   7. Return { ok, result, error, logs, durationMs, stdout, stderr }
 *
 * Subprocess runtime is configurable so tests can use Node + a fake
 * script and production can use Bun (faster startup, native TS).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { generateMemiToolsStub, type StubToolSpec } from "./stub-generator.js";
import {
  resolveToolsRpcEndpoint,
  ToolsRpcServer,
  type ScriptLogEntry,
  type ToolRunner,
} from "./tools-rpc-server.js";

const requireFromHere = createRequire(import.meta.url);
let cachedTsxCli: string | null | undefined;

function tsxCliPath(): string | null {
  if (cachedTsxCli !== undefined) return cachedTsxCli;
  try {
    cachedTsxCli = requireFromHere.resolve("tsx/cli");
    return cachedTsxCli;
  } catch {
    // Fall through to the source/dist directory walk.
  }

  // Walk upward from this file to find the nearest platform-neutral CLI
  // module. Executing node_modules/.bin/tsx directly is not portable because
  // npm installs it as a shell shim on Windows.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(dir, "node_modules", "tsx", "dist", "cli.mjs");
    if (existsSync(candidate)) {
      cachedTsxCli = candidate;
      return cachedTsxCli;
    }
    const next = dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  cachedTsxCli = null;
  return cachedTsxCli;
}

export interface ExecuteCodeRequest {
  /** TypeScript source the user (or LLM) wants to execute. */
  readonly script: string;
  /** Tool surface the script may call. */
  readonly tools: ReadonlyArray<StubToolSpec>;
  /** Working directory for the child process. Defaults to process.cwd(). */
  readonly cwd?: string;
  /** Wall-clock cap for the script. Defaults to 60s. */
  readonly timeoutMs?: number;
  /** Memory cap (passed as --max-old-space-size for Node, ignored for Bun). */
  readonly memoryMb?: number;
  /**
   * Subprocess runner. Defaults to "tsx" — works on Node 20+ and supports
   * TS natively without flags. Override with "bun" for faster startup or
   * "node" for Node 22+'s native --experimental-strip-types path. Tests
   * inject a custom value when needed.
   */
  readonly runtime?: "tsx" | "bun" | "node" | { command: string; argsBefore?: readonly string[]; argsAfter?: readonly string[] };
  /** Whitelisted env keys forwarded to the child. Default: only PATH + TZ + LANG. */
  readonly envAllowlist?: readonly string[];
  /** Extra env entries injected before the child starts. */
  readonly envExtra?: Readonly<Record<string, string>>;
}

export interface ExecuteCodeResult {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
  readonly logs: ReadonlyArray<ScriptLogEntry>;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly durationMs: number;
}

const SOCKET_ENV_VAR = "MEMI_TOOLS_SOCKET";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_ENV_ALLOWLIST: readonly string[] = ["PATH", "TZ", "LANG", "LC_ALL", "HOME"];

export async function executeCode(req: ExecuteCodeRequest, runner: ToolRunner): Promise<ExecuteCodeResult> {
  const start = Date.now();
  const dir = await mkdtemp(join(tmpdir(), "memi-execcode-"));
  // .mts forces ESM mode in tsx/Node so top-level await + import work.
  const stubPath = join(dir, "memi_tools.mts");
  const scriptPath = join(dir, "script.mts");
  const socketPath = resolveToolsRpcEndpoint(dir);

  await writeFile(
    stubPath,
    generateMemiToolsStub({
      socketEnvVar: SOCKET_ENV_VAR,
      tools: req.tools,
    }),
    "utf-8",
  );
  await writeFile(scriptPath, req.script, "utf-8");

  const logs: ScriptLogEntry[] = [];
  let stdout = "";
  let stderr = "";

  const server = new ToolsRpcServer({
    socketPath,
    runner,
    onLog: (entry) => logs.push(entry),
  });
  await server.listen();

  const memoryEnv: Record<string, string> = {};
  if (req.memoryMb !== undefined) {
    // tsx (and Node generally) honors NODE_OPTIONS for V8 flags. We
    // set it via env rather than CLI args because tsx itself doesn't
    // recognize --node-options.
    memoryEnv["NODE_OPTIONS"] = `--max-old-space-size=${req.memoryMb}`;
  }

  const env = buildChildEnv(req.envAllowlist ?? DEFAULT_ENV_ALLOWLIST, {
    [SOCKET_ENV_VAR]: socketPath,
    ...memoryEnv,
    ...(req.envExtra ?? {}),
  });

  const { command, args } = resolveExecuteCodeCommand(req.runtime ?? "tsx", scriptPath, req.memoryMb);

  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      cwd: req.cwd ?? process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    await server.close();
    await rm(dir, { recursive: true, force: true });
    return finalize({
      ok: false,
      error: `failed to spawn ${command}: ${error instanceof Error ? error.message : String(error)}`,
      logs,
      stdout,
      stderr,
      exitCode: null,
      signal: null,
      durationMs: Date.now() - start,
    });
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf-8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf-8");
  });

  // Race: script's exit message vs. process exit vs. timeout.
  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const timeoutPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve({ code: null, signal: "SIGKILL" });
    }, req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });

  const scriptResult = await server.waitForExit(req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const exitInfo = await Promise.race([exitPromise, timeoutPromise]);

  await server.close();
  await rm(dir, { recursive: true, force: true });

  return finalize({
    ok: scriptResult.ok,
    result: scriptResult.result,
    error: scriptResult.error ?? (exitInfo.code !== 0 && exitInfo.code !== null ? `script exited with code ${exitInfo.code}` : undefined),
    logs,
    stdout,
    stderr,
    exitCode: exitInfo.code,
    signal: exitInfo.signal,
    durationMs: Date.now() - start,
  });
}

function finalize(result: ExecuteCodeResult): ExecuteCodeResult {
  return result;
}

function buildChildEnv(allowlist: readonly string[], extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowlist) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    env[key] = value;
  }
  return env;
}

export function resolveExecuteCodeCommand(
  runtime: NonNullable<ExecuteCodeRequest["runtime"]>,
  scriptPath: string,
  memoryMb?: number,
): { command: string; args: string[] } {
  if (typeof runtime === "object") {
    return {
      command: runtime.command,
      args: [...(runtime.argsBefore ?? []), scriptPath, ...(runtime.argsAfter ?? [])],
    };
  }
  if (runtime === "tsx") {
    // Resolve the JS entry module relative to this engine and run it through
    // Node. This bypasses npm's platform-specific .bin shell shims, which
    // cannot be spawned directly on Windows.
    void memoryMb; // honored via NODE_OPTIONS in the parent env
    const cliPath = tsxCliPath();
    return cliPath
      ? { command: process.execPath, args: [cliPath, scriptPath] }
      : { command: "tsx", args: [scriptPath] };
  }
  if (runtime === "bun") {
    return { command: "bun", args: ["run", scriptPath] };
  }
  // Node: needs --experimental-strip-types for TS support without a transpile.
  // Only works on Node 22+. memoryMb caps V8 heap.
  const args: string[] = ["--experimental-strip-types"];
  if (memoryMb !== undefined) args.push(`--max-old-space-size=${memoryMb}`);
  args.push(scriptPath);
  return { command: "node", args };
}
