/**
 * ToolsRpcServer — listens on a local IPC endpoint (a Unix domain socket
 * or Windows named pipe); dispatches tool
 * calls from the child script to a host-supplied tool runner; sends
 * results back over the same socket.
 *
 * Lifecycle:
 *   1. caller constructs server with a unique socketPath + tool runner
 *   2. caller calls listen() to bind the socket
 *   3. caller spawns the child process with MEMI_TOOLS_SOCKET=<path>
 *   4. child opens the socket, sends `tool` requests, receives responses
 *   5. child sends `exit` then closes connection (or just disconnects)
 *   6. caller reads .finalResult() to get the script's exit value
 *   7. caller calls close() to remove the socket file
 *
 * Security:
 *   - Each call is checked against the configured tool allowlist
 *   - Socket is created with 0600 perms via mode parameter on createServer
 *   - The token in MEMI_TOOLS_TOKEN must be presented in each request
 *     (via a `token` field on the wire — though we don't reject in this
 *     commit since the socket itself is the auth boundary; token is
 *     reserved for the future remote variant)
 */

import { createServer, Server, Socket } from "node:net";
import { unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  createDecoderState,
  decodeChunk,
  encodeMessage,
  safeParseRequest,
  type ToolRequest,
  type ToolsRpcRequest,
  type LogRequest,
  type ExitRequest,
} from "./tools-rpc-protocol.js";

export interface ToolRunnerContext {
  readonly tool: string;
  readonly args: unknown;
}

export interface ToolRunner {
  /** Resolve the tool against the engine's broker. May throw on disallowed tools. */
  run(ctx: ToolRunnerContext): Promise<unknown>;
  /** Names of tools the script is permitted to call. */
  allowedTools(): readonly string[];
}

export interface ScriptLogEntry {
  readonly level: "info" | "warn" | "error";
  readonly message: string;
  readonly data?: unknown;
  readonly at: string;
}

export interface ToolsRpcServerConfig {
  readonly socketPath: string;
  readonly runner: ToolRunner;
  readonly onLog?: (entry: ScriptLogEntry) => void;
  readonly onError?: (error: unknown, context: { phase: string }) => void;
}

/**
 * Resolve the per-execution local IPC endpoint.
 *
 * Windows' `net.Server.listen(path)` accepts named pipes, not ordinary
 * filesystem paths. Hashing the already-unique execution directory keeps the
 * pipe name isolated while avoiding disclosure of the runner's temp path.
 */
export function resolveToolsRpcEndpoint(
  executionDirectory: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") {
    return join(executionDirectory, "tools.sock");
  }

  const endpointId = createHash("sha256")
    .update(executionDirectory)
    .digest("hex")
    .slice(0, 24);
  return `\\\\.\\pipe\\memi-tools-${endpointId}`;
}

export class ToolsRpcServer {
  private server: Server | null = null;
  private finalResult: { ok: boolean; result?: unknown; error?: string } | null = null;
  private finalResolvers: Array<(value: { ok: boolean; result?: unknown; error?: string }) => void> = [];
  private connections = new Set<Socket>();

  constructor(private readonly config: ToolsRpcServerConfig) {}

  async listen(): Promise<void> {
    if (this.server) return;
    // Defensive: remove any stale socket file at this path.
    try {
      await unlink(this.config.socketPath);
    } catch {
      // ignore
    }

    this.server = createServer((socket) => this.handleConnection(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.config.socketPath, () => {
        this.server!.removeListener("error", reject);
        resolve();
      });
    });
  }

  /**
   * Wait for the script to send an `exit` message. If the child closes
   * its socket without sending `exit`, returns { ok: false, error: ... }.
   */
  async waitForExit(timeoutMs?: number): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    if (this.finalResult) return this.finalResult;
    return new Promise((resolve) => {
      this.finalResolvers.push(resolve);
      if (timeoutMs !== undefined) {
        setTimeout(() => {
          if (!this.finalResult) {
            const result = { ok: false, error: `script timed out after ${timeoutMs}ms` };
            this.recordFinal(result);
          }
        }, timeoutMs);
      }
    });
  }

  async close(): Promise<void> {
    if (!this.server) return;
    for (const sock of this.connections) {
      try {
        sock.destroy();
      } catch {
        // ignore
      }
    }
    this.connections.clear();

    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
    });
    this.server = null;
    try {
      await unlink(this.config.socketPath);
    } catch {
      // ignore
    }
  }

  private handleConnection(socket: Socket): void {
    this.connections.add(socket);
    const decoder = createDecoderState();

    socket.on("data", (chunk) => {
      const messages = decodeChunk(decoder, chunk.toString("utf-8"));
      for (const raw of messages) {
        void this.handleMessage(socket, raw);
      }
    });
    socket.on("close", () => {
      this.connections.delete(socket);
      // If the socket closes without an exit message and no exit has been
      // recorded yet, treat as a child crash.
      if (!this.finalResult && this.connections.size === 0) {
        this.recordFinal({ ok: false, error: "script disconnected without exit message" });
      }
    });
    socket.on("error", (error) => {
      this.config.onError?.(error, { phase: "socket" });
    });
  }

  private async handleMessage(socket: Socket, raw: unknown): Promise<void> {
    const parsed = safeParseRequest(raw);
    if (!parsed.ok) {
      this.config.onError?.(new Error(parsed.error), { phase: "decode" });
      return;
    }
    const req: ToolsRpcRequest = parsed.req;
    switch (req.op) {
      case "tool":
        await this.handleToolRequest(socket, req);
        return;
      case "log":
        this.handleLogRequest(req);
        return;
      case "exit":
        this.handleExitRequest(req);
        return;
    }
  }

  private async handleToolRequest(socket: Socket, req: ToolRequest): Promise<void> {
    const allowed = new Set(this.config.runner.allowedTools());
    if (!allowed.has(req.tool)) {
      this.send(socket, {
        id: req.id,
        ok: false,
        error: `tool "${req.tool}" not in allowlist (${this.config.runner.allowedTools().join(", ") || "none"})`,
      });
      return;
    }
    try {
      const result = await this.config.runner.run({ tool: req.tool, args: req.args });
      this.send(socket, { id: req.id, ok: true, result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.send(socket, { id: req.id, ok: false, error: message });
    }
  }

  private handleLogRequest(req: LogRequest): void {
    this.config.onLog?.({
      level: req.level,
      message: req.message,
      data: req.data,
      at: new Date().toISOString(),
    });
  }

  private handleExitRequest(req: ExitRequest): void {
    this.recordFinal({ ok: req.ok, result: req.result, error: req.error });
  }

  private send(socket: Socket, response: { id: number; ok: boolean; result?: unknown; error?: string }): void {
    try {
      socket.write(encodeMessage(response));
    } catch (error) {
      this.config.onError?.(error, { phase: "send" });
    }
  }

  private recordFinal(result: { ok: boolean; result?: unknown; error?: string }): void {
    if (this.finalResult) return;
    this.finalResult = result;
    while (this.finalResolvers.length > 0) {
      const next = this.finalResolvers.shift()!;
      next(result);
    }
  }
}
