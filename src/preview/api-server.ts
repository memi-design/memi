/**
 * Preview API Server — Interactive preview with REST API and WebSocket hot-reload.
 *
 * Browsers connect via WebSocket for live reload notifications.
 * The server pushes `{ type: "reload", reason }` when specs or code change.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, extname, basename, resolve as resolvePath } from "path";
import { WebSocketServer, WebSocket } from "ws";
import type { MemoireEngine } from "../engine/core.js";
import type { MemoireEvent } from "../engine/core.js";
import { createLogger } from "../engine/logger.js";
import { PreviewWidgetStateCache } from "./widget-state-cache.js";

const log = createLogger("preview-api");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const MAX_PORT_RETRIES = 10;
export const PREVIEW_BIND_HOST = "127.0.0.1";

function createPortBindError(port: number, err: NodeJS.ErrnoException): Error & { code?: string; port?: number } {
  const wrapped = new Error(`Failed to bind preview port ${port}: ${err.message}`) as Error & {
    code?: string;
    port?: number;
  };
  wrapped.code = err.code;
  wrapped.port = port;
  return wrapped;
}

export interface PipelineAccessor {
  getStats(): { pullCount: number; specCount: number; generateCount: number; errorCount: number; queueDepth: number };
  getRecentEvents(): { type: string; timestamp: string; detail: string }[];
}

export class PreviewApiServer {
  private engine: MemoireEngine;
  private staticDir: string;
  private port: number;
  private startPort: number;
  private pipeline: PipelineAccessor | null = null;
  private server: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private liveClients = new Set<WebSocket>();
  private onEngineEvent: ((evt: MemoireEvent) => void) | null = null;
  private onFigmaConnectionState: ((state: unknown) => void) | null = null;
  private onFigmaSelection: ((selection: unknown) => void) | null = null;
  private onFigmaJobStatus: ((job: unknown) => void) | null = null;
  private onFigmaAgentStatus: ((agent: unknown) => void) | null = null;
  private onFigmaSyncResult: ((result: unknown) => void) | null = null;
  private onFigmaHealResult: ((result: unknown) => void) | null = null;
  private onFigmaPluginConnected: (() => void) | null = null;
  private onFigmaPluginDisconnected: (() => void) | null = null;
  private widgetState = new PreviewWidgetStateCache();
  private sseClients = new Set<ServerResponse>();

  constructor(engine: MemoireEngine, staticDir: string, port = 3030) {
    this.engine = engine;
    this.staticDir = staticDir;
    this.port = port;
    this.startPort = port;
  }

  setPipeline(pipeline: PipelineAccessor): void {
    this.pipeline = pipeline;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      this.server = createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${this.port}`);

        // API routes
        if (url.pathname.startsWith("/api/")) {
          res.setHeader("Content-Type", "application/json");
          // Fix #8 (MEDIUM): scope CORS to exact port this server is on
          const origin = req.headers.origin;
          if (origin && (
            origin === `http://localhost:${this.port}` ||
            origin === `https://localhost:${this.port}`
          )) {
            res.setHeader("Access-Control-Allow-Origin", origin);
          }

          if (url.pathname === "/api/specs") {
            try {
              const specs = await this.engine.registry.getAllSpecs();
              res.end(JSON.stringify(specs));
            } catch (err) {
              log.warn({ err }, "Failed to load specs");
              res.end(JSON.stringify([]));
            }
            return;
          }

          if (url.pathname === "/api/tokens") {
            const tokens = this.engine.registry.designSystem;
            res.end(JSON.stringify(tokens));
            return;
          }

          if (url.pathname === "/api/status") {
            res.end(JSON.stringify({
              figma: this.engine.figma.isConnected,
              connected: this.engine.figma.isConnected,
              port: this.engine.figma.wsServer.activePort || null,
            }));
            return;
          }

          if (url.pathname === "/api/figma/status") {
            res.end(JSON.stringify(this.buildWidgetStatusPayload()));
            return;
          }

          if (url.pathname === "/api/figma/jobs") {
            res.end(JSON.stringify({
              jobs: this.widgetState.getJobs(),
              updatedAt: Date.now(),
            }));
            return;
          }

          if (url.pathname === "/api/figma/selection") {
            const selection = this.widgetState.getSelection();
            res.end(JSON.stringify({
              selection,
              updatedAt: Date.now(),
            }));
            return;
          }

          if (url.pathname === "/api/figma/agents") {
            res.end(JSON.stringify({
              agents: this.widgetState.getAgents(),
              updatedAt: Date.now(),
            }));
            return;
          }

          if (url.pathname === "/api/pipeline/stats" && this.pipeline) {
            res.end(JSON.stringify(this.pipeline.getStats()));
            return;
          }

          if (url.pathname === "/api/pipeline/events" && this.pipeline) {
            res.end(JSON.stringify(this.pipeline.getRecentEvents()));
            return;
          }

          if (url.pathname === "/api/sync/state") {
            const conflicts = this.engine.sync.getConflicts();
            res.end(JSON.stringify({
              conflicts,
              conflictCount: conflicts.length,
              isGuarded: this.engine.sync.isGuarded,
            }));
            return;
          }

          if (url.pathname === "/api/agents") {
            const agents = this.engine.agentRegistry.getAll();
            const queueStats = this.engine.taskQueue.getStats();
            res.end(JSON.stringify({
              agents,
              agentCount: agents.length,
              online: agents.filter((a) => a.status === "online").length,
              busy: agents.filter((a) => a.status === "busy").length,
              queue: queueStats,
            }));
            return;
          }

          if (url.pathname === "/api/research") {
            try {
              await this.engine.research.load();
              const store = this.engine.research.getStore();
              const specs = await this.engine.registry.getAllSpecs();
              const specNames = specs.map((s) => s.name);

              // Compute coverage
              const backedSpecs = specs.filter((s) => {
                const backing = "researchBacking" in s ? (s as { researchBacking: string[] }).researchBacking : [];
                return Array.isArray(backing) && backing.length > 0;
              });

              res.end(JSON.stringify({
                ...store,
                coverage: {
                  covered: backedSpecs.length,
                  total: specs.length,
                  ratio: specs.length > 0 ? backedSpecs.length / specs.length : 1,
                },
              }));
            } catch (err) {
              log.warn({ err }, "Failed to load research data");
              res.end(JSON.stringify({
                version: 2,
                sources: [],
                observations: [],
                findings: [],
                themes: [],
                personas: [],
                quantitativeMetrics: [],
                opportunities: [],
                risks: [],
                contradictions: [],
                quality: {
                  overallScore: 0,
                  sampleSize: 0,
                  completenessScore: 0,
                  sourceDiversityScore: 0,
                  triangulationScore: 0,
                  structureScore: 0,
                  notes: [],
                  generatedAt: new Date().toISOString(),
                },
                methods: {
                  analysisMode: "decision-grade",
                  quantitativeApproach: "descriptive statistics + confidence intervals + cohort deltas",
                  qualitativeApproach: "coded observations + evidence-backed theme synthesis",
                  limitations: [],
                },
                coverage: { covered: 0, total: 0, ratio: 1 },
              }));
            }
            return;
          }

          // POST /api/sync/resolve — resolve a sync conflict
          if (url.pathname === "/api/sync/resolve" && req.method === "POST") {
            const body = await readRequestBody(req);
            try {
              const { name, resolution } = JSON.parse(body);
              const resolved = this.engine.sync.resolveConflict(name, resolution);
              res.end(JSON.stringify({ ok: resolved, name, resolution }));
            } catch (err) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: sanitizeErrorMessage(err) }));
            }
            return;
          }

          // POST /api/action — dispatch actions to Figma bridge
          if (url.pathname === "/api/action" && req.method === "POST") {
            const body = await readRequestBody(req);
            try {
              const { action } = JSON.parse(body);
              // Fix #11 (MEDIUM): allowlist valid actions — reject unknown strings
              const ALLOWED_ACTIONS = new Set(["inspect", "pull-tokens", "pull-components", "page-tree", "stickies", "full-sync"]);
              if (!action || !ALLOWED_ACTIONS.has(action)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: `Unknown action "${String(action).slice(0, 32)}"` }));
                return;
              }
              const result = await this.dispatchAction(action);
              res.end(JSON.stringify({ ok: true, action, result }));
            } catch (err) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: sanitizeErrorMessage(err) }));
            }
            return;
          }

          // Handle CORS preflight for POST endpoints
          if (req.method === "OPTIONS") {
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type");
            res.statusCode = 204;
            res.end();
            return;
          }

          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        // ── shadcn registry endpoints (/r/*) ──────────────────
        // Makes generated components installable via:
        //   npx shadcn add http://localhost:<port>/r/<ComponentName>.json
        if (url.pathname.startsWith("/r/")) {
          res.setHeader("Content-Type", "application/json");
          // Fix #6 (HIGH): restrict CORS to localhost only — not wildcard
          const regOrigin = req.headers.origin;
          if (regOrigin && /^https?:\/\/localhost(:\d+)?$/.test(regOrigin)) {
            res.setHeader("Access-Control-Allow-Origin", regOrigin);
          }

          // Fix #2 (CRITICAL): validate component name — alphanumeric + dash/underscore only
          const rawName = url.pathname.slice(3).replace(/\.json$/, "");
          if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(rawName)) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid component name" }));
            return;
          }
          const name = rawName;

          // GET /r/registry.json — full registry index
          if (name === "registry") {
            const items = await buildRegistryIndex(this.engine.config.projectRoot, this.port);
            res.end(JSON.stringify({
              $schema: "https://ui.shadcn.com/schema/registry.json",
              name: "memoire",
              homepage: `http://localhost:${this.port}`,
              items,
            }, null, 2));
            return;
          }

          // GET /r/<ComponentName>.json — individual component
          const item = await buildRegistryItem(this.engine.config.projectRoot, name, this.port);
          if (!item) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: `Component "${name}" not found in generated/` }));
            return;
          }
          res.end(JSON.stringify(item, null, 2));
          return;
        }

        // SSE /events — real-time event stream for monitor.html
        if (url.pathname === "/events") {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          const sseOrigin = req.headers.origin;
          if (sseOrigin && /^https?:\/\/localhost(:\d+)?$/.test(sseOrigin)) {
            res.setHeader("Access-Control-Allow-Origin", sseOrigin);
          }

          // Send initial state
          const initPayload = {
            type: "init",
            data: {
              status: this.buildWidgetStatusPayload(),
              recentEvents: [],
            },
          };
          res.write(`data: ${JSON.stringify(initPayload)}\n\n`);
          this.sseClients.add(res);

          req.on("close", () => {
            this.sseClients.delete(res);
          });
          return;
        }

        // Static file serving
        let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
        const fullPath = join(this.staticDir, filePath);

        // Fix #1 (CRITICAL): path traversal guard — resolved path must stay inside staticDir
        const resolvedStatic = resolvePath(fullPath);
        const resolvedStaticDir = resolvePath(this.staticDir);
        if (!resolvedStatic.startsWith(resolvedStaticDir + "/") && resolvedStatic !== resolvedStaticDir) {
          res.statusCode = 403;
          res.setHeader("Content-Type", "text/plain");
          res.end("Forbidden");
          return;
        }

        const ext = extname(fullPath);
        try {
          const content = await readFile(fullPath);
          res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
          res.end(content);
        } catch {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain");
          res.end("Not found");
        }
      });

      // Listen for engine events that should trigger browser reload + SSE
      this.onEngineEvent = (evt: MemoireEvent) => {
        if (evt.source === "codegen" || evt.source === "auto-spec") {
          this.notifyReload(evt.message);
        }
        this.broadcastSSE("engine-event", { type: evt.type, source: evt.source, message: evt.message });
      };
      this.engine.on("event", this.onEngineEvent);
      this.attachFigmaListeners();

      const setupWebSocketServer = () => {
        if (!this.server) return;

        // Fix #7 (HIGH): validate WebSocket origin — localhost only
        this.wss = new WebSocketServer({
          server: this.server,
          verifyClient: (info: { req: IncomingMessage; secure: boolean; origin: string }) => {
            const origin = info.req.headers.origin;
            if (!origin) return true; // non-browser clients (curl, CLI) allowed
            return /^https?:\/\/localhost(:\d+)?$/.test(origin);
          },
        });
        this.wss.on("connection", (ws) => {
          this.liveClients.add(ws);
          ws.on("close", () => this.liveClients.delete(ws));
          ws.on("error", () => {
            this.liveClients.delete(ws);
            try { ws.close(); } catch { /* already closed */ }
          });
        });
        this.wss.on("error", (err) => {
          if (!resolved) {
            reject(err);
            return;
          }
          for (const ws of this.liveClients) ws.close();
          this.liveClients.clear();
          this.wss?.close();
          this.wss = null;
        });
      };

      this.server.on("listening", () => {
        setupWebSocketServer();
        resolved = true;
        resolve(this.port);
      });

      this.server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          if (this.port - this.startPort >= MAX_PORT_RETRIES) {
            const wrapped = new Error(`All preview ports ${this.startPort}-${this.port} are in use`) as Error & {
              code?: string;
              port?: number;
            };
            wrapped.code = err.code;
            wrapped.port = this.port;
            reject(wrapped);
            return;
          }
          this.port++;
          this.server?.listen(this.port, PREVIEW_BIND_HOST);
        } else {
          reject(createPortBindError(this.port, err));
        }
      });

      this.server.listen(this.port, PREVIEW_BIND_HOST);
    });
  }

  /** Push a reload signal to all connected browsers. */
  notifyReload(reason: string): void {
    const msg = JSON.stringify({ type: "reload", reason });
    for (const ws of this.liveClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  stop(): void {
    if (this.onEngineEvent) {
      this.engine.off("event", this.onEngineEvent);
      this.onEngineEvent = null;
    }
    this.detachFigmaListeners();
    for (const ws of this.liveClients) ws.close();
    this.liveClients.clear();
    for (const res of this.sseClients) {
      if (!res.writableEnded) res.end();
    }
    this.sseClients.clear();
    this.wss?.close();
    this.server?.close();
  }

  private attachFigmaListeners(): void {
    const figma = this.engine.figma;
    this.onFigmaConnectionState = (state) => {
      this.widgetState.updateConnection(state as Parameters<PreviewWidgetStateCache["updateConnection"]>[0]);
    };
    this.onFigmaSelection = (selection) => {
      this.widgetState.updateSelection(selection as Parameters<PreviewWidgetStateCache["updateSelection"]>[0]);
      this.broadcastSSE("selection", selection);
    };
    this.onFigmaJobStatus = (job) => {
      this.widgetState.upsertJob(job as Parameters<PreviewWidgetStateCache["upsertJob"]>[0]);
      this.broadcastSSE("job-status", job);
    };
    this.onFigmaAgentStatus = (agent) => {
      this.widgetState.upsertAgent(agent as Parameters<PreviewWidgetStateCache["upsertAgent"]>[0]);
    };
    this.onFigmaSyncResult = (result) => {
      const payload = result as { summary?: Parameters<PreviewWidgetStateCache["mergeSync"]>[0] };
      if (payload?.summary) {
        this.widgetState.mergeSync(payload.summary);
      }
    };
    this.onFigmaHealResult = (result) => {
      this.widgetState.updateHeal(result as Parameters<PreviewWidgetStateCache["updateHeal"]>[0]);
    };
    this.onFigmaPluginConnected = () => {
      this.widgetState.updateConnection({
        ...(this.widgetState.getConnection() ?? {
          stage: "connected",
          port: this.engine.figma.wsServer.activePort || null,
          name: "Mémoire Control Plane",
          latencyMs: null,
          fileName: "",
          fileKey: null,
          pageName: "",
          pageId: null,
          editorType: "",
          connectedAt: Date.now(),
          reconnectDelayMs: null,
        }),
        stage: "connected",
      });
      this.broadcastSSE("plugin-connected", { port: this.engine.figma.wsServer.activePort });
    };
    this.onFigmaPluginDisconnected = () => {
      const current = this.widgetState.getConnection();
      if (current) {
        this.widgetState.updateConnection({
          ...current,
          stage: "offline",
          port: current.port,
          reconnectDelayMs: current.reconnectDelayMs,
        });
      }
      this.widgetState.markDisconnected();
      this.broadcastSSE("plugin-disconnected", {});
    };

    figma.on("connection-state", this.onFigmaConnectionState);
    figma.on("selection", this.onFigmaSelection);
    figma.on("job-status", this.onFigmaJobStatus);
    figma.on("agent-status", this.onFigmaAgentStatus);
    figma.on("sync-result", this.onFigmaSyncResult);
    figma.on("heal-result", this.onFigmaHealResult);
    figma.on("plugin-connected", this.onFigmaPluginConnected);
    figma.on("plugin-disconnected", this.onFigmaPluginDisconnected);
  }

  private detachFigmaListeners(): void {
    const figma = this.engine.figma;
    if (this.onFigmaConnectionState) figma.off("connection-state", this.onFigmaConnectionState);
    if (this.onFigmaSelection) figma.off("selection", this.onFigmaSelection);
    if (this.onFigmaJobStatus) figma.off("job-status", this.onFigmaJobStatus);
    if (this.onFigmaAgentStatus) figma.off("agent-status", this.onFigmaAgentStatus);
    if (this.onFigmaSyncResult) figma.off("sync-result", this.onFigmaSyncResult);
    if (this.onFigmaHealResult) figma.off("heal-result", this.onFigmaHealResult);
    if (this.onFigmaPluginConnected) figma.off("plugin-connected", this.onFigmaPluginConnected);
    if (this.onFigmaPluginDisconnected) figma.off("plugin-disconnected", this.onFigmaPluginDisconnected);
    this.onFigmaConnectionState = null;
    this.onFigmaSelection = null;
    this.onFigmaJobStatus = null;
    this.onFigmaAgentStatus = null;
    this.onFigmaSyncResult = null;
    this.onFigmaHealResult = null;
    this.onFigmaPluginConnected = null;
    this.onFigmaPluginDisconnected = null;
  }

  private buildWidgetStatusPayload() {
    const bridge = this.engine.figma.wsServer.getStatus();
    return this.widgetState.snapshot(bridge);
  }

  /** Broadcast an SSE event to all connected monitor clients. */
  private broadcastSSE(type: string, data: unknown): void {
    if (this.sseClients.size === 0) return;
    const payload = JSON.stringify({ type, data, ts: Date.now() });
    for (const res of this.sseClients) {
      if (!res.writableEnded) {
        const ok = res.write(`data: ${payload}\n\n`);
        if (!ok) {
          // Backpressure — client can't keep up, drop it
          this.sseClients.delete(res);
        }
      }
    }
  }

  /** Map action names from monitor.html to bridge commands. */
  private async dispatchAction(action: string): Promise<unknown> {
    const bridge = this.engine.figma;
    switch (action) {
      case "inspect":
        return bridge.getSelection();
      case "pull-tokens":
        return bridge.wsServer.sendCommand("getVariables", {}, 60000);
      case "pull-components":
        return bridge.wsServer.sendCommand("getComponents", {}, 60000);
      case "page-tree":
        return bridge.getPageTree();
      case "stickies":
        return bridge.extractStickies();
      case "full-sync":
        return bridge.extractDesignSystem();
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
}

/**
 * Fix #10 (LOW): Strip filesystem paths from error messages before sending to clients.
 * Prevents leaking absolute paths like /Users/alice/projects/... in API error responses.
 */
function sanitizeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Replace absolute paths: /Users/... /home/... /var/... → <path>
  return msg.replace(/\/(?:Users|home|var|tmp|private|opt)[^\s"',;)]+/g, "<path>");
}

const MAX_BODY_BYTES = 1_048_576; // 1 MB

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("Request body read timed out"));
    }, 10_000);

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        clearTimeout(timer);
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── shadcn registry helpers ───────────────────────────────────

/**
 * Scan generated/ for components and build a registry index.
 * Supports atoms, molecules, organisms, templates in nested folders.
 */
async function buildRegistryIndex(root: string, port: number): Promise<unknown[]> {
  const items: unknown[] = [];
  const generatedDir = join(root, "generated");
  if (!existsSync(generatedDir)) return items;

  const searchDirs = [
    join(generatedDir, "components", "ui"),
    join(generatedDir, "components", "molecules"),
    join(generatedDir, "components", "organisms"),
    join(generatedDir, "components", "templates"),
  ];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      items.push({
        $schema: "https://ui.shadcn.com/schema/registry-item.json",
        name,
        type: "registry:component",
        title: name,
        description: `Generated by Memoire · https://memoire.cv`,
        files: [{ path: `registry/${name}.tsx`, type: "registry:component" }],
      });
    }
  }

  return items;
}

/**
 * Build a registry item for a specific component.
 * Reads the generated TSX file and embeds its content inline.
 */
async function buildRegistryItem(root: string, name: string, _port: number): Promise<unknown | null> {
  const searchDirs = [
    join(root, "generated", "components", "ui"),
    join(root, "generated", "components", "molecules"),
    join(root, "generated", "components", "organisms"),
    join(root, "generated", "components", "templates"),
  ];

  for (const dir of searchDirs) {
    const componentDir = join(dir, name);
    const tsxPath = join(componentDir, `${name}.tsx`);
    if (!existsSync(tsxPath)) continue;

    const content = await readFile(tsxPath, "utf-8");

    // Parse dependencies from import statements
    const imports = [...content.matchAll(/^import .+ from ["']([^"']+)["']/gm)]
      .map((m) => m[1])
      .filter((pkg) => !pkg.startsWith(".") && !pkg.startsWith("@/"));

    const registryDeps = [...content.matchAll(/from ["']@\/components\/ui\/([^"']+)["']/gm)]
      .map((m) => basename(m[1], ".js"));

    return {
      $schema: "https://ui.shadcn.com/schema/registry-item.json",
      name,
      type: "registry:component",
      title: name,
      description: `Generated by Memoire · https://memoire.cv`,
      dependencies: [...new Set(imports)],
      registryDependencies: [...new Set(registryDeps)],
      files: [
        {
          path: `registry/${name}.tsx`,
          type: "registry:component",
          content,
        },
      ],
    };
  }

  return null;
}
