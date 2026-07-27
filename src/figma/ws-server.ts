/**
 * Mémoire WebSocket Server — Multi-instance bridge server.
 *
 * Each Mémoire engine instance gets its own port (9223-9232).
 * Multiple Figma plugin instances can connect to the same server.
 * Supports chat relay, command dispatch, and real-time events.
 */

import { WebSocketServer, WebSocket } from "ws";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createLogger } from "../engine/logger.js";
import { EventEmitter } from "events";
import type { MemoireEvent } from "../engine/core.js";
import {
  createBridgeCommandEnvelope,
  normalizeBridgeMessage,
  serializeBridgeEnvelope,
  type BridgeEnvelope,
  type BridgeHelloEnvelope,
} from "../plugin/shared/bridge.js";
import type { AgentBoxState, WidgetCommandName } from "../plugin/shared/contracts.js";
import { BRIDGE_PORT_START, BRIDGE_PORT_END, isPortInUse, getPortOwnerPid, isMemoireProcess } from "./port-scanner.js";

const log = createLogger("ws-server");
export const BRIDGE_BIND_HOST = "127.0.0.1";

export function verifyBridgeCapability(
  presented: unknown,
  expected: string,
): boolean {
  if (typeof presented !== "string") return false;
  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  return presentedBytes.length === expectedBytes.length
    && timingSafeEqual(presentedBytes, expectedBytes);
}

export interface BridgeClient {
  id: string;
  ws: WebSocket;
  file: string;
  fileKey: string;
  editor: string;
  connectedAt: Date;
  lastPing: Date;
}

export interface MemoireWsServerConfig {
  port?: number;
  instanceName?: string;
  studioUrl?: string;
  runtimeUrl?: string;
  onCommand?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  onChat?: (text: string, fromPlugin: string) => void;
  onEvent?: (event: MemoireEvent) => void;
}

/** Per-client rate limiter — sliding window counter */
interface RateLimit {
  messageCount: number;
  bytesCount: number;
  windowStart: number;
}

const RATE_LIMIT = {
  maxMessagesPerMinute: 1000,
  maxBytesPerMinute: 100_000_000, // 100MB
  windowMs: 60_000,
};

function isRetriableBindError(err: Error & { code?: string }): boolean {
  return err.code === "EADDRINUSE";
}

function createWsBindError(port: number, err: Error & { code?: string }): Error & { code?: string; port?: number } {
  const wrapped = new Error(`Failed to bind bridge port ${port}: ${err.message}`) as Error & {
    code?: string;
    port?: number;
  };
  wrapped.code = err.code;
  wrapped.port = port;
  return wrapped;
}

/** Connection state from the server's perspective. */
export type ConnectionState = "connected" | "reconnecting" | "disconnected";

/** Backoff schedule for reconnect warnings (milliseconds). */
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const RECONNECT_MAX_ATTEMPTS = 5;

export class MemoireWsServer extends EventEmitter {
  private config: MemoireWsServerConfig;
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, BridgeClient>();
  private pendingClients = new Map<string, BridgeClient>();
  private rateLimits = new Map<string, RateLimit>();
  private port = 0;
  private _running = false;
  private clientCounter = 0;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private pendingCommands = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    clientId: string;
  }>();
  /** Tracks in-flight idempotent reads to prevent duplicate requests. method → commandId */
  private inFlightMethods = new Map<string, string>();
  private commandId = 0;
  private readonly capabilityToken = randomBytes(32).toString("base64url");

  // ── Connection state tracking ──────────────────────────
  private _reconnectAttempts = 0;
  private _isReconnecting = false;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastConnectedAt: Date | null = null;
  private _lastDisconnectedAt: Date | null = null;
  private readonly studioUrl: string;
  private readonly runtimeUrl: string;

  constructor(config: MemoireWsServerConfig = {}) {
    super();
    this.setMaxListeners(30);
    this.config = config;
    this.studioUrl = config.studioUrl ?? "http://127.0.0.1:1420";
    this.runtimeUrl = config.runtimeUrl ?? "http://127.0.0.1:8765";
  }

  get running(): boolean {
    return this._running;
  }

  get activePort(): number {
    return this.port;
  }

  get connectedClients(): BridgeClient[] {
    return Array.from(this.clients.values());
  }

  /** Number of consecutive reconnect attempts since last successful connection. */
  get reconnectAttempts(): number {
    return this._reconnectAttempts;
  }

  /** Whether the server is in the reconnect-wait state. */
  get isReconnecting(): boolean {
    return this._isReconnecting;
  }

  /** ISO timestamp of the last time a plugin connected successfully. */
  get lastConnectedAt(): Date | null {
    return this._lastConnectedAt;
  }

  /** ISO timestamp of the last time all plugins disconnected. */
  get lastDisconnectedAt(): Date | null {
    return this._lastDisconnectedAt;
  }

  /**
   * Current logical connection state based on client count and reconnect status.
   */
  getConnectionState(): ConnectionState {
    if (this.clients.size > 0) return "connected";
    if (this._isReconnecting) return "reconnecting";
    return "disconnected";
  }

  /**
   * Start the WebSocket server, scanning ports BRIDGE_PORT_START-BRIDGE_PORT_END
   * for an available one. Warns if a port in the range is bound by a foreign process.
   */
  async start(preferPort?: number): Promise<number> {
    if (this._running && this.wss) {
      return this.port;
    }

    const startPort = preferPort ?? this.config.port ?? BRIDGE_PORT_START;
    const endPort = BRIDGE_PORT_END;

    for (let p = startPort; p <= endPort; p++) {
      // Pre-check: is the port in use before we try to bind?
      try {
        const inUse = await isPortInUse(p);
        if (inUse) {
          // Try to identify the owning process for a more actionable warning
          const pid = getPortOwnerPid(p);
          if (pid !== null) {
            const isMemi = isMemoireProcess(pid);
            if (isMemi) {
              log.warn(`Port ${p} in use by PID ${pid} (Mémoire instance) — skipping`);
            } else {
              log.warn(`Port ${p} in use by PID ${pid} (not Mémoire) — skipping`);
            }
          } else {
            log.warn(`Port ${p} in use — skipping (could not identify owning process)`);
          }
          continue;
        }
      } catch {
        // isPortInUse probe failed; attempt bind anyway
      }

      try {
        await this.startOnPort(p);
        this.port = p;
        this._running = true;
        log.info(`Mémoire WS server listening on port ${p}`);
        this.emitEvent("success", `Bridge server started on port ${p}`);
        return p;
      } catch (err) {
        if (isRetriableBindError(err as Error & { code?: string })) {
          continue;
        }
        throw err;
      }
    }

    throw new Error(`No available ports (${BRIDGE_PORT_START}-${BRIDGE_PORT_END}). Close other Mémoire instances first.`);
  }

  /**
   * Stop the server and disconnect all clients.
   */
  stop(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    // Reject all pending commands
    for (const [id, pending] of this.pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Server shutting down"));
      this.pendingCommands.delete(id);
    }

    if (this.wss) {
      for (const client of this.clients.values()) {
        client.ws.close(1000, "Server shutting down");
      }
      for (const client of this.pendingClients.values()) {
        client.ws.close(1008, "Authentication incomplete");
      }
      this.clients.clear();
      this.pendingClients.clear();
      this.wss.close();
      this.wss = null;
      this._running = false;
      this._isReconnecting = false;
      this.port = 0;
      log.info("WS server stopped");
    }
  }

  /** Idempotent read commands that should be deduplicated when already in-flight. */
  private static readonly DEDUP_METHODS = new Set([
    "getSelection", "getVariables", "getComponents", "getStyles",
    "getStickies", "getChanges", "getPageList", "getPageTree", "captureScreenshot",
  ]);

  /**
   * Send a command to the first connected Figma plugin and wait for response.
   */
  async sendCommand(
    method: string,
    params: Record<string, unknown> = {},
    timeout = 30000
  ): Promise<unknown> {
    const client = this.getActiveClient();
    if (!client) {
      throw new Error("No Figma plugin connected");
    }

    // Dedup idempotent reads — if the same method is already in-flight, reject duplicate
    if (MemoireWsServer.DEDUP_METHODS.has(method) && this.inFlightMethods.has(method)) {
      throw new Error(`Command already in-flight: ${method}`);
    }

    const id = String(++this.commandId);

    if (MemoireWsServer.DEDUP_METHODS.has(method)) {
      this.inFlightMethods.set(method, id);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id);
        this.inFlightMethods.delete(method);
        reject(new Error(`Command timed out: ${method}`));
      }, timeout);

      this.pendingCommands.set(id, { resolve, reject, timeout: timer, clientId: client.id });

      if (client.ws.readyState !== WebSocket.OPEN) {
        clearTimeout(timer);
        this.pendingCommands.delete(id);
        this.inFlightMethods.delete(method);
        reject(new Error("Plugin connection not open"));
        return;
      }

      try {
        client.ws.send(
          JSON.stringify(
            serializeBridgeEnvelope(
              createBridgeCommandEnvelope(id, method as WidgetCommandName, params),
              "v2",
            ),
          ),
        );
      } catch (err) {
        clearTimeout(timer);
        this.pendingCommands.delete(id);
        this.inFlightMethods.delete(method);
        reject(new Error(`Failed to send command ${method}: ${(err as Error).message}`));
      }
    });
  }

  /**
   * Send a chat message to all connected Figma plugins.
   */
  sendChat(text: string): void {
    this.broadcast(
      serializeBridgeEnvelope({
        channel: "memoire.bridge.v2",
        source: "server",
        type: "chat",
        text,
        from: this.config.instanceName ?? "memoire-terminal",
      }, "v2"),
    );
  }

  /**
   * Send an event notification to all plugins.
   */
  sendEvent(event: MemoireEvent): void {
    this.broadcast(
      serializeBridgeEnvelope({
        channel: "memoire.bridge.v2",
        source: "server",
        type: "event",
        level: event.type,
        message: event.message,
        data: { source: event.source },
      }, "v2"),
    );
  }

  /**
   * Broadcast agent-box state so non-canvas consumers can observe orchestration progress.
   */
  sendAgentStatus(status: AgentBoxState): void {
    this.broadcast(
      serializeBridgeEnvelope({
        channel: "memoire.bridge.v2",
        source: "plugin",
        type: "agent-status",
        data: status,
      }, "v2"),
    );
    this.emit("agent-status", status);
  }

  /**
   * Broadcast data to all connected clients.
   */
  broadcast(data: unknown): void {
    const payload = JSON.stringify(data);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(payload);
        } catch (err) {
          log.warn({ clientId: client.id, err: (err as Error).message }, "Broadcast send failed");
        }
      }
    }
  }

  /**
   * Get status summary for all connections.
   */
  getStatus(): {
    running: boolean;
    port: number;
    bridgeStatus: "stopped" | "running";
    pluginStatus: "disconnected" | "connected";
    clients: { id: string; file: string; fileKey: string; editor: string; connectedAt: string; lastPing: string }[];
    connectionState: ConnectionState;
    reconnectAttempts: number;
    lastConnectedAt: string | null;
    lastDisconnectedAt: string | null;
  } {
    return {
      running: this._running,
      port: this.port,
      bridgeStatus: this._running ? "running" : "stopped",
      pluginStatus: this.clients.size > 0 ? "connected" : "disconnected",
      clients: this.connectedClients.map((c) => ({
        id: c.id,
        file: c.file,
        fileKey: c.fileKey,
        editor: c.editor,
        connectedAt: c.connectedAt.toISOString(),
        lastPing: c.lastPing.toISOString(),
      })),
      connectionState: this.getConnectionState(),
      reconnectAttempts: this._reconnectAttempts,
      lastConnectedAt: this._lastConnectedAt?.toISOString() ?? null,
      lastDisconnectedAt: this._lastDisconnectedAt?.toISOString() ?? null,
    };
  }

  /**
   * Check bridge health — pings the active plugin and measures round-trip latency.
   * Returns gracefully even when no plugin is connected.
   */
  async checkHealth(): Promise<{
    connected: boolean;
    clientCount: number;
    latencyMs: number | null;
    uptime: number;
  }> {
    const clientCount = this.clients.size;
    const connected = clientCount > 0 && this._running;
    const uptime = this._running ? process.uptime() : 0;

    if (!connected) {
      return { connected: false, clientCount: 0, latencyMs: null, uptime };
    }

    // Measure round-trip latency via a ping command
    let latencyMs: number | null = null;
    try {
      const start = performance.now();
      await this.sendCommand("ping", {}, 5000);
      latencyMs = Math.round(performance.now() - start);
    } catch {
      // Plugin may not support ping command — still report connected
      latencyMs = null;
    }

    return { connected, clientCount, latencyMs, uptime };
  }

  // ── Private ──────────────────────────────────────────

  private startOnPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port, host: BRIDGE_BIND_HOST });

      wss.on("listening", () => {
        this.wss = wss;
        this.setupServer();
        resolve();
      });

      wss.on("error", (err: Error & { code?: string }) => {
        wss.close();
        reject(createWsBindError(port, err));
      });
    });
  }

  private setupServer(): void {
    if (!this.wss) return;

    this.wss.on("connection", (ws) => {
      const clientId = `plugin-${++this.clientCounter}`;

      const client: BridgeClient = {
        id: clientId,
        ws,
        file: "unknown",
        fileKey: "",
        editor: "figma",
        connectedAt: new Date(),
        lastPing: new Date(),
      };

      this.pendingClients.set(clientId, client);

      // Send identification — wrapped in try-catch for early disconnect
      try {
        ws.send(
          JSON.stringify(
            serializeBridgeEnvelope({
              channel: "memoire.bridge.v2",
              source: "server",
              type: "identify",
              name: this.config.instanceName ?? `Mémoire Terminal`,
              port: this.port,
              studioUrl: this.studioUrl,
              runtimeUrl: this.runtimeUrl,
              capability: this.capabilityToken,
            }, "v2"),
          ),
        );
      } catch (err) {
        log.warn({ clientId, err: (err as Error).message }, "Failed to send identify — client already gone");
        this.pendingClients.delete(clientId);
        return;
      }

      ws.on("message", (data) => {
        try {
          const raw = data.toString();
          // Basic size check — reject messages over 10MB
          if (raw.length > 10_000_000) {
            log.warn({ clientId, sizeMB: Math.round(raw.length / 1_000_000) }, "Oversized message, dropping");
            ws.send(JSON.stringify(serializeBridgeEnvelope({
              channel: "memoire.bridge.v2",
              source: "server",
              type: "error",
              message: "Message too large (>10MB). Reduce payload size.",
            }, "v2")));
            return;
          }
          // Rate limiting
          if (!this.checkRateLimit(clientId, raw.length)) {
            ws.send(JSON.stringify(serializeBridgeEnvelope({
              channel: "memoire.bridge.v2",
              source: "server",
              type: "error",
              message: "Rate limit exceeded. Slow down.",
            }, "v2")));
            return;
          }
          const msg = normalizeBridgeMessage(JSON.parse(raw));
          if (!msg) {
            log.warn({ clientId }, "Invalid message: unsupported bridge payload");
            return;
          }
          if (this.pendingClients.has(clientId)) {
            if (msg.type !== "bridge-hello" || !verifyBridgeCapability(msg.capability, this.capabilityToken)) {
              log.warn({ clientId }, "Rejected unauthenticated bridge client");
              ws.close(1008, "Invalid bridge capability");
              return;
            }
            this.activateClient(client, msg);
            return;
          }
          this.handleMessage(clientId, msg);
        } catch (err) {
          log.warn({ clientId, err: (err as Error).message }, "Invalid JSON message");
        }
      });

      ws.on("close", () => {
        const wasAuthenticated = this.clients.delete(clientId);
        this.pendingClients.delete(clientId);
        this.rateLimits.delete(clientId);

        // Reject pending commands that were sent to this specific client
        for (const [id, pending] of this.pendingCommands.entries()) {
          if (pending.clientId === clientId) {
            clearTimeout(pending.timeout);
            pending.reject(new Error("Figma plugin disconnected"));
            this.pendingCommands.delete(id);
            // Clean up dedup tracking for this command
            for (const [method, cmdId] of this.inFlightMethods.entries()) {
              if (cmdId === id) this.inFlightMethods.delete(method);
            }
          }
        }

        if (wasAuthenticated) {
          log.info(`Plugin disconnected: ${clientId}`);
          this.emitEvent("warn", "Figma plugin disconnected");
          this.emit("client-disconnected", clientId);
        }

        // Only start backoff when the last client disconnects
        if (wasAuthenticated && this.clients.size === 0 && this._running) {
          this._lastDisconnectedAt = new Date();
          this._scheduleReconnectWarn();
        }
      });

      ws.on("error", (err) => {
        log.warn({ clientId, err: err.message }, "WebSocket client error");
      });

      ws.on("pong", () => {
        client.lastPing = new Date();
      });
    });

    // Health check ping every 30s — symmetric with client-side 20s keepalive
    this.healthInterval = setInterval(() => {
      const now = new Date();
      for (const [clientId, client] of this.clients.entries()) {
        if (client.ws.readyState !== WebSocket.OPEN) {
          // Clean up stale connections
          this.clients.delete(clientId);
          this.rateLimits.delete(clientId);
          this.emit("client-disconnected", clientId);
          continue;
        }
        // Drop clients that haven't responded to a ping in over 45s
        const silentMs = now.getTime() - client.lastPing.getTime();
        if (silentMs > 45_000) {
          log.warn({ clientId, silentMs }, "Client unresponsive — closing");
          try { client.ws.close(1000, "Ping timeout"); } catch { /* ignore */ }
          this.clients.delete(clientId);
          this.rateLimits.delete(clientId);
          // Reject pending commands for this client
          for (const [id, pending] of this.pendingCommands.entries()) {
            if (pending.clientId === clientId) {
              clearTimeout(pending.timeout);
              pending.reject(new Error("Plugin unresponsive — ping timeout"));
              this.pendingCommands.delete(id);
              for (const [method, cmdId] of this.inFlightMethods.entries()) {
                if (cmdId === id) this.inFlightMethods.delete(method);
              }
            }
          }
          this.emitEvent("warn", `Plugin ${clientId} unresponsive — disconnected`);
          this.emit("client-disconnected", clientId);
          continue;
        }
        try { client.ws.ping(); } catch { /* ignore — close handler will clean up */ }
      }
    }, 30000);
  }

  private activateClient(client: BridgeClient, hello: BridgeHelloEnvelope): void {
    this.pendingClients.delete(client.id);
    client.file = hello.file;
    client.fileKey = hello.fileKey;
    client.editor = hello.editor;
    client.lastPing = new Date();
    this.clients.set(client.id, client);
    this._lastConnectedAt = new Date();
    this._reconnectAttempts = 0;
    this._isReconnecting = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    log.info(`Plugin authenticated: ${client.id}`);
    this.emitEvent("success", "Figma plugin connected");
    this.emit("client-connected", client);
    this.emit("client-updated", client);
  }

  private handleMessage(clientId: string, msg: BridgeEnvelope): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (msg.type) {
      case "ping":
        // JSON-level keepalive from plugin UI
        client.lastPing = new Date();
        try {
          client.ws.send(
            JSON.stringify(
              serializeBridgeEnvelope({
                channel: "memoire.bridge.v2",
                source: "server",
                type: "pong",
              }, "v2"),
            ),
          );
        } catch {
          // Client gone — will be cleaned up by close handler
        }
        break;

      case "bridge-hello":
        // Plugin identifying itself — validate string types
        client.file = msg.file;
        client.fileKey = msg.fileKey;
        client.editor = msg.editor;
        this.emit("client-updated", client);
        log.info(`Plugin identified: ${client.file} (${client.editor})`);
        break;

      case "response": {
        if (typeof msg.id !== "string") break;
        // Response to a command we sent — verify it came from the same client
        const pending = this.pendingCommands.get(msg.id);
        if (pending && pending.clientId === clientId) {
          clearTimeout(pending.timeout);
          this.pendingCommands.delete(msg.id);
          for (const [method, cmdId] of this.inFlightMethods.entries()) {
            if (cmdId === msg.id) this.inFlightMethods.delete(method);
          }
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
        break;
      }

      case "chat":
        // Chat from plugin UI
        break;

      case "selection":
        this.emit("selection", msg.data);
        break;

      case "page-changed":
        this.emit("page-changed", msg.data);
        break;

      case "document-changed":
        this.emit("document-changed", msg.data);
        break;

      case "action-result":
        this.emit("action-result", { action: msg.action, result: msg.result, error: msg.error });
        break;

      case "sync-result":
        this.emit("sync-result", {
          part: msg.part,
          summary: msg.summary,
          result: msg.result,
          error: msg.error,
        });
        this.emit("sync-data", {
          part: msg.part,
          summary: msg.summary,
          result: msg.result,
          error: msg.error,
        });
        break;

      case "connection-state":
        this.emit("connection-state", msg.data);
        break;

      case "job-status":
        this.emit("job-status", msg.data);
        break;

      case "heal-result":
        this.emit("heal-result", msg.data);
        break;

      case "agent-status":
        this.emit("agent-status", msg.data);
        break;

      case "agent-message":
        this.emit("agent-message", msg.data);
        break;

      case "agent-register":
      case "agent-deregister":
        // These are server→client only, ignore if received from client
        break;

      case "identify":
      case "event":
      case "error":
      case "pong":
      case "token-push":
      case "variable-changed":
      case "component-changed":
        break;

      default:
        log.debug({ clientId, type: msg.type }, "Unknown message type");
    }
  }

  /** Check and update rate limit for a client. Returns true if allowed. */
  private checkRateLimit(clientId: string, messageSize: number): boolean {
    const now = Date.now();
    let limit = this.rateLimits.get(clientId);

    if (!limit || now - limit.windowStart > RATE_LIMIT.windowMs) {
      limit = { messageCount: 0, bytesCount: 0, windowStart: now };
      this.rateLimits.set(clientId, limit);

      // Always evict stale entries from disconnected clients (2 windows old)
      const staleThreshold = now - RATE_LIMIT.windowMs * 2;
      for (const [id, rl] of this.rateLimits) {
        if (rl.windowStart < staleThreshold && !this.clients.has(id)) {
          this.rateLimits.delete(id);
        }
      }
    }

    limit.messageCount++;
    limit.bytesCount += messageSize;

    // Fix #11 (LOW): use combined weighted score so neither dimension can be
    // independently exhausted while staying under the other limit.
    const msgScore = limit.messageCount / RATE_LIMIT.maxMessagesPerMinute;
    const byteScore = limit.bytesCount / RATE_LIMIT.maxBytesPerMinute;
    if (msgScore >= 1 || byteScore >= 1 || msgScore + byteScore >= 1.5) {
      log.warn(
        { clientId, messages: limit.messageCount, bytes: limit.bytesCount },
        "Rate limit exceeded",
      );
      return false;
    }

    return true;
  }

  private getActiveClient(): BridgeClient | null {
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        return client;
      }
    }
    return null;
  }

  /**
   * Exponential backoff reconnect-wait loop.
   *
   * The server itself remains open and accepting connections — this just emits
   * diagnostic events at increasing intervals so operators can observe the
   * "waiting for plugin to come back" state without log spam.
   *
   * After RECONNECT_MAX_ATTEMPTS it emits an error event and stops the loop.
   */
  private _scheduleReconnectWarn(): void {
    if (!this._running || this.clients.size > 0) return;

    if (this._reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this._isReconnecting = false;
      this.emitEvent(
        "error",
        `No Figma plugin reconnected after ${RECONNECT_MAX_ATTEMPTS} attempts — ` +
          `open the Mémoire plugin in Figma to resume`,
      );
      this.emit("reconnect-failed", { attempts: this._reconnectAttempts });
      return;
    }

    this._isReconnecting = true;
    const delayMs = RECONNECT_DELAYS_MS[Math.min(this._reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    const attempt = this._reconnectAttempts + 1;

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;

      // Plugin may have re-connected during the wait — abort if so
      if (this.clients.size > 0 || !this._running) {
        this._isReconnecting = false;
        return;
      }

      this._reconnectAttempts = attempt;
      this.emitEvent(
        "warn",
        `Waiting for Figma plugin (attempt ${attempt}/${RECONNECT_MAX_ATTEMPTS}) — ` +
          `next check in ${RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] / 1000}s`,
      );
      this.emit("reconnecting", { attempts: attempt });
      this._scheduleReconnectWarn();
    }, delayMs);
  }

  private emitEvent(type: MemoireEvent["type"], message: string): void {
    const event: MemoireEvent = {
      type,
      source: "ws-server",
      message,
      timestamp: new Date(),
    };
    this.config.onEvent?.(event);
    this.emit("event", event);
  }
}
