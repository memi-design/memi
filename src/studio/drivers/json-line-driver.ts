/**
 * JsonLineDriver — shared base for harnesses that speak a JSON-line stdout
 * protocol with a `kind`/`type` discriminator field.
 *
 * Codex, OpenCode, Hermes, Ollama, Gemini, and Memoire-native all fit this
 * shape. By the time we have 3 of them ported (Codex, Claude Code,
 * OpenCode), the duplication is obvious — this base class lifts it out so
 * the next 4 drivers are 50–100 LOC each instead of 250+.
 *
 * Subclasses provide:
 *   - PROTOCOL_DISCRIMINATOR: "kind" | "type"  (which field carries the event tag)
 *   - PROTOCOL_TAGS: a mapping from this harness's event tags to canonical
 *     ProviderRuntimeEvent emitter calls
 *
 * This keeps the per-harness code focused on protocol-specific quirks
 * (auth, transport startup, model identifiers, env shape) and pushes the
 * boilerplate into one place.
 *
 * Codex and Claude Code do NOT extend this base — they were authored
 * before the abstraction. They can be migrated later without changing
 * any behavior, since this base preserves the exact emission shape they
 * use today.
 */

import { Effect } from "effect";
import { asId, makeId, type ToolCallId, type TurnId } from "../contracts/ids.js";
import {
  harnessConfigError,
  harnessSubprocessError,
  type HarnessError,
} from "../contracts/errors.js";
import { BaseHarnessDriver, type HarnessDriverConfig, type HarnessTurnRequest } from "./base.js";
import { TurnMachine } from "../state/turn-machine.js";

export interface LineTransport {
  write(line: string): Promise<void>;
  close(reason?: string): Promise<void>;
  kill(signal?: NodeJS.Signals): Promise<void>;
  onLine(cb: (line: string, stream: "stdout" | "stderr") => void): () => void;
  onExit(cb: (code: number | null, signal: NodeJS.Signals | null) => void): () => void;
}

export interface JsonLineSpawnContext {
  model: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export interface JsonLineDriverOptions extends Record<string, unknown> {
  model?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnTransport: (ctx: JsonLineSpawnContext) => Promise<LineTransport>;
}

export interface JsonLineProtocolBinding {
  /** Which field on the parsed object carries the event tag. */
  discriminatorField: "kind" | "type";
  /** Default model identifier when options.model isn't set. */
  defaultModel: string;
  /** Friendly subprocess name for diagnostics ("ollama", "gemini", etc.). */
  processName: string;
  /** Map of harness-specific event tags to canonical emitter calls. */
  emit(self: AbstractJsonLineDriver, tag: string, raw: Record<string, unknown>): "handled" | "unknown";
}

export abstract class AbstractJsonLineDriver extends BaseHarnessDriver {
  protected transport: LineTransport | null = null;
  private offLine: (() => void) | null = null;
  private offExit: (() => void) | null = null;

  protected abstract binding(): JsonLineProtocolBinding;

  private opts(): JsonLineDriverOptions {
    const raw = (this.config.options ?? {}) as JsonLineDriverOptions;
    if (typeof raw.spawnTransport !== "function") {
      throw new Error(
        `${this.constructor.name} requires options.spawnTransport (a JsonLineSpawnContext factory)`,
      );
    }
    return raw;
  }

  start(): Effect.Effect<void, HarnessError> {
    const self = this;
    return Effect.tryPromise({
      try: async () => {
        const opts = self.opts();
        const binding = self.binding();
        self.session.send({ type: "start" });
        self.emit({
          ...self.envelope(),
          type: "session.created",
          harnessConfigSummary: { harness: self.config.harnessId, model: opts.model ?? binding.defaultModel },
        });
        self.emitSessionStateChange("starting");

        const transport = await opts.spawnTransport({
          model: opts.model ?? binding.defaultModel,
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
          throw new Error(`${self.constructor.name}.sendTurn called before start()`);
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

        const field = self.binding().discriminatorField;
        await self.transport.write(JSON.stringify({ [field]: "user_turn", prompt: req.prompt }));
      },
      catch: (cause) => self.wrapError(cause, req.turnId),
    });
  }

  interrupt(reason?: string): Effect.Effect<void, HarnessError> {
    const self = this;
    return Effect.tryPromise({
      try: async () => {
        if (!self.transport) return;
        const field = self.binding().discriminatorField;
        await self.transport.write(JSON.stringify({ [field]: "interrupt", reason: reason ?? "user" }));
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
      const name = this.binding().processName;
      this.emitDiagnostic(stream === "stderr" ? "error" : "warn", `non-json from ${name}: ${trimmed.slice(0, 200)}`);
      return;
    }

    const obj = parsed as Record<string, unknown>;
    const binding = this.binding();
    const tag = String(obj[binding.discriminatorField] ?? "");
    const result = binding.emit(this, tag, obj);

    if (result === "unknown") {
      this.emitDiagnostic(
        stream === "stderr" ? "error" : "warn",
        `unknown ${binding.processName} event ${binding.discriminatorField}: ${tag}`,
        parsed,
      );
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const ok = code === 0 || (code === null && signal === "SIGTERM");
    if (!ok) {
      const err = harnessSubprocessError({
        harnessId: this.config.harnessId,
        sessionId: this.config.sessionId,
        message: `${this.binding().processName} subprocess exited with code=${code} signal=${signal ?? "(none)"}`,
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

/**
 * Default emitter helpers for the shared "Codex-style" protocol used by
 * Codex, OpenCode, Hermes, Ollama, Gemini, and Memoire-native.
 *
 * Each helper handles one event tag and returns "handled". Drivers that
 * need extra tags wrap this and add their own cases first.
 */
export const codexShapedEmit = {
  assistant_delta(self: AbstractJsonLineDriver, raw: Record<string, unknown>) {
    self["emitMessageDelta"](String(raw["delta"] ?? ""));
  },
  assistant_message(self: AbstractJsonLineDriver, raw: Record<string, unknown>) {
    self["emitMessageComplete"](String(raw["text"] ?? ""));
  },
  tool_started(self: AbstractJsonLineDriver, raw: Record<string, unknown>) {
    const toolCallId = asId("ToolCallId", String(raw["toolCallId"] ?? makeId("ToolCallId")));
    self["emitToolStarted"](toolCallId, String(raw["tool"] ?? "unknown"), raw["args"]);
  },
  tool_output(self: AbstractJsonLineDriver, raw: Record<string, unknown>) {
    const toolCallId = asId("ToolCallId", String(raw["toolCallId"] ?? ""));
    self["emitToolOutput"](toolCallId, String(raw["chunk"] ?? ""), (raw["stream"] as "stdout" | "stderr") ?? "stdout");
  },
  tool_completed(self: AbstractJsonLineDriver, raw: Record<string, unknown>) {
    const toolCallId = asId("ToolCallId", String(raw["toolCallId"] ?? ""));
    self["emitToolCompleted"](
      toolCallId,
      Boolean(raw["ok"]),
      Number(raw["elapsedMs"] ?? 0),
      { result: raw["result"], error: raw["error"] as string | undefined },
    );
  },
  turn_completed(self: AbstractJsonLineDriver, raw: Record<string, unknown>) {
    const turnId = (self as unknown as { currentTurnId: TurnId | null }).currentTurnId;
    const ok = Boolean(raw["ok"] ?? true);
    const turnMachine = (self as unknown as { currentTurn: TurnMachine | null }).currentTurn;
    if (turnMachine) {
      turnMachine.send(ok ? { type: "complete" } : { type: "fail", reason: String(raw["error"] ?? "") });
      self["emitTurnStateChange"]("running", ok ? "done" : "failed", turnId ?? undefined);
    }
    self["emit"]({
      ...self["envelope"]({ turnId: turnId ?? undefined }),
      type: "turn.completed",
      outcome: ok ? "success" : "error",
      error: ok ? undefined : String(raw["error"] ?? ""),
    });
    if ((self as unknown as { session: { current: () => string } }).session.current() === "running") {
      (self as unknown as { session: { send: (event: { type: string }) => void } }).session.send({ type: "turn.end" });
      self["emitSessionStateChange"]("ready");
    }
    (self as unknown as { currentTurn: TurnMachine | null }).currentTurn = null;
    (self as unknown as { currentTurnId: null }).currentTurnId = null;
  },
  usage(self: AbstractJsonLineDriver, raw: Record<string, unknown>) {
    self["emit"]({
      ...self["envelope"](),
      type: "usage.updated",
      inputTokens: Number(raw["inputTokens"] ?? 0),
      cachedInputTokens: raw["cachedInputTokens"] !== undefined ? Number(raw["cachedInputTokens"]) : undefined,
      outputTokens: Number(raw["outputTokens"] ?? 0),
      reasoningTokens: raw["reasoningTokens"] !== undefined ? Number(raw["reasoningTokens"]) : undefined,
      estimatedCostUsd: raw["estimatedCostUsd"] !== undefined ? Number(raw["estimatedCostUsd"]) : undefined,
    });
  },
};

/** Default emitter that handles the standard Codex-shaped tags. */
export function defaultCodexShapedEmit(
  self: AbstractJsonLineDriver,
  tag: string,
  raw: Record<string, unknown>,
): "handled" | "unknown" {
  const handler = (codexShapedEmit as Record<string, (s: AbstractJsonLineDriver, r: Record<string, unknown>) => void>)[tag];
  if (!handler) return "unknown";
  handler(self, raw);
  return "handled";
}
