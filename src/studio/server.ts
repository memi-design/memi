import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildHarnessCommand, clearHarnessProbeCaches, harnessProbeCacheAgeMs, listHarnesses } from "./harnesses.js";
import { loadStudioConfig, saveStudioConfig } from "./config.js";
import { redactSecrets } from "./redact.js";
import { sanitizeStudioEvent, StudioSessionStore, type StudioSessionIndexEntry } from "./session-store.js";
import {
  DESIGN_AUTOMATION_TEMPLATES,
  StudioAutomationStore,
  buildAutomationPrompt,
  createAutomationFromTemplate,
  installScheduler,
  schedulerStatus,
  uninstallScheduler,
} from "./automations.js";
import {
  createStudioOutputNormalizer,
  flushStudioOutputNormalizer,
  normalizeStudioOutputChunk,
} from "./output-normalizer.js";
import { indexProjectMemory, refreshProjectMemory } from "./project-memory.js";
import {
  captureKnowledgeEvent,
  compactKnowledgeIndex,
  getKnowledgeItem,
  listKnowledgeStore,
  refreshKnowledgeStore,
  shouldCaptureKnowledgeEvent,
} from "./knowledge-store.js";
import { StudioBrowserAdapter } from "./browser-adapter.js";
import { StudioComputerAdapter } from "./computer-adapter.js";
import { createStudioCompatibilitySnapshot } from "./compatibility.js";
import {
  captureDesignSystemArtifact,
  getDesignSystemArtifact,
  listDesignSystemArtifacts,
  updateDesignSystemArtifactSectionReview,
} from "./design-system-artifact-store.js";
import {
  archiveDesignChangelogEntry,
  captureDesignChangelogEntry,
  createDesignChangelogEntry,
  exportDesignChangelogMarkdown,
  listDesignChangelogEntries,
  restoreDesignChangelogEntry,
  updateDesignChangelogEntry,
} from "./design-changelog.js";
import { acceptDesignAuditBaseline, getLatestDesignAudit, runDesignAudit } from "./design-audit-store.js";
import { captureStudioAttachment, getStudioAttachment } from "./attachment-store.js";
import { readResolvedAsset } from "./design-system-resolver.js";
import { shouldCaptureDesignSystemArtifactEvent } from "./design-system-artifacts.js";
import { collectDesignSystemTrace } from "./design-system-trace.js";
import { StudioFigmaController } from "./figma-controller.js";
import {
  getMarketplaceNote,
  listMarketplaceNotes,
  removeMarketplaceNote,
  studioCatalogCache,
} from "./marketplace.js";
import {
  buildNoteForkPrHandoff,
  diffNoteFork,
  forkNoteDirectory,
  getNoteForkFiles,
  listNoteForks,
  updateNoteForkFile,
  validateCommunityNoteDir,
} from "../notes/community.js";
import { StudioDownloadStore } from "./downloads.js";
import { StudioToolBroker } from "./tool-broker.js";
import { buildSessionReferenceTrace } from "./reference-trace.js";
import { createStudioTraceSnapshot } from "./view-model.js";
import { asId, makeId } from "./contracts/ids.js";
import type { ProviderRuntimeEvent } from "./contracts/provider-runtime.js";
import type { RuntimeTraceContext } from "./contracts/provider-runtime.js";
import { FileEventJournal } from "./journal/event-journal.js";
import { RpcServer } from "./rpc/server.js";
import { EventBus } from "./event-bus.js";
import { createChildTraceContext, createRuntimeTraceContext } from "./tracing/context.js";
import { sanitizeRuntimeEvent } from "./tracing/privacy.js";
import {
  exportRuntimeEvent,
  NoopTelemetrySink,
  type TelemetrySink,
} from "./tracing/opentelemetry.js";
import { FileSimulationStore } from "../simulation/index.js";
import type { ResearchStore } from "../research/engine.js";
import {
  createVideoProject,
  getVideoAdapterStatus,
  listVideoProjects,
  previewVideoProject,
  renderVideoProject,
  videoDownloadArtifact,
} from "./video.js";
import { AGENT_INSTALL_TARGETS, installAgentKits, normalizeAgentInstallTarget, planAgentInstall, planSuiteManifest } from "../agents/agent-kits.js";
import { openMermaidJamTarget, resolveMermaidJamIntegration, type MermaidJamOpenTarget } from "../integrations/mermaid-jam.js";
import {
  analyzeMarkdownForFigJam,
  getMarkdownCorpusStatus,
  setupMarkdownCorpus,
  type MarkdownCorpusRepo,
} from "../integrations/markdown-corpus.js";
import type {
  StudioConfig,
  StudioEvent,
  StudioEventType,
  StudioFigmaActionRequest,
  StudioFigmaOpenRequest,
  StudioKnowledgeCaptureRequest,
  StudioRuntimeInfo,
  StudioSession,
  StudioSessionMode,
  StudioHarnessId,
  StudioHarnessStatus,
  StudioRunAction,
  StudioAgentContext,
  StudioChatMode,
  StudioPermissionMode,
  StudioToolCallRequest,
  StudioToolCallResult,
  StudioBrowserActionRequest,
  StudioComputerActionRequest,
  StudioComputerOpenRequest,
  StudioDesignSystemArtifactCaptureRequest,
  StudioDesignSystemArtifactReviewPatch,
  DesignChangelogCaptureRequest,
  StudioAttachment,
  StudioAttachmentCaptureRequest,
  StudioAutomationDefinition,
  StudioAutomationRun,
  StudioCodexConfig,
  StudioCodexReasoningEffort,
  StudioUsageProviderId,
} from "./types.js";

export interface StudioRuntimeServerOptions {
  projectRoot: string;
  port?: number;
  host?: string;
  figma?: StudioFigmaController;
  telemetrySink?: TelemetrySink;
}

interface SessionClient {
  sessionId: string;
  res: ServerResponse;
}

type StudioSessionSource = "live" | "persisted";
type StudioSessionSummary = (
  | (Omit<StudioSession, "events"> & { eventCount: number })
  | StudioSessionIndexEntry
) & { source: StudioSessionSource };

type AutomationCreateBody = Partial<StudioAutomationDefinition> & {
  templateId?: string;
};

export class StudioRuntimeServer {
  private readonly projectRoot: string;
  private readonly requestedPort: number;
  private readonly host: string;
  private server: ReturnType<typeof createServer> | null = null;
  private config: StudioConfig | null = null;
  private sessions = new Map<string, StudioSession>();
  private processes = new Map<string, ChildProcessWithoutNullStreams>();
  private clients = new Set<SessionClient>();
  private markdownCorpusAbort: AbortController | null = null;
  private readonly sessionStore: StudioSessionStore;
  private readonly figma: StudioFigmaController;
  private readonly browser: StudioBrowserAdapter;
  private readonly computer: StudioComputerAdapter;
  private readonly toolBroker: StudioToolBroker;
  private readonly automations: StudioAutomationStore;
  private readonly downloads: StudioDownloadStore;
  private readonly eventJournal: FileEventJournal;
  private readonly providerEventBus = new EventBus();
  private readonly telemetrySink: TelemetrySink;
  private readonly providerTraceContexts = new Map<string, RuntimeTraceContext>();
  private readonly providerToolTraceContexts = new Map<string, RuntimeTraceContext>();
  private readonly toolCalls = new Map<string, StudioToolCallResult>();
  private readonly providerEventSeq = new Map<string, number>();
  private readonly startedAt = Date.now();
  private readonly activeStreams = new Set<string>();
  private eventBufferSize = 0;
  private readonly maxInMemoryEvents = 400;
  private harnessSnapshot: { harnesses: StudioHarnessStatus[]; checkedAt: number } | null = null;
  private readonly harnessSnapshotTtlMs = 5_000;

  constructor(options: StudioRuntimeServerOptions) {
    this.projectRoot = resolve(options.projectRoot);
    this.requestedPort = options.port ?? 8765;
    this.host = options.host ?? "127.0.0.1";
    this.sessionStore = new StudioSessionStore(this.projectRoot);
    this.automations = new StudioAutomationStore(this.projectRoot);
    this.downloads = new StudioDownloadStore(this.projectRoot);
    this.eventJournal = new FileEventJournal(this.projectRoot);
    this.telemetrySink = options.telemetrySink ?? new NoopTelemetrySink();
    this.browser = new StudioBrowserAdapter({ projectRoot: this.projectRoot });
    this.computer = new StudioComputerAdapter({ projectRoot: this.projectRoot });
    this.figma = options.figma ?? new StudioFigmaController({
      projectRoot: this.projectRoot,
      onEvent: (event) => {
        this.eventBufferSize = Math.min(200_000, this.eventBufferSize + event.message.length);
      },
    });
    this.toolBroker = new StudioToolBroker({
      projectRoot: this.projectRoot,
      getConfig: () => this.getConfig(),
      browser: this.browser,
      runFigmaAction: (request) => this.figma.runAction(request),
    });
  }

  async start(): Promise<StudioRuntimeInfo> {
    if (this.server) return this.runtimeInfo();
    this.config = await loadStudioConfig(this.projectRoot);
    this.sessionStore.init();
    await this.downloads.init();
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        this.sendJSON(res, 500, { error: error instanceof Error ? error.message : String(error) });
      });
    });

    await new Promise<void>((resolveStart, rejectStart) => {
      if (!this.server) return rejectStart(new Error("Studio server not initialized"));
      this.server.once("error", rejectStart);
      this.server.listen(this.requestedPort, this.host, () => {
        this.server?.off("error", rejectStart);
        resolveStart();
      });
    });

    return this.runtimeInfo();
  }

  async stop(): Promise<void> {
    for (const child of this.processes.values()) child.kill("SIGTERM");
    this.processes.clear();
    await this.browser.closeAll();
    for (const client of this.clients) client.res.end();
    this.clients.clear();
    this.providerEventBus.clear();
    this.providerTraceContexts.clear();
    this.providerToolTraceContexts.clear();
    if (!this.server) return;
    await new Promise<void>((resolveStop) => this.server?.close(() => resolveStop()));
    this.server = null;
  }

  getSession(id: string): StudioSession | null {
    return this.sessions.get(id) ?? null;
  }

  async startSession(input: { harness: StudioHarnessId; cwd: string; prompt: string; action?: StudioRunAction; mode?: StudioSessionMode; chatMode?: StudioChatMode; permissionMode?: StudioPermissionMode; attachments?: StudioAttachment[]; conversationId?: string; goal?: string; model?: string | null; effort?: string | null; codex?: Partial<StudioCodexConfig> }): Promise<StudioSession> {
    const baseConfig = await this.getConfig();
    const requestedModel = optionalTrimmedString(input.model);
    const requestedEffort = normalizeCodexEffort(input.effort);
    const codexOverrides = {
      ...(input.codex ?? {}),
      ...(input.harness === "codex" && requestedModel ? { model: requestedModel } : {}),
      ...(input.harness === "codex" && requestedEffort ? { reasoningEffort: requestedEffort } : {}),
    };
    const config = Object.keys(codexOverrides).length > 0
      ? { ...baseConfig, codex: { ...baseConfig.codex, ...codexOverrides } }
      : baseConfig;
    const cwd = resolve(input.cwd || this.projectRoot);
    if (!isInWorkspace(cwd, config.workspaceRoots)) {
      throw Object.assign(new Error(`Workspace path is not allowed: ${cwd}`), { statusCode: 403 });
    }
    if (!input.prompt.trim()) throw Object.assign(new Error("Prompt is required"), { statusCode: 400 });
    const sessionId = `studio-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const conversationId = optionalTrimmedString(input.conversationId) ?? sessionId;
    const turnIndex = this.nextConversationTurnIndex(conversationId);
    const goal = optionalTrimmedString(input.goal);
    const model = input.harness === "codex" ? config.codex.model : requestedModel ?? null;
    const effort = input.harness === "codex" ? config.codex.reasoningEffort : optionalTrimmedString(input.effort) ?? null;
    const action = input.action ?? (input.harness === "memoire" ? "compose" : "raw");
    const mode = input.mode ?? "delegate";
    const chatMode = input.chatMode ?? defaultChatMode(input.harness, action, input.prompt);
    const permissionMode = input.permissionMode ?? "guarded";
    const attachments = input.attachments ?? [];
    const agentContext = await this.buildAgentContext({
      harness: input.harness,
      action,
      mode,
      chatMode,
      permissionMode,
      cwd,
      prompt: input.prompt,
      conversationId,
      turnIndex,
      goal,
      model,
      effort,
      config,
    });
    const commandSpec = buildHarnessCommand(config, {
      harnessId: input.harness,
      cwd,
      prompt: input.prompt,
      goal,
      model,
      effort,
      action,
      chatMode,
      permissionMode,
      agentContext,
    });

    const session: StudioSession = {
      id: sessionId,
      conversationId,
      turnIndex,
      goal,
      model,
      effort,
      harness: input.harness,
      action,
      mode,
      chatMode,
      permissionMode,
      cwd,
      prompt: input.prompt,
      attachments,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      exitCode: null,
      activeStreamId: randomUUID(),
      pendingPrompt: input.prompt,
      events: [],
    };
    this.sessions.set(session.id, session);
    this.activeStreams.add(session.id);
    const outputNormalizer = createStudioOutputNormalizer(commandSpec.outputParser);
    this.addEvent(session.id, "session_started", `Started ${input.harness}`, { cwd, prompt: input.prompt, conversationId, turnIndex, goal, model, effort, mode, chatMode, permissionMode, attachments });
    this.addEvent(session.id, "chat_message", input.prompt.trim(), {
      role: "user",
      conversationId,
      turnIndex,
      goal,
      model,
      effort,
      chatMode,
      permissionMode,
      harness: input.harness,
      action,
      attachments,
    });
    this.addEvent(session.id, "reference_trace", "Mémoire package and source references loaded", {
      references: buildSessionReferenceTrace(agentContext),
    });
    if (mode === "brokered") {
      this.addEvent(session.id, "harness_log", "Brokered tool routing enabled", {
        tools: this.toolBroker.listTools().map((tool) => tool.id),
      });
    }

    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: commandSpec.cwd,
      env: commandSpec.env,
      shell: false,
    });
    this.processes.set(session.id, child);
    child.stdin.on("error", () => {
      // Some CLIs close stdin eagerly. Studio is non-interactive here, so this is safe to ignore.
    });
    child.stdin.end();
    let finalized = false;

    child.stdout.on("data", (chunk: Buffer) => {
      for (const event of normalizeStudioOutputChunk(outputNormalizer, "stdout", redactSecrets(chunk.toString("utf-8")))) {
        this.addEvent(session.id, event.type, event.message, event.data);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      for (const event of normalizeStudioOutputChunk(outputNormalizer, "stderr", redactSecrets(chunk.toString("utf-8")))) {
        this.addEvent(session.id, event.type, event.message, event.data);
      }
    });
    child.on("error", (error) => {
      if (finalized) return;
      finalized = true;
      for (const event of flushStudioOutputNormalizer(outputNormalizer)) {
        this.addEvent(session.id, event.type, event.message, event.data);
      }
      session.status = "failed";
      session.completedAt = new Date().toISOString();
      session.activeStreamId = null;
      session.pendingPrompt = null;
      this.addEvent(session.id, "session_error", redactSecrets(error.message));
      this.processes.delete(session.id);
      this.activeStreams.delete(session.id);
      this.sessionStore.upsertSession(session);
    });
    child.on("close", (code) => {
      if (finalized) return;
      finalized = true;
      for (const event of flushStudioOutputNormalizer(outputNormalizer)) {
        this.addEvent(session.id, event.type, event.message, event.data);
      }
      session.exitCode = code;
      session.completedAt = new Date().toISOString();
      session.activeStreamId = null;
      session.pendingPrompt = null;
      if (session.status === "cancelled") {
        this.addEvent(session.id, "session_done", "Session cancelled", { exitCode: code });
      } else if (code === 0) {
        session.status = "completed";
        this.addEvent(session.id, "session_done", "Session completed", { exitCode: code });
      } else {
        session.status = "failed";
        this.addEvent(session.id, "session_error", `Session exited with code ${code}`, { exitCode: code });
      }
      this.processes.delete(session.id);
      this.activeStreams.delete(session.id);
      this.sessionStore.upsertSession(session);
    });

    return session;
  }

  cancelSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.status = "cancelled";
    session.completedAt = new Date().toISOString();
    session.activeStreamId = null;
    session.pendingPrompt = null;
    const child = this.processes.get(sessionId);
    if (child) child.kill("SIGTERM");
    this.addEvent(sessionId, "session_done", "Cancellation requested");
    this.activeStreams.delete(sessionId);
    this.sessionStore.upsertSession(session);
    return true;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${this.host}`);
    this.setBaseHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      const config = await this.getConfig();
      this.sendJSON(res, 200, {
        status: "running",
        projectRoot: this.projectRoot,
        runtime: this.runtimeInfo(),
        config,
        metrics: this.metrics(config),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/usage") {
      this.sendJSON(res, 200, { usage: await this.usageSnapshot() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/harnesses") {
      this.sendJSON(res, 200, { harnesses: await this.listHarnessSnapshot(isRefreshRequest(url)) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/compatibility") {
      this.sendJSON(res, 200, { compatibility: await this.compatibilitySnapshot(isRefreshRequest(url)) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/tools") {
      this.sendJSON(res, 200, { tools: this.toolBroker.listTools() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/rpc") {
      const body = normalizeRpcRequestSessionId(await readJSON(req));
      const rpc = new RpcServer({
        journal: this.eventJournal,
        resolver: {
          resolveDriver: () => null,
          resolveHarnessId: (sessionId) => {
            const key = studioSessionKeyFromProviderSessionId(sessionId as unknown as string);
            const session = this.sessions.get(key) ?? this.sessionStore.getSession(key);
            return session ? asId("HarnessId", `hns_${session.harness}`) : null;
          },
          createDriver: () => {
            throw new Error("Live ProviderRuntime drivers are not mounted on the legacy Studio server yet");
          },
          subscribeEvents: (sessionId, onEvent) => this.providerEventBus.subscribeFiltered(
            onEvent,
            { sessionId: sessionId as unknown as string },
          ),
        },
      });
      const responses: unknown[] = [];
      for await (const response of rpc.dispatch(body)) responses.push(response);
      this.sendJSON(res, 200, { responses });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tools/call") {
      const body = await readJSON<StudioToolCallRequest>(req);
      const call = await this.toolBroker.call(body);
      this.toolCalls.set(call.id, call);
      this.emitToolCallEvents(body, call);
      this.sendJSON(res, call.status === "failed" ? statusCodeForError(call.error) : 200, { call });
      return;
    }

    const toolCallMatch = url.pathname.match(/^\/api\/tools\/calls\/([^/]+)$/);
    if (req.method === "GET" && toolCallMatch) {
      const id = decodeURIComponent(toolCallMatch[1]);
      const call = this.toolCalls.get(id);
      if (!call) {
        this.sendJSON(res, 404, { error: `Unknown tool call: ${id}` });
        return;
      }
      this.sendJSON(res, 200, { call });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/browser/status") {
      const config = await this.getConfig();
      this.sendJSON(res, 200, await this.browser.status(config.enabledTools.browser));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/computer/status") {
      const config = await this.getConfig();
      this.sendJSON(res, 200, this.computer.status(config));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/computer/open") {
      const config = await this.getConfig();
      const body = await readJSON<StudioComputerOpenRequest>(req);
      const result = await this.computer.open(body, config);
      this.emitComputerEvent(body.approved ? null : undefined, result);
      this.sendJSON(res, 200, { result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/computer/action") {
      const config = await this.getConfig();
      const body = await readJSON<StudioComputerActionRequest>(req);
      const result = await this.computer.action(body, config);
      this.emitComputerEvent(body.sessionId ?? null, result);
      this.sendJSON(res, 200, { result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/browser/session") {
      const config = await this.getConfig();
      if (!config.enabledTools.browser) {
        this.sendJSON(res, 403, { error: "Browser tools are disabled in Studio config" });
        return;
      }
      try {
        const body = await readJSON<{ url?: string | null }>(req);
        this.sendJSON(res, 201, { session: await this.browser.createSession(body) });
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/browser/action") {
      const config = await this.getConfig();
      if (!config.enabledTools.browser) {
        this.sendJSON(res, 403, { error: "Browser tools are disabled in Studio config" });
        return;
      }
      try {
        const body = await readJSON<StudioBrowserActionRequest>(req);
        this.sendJSON(res, 200, { result: await this.browser.runAction(body) });
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/agents/kits") {
      try {
        const target = normalizeAgentInstallTarget(url.searchParams.get("target") ?? "all");
        this.sendJSON(res, 200, {
          targets: AGENT_INSTALL_TARGETS,
          projectRoot: this.projectRoot,
          suiteManifest: await planSuiteManifest(this.projectRoot, url.searchParams.get("force") === "true"),
          plans: await planAgentInstall({
            target,
            projectRoot: this.projectRoot,
            dryRun: true,
            force: url.searchParams.get("force") === "true",
            global: url.searchParams.get("global") === "true",
          }),
        });
      } catch (error) {
        this.sendJSON(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/agents/kits/install") {
      try {
        const body = await readJSON<{
          target?: string;
          dryRun?: boolean;
          force?: boolean;
          global?: boolean;
        }>(req);
        this.sendJSON(res, 200, await installAgentKits({
          target: normalizeAgentInstallTarget(body.target),
          projectRoot: this.projectRoot,
          dryRun: Boolean(body.dryRun),
          force: Boolean(body.force),
          global: Boolean(body.global),
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const statusCode = /already exists|already has/i.test(message) ? 409 : 400;
        this.sendJSON(res, statusCode, { error: message });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/logs") {
      this.sendJSON(res, 200, { sessions: this.sessionStore.listSessions() });
      return;
    }

    const logMatch = url.pathname.match(/^\/api\/logs\/([^/]+)$/);
    if (req.method === "GET" && logMatch) {
      const sessionId = decodeURIComponent(logMatch[1]);
      const session = this.sessionStore.getSession(sessionId);
      if (!session) {
        this.sendJSON(res, 404, { error: `Unknown log session: ${sessionId}` });
        return;
      }
      const limit = parseLimit(url.searchParams.get("limit"));
      this.sendJSON(res, 200, { session, events: this.sessionStore.readSessionEvents(sessionId, { limit }) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/automations/templates") {
      this.sendJSON(res, 200, { templates: DESIGN_AUTOMATION_TEMPLATES });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/automations/scheduler/status") {
      this.sendJSON(res, 200, { scheduler: schedulerStatus(this.projectRoot, process.execPath) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/automations/scheduler/install") {
      this.sendJSON(res, 200, { scheduler: await installScheduler(this.projectRoot, process.execPath) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/automations/scheduler/uninstall") {
      this.sendJSON(res, 200, { scheduler: await uninstallScheduler(this.projectRoot, process.execPath) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/automations/run-due") {
      const body = await readJSON<{ now?: string }>(req);
      this.sendJSON(res, 200, { runs: await this.runDueAutomations(body.now) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/automations") {
      this.sendJSON(res, 200, { automations: await this.automations.list() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/automations") {
      try {
        const body = await readJSON<AutomationCreateBody>(req);
        const config = await this.getConfig();
        const cwd = resolve(body.cwd ?? this.projectRoot);
        if (!isInWorkspace(cwd, config.workspaceRoots)) {
          this.sendJSON(res, 403, { error: `Workspace path is not allowed: ${cwd}` });
          return;
        }
        const base = body.templateId
          ? createAutomationFromTemplate({
            templateId: body.templateId,
            cwd,
            timezone: body.timezone ?? "America/Chicago",
            sourceSessionId: body.sourceSessionId ?? null,
          })
          : {};
        const automation = await this.automations.create({
          ...base,
          ...body,
          cwd,
        });
        this.sendJSON(res, 201, { automation });
      } catch (error) {
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 400;
        this.sendJSON(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const automationRunMatch = url.pathname.match(/^\/api\/automations\/([^/]+)\/run$/);
    if (req.method === "POST" && automationRunMatch) {
      try {
        this.sendJSON(res, 200, { run: await this.runAutomation(decodeURIComponent(automationRunMatch[1])) });
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const automationRunsMatch = url.pathname.match(/^\/api\/automations\/([^/]+)\/runs$/);
    if (req.method === "GET" && automationRunsMatch) {
      try {
        const automationId = decodeURIComponent(automationRunsMatch[1]);
        this.sendJSON(res, 200, { runs: await this.automations.listRuns(automationId) });
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const automationMatch = url.pathname.match(/^\/api\/automations\/([^/]+)$/);
    if (automationMatch) {
      const automationId = decodeURIComponent(automationMatch[1]);
      if (req.method === "GET") {
        const automation = await this.automations.get(automationId);
        if (!automation) {
          this.sendJSON(res, 404, { error: `Unknown automation: ${automationId}` });
          return;
        }
        this.sendJSON(res, 200, { automation });
        return;
      }
      if (req.method === "PATCH") {
        try {
          const body = await readJSON<Partial<StudioAutomationDefinition>>(req);
          this.sendJSON(res, 200, { automation: await this.automations.update(automationId, body) });
        } catch (error) {
          this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      if (req.method === "DELETE") {
        this.sendJSON(res, 200, { deleted: await this.automations.delete(automationId) });
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/api/marketplace/notes") {
      this.sendJSON(res, 200, await listMarketplaceNotes(this.projectRoot, {
        refresh: isRefreshRequest(url),
        catalogUrl: url.searchParams.get("catalogUrl"),
        includeRemote: isRefreshRequest(url) || url.searchParams.has("catalogUrl"),
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/marketplace/notes/fork") {
      try {
        const body = await readJSON<{ noteId?: string }>(req);
        const noteId = body.noteId?.trim();
        if (!noteId) throw Object.assign(new Error("noteId is required"), { statusCode: 400 });
        const note = await getMarketplaceNote(this.projectRoot, noteId, { includeRemote: false });
        if (!note) throw Object.assign(new Error(`Unknown marketplace note: ${noteId}`), { statusCode: 404 });
        if (!note.isForkable || note.sourcePath.startsWith("http://") || note.sourcePath.startsWith("https://")) {
          throw Object.assign(new Error(`Marketplace note is not locally forkable yet: ${note.name}`), { statusCode: 400 });
        }
        const fork = await forkNoteDirectory(this.projectRoot, {
          sourcePath: note.sourcePath,
          sourceRepo: note.sourceRepo ?? "https://github.com/memi-design/memi",
          sourcePathInRepo: note.sourcePath.includes("/notes/") ? `notes/${note.name}` : note.sourcePath,
        });
        this.sendJSON(res, 201, {
          fork,
          marketplace: await listMarketplaceNotes(this.projectRoot),
        });
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/marketplace/notes/forks") {
      this.sendJSON(res, 200, { forks: await listNoteForks(this.projectRoot) });
      return;
    }

    const marketplaceForkFilesMatch = url.pathname.match(/^\/api\/marketplace\/notes\/forks\/([^/]+)\/files$/);
    if (marketplaceForkFilesMatch) {
      const forkName = decodeURIComponent(marketplaceForkFilesMatch[1]);
      try {
        if (req.method === "GET") {
          this.sendJSON(res, 200, { files: await getNoteForkFiles(this.projectRoot, forkName) });
          return;
        }
        if (req.method === "PUT") {
          const body = await readJSON<{ path?: string; content?: string }>(req);
          this.sendJSON(res, 200, {
            file: await updateNoteForkFile(this.projectRoot, forkName, {
              path: body.path ?? "",
              content: body.content ?? "",
            }),
          });
          return;
        }
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const marketplaceForkActionMatch = url.pathname.match(/^\/api\/marketplace\/notes\/forks\/([^/]+)\/(diff|validate|export-pr)$/);
    if (marketplaceForkActionMatch) {
      const forkName = decodeURIComponent(marketplaceForkActionMatch[1]);
      const action = marketplaceForkActionMatch[2];
      try {
        if (req.method === "GET" && action === "diff") {
          this.sendJSON(res, 200, { diff: await diffNoteFork(this.projectRoot, forkName) });
          return;
        }
        if (req.method === "POST" && action === "validate") {
          this.sendJSON(res, 200, {
            validation: await validateCommunityNoteDir(join(this.projectRoot, ".memoire", "notes", forkName), {
              strictCommunity: true,
            }),
          });
          return;
        }
        if (req.method === "POST" && action === "export-pr") {
          this.sendJSON(res, 200, { handoff: await buildNoteForkPrHandoff(this.projectRoot, forkName) });
          return;
        }
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const marketplaceNoteMatch = url.pathname.match(/^\/api\/marketplace\/notes\/([^/]+)$/);
    if (req.method === "GET" && marketplaceNoteMatch) {
      const note = await getMarketplaceNote(this.projectRoot, decodeURIComponent(marketplaceNoteMatch[1]), {
        refresh: isRefreshRequest(url),
        catalogUrl: url.searchParams.get("catalogUrl"),
      });
      if (!note) {
        this.sendJSON(res, 404, { error: `Unknown marketplace note: ${decodeURIComponent(marketplaceNoteMatch[1])}` });
        return;
      }
      this.sendJSON(res, 200, { note });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/marketplace/notes/install") {
      try {
        const body = await readJSON<{ noteId?: string; source?: string; version?: string; catalogUrl?: string }>(req);
        const localMarketplace = !body.source && !body.catalogUrl && body.noteId
          ? await listMarketplaceNotes(this.projectRoot)
          : null;
        const localNote = localMarketplace?.notes.find((note) => note.id === body.noteId || note.name === body.noteId);
        const job = await this.downloads.installNoteJob({
          ...body,
          source: body.source ?? (localNote?.source !== "remote-catalog" ? localNote?.sourcePath : undefined),
        });
        this.sendJSON(res, job.status === "failed" ? 500 : 202, {
          job,
          marketplace: await listMarketplaceNotes(this.projectRoot, {
            catalogUrl: body.catalogUrl,
            includeRemote: Boolean(body.catalogUrl),
          }),
        });
      } catch (error) {
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
        this.sendJSON(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/marketplace/notes/update") {
      try {
        const body = await readJSON<{ name?: string; all?: boolean; catalogUrl?: string }>(req);
        if (body.all) {
          const marketplace = await listMarketplaceNotes(this.projectRoot, {
            refresh: true,
            catalogUrl: body.catalogUrl,
            includeRemote: true,
          });
          const jobs = [];
          for (const note of marketplace.notes.filter((candidate) => candidate.source === "remote-catalog" || candidate.installable)) {
            jobs.push(await this.downloads.installNoteJob({ noteId: note.name, catalogUrl: body.catalogUrl }));
          }
          this.sendJSON(res, 202, { jobs });
          return;
        }
        const job = await this.downloads.installNoteJob({ noteId: body.name, catalogUrl: body.catalogUrl });
        this.sendJSON(res, 202, { job });
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/marketplace/notes/remove") {
      try {
        this.sendJSON(res, 200, await removeMarketplaceNote(
          this.projectRoot,
          await readJSON<{ name?: string }>(req),
        ));
      } catch (error) {
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
        this.sendJSON(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/downloads") {
      this.sendJSON(res, 200, { downloads: this.downloads.list() });
      return;
    }

    const downloadEventsMatch = url.pathname.match(/^\/api\/downloads\/([^/]+)\/events$/);
    if (req.method === "GET" && downloadEventsMatch) {
      this.downloads.writeEventsSSE(decodeURIComponent(downloadEventsMatch[1]), res);
      return;
    }

    const downloadMatch = url.pathname.match(/^\/api\/downloads\/([^/]+)$/);
    if (req.method === "GET" && downloadMatch) {
      const download = this.downloads.get(decodeURIComponent(downloadMatch[1]));
      if (!download) {
        this.sendJSON(res, 404, { error: `Unknown download: ${decodeURIComponent(downloadMatch[1])}` });
        return;
      }
      this.sendJSON(res, 200, { download, events: this.downloads.eventsFor(download.id) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/video/status") {
      this.sendJSON(res, 200, { adapters: getVideoAdapterStatus(), projects: await listVideoProjects(this.projectRoot) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/video/projects") {
      this.sendJSON(res, 200, { projects: await listVideoProjects(this.projectRoot) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/video/projects") {
      try {
        const body = await readJSON<{ title?: string; prompt?: string; adapter?: "remotion" | "hyperframes" }>(req);
        const project = await createVideoProject(this.projectRoot, {
          title: body.title ?? "",
          prompt: body.prompt,
          adapter: body.adapter,
        });
        this.sendJSON(res, 201, { project });
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const videoPreviewMatch = url.pathname.match(/^\/api\/video\/projects\/([^/]+)\/preview$/);
    if (req.method === "POST" && videoPreviewMatch) {
      this.sendJSON(res, 200, { result: await previewVideoProject(this.projectRoot, decodeURIComponent(videoPreviewMatch[1])) });
      return;
    }

    const videoRenderMatch = url.pathname.match(/^\/api\/video\/projects\/([^/]+)\/render$/);
    if (req.method === "POST" && videoRenderMatch) {
      this.sendJSON(res, 200, { result: await renderVideoProject(this.projectRoot, decodeURIComponent(videoRenderMatch[1])) });
      return;
    }

    const videoDownloadMatch = url.pathname.match(/^\/api\/video\/projects\/([^/]+)\/download$/);
    if (req.method === "GET" && videoDownloadMatch) {
      try {
        const artifact = await videoDownloadArtifact(this.projectRoot, decodeURIComponent(videoDownloadMatch[1]));
        res.writeHead(200, {
          "content-type": artifact.mimeType,
          "content-disposition": `attachment; filename="${basename(artifact.path)}"`,
        });
        res.end(artifact.bytes);
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/project-memory") {
      this.sendJSON(res, 200, await indexProjectMemory(this.projectRoot));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/knowledge") {
      const index = await listKnowledgeStore(this.projectRoot, { includeGenerated: includesGeneratedKnowledge(url) });
      this.sendJSON(res, 200, wantsCompactKnowledge(url) ? compactKnowledgeIndex(index) : index);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/knowledge/refresh") {
      const index = await refreshKnowledgeStore(this.projectRoot, { includeGenerated: includesGeneratedKnowledge(url) });
      this.sendJSON(res, 200, wantsCompactKnowledge(url) ? compactKnowledgeIndex(index) : index);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/knowledge/capture") {
      try {
        const body = await readJSON<StudioKnowledgeCaptureRequest>(req);
        if (!body.event) throw Object.assign(new Error("Knowledge capture requires an event"), { statusCode: 400 });
        const item = await captureKnowledgeEvent(this.projectRoot, body.event, body.session, body.item);
        this.sendJSON(res, 200, { item });
      } catch (error) {
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
        this.sendJSON(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const knowledgeItemMatch = url.pathname.match(/^\/api\/knowledge\/(.+)$/);
    if (req.method === "GET" && knowledgeItemMatch) {
      const id = decodeURIComponent(knowledgeItemMatch[1]);
      const item = await getKnowledgeItem(this.projectRoot, id);
      if (!item) {
        this.sendJSON(res, 404, { error: `Unknown knowledge item: ${id}` });
        return;
      }
      this.sendJSON(res, 200, { item });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/integrations/mermaid-jam") {
      this.sendJSON(res, 200, {
        integration: await resolveMermaidJamIntegration({ projectRoot: this.projectRoot }),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/integrations/mermaid-jam/open") {
      try {
        const body = await readJSON<{ target?: MermaidJamOpenTarget }>(req);
        const integration = await resolveMermaidJamIntegration({ projectRoot: this.projectRoot });
        this.sendJSON(res, 200, {
          status: "opened",
          result: await openMermaidJamTarget(integration, body.target ?? "community"),
          integration,
        });
      } catch (error) {
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
        this.sendJSON(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/markdown-corpus/status") {
      this.sendJSON(res, 200, await getMarkdownCorpusStatus(this.projectRoot));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/markdown-corpus/setup") {
      try {
        const body = await readJSON<{ catalog?: MarkdownCorpusRepo[] }>(req);
        if (this.markdownCorpusAbort) {
          this.sendJSON(res, 409, { error: "Markdown corpus setup is already running" });
          return;
        }
        const abort = new AbortController();
        this.markdownCorpusAbort = abort;
        req.on("aborted", () => {
          if (!res.writableEnded) abort.abort();
        });
        const status = await setupMarkdownCorpus({ projectRoot: this.projectRoot, catalog: body.catalog, signal: abort.signal });
        this.markdownCorpusAbort = null;
        this.sendJSON(res, 200, status);
      } catch (error) {
        this.markdownCorpusAbort = null;
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
        this.sendJSON(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/markdown-corpus/cancel") {
      this.markdownCorpusAbort?.abort();
      this.sendJSON(res, 200, { cancelled: Boolean(this.markdownCorpusAbort) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/markdown-corpus/analyze") {
      try {
        const body = await readJSON<{ sourcePath?: string; source?: string }>(req);
        this.sendJSON(res, 200, await analyzeMarkdownForFigJam({
          projectRoot: this.projectRoot,
          sourcePath: body.sourcePath,
          source: body.source,
        }));
      } catch (error) {
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
        this.sendJSON(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/markdown-corpus/sync-to-figjam") {
      try {
        const body = await readJSON<{ sourcePath?: string; source?: string }>(req);
        const analysis = await analyzeMarkdownForFigJam({
          projectRoot: this.projectRoot,
          sourcePath: body.sourcePath,
          source: body.source,
        });
        this.sendJSON(res, 200, {
          status: analysis.status,
          candidates: analysis.candidates,
          figjam: await this.figma.syncMarkdownToFigJam(analysis),
        });
      } catch (error) {
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
        this.sendJSON(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/project-memory/refresh") {
      this.sendJSON(res, 200, await refreshProjectMemory(this.projectRoot));
      return;
    }

    const memoryItemMatch = url.pathname.match(/^\/api\/project-memory\/(.+)$/);
    if (req.method === "GET" && memoryItemMatch) {
      const index = await indexProjectMemory(this.projectRoot);
      const id = decodeURIComponent(memoryItemMatch[1]);
      const item = index.items.find((candidate) => candidate.id === id);
      if (!item) {
        this.sendJSON(res, 404, { error: `Unknown project memory item: ${id}` });
        return;
      }
      this.sendJSON(res, 200, { item });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/figma/status") {
      this.sendJSON(res, 200, await this.figma.status());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/figma/connect") {
      const body = await readJSON<{ preferredPort?: number | null }>(req);
      this.sendJSON(res, 200, await this.figma.connect({ preferredPort: body.preferredPort ?? null }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/figma/disconnect") {
      this.sendJSON(res, 200, await this.figma.disconnect());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/figma/open") {
      const body = await readJSON<StudioFigmaOpenRequest>(req);
      this.sendJSON(res, 200, await this.figma.openFigma(body));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/figma/action") {
      const body = await readJSON<StudioFigmaActionRequest>(req);
      try {
        this.sendJSON(res, 200, await this.figma.runAction(body));
      } catch (error) {
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
        this.sendJSON(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      this.sendJSON(res, 200, { config: await this.getConfig() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/design-system/trace") {
      this.sendJSON(res, 200, { trace: await collectDesignSystemTrace(this.projectRoot) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/design-changelog") {
      if (url.searchParams.get("format") === "markdown") {
        res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
        res.end(await exportDesignChangelogMarkdown(this.projectRoot));
        return;
      }
      this.sendJSON(res, 200, { entries: await listDesignChangelogEntries(this.projectRoot) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/design-changelog") {
      try {
        this.sendJSON(res, 200, { entry: await createDesignChangelogEntry(this.projectRoot, await readJSON(req)) });
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/design-changelog/capture") {
      try {
        const body = await readJSON<DesignChangelogCaptureRequest>(req);
        this.sendJSON(res, 200, await captureDesignChangelogEntry(this.projectRoot, body));
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const designChangelogRestoreMatch = url.pathname.match(/^\/api\/design-changelog\/([^/]+)\/restore$/);
    if (req.method === "POST" && designChangelogRestoreMatch) {
      try {
        this.sendJSON(res, 200, { entry: await restoreDesignChangelogEntry(this.projectRoot, decodeURIComponent(designChangelogRestoreMatch[1])) });
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const designChangelogMatch = url.pathname.match(/^\/api\/design-changelog\/([^/]+)$/);
    if (designChangelogMatch && req.method === "PATCH") {
      try {
        this.sendJSON(res, 200, {
          entry: await updateDesignChangelogEntry(this.projectRoot, decodeURIComponent(designChangelogMatch[1]), await readJSON(req)),
        });
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (designChangelogMatch && req.method === "DELETE") {
      try {
        this.sendJSON(res, 200, { entry: await archiveDesignChangelogEntry(this.projectRoot, decodeURIComponent(designChangelogMatch[1])) });
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/design-system/assets") {
      const asset = await readResolvedAsset(this.projectRoot, url.searchParams.get("path") ?? "");
      if (!asset) {
        this.sendJSON(res, 404, { error: "Asset not found or not allowed" });
        return;
      }
      res.writeHead(200, { "content-type": asset.mimeType });
      res.end(asset.bytes);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/attachments/capture") {
      try {
        const body = await readJSON<StudioAttachmentCaptureRequest>(req);
        this.sendJSON(res, 200, { attachment: await captureStudioAttachment(this.projectRoot, body) });
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const attachmentMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)$/);
    if (req.method === "GET" && attachmentMatch) {
      const attachment = await getStudioAttachment(this.projectRoot, decodeURIComponent(attachmentMatch[1]));
      if (!attachment) {
        this.sendJSON(res, 404, { error: `Unknown attachment: ${decodeURIComponent(attachmentMatch[1])}` });
        return;
      }
      if (url.searchParams.get("raw") === "1" && attachment.path) {
        res.writeHead(200, { "content-type": attachment.mimeType || "application/octet-stream" });
        res.end(await readFile(attachment.path));
        return;
      }
      this.sendJSON(res, 200, { attachment });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/artifacts") {
      this.sendJSON(res, 200, { artifacts: await listDesignSystemArtifacts(this.projectRoot) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/artifacts/capture") {
      try {
        const body = await readJSON<StudioDesignSystemArtifactCaptureRequest>(req);
        this.sendJSON(res, 200, { artifact: await captureDesignSystemArtifact(this.projectRoot, body) });
      } catch (error) {
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
        this.sendJSON(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const artifactSectionReviewMatch = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/sections\/([^/]+)\/review$/);
    if (req.method === "PATCH" && artifactSectionReviewMatch) {
      try {
        const body = await readJSON<StudioDesignSystemArtifactReviewPatch>(req);
        this.sendJSON(res, 200, {
          artifact: await updateDesignSystemArtifactSectionReview(
            this.projectRoot,
            decodeURIComponent(artifactSectionReviewMatch[1]),
            decodeURIComponent(artifactSectionReviewMatch[2]),
            body,
          ),
        });
      } catch (error) {
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
        this.sendJSON(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const artifactMatch = url.pathname.match(/^\/api\/artifacts\/([^/]+)$/);
    if (req.method === "GET" && artifactMatch) {
      const artifact = await getDesignSystemArtifact(this.projectRoot, decodeURIComponent(artifactMatch[1]));
      if (!artifact) {
        this.sendJSON(res, 404, { error: `Unknown artifact: ${decodeURIComponent(artifactMatch[1])}` });
        return;
      }
      this.sendJSON(res, 200, { artifact });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/design-audit/run") {
      try {
        const body = await readJSON<{ maxFiles?: number }>(req);
        this.sendJSON(res, 200, await runDesignAudit(this.projectRoot, { maxFiles: body.maxFiles }));
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/design-audit/latest") {
      const result = await getLatestDesignAudit(this.projectRoot);
      if (!result) {
        this.sendJSON(res, 404, { error: "No design audit has been run yet." });
        return;
      }
      this.sendJSON(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/design-audit/accept-baseline") {
      try {
        this.sendJSON(res, 200, { baseline: await acceptDesignAuditBaseline(this.projectRoot) });
      } catch (error) {
        this.sendJSON(res, statusCodeFromUnknown(error), { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/config") {
      const body = await readJSON<StudioConfig>(req);
      await saveStudioConfig(this.projectRoot, body);
      this.config = await loadStudioConfig(this.projectRoot);
      this.harnessSnapshot = null;
      clearHarnessProbeCaches();
      this.sendJSON(res, 200, { config: this.config });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/sessions") {
      this.sendJSON(res, 200, { sessions: this.listSessionSummaries() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sessions") {
      const body = await readJSON<{ harness?: StudioHarnessId; cwd?: string; prompt?: string; action?: StudioRunAction; mode?: StudioSessionMode; chatMode?: StudioChatMode; permissionMode?: StudioPermissionMode; attachments?: StudioAttachment[]; conversationId?: string; goal?: string; model?: string | null; effort?: string | null }>(req);
      try {
        const session = await this.startSession({
          harness: body.harness ?? (await this.getConfig()).defaultHarness,
          cwd: body.cwd ?? this.projectRoot,
          prompt: body.prompt ?? "",
          action: body.action,
          mode: body.mode,
          chatMode: body.chatMode,
          permissionMode: body.permissionMode,
          attachments: body.attachments,
          conversationId: body.conversationId,
          goal: body.goal,
          model: body.model,
          effort: body.effort,
        });
        this.sendJSON(res, 201, { session: summarySession(session, "live") });
      } catch (error) {
        const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
        this.sendJSON(res, statusCode, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const sessionEventsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
    if (req.method === "GET" && sessionEventsMatch) {
      const sessionId = decodeURIComponent(sessionEventsMatch[1]);
      const wantsSSE = req.headers.accept?.includes("text/event-stream") && !url.searchParams.has("limit");
      if (wantsSSE) {
        this.handleSessionEvents(sessionId, res);
      } else {
        const record = this.readSessionRecord(sessionId, parseLimit(url.searchParams.get("limit")));
        if (!record) {
          this.sendJSON(res, 404, { error: `Unknown session: ${sessionId}` });
          return;
        }
        this.sendJSON(res, 200, record);
      }
      return;
    }

    const sessionTraceMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/trace$/);
    if (req.method === "GET" && sessionTraceMatch) {
      const sessionId = decodeURIComponent(sessionTraceMatch[1]);
      const record = this.readSessionRecord(sessionId);
      if (!record) {
        this.sendJSON(res, 404, { error: `Unknown session: ${sessionId}` });
        return;
      }
      this.sendJSON(res, 200, {
        session: record.session,
        trace: createStudioTraceSnapshot({
          session: record.session,
          events: record.events,
          source: record.session.source,
        }),
      });
      return;
    }

    const sessionCancelMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/cancel$/);
    if (req.method === "POST" && sessionCancelMatch) {
      this.sendJSON(res, 200, { cancelled: this.cancelSession(sessionCancelMatch[1]) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workspace") {
      await this.handleWorkspace(url, res);
      return;
    }

    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      await this.serveStudioAsset(url.pathname, res);
      return;
    }

    this.sendJSON(res, 404, { error: "Not found" });
  }

  async runDueAutomations(now?: string): Promise<StudioAutomationRun[]> {
    const due = await this.automations.claimDue(now ?? new Date().toISOString());
    const runs: StudioAutomationRun[] = [];
    for (const automation of due) {
      runs.push(await this.runAutomation(automation.id, automation));
    }
    return runs;
  }

  async runAutomation(id: string, loaded?: StudioAutomationDefinition): Promise<StudioAutomationRun> {
    const automation = loaded ?? await this.automations.get(id);
    if (!automation) throw Object.assign(new Error(`Unknown automation: ${id}`), { statusCode: 404 });
    const config = await this.getConfig();
    if (!isInWorkspace(automation.cwd, config.workspaceRoots)) {
      throw Object.assign(new Error(`Workspace path is not allowed: ${automation.cwd}`), { statusCode: 403 });
    }
    const startedAt = new Date().toISOString();
    const run: StudioAutomationRun = {
      id: `automation-run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      automationId: automation.id,
      sessionId: null,
      status: "running",
      startedAt,
      completedAt: null,
      error: null,
    };
    try {
      const session = await this.startSession({
        harness: automation.harness,
        cwd: automation.cwd,
        prompt: buildAutomationPrompt(automation, config),
        action: automation.action,
        chatMode: automation.chatMode,
        permissionMode: automation.permissionMode,
        codex: automation.codex,
      });
      run.sessionId = session.id;
      const completedSession = await this.waitForSessionCompletion(session.id);
      run.status = completedSession.status === "completed" ? "completed" : "failed";
      run.completedAt = completedSession.completedAt ?? new Date().toISOString();
      run.error = completedSession.status === "failed" ? `Session exited with code ${completedSession.exitCode ?? "unknown"}` : null;
      await this.automations.appendRun(automation.id, run);
      return run;
    } catch (error) {
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      run.error = error instanceof Error ? error.message : String(error);
      await this.automations.appendRun(automation.id, run);
      return run;
    }
  }

  private async waitForSessionCompletion(sessionId: string): Promise<StudioSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw Object.assign(new Error(`Unknown session: ${sessionId}`), { statusCode: 404 });
    if (session.status !== "running") return session;
    return new Promise((resolveSession) => {
      const timer = setInterval(() => {
        const current = this.sessions.get(sessionId) ?? session;
        if (current.status !== "running") {
          clearInterval(timer);
          resolveSession(current);
        }
      }, 100);
    });
  }

  private async handleWorkspace(url: URL, res: ServerResponse): Promise<void> {
    const config = await this.getConfig();
    const requested = resolve(url.searchParams.get("path") ?? this.projectRoot);
    if (!isInWorkspace(requested, config.workspaceRoots)) {
      this.sendJSON(res, 403, { error: `Workspace path is not allowed: ${requested}` });
      return;
    }
    const itemStat = await stat(requested);
    if (!itemStat.isDirectory()) {
      this.sendJSON(res, 200, {
        path: requested,
        type: "file",
        name: basename(requested),
        content: await readFile(requested, "utf-8"),
      });
      return;
    }
    const entries = await readdir(requested, { withFileTypes: true });
    this.sendJSON(res, 200, {
      path: requested,
      type: "directory",
      entries: entries
        .filter((entry) => !entry.name.startsWith(".git") && entry.name !== "node_modules")
        .slice(0, 200)
        .map((entry) => ({
          name: entry.name,
          path: join(requested, entry.name),
          type: entry.isDirectory() ? "directory" : "file",
        })),
    });
  }

  private async serveStudioAsset(pathname: string, res: ServerResponse): Promise<void> {
    const appRoot = resolveStudioAssetRoot(this.projectRoot);
    const path = pathname === "/" ? "/index.html" : pathname;
    const filePath = resolve(appRoot, `.${path}`);
    if (!isSubpath(filePath, appRoot)) {
      this.sendJSON(res, 403, { error: "Asset path is not allowed" });
      return;
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": contentTypeFor(filePath) });
      res.end(body);
    } catch {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(defaultStudioHTML(this.runtimeInfo().url));
    }
  }

  private handleSessionEvents(sessionId: string, res: ServerResponse): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendJSON(res, 404, { error: `Unknown session: ${sessionId}` });
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    for (const event of session.events) writeSSE(res, event);
    const client = { sessionId, res };
    this.clients.add(client);
    res.on("close", () => this.clients.delete(client));
  }

  private listSessionSummaries(): StudioSessionSummary[] {
    const live = Array.from(this.sessions.values()).map((session) => summarySession(session, "live"));
    const liveIds = new Set(live.map((session) => session.id));
    const persisted = this.sessionStore
      .listSessions()
      .filter((session) => !liveIds.has(session.id))
      .map((session) => ({ ...session, source: "persisted" as const }));
    return [...live, ...persisted];
  }

  private nextConversationTurnIndex(conversationId: string): number {
    const liveCount = Array.from(this.sessions.values())
      .filter((session) => (session.conversationId ?? session.id) === conversationId)
      .length;
    const persistedIds = new Set(this.sessions.keys());
    const persistedCount = this.sessionStore
      .listSessions()
      .filter((session) => !persistedIds.has(session.id))
      .filter((session) => (session.conversationId ?? session.id) === conversationId)
      .length;
    return liveCount + persistedCount;
  }

  private async listHarnessSnapshot(forceRefresh = false): Promise<StudioHarnessStatus[]> {
    const now = Date.now();
    if (!forceRefresh && this.harnessSnapshot && now - this.harnessSnapshot.checkedAt < this.harnessSnapshotTtlMs) {
      return this.harnessSnapshot.harnesses;
    }
    if (forceRefresh) clearHarnessProbeCaches();
    const harnesses = listHarnesses(await this.getConfig(), { forceRefresh });
    this.harnessSnapshot = { harnesses, checkedAt: now };
    return harnesses;
  }

  private async compatibilitySnapshot(forceRefresh = false) {
    const config = await this.getConfig();
    const [figma, browser] = await Promise.all([
      this.figma.status(),
      this.browser.status(config.enabledTools.browser),
    ]);
    return createStudioCompatibilitySnapshot({
      config,
      harnesses: await this.listHarnessSnapshot(forceRefresh),
      browser,
      figma,
      computer: this.computer.status(config),
    });
  }

  private emitComputerEvent(sessionId: string | null | undefined, result: { status: string; action: string; message: string; artifactPath?: string | null }): void {
    if (!sessionId) return;
    if (!this.sessions.has(sessionId)) return;
    const type: StudioEventType = result.status === "completed"
      ? "computer_action_completed"
      : result.status === "approval_required"
        ? "approval_request"
        : "computer_action_failed";
    this.addEvent(sessionId, type, result.message, result);
    if (result.status === "completed" && result.action === "captureScreen" && result.artifactPath) {
      this.addEvent(sessionId, "screenshot", "Captured screen", {
        artifactPath: result.artifactPath,
        source: "computer",
      });
    }
  }

  private readSessionRecord(sessionId: string, limit?: number): {
    session: StudioSessionSummary;
    events: StudioEvent[];
  } | null {
    const live = this.sessions.get(sessionId);
    if (live) {
      const persistedEvents = this.sessionStore.readSessionEvents(sessionId, { limit });
      const events = persistedEvents.length > 0
        ? persistedEvents
        : limit && limit > 0
          ? live.events.slice(-limit)
          : live.events;
      return { session: summarySession(live, "live"), events };
    }
    const persisted = this.sessionStore.getSession(sessionId);
    if (!persisted) return null;
    return {
      session: { ...persisted, source: "persisted" },
      events: this.sessionStore.readSessionEvents(sessionId, { limit }),
    };
  }

  private addEvent(sessionId: string, type: StudioEventType, message: string, data?: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const event: StudioEvent = {
      id: randomUUID(),
      sessionId,
      type,
      timestamp: new Date().toISOString(),
      message,
      data,
    };
    session.events.push(event);
    if (session.events.length > this.maxInMemoryEvents) session.events.splice(0, session.events.length - this.maxInMemoryEvents);
    this.eventBufferSize = Math.min(200_000, this.eventBufferSize + event.message.length);
    this.sessionStore.appendEvent(session, event);
    const providerEvent = this.providerRuntimeEventFromStudioEvent(session, event);
    if (providerEvent) {
      this.publishProviderEvent(providerEvent);
      if (providerEvent.type === "session.created") {
        this.publishProviderEvent(this.modelSelectionEvent(session, providerEvent));
      }
    }
    if (shouldCaptureKnowledgeEvent(event)) {
      void captureKnowledgeEvent(this.projectRoot, event, {
        harness: session.harness,
        action: session.action,
      }).catch(() => undefined);
    }
    if (shouldCaptureDesignSystemArtifactEvent(event)) {
      void captureDesignSystemArtifact(this.projectRoot, {
        session: {
          id: session.id,
          harness: session.harness,
          action: session.action,
          cwd: session.cwd,
        },
        events: this.sessionStore.readSessionEvents(sessionId),
      }).catch(() => undefined);
    }
    if (event.type === "session_done" || event.type === "session_result") {
      void captureDesignChangelogEntry(this.projectRoot, {
        session: {
          id: session.id,
          harness: session.harness,
          action: session.action,
          cwd: session.cwd,
          prompt: session.prompt,
        },
        events: this.sessionStore.readSessionEvents(sessionId),
      }).catch(() => undefined);
    }
    for (const client of this.clients) {
      if (client.sessionId === sessionId) writeSSE(client.res, sanitizeStudioEvent(event));
    }
  }

  private publishProviderEvent(event: ProviderRuntimeEvent): void {
    const publishable = sanitizeRuntimeEvent(event);
    void this.eventJournal.append(publishable.sessionId, publishable).catch(() => undefined);
    this.providerEventBus.publish(publishable);
    void exportRuntimeEvent(publishable, this.telemetrySink).catch(() => undefined);
  }

  private providerRuntimeEventFromStudioEvent(session: StudioSession, event: StudioEvent): ProviderRuntimeEvent | null {
    const trace = this.providerTraceContextForStudioEvent(session.id, event);
    const base = {
      schemaVersion: 1 as const,
      eventId: providerRuntimeId("EventId", event.id),
      seq: this.nextProviderEventSeq(session.id),
      harnessId: asId("HarnessId", `hns_${session.harness}`),
      providerInstanceId: asId("ProviderInstanceId", `prv_${session.id}`),
      sessionId: providerRuntimeId("SessionId", session.id),
      createdAt: event.timestamp,
      trace,
      contentTrust: contentTrustForStudioEvent(event.type),
    };
    const message = redactSecrets(event.message ?? "");

    if (event.type === "session_started") {
      return {
        ...base,
        type: "session.created",
        harnessConfigSummary: {
          harness: base.harnessId,
          model: this.resolvedSessionModel(session),
          effort: session.effort ?? undefined,
        },
      };
    }
    if (event.type === "chat_message") return { ...base, type: "message.user", text: message };
    if (event.type === "reasoning") return { ...base, type: "reasoning.complete", text: message };
    if (event.type === "tool_call") {
      const data = isRecord(event.data) ? event.data : {};
      return {
        ...base,
        type: "tool.call.started",
        toolCallId: providerRuntimeId("ToolCallId", data.id ?? data.callId),
        tool: String(data.name ?? data.tool ?? data.toolId ?? (message || "tool")),
        args: data.input ?? data.args ?? data,
      };
    }
    if (event.type === "tool_result") {
      const data = isRecord(event.data) ? event.data : {};
      return {
        ...base,
        type: "tool.call.completed",
        toolCallId: providerRuntimeId("ToolCallId", data.id ?? data.callId ?? data.toolUseId),
        ok: data.ok !== false,
        result: data.output ?? data.result ?? message,
        error: typeof data.error === "string" ? data.error : undefined,
        elapsedMs: numberField(data.elapsedMs) ?? 0,
      };
    }
    if (event.type === "token_usage") {
      const data = isRecord(event.data) ? event.data : {};
      return {
        ...base,
        type: "usage.updated",
        inputTokens: numberField(data.inputTokens) ?? numberField(data.input_tokens) ?? 0,
        outputTokens: numberField(data.outputTokens) ?? numberField(data.output_tokens) ?? 0,
        reasoningTokens: numberField(data.reasoningTokens) ?? numberField(data.reasoning_tokens) ?? undefined,
        estimatedCostUsd: numberField(data.estimatedCostUsd) ?? numberField(data.estimated_cost_usd) ?? undefined,
      };
    }
    if (event.type === "session_done") {
      return { ...base, type: "turn.completed", outcome: session.status === "cancelled" ? "cancelled" : "success" };
    }
    if (event.type === "session_error" || event.type === "stderr") {
      return { ...base, type: "diagnostic.error", message, data: event.data };
    }
    if (event.type === "stdout" || event.type === "harness_log" || event.type === "package_log") {
      return { ...base, type: "diagnostic.warn", message, data: event.data };
    }
    return null;
  }

  private modelSelectionEvent(
    session: StudioSession,
    created: Extract<ProviderRuntimeEvent, { type: "session.created" }>,
  ): Extract<ProviderRuntimeEvent, { type: "model.selected" }> {
    const harness = this.config?.harnesses.find((candidate) => candidate.id === session.harness);
    const resolvedModel = this.resolvedSessionModel(session);
    return {
      schemaVersion: 1,
      eventId: providerRuntimeId("EventId", `model-${session.id}`),
      seq: this.nextProviderEventSeq(session.id),
      harnessId: created.harnessId,
      providerInstanceId: created.providerInstanceId,
      sessionId: created.sessionId,
      createdAt: created.createdAt,
      trace: createChildTraceContext(this.providerTraceContext(session.id)),
      contentTrust: "trusted",
      type: "model.selected",
      providerId: harness?.provider ?? session.harness,
      requestedModel: session.model ?? undefined,
      resolvedModel,
      reason: session.model ? "requested" : "default",
      capabilities: [...(harness?.capabilities ?? [])],
    };
  }

  private resolvedSessionModel(session: StudioSession): string {
    const harness = this.config?.harnesses.find((candidate) => candidate.id === session.harness);
    return session.model
      ?? harness?.defaultModel
      ?? `${harness?.provider ?? session.harness}-default`;
  }

  private providerTraceContext(sessionId: string): RuntimeTraceContext {
    const current = this.providerTraceContexts.get(sessionId);
    if (current) return current;
    const created = createRuntimeTraceContext({ runId: `run_${sessionId.replace(/[^A-Za-z0-9_-]/g, "")}` });
    this.providerTraceContexts.set(sessionId, created);
    return created;
  }

  private providerTraceContextForStudioEvent(
    sessionId: string,
    event: StudioEvent,
  ): RuntimeTraceContext {
    const root = this.providerTraceContext(sessionId);
    if (event.type === "session_started") return root;
    if (event.type === "tool_call") {
      const data = isRecord(event.data) ? event.data : {};
      const callId = String(data.callId ?? data.id ?? event.id);
      const trace = createChildTraceContext(root);
      this.providerToolTraceContexts.set(`${sessionId}:${callId}`, trace);
      return trace;
    }
    if (event.type === "tool_result") {
      const data = isRecord(event.data) ? event.data : {};
      const callId = String(data.callId ?? data.id ?? data.toolUseId ?? event.id);
      const key = `${sessionId}:${callId}`;
      const trace = this.providerToolTraceContexts.get(key) ?? createChildTraceContext(root);
      this.providerToolTraceContexts.delete(key);
      return trace;
    }
    return createChildTraceContext(root);
  }

  private nextProviderEventSeq(sessionId: string): number {
    const next = (this.providerEventSeq.get(sessionId) ?? 0) + 1;
    this.providerEventSeq.set(sessionId, next);
    return next;
  }

  private emitToolCallEvents(request: StudioToolCallRequest, call: StudioToolCallResult): void {
    if (!request.sessionId || !this.sessions.has(request.sessionId)) return;
    this.addEvent(request.sessionId, "tool_call", request.toolId, {
      callId: call.id,
      input: request.input ?? {},
      approved: Boolean(request.approved),
    });
    if (call.status === "approval_required") {
      this.addEvent(request.sessionId, "approval_request", call.error ?? "Approval required", {
        callId: call.id,
        approval: call.approval,
      });
      return;
    }
    this.addEvent(request.sessionId, call.status === "completed" ? "tool_result" : "session_error", call.error ?? request.toolId, {
      callId: call.id,
      result: call.data,
      artifactPath: call.artifactPath,
    });
    const designArtifact = isRecord(call.data) && isRecord(call.data.designSystemArtifact)
      ? call.data.designSystemArtifact
      : null;
    if (call.status === "completed" && designArtifact) {
      this.addEvent(request.sessionId, "design_system_artifact", "UX Tenets and Traps audit", designArtifact);
    }
  }

  private async getConfig(): Promise<StudioConfig> {
    if (!this.config) this.config = await loadStudioConfig(this.projectRoot);
    return this.config;
  }

  private async buildAgentContext(input: {
    harness: StudioHarnessId;
    action: StudioRunAction;
    mode: StudioSessionMode;
    chatMode: StudioChatMode;
    permissionMode: StudioPermissionMode;
    cwd: string;
    prompt: string;
    conversationId?: string;
    turnIndex?: number;
    goal?: string;
    model?: string | null;
    effort?: string | null;
    config: StudioConfig;
  }): Promise<StudioAgentContext> {
    const [memory, knowledge, figmaStatus, researchDesign] = await Promise.all([
      indexProjectMemory(this.projectRoot).catch(() => null),
      listKnowledgeStore(this.projectRoot).catch(() => null),
      this.figma.status().catch(() => null),
      this.buildResearchDesignAgentContext().catch(() => null),
    ]);
    return {
      workspaceLabel: "Memoire workspace",
      projectRoot: this.projectRoot,
      conversationId: input.conversationId,
      turnIndex: input.turnIndex,
      goal: input.goal,
      model: input.model,
      effort: input.effort,
      harness: input.harness,
      action: input.action,
      mode: input.mode,
      chatMode: input.chatMode,
      permissionMode: input.permissionMode,
      codex: input.config.codex,
      prompt: input.prompt,
      memory: {
        counts: memory?.counts ?? { home: 0, research: 0, spec: 0, system: 0, monitor: 0, changelog: 0 },
        recent: (memory?.items ?? []).slice(0, 8).map((item) => ({
          kind: item.kind,
          title: item.title,
          summary: item.summary,
          sourcePath: item.sourcePath,
        })),
      },
      figma: {
        enabled: input.config.enabledTools.figma,
        status: figmaStatus?.connectionState ?? "disconnected",
        clients: figmaStatus?.clients.length ?? 0,
        port: figmaStatus?.port ?? input.config.figma?.preferredPort ?? null,
      },
      knowledge: {
        counts: knowledge?.counts ?? {},
        recent: (knowledge?.items ?? []).slice(0, 8).map((item) => ({
          kind: item.kind,
          title: item.title,
          summary: item.summary,
          sourcePath: item.sourcePath,
        })),
      },
      researchDesign: researchDesign ?? {
        personas: [],
        findings: [],
        risks: [],
        metrics: [],
        latestSimulationRunId: null,
        suggestedTools: ["research_design_package", "research_generate_specs", "mermaid_jam_export"],
      },
    };
  }

  private async buildResearchDesignAgentContext(): Promise<StudioAgentContext["researchDesign"]> {
    let research: ResearchStore | null = null;
    try {
      research = JSON.parse(await readFile(join(this.projectRoot, "research", "store.v2.json"), "utf-8")) as ResearchStore;
    } catch {
      research = null;
    }
    const runs = await new FileSimulationStore(this.projectRoot).listRuns();
    const latestRun = runs
      .slice()
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ?? null;
    return {
      personas: (research?.personas ?? []).slice(0, 3).map((persona) => compactResearchContext(`${persona.name}${persona.role ? ` (${persona.role})` : ""}`)),
      findings: (research?.findings ?? []).slice(0, 5).map((finding) => compactResearchContext(`${finding.id}: ${finding.statement}`)),
      risks: (research?.risks ?? []).slice(0, 4).map((risk) => compactResearchContext(`${risk.title}: ${risk.summary}`)),
      metrics: (research?.quantitativeMetrics ?? []).slice(0, 4).map((metric) => compactResearchContext(`${metric.label || metric.field}: ${metric.mean ?? "n/a"}`)),
      latestSimulationRunId: latestRun?.id ?? null,
      suggestedTools: ["research_design_package", "research_generate_specs", "mermaid_jam_export"],
    };
  }

  private runtimeInfo(): StudioRuntimeInfo {
    if (!this.server) throw new Error("Studio runtime is not running");
    const address = this.server.address();
    const port = typeof address === "object" && address ? address.port : this.requestedPort;
    return { host: this.host, port, url: `http://${this.host}:${port}` };
  }

  private metrics(config: StudioConfig) {
    return {
      uptimeMs: Math.max(0, Date.now() - this.startedAt),
      indexedSessions: this.sessionStore.indexedSessionCount,
      activeProcesses: this.processes.size,
      activeStreams: this.activeStreams.size,
      eventBufferSize: this.eventBufferSize,
      harnessProbeCacheAgeMs: harnessProbeCacheAgeMs(),
      enabledHarnesses: config.harnesses.filter((harness) => harness.enabled).length,
      catalogCacheAgeMs: studioCatalogCache.ageMs,
      downloads: this.downloads.metrics(),
    };
  }

  private async usageSnapshot() {
    const config = await this.getConfig();
    const emptyTotals = () => ({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 0,
    });
    const totals = emptyTotals();
    const byHarness: Record<string, ReturnType<typeof emptyTotals>> = {};
    const byProvider: Record<string, ReturnType<typeof emptyTotals>> = {};
    const sessions = this.listSessionSummaries().map((session) => {
      const sessionTotals = emptyTotals();
      for (const event of this.readSessionRecord(session.id)?.events ?? []) {
        if (event.type !== "token_usage" || !event.data || typeof event.data !== "object") continue;
        const data = event.data as Record<string, unknown>;
        sessionTotals.inputTokens += numberField(data.inputTokens) ?? numberField(data.input_tokens) ?? 0;
        sessionTotals.outputTokens += numberField(data.outputTokens) ?? numberField(data.output_tokens) ?? 0;
        sessionTotals.cachedInputTokens += numberField(data.cachedInputTokens) ?? numberField(data.cached_input_tokens) ?? 0;
        sessionTotals.reasoningTokens += numberField(data.reasoningTokens) ?? numberField(data.reasoning_tokens) ?? 0;
        sessionTotals.estimatedCostUsd += numberField(data.estimatedCostUsd) ?? numberField(data.estimated_cost_usd) ?? 0;
      }
      sessionTotals.totalTokens = sessionTotals.inputTokens + sessionTotals.outputTokens + sessionTotals.reasoningTokens;
      addUsageTotals(totals, sessionTotals);
      const provider = usageProviderForHarness(session.harness as StudioHarnessId);
      byHarness[session.harness] ??= emptyTotals();
      byProvider[provider] ??= emptyTotals();
      addUsageTotals(byHarness[session.harness], sessionTotals);
      addUsageTotals(byProvider[provider], sessionTotals);
      return {
        id: session.id,
        harness: session.harness,
        provider,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt ?? null,
        totals: sessionTotals,
      };
    });
    return {
      generatedAt: new Date().toISOString(),
      sessions,
      totals,
      byHarness,
      byProvider,
      rateLimits: [],
      budgets: config.usageBudgets,
    };
  }

  private setBaseHeaders(res: ServerResponse): void {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("x-content-type-options", "nosniff");
  }

  private sendJSON(res: ServerResponse, statusCode: number, payload: unknown): void {
    res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload, null, 2));
  }
}

async function readJSON<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw.trim()) return {} as T;
  return JSON.parse(raw) as T;
}

function writeSSE(res: ServerResponse, event: StudioEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function statusCodeFromUnknown(error: unknown): number {
  const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : 500;
  return statusCode;
}

function statusCodeForError(error: string | undefined): number {
  if (!error) return 500;
  if (/not found|unknown/i.test(error)) return 404;
  if (/not allowed|disabled|workspace/i.test(error)) return 403;
  if (/requires|invalid/i.test(error)) return 400;
  if (/unavailable|not installed/i.test(error)) return 501;
  return 500;
}

function isInWorkspace(path: string, roots: string[]): boolean {
  return roots.some((root) => isSubpath(path, root));
}

function isRefreshRequest(url: URL): boolean {
  return url.searchParams.get("refresh") === "1" || url.searchParams.get("refresh") === "true";
}

function wantsCompactKnowledge(url: URL): boolean {
  return url.searchParams.get("detail") === "compact";
}

function includesGeneratedKnowledge(url: URL): boolean {
  return url.searchParams.get("includeGenerated") === "1" || url.searchParams.get("includeGenerated") === "true";
}

function isSubpath(path: string, root: string): boolean {
  const normalizedPath = canonicalPath(path);
  const normalizedRoot = canonicalPath(root);
  const rel = relative(normalizedRoot, normalizedPath);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`) && rel !== "..");
}

function canonicalPath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function addUsageTotals(
  target: { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens: number; reasoningTokens: number; estimatedCostUsd: number },
  source: { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens: number; reasoningTokens: number; estimatedCostUsd: number },
): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.totalTokens += source.totalTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.reasoningTokens += source.reasoningTokens;
  target.estimatedCostUsd += source.estimatedCostUsd;
}

function usageProviderForHarness(harness: StudioHarnessId): StudioUsageProviderId {
  if (harness === "codex" || harness === "opencode") return "openai";
  if (harness === "claude-code") return "anthropic";
  if (harness === "gemini") return "google";
  if (harness === "ollama") return "local";
  if (harness === "shell") return "shell";
  return "memoire";
}

function contentTrustForStudioEvent(
  type: StudioEventType,
): "trusted" | "user" | "tool_untrusted" | "web_untrusted" | "model_generated" {
  if (type === "chat_message") return "user";
  if (type === "reasoning") return "model_generated";

  if (
    type === "stdout" ||
    type === "stderr" ||
    type === "terminal_output" ||
    type === "tool_call" ||
    type === "tool_result" ||
    type === "harness_log" ||
    type === "package_log" ||
    type === "mcp_call"
  ) {
    return "tool_untrusted";
  }

  return "trusted";
}

function normalizeRpcRequestSessionId(body: unknown): unknown {
  if (!isRecord(body) || typeof body.sessionId !== "string") return body;
  return { ...body, sessionId: providerRuntimeId("SessionId", body.sessionId) };
}

function studioSessionKeyFromProviderSessionId(sessionId: string): string {
  return sessionId.startsWith("ses_") ? sessionId.slice("ses_".length) : sessionId;
}

const RUNTIME_ID_PREFIXES = {
  EventId: "evt",
  SessionId: "ses",
  ToolCallId: "tcl",
} as const;

function providerRuntimeId<K extends keyof typeof RUNTIME_ID_PREFIXES>(kind: K, raw: unknown): ReturnType<typeof makeId<K>> {
  const prefix = RUNTIME_ID_PREFIXES[kind];
  if (typeof raw === "string" && raw.startsWith(`${prefix}_`)) {
    return asId(kind, raw) as ReturnType<typeof makeId<K>>;
  }
  if (typeof raw !== "string" || !raw.trim()) return makeId(kind);
  return asId(kind, `${prefix}_${safeRuntimeIdSuffix(raw)}`) as ReturnType<typeof makeId<K>>;
}

function safeRuntimeIdSuffix(raw: string): string {
  const suffix = raw.trim().replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 160);
  return suffix || randomUUID().replace(/-/g, "");
}

function optionalTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeCodexEffort(value: unknown): StudioCodexReasoningEffort | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  return undefined;
}

function summarySession(
  session: StudioSession,
  source: "live" | "persisted" = "live",
): StudioSessionSummary {
  const { events: _events, ...rest } = session;
  return { ...rest, eventCount: session.events.length, source };
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "text/html; charset=utf-8";
}

function resolveStudioAssetRoot(projectRoot: string): string {
  const roots = candidateStudioAssetRoots(projectRoot);
  return roots.find((root) => existsSync(join(root, "index.html"))) ?? roots[0];
}

function candidateStudioAssetRoots(projectRoot: string): string[] {
  // Static web bundle now lives only in published runtime resources.
  // The macOS app at github.com/memi-design/memi-studio bundles its own
  // frontend via Tauri; this path is only used by `memi studio web`.
  return [fileURLToPath(new URL("../studio-web/", import.meta.url))];
}

function defaultChatMode(harness: StudioHarnessId, action: StudioRunAction, prompt: string): StudioChatMode {
  const normalized = `${harness} ${action} ${prompt}`.toLowerCase();
  if (/\bresearch|netnograph|interview|survey|dovetail|theme|insight\b/.test(normalized)) return "research";
  if (/\baudit|review|check|qa|test\b/.test(normalized)) return "review";
  if (/\bterminal|shell|command|logs?\b/.test(normalized) || harness === "shell") return "terminal";
  if (/\bbuild|fix|implement|patch|generate code\b/.test(normalized)) return "build";
  return "ideate";
}

function compactResearchContext(value: string, max = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}...`;
}

function defaultStudioHTML(runtimeUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mémoire Studio</title>
  <style>
    :root { color-scheme: dark; --font-studio: "Geist Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --font-size-sm: 14px; --font-size-md: 28px; --font-weight-regular: 400; --space-0: 0; --space-3: 12px; --space-4: 16px; --fallback-width: 560px; --studio-color-surface-bg-dark: Canvas; --studio-color-surface-dark: Canvas; --studio-color-ink-dark: CanvasText; --studio-color-agentic-accent: LinkText; --radius-panel: 6px; }
    body { margin: var(--space-0); min-height: 100vh; display: grid; place-items: center; background: var(--studio-color-surface-bg-dark); color: var(--studio-color-ink-dark); font-family: var(--font-studio); font-size: var(--font-size-sm); font-weight: var(--font-weight-regular); }
    main { max-width: var(--fallback-width); border: 1px solid color-mix(in srgb, var(--studio-color-ink-dark) 12%, transparent); border-radius: var(--radius-panel); padding: var(--space-4); background: var(--studio-color-surface-dark); }
    h1 { margin: var(--space-0) var(--space-0) var(--space-3); font-size: var(--font-size-md); font-weight: var(--font-weight-regular); }
    code { color: var(--studio-color-agentic-accent); }
  </style>
</head>
<body><main><h1>Mémoire Studio runtime</h1><p>The desktop shell is not built yet. Runtime API is available at <code>${runtimeUrl}/api/status</code>.</p></main></body>
</html>`;
}

export function studioRuntimeUrl(info: StudioRuntimeInfo): URL {
  return new URL(info.url);
}

export function studioRuntimeFileUrl(path: string): string {
  return pathToFileURL(path).toString();
}
