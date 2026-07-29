/**
 * OpenCodeDriver — port of the OpenCode CLI harness to the new ProviderRuntime contract.
 *
 * OpenCode is an OpenAI-compatible Codex-like agent. Its stdout protocol is
 * structurally identical to Codex's (same JSON-line `kind` field, same
 * tool/turn lifecycle), but with model identifiers and a few different setup
 * conventions. This driver intentionally shares the Codex parser shape so a
 * future refactor can extract the shared "JSON-line agent" base class.
 *
 * Recognized event kinds (same as Codex):
 *   - assistant_delta, assistant_message
 *   - tool_started, tool_output, tool_completed
 *   - turn_completed, usage
 */

import { Effect } from "effect";
import { asId, makeId, type ToolCallId } from "../contracts/ids.js";
import {
  harnessConfigError,
  harnessSubprocessError,
  type HarnessError,
} from "../contracts/errors.js";
import { BaseHarnessDriver, type HarnessDriverConfig, type HarnessTurnRequest } from "./base.js";
import { registerDriver } from "./registry.js";
import { TurnMachine } from "../state/turn-machine.js";

export interface OpenCodeTransport {
  write(line: string): Promise<void>;
  close(reason?: string): Promise<void>;
  kill(signal?: NodeJS.Signals): Promise<void>;
  onLine(cb: (line: string, stream: "stdout" | "stderr") => void): () => void;
  onExit(cb: (code: number | null, signal: NodeJS.Signals | null) => void): () => void;
}

export interface OpenCodeTransportFactory {
  (opts: { model: string; baseUrl?: string; env: NodeJS.ProcessEnv; cwd: string }): Promise<OpenCodeTransport>;
}

export interface OpenCodeDriverOptions extends Record<string, unknown> {
  model?: string;
  baseUrl?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnTransport: OpenCodeTransportFactory;
}

/** Canonical HarnessId for the OpenCode driver. */
export const OPENCODE_HARNESS_ID = asId("HarnessId", "hns_opencode");

export class OpenCodeDriver extends BaseHarnessDriver {
  private transport: OpenCodeTransport | null = null;
  private offLine: (() => void) | null = null;
  private offExit: (() => void) | null = null;

  constructor(config: HarnessDriverConfig) {
    super(config);
  }

  private opts(): OpenCodeDriverOptions {
    const raw = (this.config.options ?? {}) as OpenCodeDriverOptions;
    if (typeof raw.spawnTransport !== "function") {
      throw new Error("OpenCodeDriver requires options.spawnTransport (an OpenCodeTransportFactory)");
    }
    return raw;
  }

  start(): Effect.Effect<void, HarnessError> {
    const self = this;
    return Effect.tryPromise({
      try: async () => {
        const opts = self.opts();
        self.session.send({ type: "start" });
        self.emit({
          ...self.envelope(),
          type: "session.created",
          harnessConfigSummary: { harness: self.config.harnessId, model: opts.model },
        });
        self.emitSessionStateChange("starting");

        const transport = await opts.spawnTransport({
          model: opts.model ?? "gpt-5.5",
          baseUrl: opts.baseUrl,
          env: opts.env ?? process.env,
          cwd: opts.cwd ?? process.cwd(),
        });
        self.transport = transport;

        self.offLine = transport.onLine((line, stream) => self.handleLine(line, stream));
        self.offExit = transport.onExit((code, signal) => self.handleExit(code, signal));

        self.session.send({ type: "ready" });
        self.emitSessionStateChange("ready");
      },
      catch: (cause) => {
        if (cause instanceof Error && /spawnTransport/.test(cause.message)) {
          return harnessConfigError({
            harnessId: self.config.harnessId,
            sessionId: self.config.sessionId,
            message: cause.message,
            configKey: "spawnTransport",
            cause,
          });
        }
        return self.wrapError(cause);
      },
    });
  }

  sendTurn(req: HarnessTurnRequest): Effect.Effect<void, HarnessError> {
    const self = this;
    return Effect.tryPromise({
      try: async () => {
        if (!self.transport) {
          throw new Error("OpenCodeDriver.sendTurn called before start()");
        }
        self.currentTurnId = req.turnId;
        self.currentTurn = new TurnMachine("pending");

        self.emit({
          ...self.envelope({ turnId: req.turnId }),
          type: "turn.created",
          promptPreview: req.prompt.slice(0, 120),
        });
        self.emitUserMessage(req.prompt);

        self.session.send({ type: "turn.begin" });
        self.emitSessionStateChange("running");
        self.currentTurn.send({ type: "begin" });
        self.emitTurnStateChange("pending", "running", req.turnId);

        await self.transport.write(JSON.stringify({ kind: "user_turn", prompt: req.prompt }));
      },
      catch: (cause) => self.wrapError(cause, req.turnId),
    });
  }

  interrupt(reason?: string): Effect.Effect<void, HarnessError> {
    const self = this;
    return Effect.tryPromise({
      try: async () => {
        if (!self.transport) return;
        await self.transport.write(JSON.stringify({ kind: "interrupt", reason: reason ?? "user" }));
        self.session.send({ type: "interrupt" });
        self.emitSessionStateChange("interrupted", reason);
      },
      catch: (cause) => self.wrapError(cause),
    });
  }

  shutdown(): Effect.Effect<void, HarnessError> {
    const self = this;
    return Effect.tryPromise({
      try: async () => {
        if (self.offLine) self.offLine();
        if (self.offExit) self.offExit();
        if (self.transport) {
          await self.transport.close("shutdown");
          self.transport = null;
        }
        if (self.session.current() !== "stopped" && self.session.current() !== "error") {
          self.session.send({ type: "shutdown" });
          self.emitSessionStateChange("stopped", "shutdown");
        }
        self.emit({ ...self.envelope(), type: "session.shutdown", reason: "user" });
        self.finalize();
      },
      catch: (cause) => self.wrapError(cause),
    });
  }

  private handleLine(line: string, stream: "stdout" | "stderr"): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.emitDiagnostic(stream === "stderr" ? "error" : "warn", `non-json from opencode: ${trimmed.slice(0, 200)}`);
      return;
    }

    const obj = parsed as Record<string, unknown>;
    const kind = String(obj["kind"] ?? "");

    switch (kind) {
      case "assistant_delta":
        this.emitMessageDelta(String(obj["delta"] ?? ""));
        break;
      case "assistant_message":
        this.emitMessageComplete(String(obj["text"] ?? ""));
        break;
      case "tool_started": {
        const toolCallId = asId("ToolCallId", String(obj["toolCallId"] ?? makeId("ToolCallId")));
        this.emitToolStarted(toolCallId, String(obj["tool"] ?? "unknown"), obj["args"]);
        break;
      }
      case "tool_output": {
        const toolCallId = asId("ToolCallId", String(obj["toolCallId"] ?? ""));
        this.emitToolOutput(toolCallId, String(obj["chunk"] ?? ""), (obj["stream"] as "stdout" | "stderr") ?? "stdout");
        break;
      }
      case "tool_completed": {
        const toolCallId = asId("ToolCallId", String(obj["toolCallId"] ?? ""));
        this.emitToolCompleted(
          toolCallId,
          Boolean(obj["ok"]),
          Number(obj["elapsedMs"] ?? 0),
          { result: obj["result"], error: obj["error"] as string | undefined },
        );
        break;
      }
      case "turn_completed": {
        const turnId = this.currentTurnId;
        const ok = Boolean(obj["ok"]);
        if (this.currentTurn) {
          this.currentTurn.send(ok ? { type: "complete" } : { type: "fail", reason: String(obj["error"] ?? "") });
          this.emitTurnStateChange("running", ok ? "done" : "failed", turnId ?? undefined);
        }
        this.emit({
          ...this.envelope({ turnId: turnId ?? undefined }),
          type: "turn.completed",
          outcome: ok ? "success" : "error",
          error: ok ? undefined : String(obj["error"] ?? ""),
        });
        if (this.session.current() === "running") {
          this.session.send({ type: "turn.end" });
          this.emitSessionStateChange("ready");
        }
        this.currentTurn = null;
        this.currentTurnId = null;
        break;
      }
      case "usage":
        this.emit({
          ...this.envelope(),
          type: "usage.updated",
          inputTokens: Number(obj["inputTokens"] ?? 0),
          cachedInputTokens: obj["cachedInputTokens"] !== undefined ? Number(obj["cachedInputTokens"]) : undefined,
          outputTokens: Number(obj["outputTokens"] ?? 0),
          reasoningTokens: obj["reasoningTokens"] !== undefined ? Number(obj["reasoningTokens"]) : undefined,
          estimatedCostUsd: obj["estimatedCostUsd"] !== undefined ? Number(obj["estimatedCostUsd"]) : undefined,
        });
        break;
      default:
        this.emitDiagnostic(stream === "stderr" ? "error" : "warn", `unknown opencode event kind: ${kind}`, parsed);
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const ok = code === 0 || (code === null && signal === "SIGTERM");
    if (!ok) {
      const err = harnessSubprocessError({
        harnessId: this.config.harnessId,
        sessionId: this.config.sessionId,
        message: `opencode subprocess exited with code=${code} signal=${signal ?? "(none)"}`,
        exitCode: code,
        signal,
      });
      this.emitDiagnostic("error", err.message, { exitCode: code, signal });
      this.session.send({ type: "fail", reason: err.message });
      this.emitSessionStateChange("error", err.message);
    } else if (this.session.current() !== "stopped") {
      this.session.send({ type: "shutdown" });
      this.emitSessionStateChange("stopped", "process exited cleanly");
    }
    this.finalize();
  }
}

registerDriver(OPENCODE_HARNESS_ID, (config) => new OpenCodeDriver(config));
