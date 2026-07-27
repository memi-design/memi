import {
  type AgentBoxState,
  WIDGET_V2_CHANNEL,
  createRunId,
  isWidgetV2Envelope,
  isWidgetCommandName,
  type WidgetCommandName,
  type WidgetConnectionState,
  type WidgetHealSummary,
  type WidgetJob,
  type WidgetLogEntry,
  type WidgetSelectionNodeSnapshot,
  type WidgetSelectionSnapshot,
  type WidgetSyncSummary,
  type WidgetUiEnvelope,
  type WidgetMainEnvelope,
} from "../shared/contracts.js";
import { findFirst, findIndexBy } from "../shared/compat.js";
import { uuidv4 } from "../shared/ids.js";
import {
  createBridgeResponseEnvelope,
  normalizeBridgeMessage,
  serializeBridgeEnvelope,
  type BridgeCommandEnvelope,
  type BridgeIdentifyEnvelope,
} from "../shared/bridge.js";
import {
  createBridgeCommandDispatch,
  createBridgeConnectionStateMessage,
  createBridgeDocumentChangedMessage,
  createBridgeHelloMessage,
  createBridgeJobStatusMessage,
  createBridgePageChangedMessage,
  createBridgeSelectionMessage,
  createBridgeSyncResultMessage,
  createBridgeVariableChangedMessage,
  createBridgeComponentChangedMessage,
  resolveBridgeResponse,
  trackBridgeRequest,
  type PendingBridgeRequest,
} from "./bridge-adapter.js";
import { BRIDGE_CAPABILITY_PLACEHOLDER } from "../shared/bridge-auth.js";
import {
  authenticateBridgeIdentify,
} from "./bridge-auth.js";
import { buildJobsOverview, describeSelectionNode, formatElapsedTime } from "./presenters.js";
import { disconnectActiveJobs, mergeSyncSummaries, reduceHealEvent, upsertJobState } from "./job-state.js";

interface UiState {
  activeTab: "jobs" | "selection" | "system";
  connection: WidgetConnectionState;
  agentStatuses: AgentBoxState[];
  jobs: WidgetJob[];
  selection: WidgetSelectionSnapshot;
  logs: WidgetLogEntry[];
  changeCount: number;
  bufferedChanges: number;
  lastPageUpdate: number | null;
  pageTree: unknown | null;
  lastCapture: { nodeId: string; dataUrl: string; format: string } | null;
  syncSummary: WidgetSyncSummary | null;
  lastSyncAt: number | null;
  healSummary: WidgetHealSummary | null;
  bridge: {
    ws: WebSocket | null;
    port: number | null;
    portsTried: number[];
    stage: "offline" | "scanning" | "connected" | "reconnecting";
    name: string;
    reconnectDelayMs: number;
    latencyMs: number | null;
    studioUrl: string;
    runtimeUrl: string;
    lastPingSentAt: number;
    scanTimer: number | null;
    offlineSince: number | null;
    reconnectAttempts: number;
    capability: string;
    proof: string;
  };
}

const PORT_START = 9223;
const PORT_END = 9232;
const LOG_LIMIT = 80;
const INSTALLED_BRIDGE_CAPABILITY = BRIDGE_CAPABILITY_PLACEHOLDER;

const OFFLINE_CTA_GRACE_MS = 5000;

// Tab + action registries (#47, #48). Data-driven rather than hardcoded
// so new panels/actions can be added by appending to these lists.
interface TabDef {
  id: "jobs" | "selection" | "system";
  label: string;
  count: (s: UiState) => number | null;
}

const TABS: TabDef[] = [
  { id: "jobs", label: "Jobs", count: (s) => s.jobs.length || null },
  { id: "selection", label: "Selection", count: (s) => (s.selection.count > 0 ? s.selection.count : null) },
  { id: "system", label: "System", count: () => null },
];

interface ActionDef {
  id: string;
  label: string;
  requiresConnection: boolean;
  requiresSelection?: boolean;
  primary?: boolean;
  hiddenIfConnected?: boolean;
}

const ACTIONS: ActionDef[] = [
  { id: "sync", label: "sync", requiresConnection: true, primary: true },
  { id: "inspect", label: "inspect", requiresConnection: true },
  { id: "capture", label: "capture", requiresConnection: true, requiresSelection: true },
  { id: "changes", label: "changes", requiresConnection: true },
  { id: "page-tree", label: "tree", requiresConnection: true },
  { id: "studio-full-sync", label: "studio sync", requiresConnection: true },
  { id: "studio-pull-stickies", label: "stickies", requiresConnection: true },
  { id: "studio-open", label: "open studio", requiresConnection: false },
  { id: "retry", label: "reconnect", requiresConnection: false },
];

const TRUSTED_PARENT_ORIGINS = new Set<string>([
  "https://www.figma.com",
  "https://figma.com",
  "https://staging.figma.com",
  "", // Figma desktop delivers with empty origin
  "null", // Some desktop builds report literal "null"
]);

function isTrustedMessageOrigin(origin: string): boolean {
  return TRUSTED_PARENT_ORIGINS.has(origin);
}
const MAX_JOBS = 24;
const MAX_AGENT_STATUSES = 48;
const PENDING_REQUEST_TIMEOUT_MS = 35000;

// Per-method timeout budgets (#12). Screenshot/export operations can take
// tens of seconds on large frames; inspect/ping should fail fast so the UI
// surfaces disconnects quickly.
const COMMAND_TIMEOUTS_MS: Partial<Record<WidgetCommandName, number>> = {
  captureScreenshot: 90000,
  getComponentImage: 60000,
  getVariables: 60000,
  getComponents: 60000,
  getStyles: 60000,
  getPageTree: 45000,
  getFileData: 45000,
  pushTokens: 60000,
  execute: 30000,
  getSelection: 8000,
  getStickies: 10000,
  getChanges: 8000,
  getPageList: 8000,
  createNode: 15000,
  updateNode: 15000,
  deleteNode: 10000,
  setSelection: 8000,
  navigateTo: 8000,
};

function timeoutForCommand(command: WidgetCommandName): number {
  const t = COMMAND_TIMEOUTS_MS[command];
  return t ?? PENDING_REQUEST_TIMEOUT_MS;
}
const pendingBridgeRequests = new Map<string, PendingBridgeRequest>();
const pendingRequestTimers = new Map<string, number>();

let app: HTMLDivElement | null = null;
let bootstrapped = false;
let keepaliveInterval: number | null = null;
const bootstrapOnReady = () => {
  document.removeEventListener("DOMContentLoaded", bootstrapOnReady);
  bootstrap();
};

const emptyConnection: WidgetConnectionState = {
  stage: "offline",
  port: null,
  name: "Mémoire Control Plane",
  latencyMs: null,
  fileName: "",
  fileKey: null,
  pageName: "",
  pageId: null,
  editorType: "",
  connectedAt: null,
  reconnectDelayMs: null,
};

const emptySelection: WidgetSelectionSnapshot = {
  count: 0,
  pageName: "",
  pageId: null,
  nodes: [],
  updatedAt: 0,
};

const state: UiState = {
  activeTab: "jobs",
  connection: emptyConnection,
  agentStatuses: [],
  jobs: [],
  selection: emptySelection,
  logs: [],
  changeCount: 0,
  bufferedChanges: 0,
  lastPageUpdate: null,
  pageTree: null,
  lastCapture: null,
  syncSummary: null,
  lastSyncAt: null,
  healSummary: null,
  bridge: {
    ws: null,
    port: null,
    portsTried: [],
    stage: "offline",
    name: "",
    reconnectDelayMs: 2000,
    latencyMs: null,
    studioUrl: "http://127.0.0.1:1420",
    runtimeUrl: "http://127.0.0.1:8765",
    lastPingSentAt: 0,
    scanTimer: null,
    offlineSince: Date.now(),
    reconnectAttempts: 0,
    capability: INSTALLED_BRIDGE_CAPABILITY,
    proof: "",
  },
};

bootstrap();

function bootstrap(): void {
  if (bootstrapped) {
    return;
  }

  const root = document.getElementById("app");
  if (!root) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootstrapOnReady);
      return;
    }
    throw new Error("Plugin root element not found");
  }

  app = root as HTMLDivElement;
  bootstrapped = true;

  render();
  bindPluginMessages();
  bindLifecycleCleanup();
  sendToMain({ channel: WIDGET_V2_CHANNEL, source: "ui", type: "ping" });
  window.setTimeout(scanBridge, 200);
  keepaliveInterval = window.setInterval(function keepalive() {
    sendToMain({ channel: WIDGET_V2_CHANNEL, source: "ui", type: "ping" });
    if (state.bridge.ws && state.bridge.ws.readyState === WebSocket.OPEN) {
      state.bridge.lastPingSentAt = Date.now();
      try {
        state.bridge.ws.send(JSON.stringify({ channel: "memoire.bridge.v2", source: "plugin", type: "ping" }));
      } catch {
        // Send failed — connection is stale
        state.bridge.ws = null;
        setBridgeStage("reconnecting");
        scheduleReconnect();
      }
    }
  }, 20000);
}

function bindPluginMessages(): void {
  window.onmessage = (event: MessageEvent<{ pluginMessage?: WidgetMainEnvelope }>) => {
    // Defense-in-depth origin check (#2). Figma desktop delivers postMessage
    // with a null origin (empty string or 'null'); the web app delivers from
    // https://www.figma.com. We reject everything outside that set, while
    // still accepting null for the desktop app's cross-context bridge.
    if (!isTrustedMessageOrigin(event.origin)) {
      return;
    }
    const message = event.data?.pluginMessage;
    if (!message || !isWidgetV2Envelope(message)) {
      return;
    }
    if (message.source !== "main") {
      return;
    }

    switch (message.type) {
      case "bootstrap":
        state.connection = message.connection;
        state.selection = message.selection;
        state.jobs = message.initialJobs;
        announceBridgeHello();
        addLog("success", "Plugin ready", {
          file: message.connection.fileName,
          page: message.connection.pageName,
        });
        scheduleRender();
        break;
      case "pong":
        state.connection = message.connection;
        scheduleRender();
        break;
      case "connection":
        state.connection = message.connection;
        announceBridgeHello();
        forwardToBridge(serializeBridgeEnvelope(createBridgeConnectionStateMessage(message.connection), "v2"));
        scheduleRender();
        break;
      case "selection":
        state.selection = message.selection;
        forwardToBridge(serializeBridgeEnvelope(createBridgeSelectionMessage(message.selection), "v2"));
        scheduleRender();
        break;
      case "page":
        state.connection = {
          ...state.connection,
          pageName: message.pageName,
          pageId: message.pageId,
        };
        state.lastPageUpdate = message.updatedAt;
        forwardToBridge(serializeBridgeEnvelope(createBridgePageChangedMessage(
          message.pageName,
          message.pageId,
          message.updatedAt,
        ), "v2"));
        scheduleRender();
        break;
      case "changes":
        state.changeCount = message.count;
        state.bufferedChanges = message.buffered;
        forwardToBridge(serializeBridgeEnvelope(createBridgeDocumentChangedMessage(
          message.count,
          message.buffered,
          message.sessionId,
          message.runId ?? null,
          message.updatedAt,
        ), "v2"));
        scheduleRender();
        break;
      case "job":
        upsertJob(message.job);
        forwardToBridge(serializeBridgeEnvelope(createBridgeJobStatusMessage(message.job), "v2"));
        scheduleRender();
        break;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- granular-change is a plugin-internal message type not in the union
      case "granular-change" as any: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin sends untyped granular change events
        const granular = message as any;
        if (granular.granularType === "variable-changed") {
          forwardToBridge(serializeBridgeEnvelope(createBridgeVariableChangedMessage(granular.data), "v2"));
        } else if (granular.granularType === "component-changed") {
          forwardToBridge(serializeBridgeEnvelope(createBridgeComponentChangedMessage(granular.data), "v2"));
        }
        break;
      }
      case "command-result":
        handleCommandResult(message);
        scheduleRender();
        break;
      case "log":
        addLog(message.entry.level, message.entry.message, message.entry.detail);
        scheduleRender();
        break;
      default:
        break;
    }
  };
}

// Active candidate sockets for the in-flight parallel scan (#10). We open
// one WebSocket per port and adopt the first one that sends a valid
// identify/pong; all other candidates are closed immediately.
let scanCandidates: WebSocket[] = [];
let scanGenerationId = 0;

function orderedScanPorts(): number[] {
  const ports: number[] = [];
  for (let p = PORT_START; p <= PORT_END; p += 1) ports.push(p);
  const cached = readCachedPort();
  const preferred = cached !== null ? cached : state.bridge.port;
  if (preferred && preferred >= PORT_START && preferred <= PORT_END) {
    const idx = ports.indexOf(preferred);
    if (idx > 0) {
      ports.splice(idx, 1);
      ports.unshift(preferred);
    }
  }
  return ports;
}

function scanBridge(): void {
  if (state.bridge.stage === "scanning") {
    return;
  }
  setBridgeStage("scanning");
  state.bridge.portsTried = [];
  scheduleRender();

  scanGenerationId += 1;
  const generation = scanGenerationId;
  closeScanCandidates();

  const ports = orderedScanPorts();
  let settledPorts = 0;
  let adopted = false;

  const scanTimeout = window.setTimeout(() => {
    if (adopted || generation !== scanGenerationId) return;
    closeScanCandidates();
    setBridgeStage("offline");
    scheduleReconnect();
    scheduleRender();
  }, 3000);

  const onCandidateSettle = (): void => {
    if (adopted || generation !== scanGenerationId) return;
    settledPorts += 1;
    if (settledPorts >= ports.length) {
      window.clearTimeout(scanTimeout);
      setBridgeStage("offline");
      scheduleReconnect();
      scheduleRender();
    }
  };

  for (const port of ports) {
    state.bridge.portsTried.push(port);
    let ws: WebSocket;
    try {
      ws = new WebSocket("ws://localhost:" + port);
    } catch {
      onCandidateSettle();
      continue;
    }
    scanCandidates.push(ws);
    let candidateSettled = false;

    ws.onmessage = (event) => {
      if (generation !== scanGenerationId) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        addLog("warn", "Dropped malformed bridge frame", {
          port,
          preview: String(event.data).slice(0, 120),
        });
        return;
      }
      if (!parsed || typeof parsed !== "object") return;
      const payload = parsed as { type?: string; channel?: string; name?: string };

      if (payload.type === "pong" && state.bridge.lastPingSentAt > 0) {
        state.bridge.latencyMs = Date.now() - state.bridge.lastPingSentAt;
      }

      if (!adopted) {
        const isIdentify = payload.type === "identify" && payload.channel === "memoire.bridge.v2";
        const isPong = payload.type === "pong" && payload.channel === "memoire.bridge.v2";
        if (isIdentify || isPong) {
          adopted = true;
          candidateSettled = true;
          window.clearTimeout(scanTimeout);
          // Remove THIS socket from the candidate list, close all others.
          scanCandidates = scanCandidates.filter((candidate) => candidate !== ws);
          closeScanCandidates();
          void adoptBridge(ws, port, payload as Partial<BridgeIdentifyEnvelope>);
          return;
        }
      }

      handleBridgeMessage(payload);
    };

    ws.onerror = () => {
      if (candidateSettled || generation !== scanGenerationId) return;
      candidateSettled = true;
      onCandidateSettle();
    };

    ws.onclose = () => {
      // If this socket is the adopted bridge, this is a post-connect close.
      if (state.bridge.ws === ws) {
        const lastPort = state.bridge.port;
        state.bridge.ws = null;
        state.bridge.port = lastPort;
        state.jobs = disconnectActiveJobs(state.jobs);
        cleanupPendingRequests();
        setBridgeStage("reconnecting");
        addLog("warn", "Bridge disconnected");
        scheduleRender();
        scheduleReconnect();
        return;
      }
      if (candidateSettled || generation !== scanGenerationId) return;
      candidateSettled = true;
      onCandidateSettle();
    };
  }
}

function closeScanCandidates(): void {
  for (const ws of scanCandidates) {
    try { ws.close(); } catch { /* ignore */ }
  }
  scanCandidates = [];
}

async function adoptBridge(ws: WebSocket, port: number, payload: Partial<BridgeIdentifyEnvelope>): Promise<void> {
  try {
    state.bridge.proof = await authenticateBridgeIdentify(
      state.bridge.capability,
      payload,
    );
  } catch (error) {
    ws.close();
    setBridgeStage("offline");
    addLog("error", "Secure bridge pairing failed", error instanceof Error ? error.message : String(error));
    scheduleReconnect();
    scheduleRender();
    return;
  }
  if (ws.readyState !== WebSocket.OPEN) {
    setBridgeStage("offline");
    scheduleReconnect();
    scheduleRender();
    return;
  }
  state.bridge.ws = ws;
  state.bridge.port = port;
  state.bridge.name = payload.name || "Mémoire";
  state.bridge.studioUrl = payload.studioUrl || state.bridge.studioUrl;
  state.bridge.runtimeUrl = payload.runtimeUrl || state.bridge.runtimeUrl;
  state.bridge.reconnectDelayMs = 2000;
  state.bridge.reconnectAttempts = 0;
  writeCachedPort(port);
  setBridgeStage("connected");
  addLog("success", `Connected :${port}`);
  forwardToBridge(serializeBridgeEnvelope(
    createBridgeHelloMessage(state.connection, state.bridge.proof),
    "v2",
  ));
  scheduleRender();
  // Auto-sync on connect — pull selection immediately
  window.setTimeout(() => {
    requestCommand("getSelection", {}, "Auto-inspect", "selection");
  }, 300);
}

function announceBridgeHello(): void {
  if (!state.bridge.proof) return;
  forwardToBridge(serializeBridgeEnvelope(
    createBridgeHelloMessage(state.connection, state.bridge.proof),
    "v2",
  ));
}

const MAX_RECONNECT_ATTEMPTS = 20;

function scheduleReconnect(): void {
  if (state.bridge.scanTimer) {
    return;
  }
  if (state.bridge.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    // Give up the retry loop. User can still click "reconnect" to restart.
    addLog("error", "Bridge unreachable after " + MAX_RECONNECT_ATTEMPTS + " attempts", {
      code: "E_BRIDGE_UNREACHABLE",
    });
    return;
  }
  state.bridge.reconnectAttempts += 1;
  const base = state.bridge.reconnectDelayMs;
  // ±20% jitter prevents thundering-herd reconnects when multiple plugin
  // instances come back at once (N9).
  const jitter = (Math.random() - 0.5) * 0.4 * base;
  const delay = Math.max(500, Math.round(base + jitter));
  state.bridge.scanTimer = window.setTimeout(() => {
    state.bridge.scanTimer = null;
    scanBridge();
  }, delay);
  state.bridge.reconnectDelayMs = Math.min(base * 1.5, 15000);
}

function setBridgeStage(stage: UiState["bridge"]["stage"]): void {
  const prev = state.bridge.stage;
  state.bridge.stage = stage;
  // Track the moment we became offline so the CTA can wait out a grace
  // window before nagging the operator (#53).
  if (stage === "offline" && prev !== "offline") {
    state.bridge.offlineSince = Date.now();
  } else if (stage === "connected") {
    state.bridge.offlineSince = null;
  }
  state.connection = {
    ...state.connection,
    stage: stage === "connected" ? "connected" : stage === "scanning" ? "scanning" : stage === "reconnecting" ? "reconnecting" : "offline",
    port: state.bridge.port,
    name: state.bridge.name || state.connection.name,
    latencyMs: state.bridge.latencyMs,
    reconnectDelayMs: stage === "reconnecting" ? state.bridge.reconnectDelayMs : null,
  };
}

// WebSocket.send is synchronous from the caller's perspective but pushes
// into an internal buffer. A stuck peer can balloon bufferedAmount without
// throwing. Reject sends when the buffer is already very large so a dead
// bridge cannot silently swallow commands (#34).
const MAX_WS_BUFFERED_BYTES = 4 * 1024 * 1024;

function forwardToBridge(payload: Record<string, unknown>): boolean {
  const ws = state.bridge.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  if (ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
    addLog("warn", "Bridge send rejected — socket buffer exceeded threshold", {
      bufferedAmount: ws.bufferedAmount,
    });
    state.bridge.ws = null;
    try { ws.close(); } catch { /* ignore */ }
    setBridgeStage("reconnecting");
    scheduleReconnect();
    return false;
  }
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    // Send failed — connection is stale, trigger reconnect
    state.bridge.ws = null;
    setBridgeStage("reconnecting");
    scheduleReconnect();
    return false;
  }
}

// Drains the pending request map atomically (#37). Previously, concurrent
// new request registrations during cleanup could race the iteration; we
// now swap out the underlying storage first and clear in isolation.
function cleanupPendingRequests(): void {
  const timers = Array.from(pendingRequestTimers.values());
  pendingBridgeRequests.clear();
  pendingRequestTimers.clear();
  inFlightDedupeKeys.clear();
  for (const timerId of timers) {
    window.clearTimeout(timerId);
  }
}

// pagehide fires on plugin UI close / navigation and is more reliable than
// beforeunload inside the Figma plugin iframe (N4). Releases WebSocket,
// clears all timers, and drops the pending map so the main thread doesn't
// ghost-write into a closed iframe.
function bindLifecycleCleanup(): void {
  const release = (): void => {
    cleanupPendingRequests();
    if (keepaliveInterval !== null) {
      window.clearInterval(keepaliveInterval);
      keepaliveInterval = null;
    }
    if (state.bridge.scanTimer) {
      window.clearTimeout(state.bridge.scanTimer);
      state.bridge.scanTimer = null;
    }
    const ws = state.bridge.ws;
    state.bridge.ws = null;
    if (ws) {
      try { ws.close(); } catch { /* ignore */ }
    }
  };
  window.addEventListener("pagehide", release);
  window.addEventListener("beforeunload", release);
}

const LAST_PORT_KEY = "memoire.bridge.lastGoodPort";

function readCachedPort(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_PORT_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 9223 && n <= 9232 ? n : null;
  } catch {
    return null;
  }
}

function writeCachedPort(port: number): void {
  try {
    window.localStorage.setItem(LAST_PORT_KEY, String(port));
  } catch {
    // localStorage may be unavailable (private mode, Figma desktop) — ignore.
  }
}

// Hard ceiling on a single bridge frame after JSON.parse (#13). Protects
// the plugin from an adversarial or buggy bridge flooding us with a
// gigantic payload that would sit in memory while normalization runs.
const MAX_INBOUND_FRAME_CHARS = 256 * 1024;

function handleBridgeMessage(payload: unknown): void {
  // Cheap structural sanity: everything we care about is an object.
  if (!payload || typeof payload !== "object") {
    addLog("warn", "Rejected non-object bridge frame", {
      typeofPayload: typeof payload,
    });
    return;
  }
  // Size gate happens here (post-parse) so we catch wire shapes that
  // JSON.parse accepted but that we still don't want to process.
  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_INBOUND_FRAME_CHARS) {
      addLog("warn", "Rejected oversized bridge frame", {
        bytes: serialized.length,
        max: MAX_INBOUND_FRAME_CHARS,
      });
      return;
    }
  } catch {
    addLog("warn", "Rejected bridge frame with circular references");
    return;
  }

  const message = normalizeBridgeMessage(payload);
  if (!message) {
    // Upgrade prior silent-drop (#13) into a visible diagnostic. The
    // preview is truncated so a malformed frame can't swamp the log
    // buffer by itself.
    const shape = payload as { type?: unknown };
    addLog("warn", "Rejected bridge frame — failed shape validation", {
      type: typeof shape.type === "string" ? shape.type : "<unknown>",
    });
    return;
  }

  switch (message.type) {
    case "command":
      handleBridgeCommand(message);
      break;
    case "identify":
      state.bridge.name = message.name || state.bridge.name;
      state.bridge.studioUrl = message.studioUrl || state.bridge.studioUrl;
      state.bridge.runtimeUrl = message.runtimeUrl || state.bridge.runtimeUrl;
      scheduleRender();
      break;
    case "event": {
      addLog(message.level, message.message || "Bridge event", message.data || null);
      state.healSummary = reduceHealEvent(
        state.healSummary,
        message.message || "",
        typeof message.data === "object" && message.data && "source" in (message.data as Record<string, unknown>)
          ? String((message.data as Record<string, unknown>).source)
          : undefined,
      );
      break;
    }
    case "chat":
      addLog("info", `Bridge chat from ${message.from}`, message.text);
      break;
    case "agent-status":
      upsertAgentStatus(message.data);
      if (message.data.status === "error") {
        addLog("error", `Agent ${message.data.role} failed`, {
          runId: message.data.runId,
          taskId: message.data.taskId,
          summary: message.data.summary,
          error: message.data.error,
        });
      }
      scheduleRender();
      break;
    case "heal-result":
      state.healSummary = message.data ?? null;
      scheduleRender();
      break;
    case "error":
      addLog("error", message.message || "Bridge error", message.details || null);
      break;
    default:
      break;
  }
}

function handleBridgeCommand(message: BridgeCommandEnvelope): void {
  if (!isWidgetCommandName(message.method)) {
    forwardToBridge(serializeBridgeEnvelope(
      createBridgeResponseEnvelope(message.id, undefined, "Unknown bridge command: " + message.method),
      "v2",
    ));
    return;
  }

  var dispatch = createBridgeCommandDispatch(message);
  trackBridgeRequest(pendingBridgeRequests, dispatch.requestId, message);

  // Per-method timeout budget (#12) prevents a fast ping from sharing the
  // same 35s wait as a heavy screenshot export.
  var commandTimeout = timeoutForCommand(dispatch.command);
  var timerId = window.setTimeout(function onRequestTimeout() {
    var pending = pendingBridgeRequests.get(dispatch.requestId);
    if (pending) {
      pendingBridgeRequests.delete(dispatch.requestId);
      pendingRequestTimers.delete(dispatch.requestId);
      forwardToBridge(serializeBridgeEnvelope(
        createBridgeResponseEnvelope(
          pending.bridgeId,
          undefined,
          JSON.stringify({
            code: "E_TIMEOUT",
            message: "Request timed out: " + dispatch.command + " after " + commandTimeout + "ms",
            retryable: true,
          }),
        ),
        "v2",
      ));
      addLog("warn", "Command timed out: " + dispatch.command, { afterMs: commandTimeout });
    }
  }, commandTimeout);
  pendingRequestTimers.set(dispatch.requestId, timerId);

  sendToMain({
    channel: WIDGET_V2_CHANNEL,
    source: "ui",
    type: "run-command",
    requestId: dispatch.requestId,
    command: dispatch.command,
    params: dispatch.params,
  });
}

function handleCommandResult(message: Extract<WidgetMainEnvelope, { type: "command-result" }>): void {
  // Clear pending request timeout
  var timer = pendingRequestTimers.get(message.requestId);
  if (timer) {
    window.clearTimeout(timer);
    pendingRequestTimers.delete(message.requestId);
  }

  // Free the dedupe slot so the same command can be re-triggered now that
  // the main thread has replied (#28).
  releaseDedupe(message.requestId);

  var bridgeResponse = resolveBridgeResponse(pendingBridgeRequests, message);
  if (bridgeResponse) {
    forwardToBridge(serializeBridgeEnvelope(bridgeResponse, "v2"));
  }

  if (message.error) {
    if (message.command === "getVariables") {
      recordSyncSummary("tokens", null, message.error);
    }
    if (message.command === "getComponents") {
      recordSyncSummary("components", null, message.error);
    }
    if (message.command === "getStyles") {
      recordSyncSummary("styles", null, message.error);
    }
    addLog("error", `${message.command} failed`, message.error);
    return;
  }

  if (message.command === "getPageTree") {
    state.pageTree = message.result || null;
  }

  if (message.command === "captureScreenshot") {
    const image = (message.result as { image?: { base64?: string; format?: string; node?: { id: string } } })?.image;
    if (image?.base64) {
      const mime = String(image.format || "PNG").toLowerCase() === "svg" ? "image/svg+xml" : "image/png";
      state.lastCapture = {
        nodeId: image.node?.id || "",
        format: String(image.format || "PNG"),
        dataUrl: `data:${mime};base64,${image.base64}`,
      };
    }
  }

  if (message.command === "getVariables") {
    const collections = ((message.result as { collections?: unknown[] })?.collections || []).length;
    const syncMessage = createBridgeSyncResultMessage("tokens", message.result);
    forwardToBridge(serializeBridgeEnvelope(syncMessage, "v2"));
    recordSyncSummary("tokens", message.result);
    addLog("success", `Synced tokens`, { collections });
  }

  if (message.command === "getComponents") {
    const count = Array.isArray(message.result) ? message.result.length : 0;
    const syncMessage = createBridgeSyncResultMessage("components", message.result);
    forwardToBridge(serializeBridgeEnvelope(syncMessage, "v2"));
    recordSyncSummary("components", message.result);
    addLog("success", `Synced components`, { count });
  }

  if (message.command === "getStyles") {
    const count = Array.isArray(message.result) ? message.result.length : 0;
    const syncMessage = createBridgeSyncResultMessage("styles", message.result);
    forwardToBridge(serializeBridgeEnvelope(syncMessage, "v2"));
    recordSyncSummary("styles", message.result);
    addLog("success", `Synced styles`, { count });
  }

  if (message.command === "getChanges") {
    addLog("info", "Read buffered changes", { count: Array.isArray(message.result) ? message.result.length : 0 });
  }
}

// In-flight requests keyed by (command + dedupe hint). Rapid-fire clicks
// on sync/inspect/etc. within the dedupe window skip redispatch until the
// first invocation completes, preventing duplicate command fan-out (#28).
const inFlightDedupeKeys = new Map<string, string>();

function dedupeKeyFor(command: WidgetCommandName, params: Record<string, unknown>): string {
  // For commands whose behavior depends on params (nodeId, depth, format),
  // fold those into the key so `capture node A` and `capture node B` don't
  // coalesce into one dispatch.
  const salient: string[] = [command];
  if (typeof params.nodeId === "string") salient.push("n=" + params.nodeId);
  if (typeof params.depth === "number") salient.push("d=" + String(params.depth));
  if (typeof params.format === "string") salient.push("f=" + String(params.format));
  return salient.join("|");
}

function requestCommand(command: WidgetCommandName, params: Record<string, unknown> = {}, label: string = command, kind: WidgetJob["kind"] = "system"): void {
  const dedupeKey = dedupeKeyFor(command, params);
  if (inFlightDedupeKeys.has(dedupeKey)) {
    addLog("info", "Command already in flight — skipped redundant dispatch", {
      command,
      dedupeKey,
    });
    return;
  }
  const requestId = createRunId("cmd");
  inFlightDedupeKeys.set(dedupeKey, requestId);
  sendToMain({
    channel: WIDGET_V2_CHANNEL,
    source: "ui",
    type: "run-command",
    requestId,
    command,
    params,
    action: { kind, label },
  });
}

// Called by handleCommandResult so the dedupe slot frees when main replies.
function releaseDedupe(requestId: string): void {
  for (const [key, id] of inFlightDedupeKeys) {
    if (id === requestId) {
      inFlightDedupeKeys.delete(key);
      return;
    }
  }
}

function recordSyncSummary(part: "tokens" | "components" | "styles", result: unknown, error?: string): void {
  const syncMessage = createBridgeSyncResultMessage(part, result, error);
  state.syncSummary = mergeSyncSummaries(state.syncSummary, syncMessage.summary);
  state.lastSyncAt = Date.now();
}

function sendToMain(message: WidgetUiEnvelope): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function upsertJob(job: WidgetJob): void {
  state.jobs = upsertJobState(state.jobs, job, MAX_JOBS);
}

function upsertAgentStatus(status: AgentBoxState): void {
  const next = [...state.agentStatuses];
  const existing = findIndexBy(next, (candidate) => getAgentStatusKey(candidate) === getAgentStatusKey(status));
  if (existing >= 0) {
    next[existing] = status;
  } else {
    next.unshift(status);
  }
  state.agentStatuses = next.sort(compareAgentStatuses).slice(0, MAX_AGENT_STATUSES);
}

// Structured log append. Uses UUIDv4 ids so newest-first keying is stable
// across same-millisecond inserts (#23). Overflow evicts in-place (pop
// oldest) to avoid the O(n) slice-and-realloc churn the previous impl
// incurred on every log entry past the limit (#46).
function addLog(level: WidgetLogEntry["level"], message: string, detail?: unknown): void {
  state.logs.unshift({
    id: uuidv4(),
    level,
    message,
    detail,
    timestamp: Date.now(),
  });
  while (state.logs.length > LOG_LIMIT) {
    state.logs.pop();
  }
}

// Dirty-flag render scheduler (#30). Previous implementation dropped any
// scheduleRender() calls that arrived while a trailing timer was pending;
// mutations between "timer scheduled" and "timer fires" were therefore
// applied but never reflected until the NEXT state change. Now we track a
// `renderDirty` flag: once the trailing render fires, if the dirty flag
// was set during the throttle window, we render once more.
let renderScheduled = false;
let renderDirty = false;
let lastRenderTime = 0;
const RENDER_THROTTLE_MS = 80;

function scheduleRender(): void {
  if (renderScheduled) {
    renderDirty = true;
    return;
  }
  const elapsed = Date.now() - lastRenderTime;
  if (elapsed >= RENDER_THROTTLE_MS) {
    renderDirty = false;
    render();
    return;
  }
  renderScheduled = true;
  renderDirty = false;
  window.setTimeout(() => {
    renderScheduled = false;
    const wasDirty = renderDirty;
    renderDirty = false;
    render();
    if (wasDirty) scheduleRender();
  }, RENDER_THROTTLE_MS - elapsed);
}

// Slot-level render memoization (#42 mitigation without a full VDOM swap).
// Previously every state change rewrote the entire `app.innerHTML`, tearing
// down and re-parsing every DOM node including the expensive SVG brand.
// Now we maintain a static skeleton with one innerHTML slot per high-level
// surface and only rewrite slots whose *input state hash* has changed. The
// SVG brand is written once at bootstrap and never touched again.
const slotSignatures = new Map<string, string>();
let skeletonMounted = false;

const STATIC_SHELL_HTML = `
<div class="shell">
  <div class="topbar">
    <div class="brand-wrap">
      <svg class="brand-flower" viewBox="0 0 512 512" width="22" height="22" aria-hidden="true">
        <defs>
          <path id="brand-petal" d="M256 220C236 194 196 176 181 139C167 104 184 72 217 67C237 64 250 75 256 88C262 75 275 64 295 67C328 72 345 104 331 139C316 176 276 194 256 220Z"/>
          <mask id="brand-flower-mask" maskUnits="userSpaceOnUse"><rect width="512" height="512" fill="black"/><use href="#brand-petal" fill="white"/><use href="#brand-petal" fill="white" transform="rotate(90 256 256)"/><use href="#brand-petal" fill="white" transform="rotate(180 256 256)"/><use href="#brand-petal" fill="white" transform="rotate(270 256 256)"/><path d="M256 204C264 232 280 248 308 256C280 264 264 280 256 308C248 280 232 264 204 256C232 248 248 232 256 204Z" fill="black"/><g fill="black"><path d="M256 126C243 154 244 188 256 220C268 188 269 154 256 126Z"/><circle cx="256" cy="145" r="15"/><path d="M256 126C243 154 244 188 256 220C268 188 269 154 256 126Z" transform="rotate(90 256 256)"/><circle cx="367" cy="256" r="15"/><path d="M256 126C243 154 244 188 256 220C268 188 269 154 256 126Z" transform="rotate(180 256 256)"/><circle cx="256" cy="367" r="15"/><path d="M256 126C243 154 244 188 256 220C268 188 269 154 256 126Z" transform="rotate(270 256 256)"/><circle cx="145" cy="256" r="15"/></g></mask>
        </defs>
        <rect width="512" height="512" fill="currentColor" mask="url(#brand-flower-mask)"/>
      </svg>
    </div>
    <div class="status-cluster" data-slot="status"></div>
  </div>
  <div class="context-bar" data-slot="context"></div>
  <div class="toolbar" data-slot="toolbar"></div>
  <div class="content">
    <div class="tabstrip" data-slot="tabstrip"></div>
    <div class="tab-panel active" data-slot="tab-content"></div>
  </div>
  <div class="ticker-wrap" data-slot="ticker"></div>
</div>
`;

// fnv-1a over a string; same primitive as nodeFingerprint. We never need
// cryptographic strength here — any stable hash that avoids collisions for
// realistic render inputs is sufficient for cache-key comparison.
function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16);
}

function writeSlotIfChanged(slot: string, html: string): boolean {
  const sig = hashString(html);
  if (slotSignatures.get(slot) === sig) return false;
  slotSignatures.set(slot, sig);
  if (!app) return false;
  const el = app.querySelector<HTMLElement>('[data-slot="' + slot + '"]');
  if (!el) return false;
  el.innerHTML = html;
  return true;
}

function render(): void {
  if (!app) {
    return;
  }
  lastRenderTime = Date.now();

  if (!skeletonMounted) {
    app.innerHTML = STATIC_SHELL_HTML;
    skeletonMounted = true;
    slotSignatures.clear();
  }

  const hasSelection = state.selection.nodes.length > 0;
  const selNode = state.selection.nodes[0];
  const latestLog = state.logs[0];
  const isConnected = state.connection.stage === "connected";
  const portLabel = state.connection.port ? `:${state.connection.port}` : "";
  const latencyLabel = state.connection.latencyMs ? `${state.connection.latencyMs}ms` : "";
  const connMeta = [portLabel, latencyLabel].filter(Boolean).join(" / ");

  const statusHtml = `
    ${connMeta ? `<span class="conn-meta">${escapeHtml(connMeta)}</span>` : ""}
    <div class="status-pill ${state.connection.stage}">
      ${escapeHtml(connectionLabel())}
    </div>
  `;

  const contextHtml = `
    <div class="ctx-item">
      <span class="ctx-label">file</span>
      <span class="ctx-value">${escapeHtml(state.connection.fileName || "--")}</span>
    </div>
    <div class="ctx-sep"></div>
    <div class="ctx-item">
      <span class="ctx-label">page</span>
      <span class="ctx-value">${escapeHtml(state.connection.pageName || "--")}</span>
    </div>
    ${hasSelection ? `
      <div class="ctx-sep"></div>
      <div class="ctx-item">
        <span class="ctx-label">sel</span>
        <span class="ctx-value">${escapeHtml(selNode ? selNode.name : `${state.selection.count}`)}${state.selection.count > 1 ? ` +${state.selection.count - 1}` : ""}</span>
      </div>
    ` : ""}
    ${state.bufferedChanges > 0 ? `
      <div class="ctx-sep"></div>
      <div class="ctx-item">
        <span class="ctx-label">buf</span>
        <span class="ctx-value">${state.bufferedChanges}</span>
      </div>
    ` : ""}
  `;

  const toolbarHtml = ACTIONS.map((a) => renderActionButton(a, { isConnected, hasSelection })).join("");
  const tabstripHtml = TABS.map((t) => renderTabButton(t)).join("");

  const activeTabBody = state.activeTab === "jobs"
    ? `<div class="jobs-list">${renderJobs()}</div>`
    : state.activeTab === "selection"
      ? `<div class="selection-list">${renderSelection()}</div>`
      : `<div class="system-list">${renderSystem()}</div>`;
  const tabContentHtml = activeTabBody + `<!-- active:${state.activeTab} -->`;

  const tickerHtml = latestLog ? `
    <div class="ticker ${latestLog.level}">
      <span class="ticker-dot"></span>
      <span class="ticker-text">${escapeHtml(latestLog.message)}</span>
      <span class="ticker-time">${escapeHtml(new Date(latestLog.timestamp).toLocaleTimeString())}</span>
    </div>
  ` : "";

  // Only the slots whose input state changed pay the innerHTML+reparse cost.
  const statusChanged = writeSlotIfChanged("status", statusHtml);
  const contextChanged = writeSlotIfChanged("context", contextHtml);
  const toolbarChanged = writeSlotIfChanged("toolbar", toolbarHtml);
  const tabstripChanged = writeSlotIfChanged("tabstrip", tabstripHtml);
  const tabContentChanged = writeSlotIfChanged("tab-content", tabContentHtml);
  writeSlotIfChanged("ticker", tickerHtml);

  // Only re-attach listeners on slots that actually rewrote their DOM.
  // Everything else retains its existing listener bindings, which means
  // every 80ms render that's status-meta-only no longer thrashes the
  // action toolbar or selection cards (#42 mitigation).
  if (tabstripChanged) {
    app.querySelectorAll<HTMLButtonElement>('[data-slot="tabstrip"] [data-tab]').forEach((button) => {
      button.onclick = () => {
        state.activeTab = button.dataset.tab as UiState["activeTab"];
        render();
      };
    });
  }

  if (toolbarChanged || tabContentChanged) {
    // Action buttons live in both the toolbar and the tab-content offline CTA
    // / retry card, so we rebind anytime either slot churned.
    app.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
      button.onclick = () => {
        const action = button.dataset.action || "";
        if (action === "retry-job") {
          handleRetryJob({
            command: button.dataset.jobCommand || "",
            kind: button.dataset.jobKind || "",
            label: button.dataset.jobLabel || "",
          });
          return;
        }
        handleAction(action);
      };
    });
  }

  if (tabContentChanged) {
    app.querySelectorAll<HTMLButtonElement>("[data-node-action]").forEach((button) => {
      button.onclick = () => handleNodeAction(button.dataset.nodeAction || "", button.dataset.nodeId || "");
    });
  }

  // Silence the unused-var warning if none of the above branches fired.
  void statusChanged;
  void contextChanged;
}

// Re-dispatches a previously-failed command with identical command/kind/label
// (#51). Params aren't preserved on the job record so retry is only offered
// for commands whose defaults match the original invocation; this covers the
// common sync/inspect/changes/page-tree failures.
function handleRetryJob(ctx: { command: string; kind: string; label: string }): void {
  if (!ctx.command || !isWidgetCommandName(ctx.command)) return;
  requestCommand(ctx.command, {}, ctx.label || "Retry", (ctx.kind || "sync") as WidgetJob["kind"]);
}

function handleAction(action: string): void {
  switch (action) {
    case "sync":
      requestCommand("getVariables", {}, "Sync tokens", "sync");
      requestCommand("getComponents", {}, "Sync components", "sync");
      requestCommand("getStyles", {}, "Sync styles", "sync");
      break;
    case "inspect":
      requestCommand("getSelection", {}, "Inspect selection", "selection");
      break;
    case "capture": {
      const node = state.selection.nodes[0];
      if (!node) {
        addLog("warn", "Select a node before capturing");
        scheduleRender();
        return;
      }
      requestCommand("captureScreenshot", { nodeId: node.id, format: "PNG", scale: 2 }, "Capture node", "capture");
      break;
    }
    case "changes":
      requestCommand("getChanges", {}, "Read changes", "changes");
      break;
    case "page-tree":
      requestCommand("getPageTree", { depth: 2 }, "Inspect page tree", "system");
      break;
    case "studio-full-sync":
      requestCommand("getSelection", {}, "Studio selection sync", "selection");
      requestCommand("getVariables", {}, "Studio token pull", "sync");
      requestCommand("getComponents", {}, "Studio component pull", "sync");
      requestCommand("getStyles", {}, "Studio style pull", "sync");
      requestCommand("getStickies", {}, "Studio sticky pull", "sync");
      requestCommand("getPageTree", { depth: 2 }, "Studio page tree", "system");
      break;
    case "studio-pull-stickies":
      requestCommand("getStickies", {}, "Studio sticky pull", "sync");
      break;
    case "studio-open":
      addLog("info", "Studio runtime: " + state.bridge.runtimeUrl);
      window.open(state.bridge.studioUrl + "/", "_blank", "noopener,noreferrer");
      scheduleRender();
      break;
    case "retry":
      if (state.bridge.ws) {
        try {
          state.bridge.ws.close();
        } catch {
          // ignore
        }
      }
      state.bridge.ws = null;
      state.bridge.port = null;
      if (state.bridge.scanTimer) {
        window.clearTimeout(state.bridge.scanTimer);
        state.bridge.scanTimer = null;
      }
      state.bridge.reconnectDelayMs = 2000;
      state.bridge.reconnectAttempts = 0;
      scanBridge();
      break;
    default:
      break;
  }
}

function handleNodeAction(action: string, nodeId: string): void {
  const node = findFirst(state.selection.nodes, (candidate) => candidate.id === nodeId);
  if (!node) {
    addLog("warn", "Selection node is no longer available", { nodeId });
    scheduleRender();
    return;
  }

  switch (action) {
    case "copy-id":
      void copyToClipboard(node.id, "Copied node id", { nodeId: node.id });
      break;
    case "copy-key":
      if (!node.component?.key) {
        addLog("warn", "No component key on selection", { nodeId: node.id });
        scheduleRender();
        return;
      }
      void copyToClipboard(node.component.key, "Copied component key", { nodeId: node.id, key: node.component.key });
      break;
    case "jump":
      requestCommand("navigateTo", { nodeId: node.id }, `Jump to ${node.name}`, "navigation");
      break;
    case "capture-node":
      requestCommand("captureScreenshot", { nodeId: node.id, format: "PNG", scale: 2 }, `Capture ${node.name}`, "capture");
      break;
    default:
      break;
  }
}

function renderJobs(): string {
  const overview = buildJobsOverview(state.jobs);
  const cta = renderOfflineCta();
  if (!state.jobs.length) {
    return cta + emptyCard("No jobs", "Run sync or inspect to begin.");
  }

  const cards: string[] = [];
  if (cta) cards.push(cta);
  cards.push(`
    <article class="system-card">
      <div class="card-topline">
        <strong class="card-title">Run overview</strong>
        <span class="chip">${overview.runningCount} active</span>
      </div>
      <div class="jobs-summary-grid">
        ${summaryMetric("Running", String(overview.runningCount), `${overview.active.length} in flight`)}
        ${summaryMetric("Completed", String(overview.completedCount), overview.latestCompleted ? overview.latestCompleted.label : "No recent success")}
        ${summaryMetric("Failed", String(overview.failedCount), overview.latestFailure ? overview.latestFailure.label : "No failures")}
        ${summaryMetric("Bridge queue", String(pendingBridgeRequests.size), state.bridge.stage)}
      </div>
      ${overview.latestFailure ? `
        <div class="jobs-alert error">
          <strong>Last failure</strong>
          <span>${escapeHtml(overview.latestFailure.label)} · ${escapeHtml(overview.latestFailure.error || overview.latestFailure.summary || "No error text")}</span>
        </div>
      ` : ""}
      ${overview.latestCompleted ? `
        <div class="jobs-alert success">
          <strong>Last completion</strong>
          <span>${escapeHtml(overview.latestCompleted.label)} · ${escapeHtml(overview.latestCompleted.summary || overview.latestCompleted.command || "Complete")}</span>
        </div>
      ` : ""}
      ${state.syncSummary ? `
        <div class="jobs-alert success">
          <strong>Last sync</strong>
          <span>${escapeHtml(formatSyncSummary(state.syncSummary))}${state.lastSyncAt ? ` · ${escapeHtml(new Date(state.lastSyncAt).toLocaleTimeString())}` : ""}</span>
        </div>
      ` : ""}
      ${state.healSummary ? `
        <div class="jobs-alert ${state.healSummary.healed ? "success" : "error"}">
          <strong>Healer</strong>
          <span>${escapeHtml(formatHealSummary(state.healSummary))}</span>
        </div>
      ` : ""}
      ${state.agentStatuses.length ? `
        <div class="jobs-alert">
          <strong>Agent surface</strong>
          <span>${escapeHtml(formatAgentStatusSummary(state.agentStatuses))}</span>
        </div>
      ` : ""}
    </article>
  `);

  cards.push(...state.agentStatuses.slice(0, 6).map((agent) => `
      <article class="job-card ${agent.status === "done" ? "completed" : agent.status === "error" ? "failed" : "running"}">
        <div class="card-topline">
          <strong class="card-title">${escapeHtml(agent.title)}</strong>
          <span class="chip">${escapeHtml(agent.status)}</span>
        </div>
        <div class="stack muted">
          <div>${escapeHtml(agent.role)} · ${escapeHtml(agent.elapsedMs !== undefined ? formatDuration(agent.elapsedMs) : "live")}</div>
          <div class="mono">run ${escapeHtml(agent.runId)} · task ${escapeHtml(agent.taskId)}</div>
          <div>${escapeHtml(agent.summary || agent.error || "Agent update received")}</div>
        </div>
      </article>
    `));

  cards.push(...state.jobs.map((job) => `
      <article class="job-card ${job.status}">
        <div class="card-topline">
          <strong class="card-title">${escapeHtml(job.label)}</strong>
          <span class="chip">${escapeHtml(job.status)}</span>
        </div>
        <div class="stack muted">
          <div>${escapeHtml(job.command || job.kind)} · ${escapeHtml(formatElapsedTime(job))}</div>
          <div class="mono">run ${escapeHtml(job.runId)}</div>
          <div>${escapeHtml(job.summary || job.progressText || "Running")}</div>
          ${job.error ? `<div class="mono">${escapeHtml(formatJobError(job.error))}</div>` : ""}
          ${job.status === "failed" && job.command ? `
            <div class="inline-actions">
              <button class="tool-btn" data-action="retry-job" data-job-command="${escapeHtml(job.command)}" data-job-kind="${escapeHtml(job.kind)}" data-job-label="${escapeHtml(job.label)}">Retry</button>
            </div>
          ` : ""}
        </div>
      </article>
    `));

  return cards.join("");
}

function renderSelection(): string {
  const cards: string[] = [];
  cards.push(`
    <article class="selection-card">
      <div class="card-topline">
        <strong class="card-title">Live selection</strong>
        <span class="chip">${state.selection.count} nodes</span>
      </div>
      <div class="split-grid">
        <div class="kv-grid">
          <span class="kv-key">Page</span><span>${escapeHtml(state.selection.pageName || "Current page")}</span>
          <span class="kv-key">Page ID</span><span class="mono">${escapeHtml(state.selection.pageId || "—")}</span>
          <span class="kv-key">Updated</span><span>${state.selection.updatedAt ? escapeHtml(new Date(state.selection.updatedAt).toLocaleTimeString()) : "--"}</span>
        </div>
        <div class="inline-actions">
          <button class="tool-btn" data-action="inspect">Refresh</button>
          <button class="tool-btn" data-action="capture">Capture</button>
        </div>
      </div>
    </article>
  `);

  if (state.lastCapture) {
    cards.push(`
      <article class="selection-card">
        <div class="card-topline">
          <strong class="card-title">Latest capture</strong>
          <span class="chip">${escapeHtml(state.lastCapture.format)}</span>
        </div>
        <div class="selection-preview">
          <img src="${escapeHtml(state.lastCapture.dataUrl)}" alt="Selection preview">
        </div>
      </article>
    `);
  }

  if (!state.selection.nodes.length) {
    cards.push(emptyCard("Nothing selected", "Select a node to inspect."));
    return cards.join("");
  }

  for (const node of state.selection.nodes) {
    cards.push(renderSelectionNode(node));
  }

  return cards.join("");
}

function renderSelectionNode(node: WidgetSelectionNodeSnapshot): string {
  const facts = describeSelectionNode(node);

  return `
    <article class="selection-card">
      <div class="card-topline">
        <strong class="card-title">${escapeHtml(node.name)}</strong>
        <div class="chips">${facts.chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("")}</div>
      </div>
      <div class="inline-actions">
        <button class="tool-btn" data-node-action="copy-id" data-node-id="${escapeHtml(node.id)}">Copy ID</button>
        <button class="tool-btn" data-node-action="jump" data-node-id="${escapeHtml(node.id)}">Jump to node</button>
        <button class="tool-btn" data-node-action="capture-node" data-node-id="${escapeHtml(node.id)}">Capture</button>
        ${node.component?.key ? `<button class="tool-btn" data-node-action="copy-key" data-node-id="${escapeHtml(node.id)}">Copy key</button>` : ""}
      </div>
      <div class="kv-grid">
        <span class="kv-key">Node</span><span class="mono">${escapeHtml(node.id)}</span>
        <span class="kv-key">Bounds</span><span>${formatBounds(node)}</span>
        <span class="kv-key">Text</span><span>${escapeHtml(node.characters ? node.characters.slice(0, 120) : "—")}</span>
        <span class="kv-key">Fill</span><span>${facts.fillHex ? `<span class="mono">${facts.fillHex}</span>` : "—"}</span>
        <span class="kv-key">Styles</span><span>${escapeHtml(facts.styleIds.join(" / ") || "—")}</span>
        <span class="kv-key">State</span><span>${escapeHtml(facts.stateFacts.join(", ") || "—")}</span>
        <span class="kv-key">Component</span><span>${escapeHtml(node.component?.key || node.component?.description || "—")}</span>
        <span class="kv-key">Variant</span><span>${escapeHtml(facts.variantPairs.join(", ") || "—")}</span>
        <span class="kv-key">Variables</span><span>${escapeHtml(facts.variableBindings.join(", ") || "—")}</span>
        <span class="kv-key">Layout</span><span>${escapeHtml(facts.layoutFacts.join(", ") || "—")}</span>
        <span class="kv-key">Props</span><span>${escapeHtml(facts.propertyFacts.join(", ") || "—")}</span>
      </div>
    </article>
  `;
}

function renderSystem(): string {
  const cards: string[] = [];
  cards.push(renderStudioCompanion());

  if (state.agentStatuses.length) {
    cards.push(`
      <article class="system-card">
        <div class="card-topline">
          <strong class="card-title">Agent status</strong>
          <span class="chip">${escapeHtml(formatAgentStatusSummary(state.agentStatuses))}</span>
        </div>
        <div class="stack">
          ${state.agentStatuses.slice(0, 8).map((agent) => `
            <div class="job-card ${agent.status === "done" ? "completed" : agent.status === "error" ? "failed" : agent.status === "busy" ? "running" : "queued"}">
              <div class="card-topline">
                <strong class="card-title">${escapeHtml(agent.title)}</strong>
                <span class="chip">${escapeHtml(agent.status)}</span>
              </div>
              <div class="stack muted">
                <div>${escapeHtml(agent.role)} · <span class="mono">${escapeHtml(agent.runId)}</span></div>
                ${agent.summary ? `<div>${escapeHtml(agent.summary)}</div>` : ""}
                ${agent.error ? `<div class="mono">${escapeHtml(agent.error)}</div>` : ""}
                <div>${escapeHtml(formatAgentStatusMeta(agent))}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </article>
    `);
  } else {
    cards.push(emptyCard(
      "No agent activity",
      "Status appears when orchestrator runs.",
    ));
  }

  cards.push(`
    <article class="system-card">
      <div class="card-topline">
        <strong class="card-title">Connection</strong>
        <span class="chip">${escapeHtml(connectionLabel())}</span>
      </div>
      <div class="kv-grid">
        <span class="kv-key">Bridge</span><span>${escapeHtml(state.bridge.name || "Scanning")}</span>
        <span class="kv-key">Port</span><span>${state.bridge.port ? `:${state.bridge.port}` : "--"}</span>
        <span class="kv-key">Latency</span><span>${state.bridge.latencyMs ? `${state.bridge.latencyMs}ms` : "--"}</span>
        <span class="kv-key">Editor</span><span>${escapeHtml(state.connection.editorType || "figma")}</span>
        <span class="kv-key">Ports tried</span><span>${escapeHtml(state.bridge.portsTried.join(", ") || "—")}</span>
        <span class="kv-key">Reconnect</span><span>${state.bridge.scanTimer ? `${state.bridge.reconnectDelayMs}ms` : "Idle"}</span>
        <span class="kv-key">Pending bridge</span><span>${pendingBridgeRequests.size}</span>
      </div>
    </article>
  `);

  cards.push(`
    <article class="system-card">
      <div class="card-topline">
        <strong class="card-title">Change stream</strong>
        <span class="chip">${state.bufferedChanges}</span>
      </div>
      <div class="kv-grid">
        <span class="kv-key">Latest batch</span><span>${state.changeCount}</span>
        <span class="kv-key">Buffered</span><span>${state.bufferedChanges}</span>
        <span class="kv-key">Page update</span><span>${state.lastPageUpdate ? escapeHtml(new Date(state.lastPageUpdate).toLocaleTimeString()) : "--"}</span>
      </div>
    </article>
  `);

  if (state.pageTree) {
    cards.push(`
      <article class="system-card">
        <div class="card-topline">
          <strong class="card-title">Page tree</strong>
          <span class="chip">cached</span>
        </div>
        <pre class="mono muted">${escapeHtml(JSON.stringify(state.pageTree, null, 2).slice(0, 2400))}</pre>
      </article>
    `);
  } else {
    cards.push(emptyCard("Page tree not loaded", "Run tree to load."));
  }

  cards.push(`
    <article class="system-card">
      <div class="card-topline">
        <strong class="card-title">Activity feed</strong>
        <span class="chip">${state.logs.length ? `${state.logs.length}` : "quiet"}</span>
      </div>
      <div class="stack">
        ${renderLogs()}
      </div>
    </article>
  `);

  return cards.join("");
}

function renderStudioCompanion(): string {
  const runtime = state.bridge.runtimeUrl;
  const selected = state.selection.count;
  const tokenCount = state.syncSummary?.tokens ?? 0;
  const componentCount = state.syncSummary?.components ?? 0;
  const lastSync = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleTimeString() : "--";
  const latestAgent = state.agentStatuses[0];

  return `
    <article class="studio-companion">
      <div class="card-topline">
        <strong class="card-title">Studio companion</strong>
        <span class="chip">${escapeHtml(state.bridge.stage)}</span>
      </div>
      <div class="studio-companion-grid">
        <span class="studio-runtime">${escapeHtml(runtime)}</span>
        <span>${escapeHtml(state.connection.fileName || "--")}</span>
        <span>${escapeHtml(state.connection.pageName || "--")}</span>
        <span>${selected} selected</span>
        <span>${tokenCount} token collections</span>
        <span>${componentCount} components</span>
        <span>last sync ${escapeHtml(lastSync)}</span>
        <span>${latestAgent ? escapeHtml(`${latestAgent.title} · ${latestAgent.status}`) : "agent idle"}</span>
      </div>
      <div class="inline-actions">
        <button class="tool-btn" data-action="inspect">Selection</button>
        <button class="tool-btn" data-action="sync">Tokens/components</button>
        <button class="tool-btn" data-action="studio-pull-stickies">Stickies</button>
        <button class="tool-btn" data-action="capture">Screenshot</button>
        <button class="tool-btn" data-action="studio-full-sync">Full sync</button>
        <button class="tool-btn" data-action="studio-open">Open Studio</button>
      </div>
    </article>
  `;
}

function renderLogs(): string {
  if (!state.logs.length) {
    return emptyCard("Quiet", "Events log here as they happen.");
  }
  return state.logs
    .map((entry) => `
      <article class="log-card ${entry.level}">
        <div class="card-topline">
          <strong class="card-title">${escapeHtml(entry.message)}</strong>
          <span class="chip">${escapeHtml(entry.level)}</span>
        </div>
        <div class="stack muted">
          <div>${escapeHtml(new Date(entry.timestamp).toLocaleTimeString())}</div>
          ${entry.detail ? `<pre class="mono muted">${escapeHtml(JSON.stringify(entry.detail, null, 2))}</pre>` : ""}
        </div>
      </article>
    `)
    .join("");
}

function metric(label: string, value: string): string {
  return `
    <div class="metric-card">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function summaryMetric(label: string, value: string, detail: string): string {
  return `
    <div class="summary-metric">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      <div class="muted">${escapeHtml(detail)}</div>
    </div>
  `;
}

function formatSyncSummary(summary: WidgetSyncSummary): string {
  const parts = [`${summary.tokens} collections`, `${summary.components} components`, `${summary.styles} styles`];
  if (summary.partialFailures.length) {
    parts.push(`${summary.partialFailures.length} partial failure(s)`);
  }
  return parts.join(" · ");
}

function formatHealSummary(summary: WidgetHealSummary): string {
  const status = summary.healed ? "healed" : "needs review";
  return `round ${summary.round} · ${summary.issueCount} issue(s) · ${status}`;
}

// Normalizes missing fields to a sentinel so two malformed entries cannot
// collide into the same composite key (#22). Previously ${undefined}:${undefined}:x
// would collapse many logically distinct agents onto one row.
function getAgentStatusKey(agent: AgentBoxState): string {
  const runId = agent.runId ? agent.runId : "∅run";
  const taskId = agent.taskId ? agent.taskId : "∅task";
  const role = agent.role ? agent.role : "∅role";
  return runId + ":" + taskId + ":" + role;
}

function compareAgentStatuses(left: AgentBoxState, right: AgentBoxState): number {
  const priority = (status: AgentBoxState["status"]): number => {
    switch (status) {
      case "busy":
        return 0;
      case "error":
        return 1;
      case "idle":
        return 2;
      case "done":
        return 3;
      default:
        return 4;
    }
  };

  const priorityDiff = priority(left.status) - priority(right.status);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const elapsedDiff = (right.elapsedMs ?? 0) - (left.elapsedMs ?? 0);
  if (elapsedDiff !== 0) {
    return elapsedDiff;
  }

  return getAgentStatusKey(left).localeCompare(getAgentStatusKey(right));
}

function formatAgentStatusSummary(agents: AgentBoxState[]): string {
  const busy = agents.filter((agent) => agent.status === "busy").length;
  const done = agents.filter((agent) => agent.status === "done").length;
  const error = agents.filter((agent) => agent.status === "error").length;
  return `${busy} busy · ${done} done · ${error} error`;
}

function formatAgentStatusMeta(agent: AgentBoxState): string {
  const parts: string[] = [];
  if (agent.elapsedMs !== undefined) {
    parts.push(`elapsed ${formatDuration(agent.elapsedMs)}`);
  }
  if (agent.healRound !== undefined) {
    parts.push(`heal round ${agent.healRound}`);
  }
  if (!parts.length) {
    parts.push(`task ${agent.taskId}`);
  }
  return parts.join(" · ");
}

function formatDuration(elapsedMs: number): string {
  if (elapsedMs < 1000) {
    return `${elapsedMs}ms`;
  }
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function emptyCard(title: string, copy: string): string {
  return `
    <article class="empty-card">
      <div class="stack">
        <strong class="card-title">${escapeHtml(title)}</strong>
        <span class="muted">${escapeHtml(copy)}</span>
      </div>
    </article>
  `;
}

// Jobs may carry an error that's either a plain string or a JSON-encoded
// WidgetError from JobsStore.finishFailed. Show the human message when
// the payload parses; otherwise fall back to the raw string.
function formatJobError(raw: string): string {
  if (raw.charAt(0) !== "{") return raw;
  try {
    const parsed = JSON.parse(raw) as { code?: string; message?: string };
    if (parsed && typeof parsed.message === "string") {
      return (parsed.code ? parsed.code + ": " : "") + parsed.message;
    }
  } catch {
    // fallthrough
  }
  return raw;
}

function renderTabButton(tab: TabDef): string {
  const count = tab.count(state);
  const suffix = count ? ` (${count})` : "";
  const active = state.activeTab === tab.id ? "active" : "";
  return `<button class="tab ${active}" data-tab="${escapeHtml(tab.id)}">${escapeHtml(tab.label)}${suffix}</button>`;
}

function renderActionButton(action: ActionDef, ctx: { isConnected: boolean; hasSelection: boolean }): string {
  let disabled = false;
  if (action.requiresConnection && !ctx.isConnected) disabled = true;
  if (action.requiresSelection && !ctx.hasSelection) disabled = true;
  const cls = action.primary ? "tool-btn primary" : "tool-btn";
  return `<button class="${cls}" data-action="${escapeHtml(action.id)}"${disabled ? " disabled" : ""}>${escapeHtml(action.label)}</button>`;
}

// Offline CTA (#53). Rendered at the top of the content area when the
// bridge has been offline for more than OFFLINE_CTA_GRACE_MS. Drives
// operators to run `memi connect` instead of waiting through the silent
// port scan.
function renderOfflineCta(): string {
  if (state.bridge.stage !== "offline") return "";
  if (state.bridge.offlineSince === null) return "";
  if (Date.now() - state.bridge.offlineSince < OFFLINE_CTA_GRACE_MS) return "";
  return `
    <article class="empty-card" role="status" aria-live="polite">
      <div class="stack">
        <strong class="card-title">Mémoire bridge not found</strong>
        <span class="muted">Start the Control Plane so the widget can connect.</span>
        <code class="mono">memi connect</code>
        <div class="inline-actions">
          <button class="tool-btn primary" data-action="retry">Scan again</button>
        </div>
      </div>
    </article>
  `;
}

function connectionLabel(): string {
  if (state.connection.stage === "connected") {
    return "Connected";
  }
  if (state.connection.stage === "scanning") {
    return "Scanning";
  }
  if (state.connection.stage === "reconnecting") {
    return "Reconnecting";
  }
  return "Offline";
}

function formatBounds(node: WidgetSelectionNodeSnapshot): string {
  const parts = [node.x, node.y, node.width, node.height].map((value) => value === undefined ? "?" : Math.round(value).toString());
  return `${parts[0]}, ${parts[1]} / ${parts[2]} × ${parts[3]}`;
}

async function copyToClipboard(value: string, successMessage: string, detail: Record<string, unknown>): Promise<void> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(value);
    } else if (!copyToClipboardFallback(value)) {
      throw new Error("Clipboard API unavailable");
    }
    addLog("success", successMessage, detail);
  } catch (error) {
    addLog("warn", "Clipboard write failed", error instanceof Error ? error.message : String(error));
  }
  scheduleRender();
}

function copyToClipboardFallback(value: string): boolean {
  if (!document.body) {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
