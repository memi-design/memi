import type {
  AgentBoxState,
  AgentRegistryEntry,
  AgentTaskEnvelope,
  WidgetCommandName,
  WidgetConnectionState,
  WidgetHealSummary,
  WidgetJob,
  WidgetSelectionSnapshot,
  WidgetSyncSummary,
} from "./contracts.js";
import { isWidgetCommandName } from "./contracts.js";

export const BRIDGE_V2_CHANNEL = "memoire.bridge.v2";

export type BridgeSyncPart = "tokens" | "components" | "styles";

export interface BridgeCommandEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "server";
  type: "command";
  id: string;
  method: WidgetCommandName;
  params: Record<string, unknown>;
}

export interface BridgeResponseEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "plugin";
  type: "response";
  id: string;
  result?: unknown;
  error?: string;
}

export interface BridgePingEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "server" | "plugin";
  type: "ping" | "pong";
}

export interface BridgeIdentifyEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "server";
  type: "identify";
  name: string;
  port?: number;
  studioUrl?: string;
  runtimeUrl?: string;
  auth?: "pre-shared-hmac-sha256-v1";
  minimumProtocolVersion?: number;
  challenge?: string;
  serverProof?: string;
}

export interface BridgeHelloEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "plugin";
  type: "bridge-hello";
  file: string;
  fileKey: string;
  editor: string;
  protocolVersion?: number;
  proof?: string;
}

export interface BridgeEventEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "server";
  type: "event";
  level: "info" | "warn" | "error" | "success";
  message: string;
  data?: unknown;
}

export interface BridgeChatEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "server" | "plugin";
  type: "chat";
  text: string;
  from: string;
}

export interface BridgeErrorEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "server";
  type: "error";
  message: string;
  details?: unknown;
}

export interface BridgeSelectionEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "plugin";
  type: "selection";
  data: WidgetSelectionSnapshot;
}

export interface BridgePageChangedEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "plugin";
  type: "page-changed";
  data: { page: string; pageId: string | null; updatedAt: number };
}

export interface BridgeDocumentChangedEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "plugin";
  type: "document-changed";
  data: { changes: number; buffered: number; sessionId: string; runId?: string | null; updatedAt: number };
}

export interface BridgeActionResultEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "plugin";
  type: "action-result";
  action: string;
  result?: unknown;
  error?: string;
}

export interface BridgeSyncResultEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "plugin";
  type: "sync-result";
  part: BridgeSyncPart;
  summary: WidgetSyncSummary;
  result?: unknown;
  error?: string;
}

export interface BridgeConnectionStateEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "plugin";
  type: "connection-state";
  data: WidgetConnectionState;
}

export interface BridgeJobStatusEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "plugin";
  type: "job-status";
  data: WidgetJob;
}

export interface BridgeHealResultEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "plugin";
  type: "heal-result";
  data: WidgetHealSummary;
}

export interface BridgeAgentStatusEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "plugin";
  type: "agent-status";
  data: AgentBoxState;
}

export interface BridgeAgentRegisterEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "server";
  type: "agent-register";
  data: AgentRegistryEntry;
}

export interface BridgeAgentDeregisterEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "server";
  type: "agent-deregister";
  data: { agentId: string };
}

export interface BridgeAgentMessageEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "server";
  type: "agent-message";
  data: AgentTaskEnvelope;
}

export interface BridgeTokenPushEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "server";
  type: "token-push";
  data: {
    tokens: { name: string; values: Record<string, string | number> }[];
    source: "code" | "manual";
  };
}

export interface BridgeVariableChangedEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "plugin";
  type: "variable-changed";
  data: {
    name: string;
    collection: string;
    values: Record<string, string | number>;
    updatedAt: number;
  };
}

export interface BridgeComponentChangedEnvelope {
  channel: typeof BRIDGE_V2_CHANNEL;
  source: "plugin";
  type: "component-changed";
  data: {
    name: string;
    key: string;
    figmaNodeId: string;
    updatedAt: number;
  };
}

export type BridgeEnvelope =
  | BridgeCommandEnvelope
  | BridgeResponseEnvelope
  | BridgePingEnvelope
  | BridgeIdentifyEnvelope
  | BridgeHelloEnvelope
  | BridgeEventEnvelope
  | BridgeChatEnvelope
  | BridgeErrorEnvelope
  | BridgeSelectionEnvelope
  | BridgePageChangedEnvelope
  | BridgeDocumentChangedEnvelope
  | BridgeActionResultEnvelope
  | BridgeSyncResultEnvelope
  | BridgeConnectionStateEnvelope
  | BridgeJobStatusEnvelope
  | BridgeHealResultEnvelope
  | BridgeAgentStatusEnvelope
  | BridgeTokenPushEnvelope
  | BridgeVariableChangedEnvelope
  | BridgeComponentChangedEnvelope
  | BridgeAgentRegisterEnvelope
  | BridgeAgentDeregisterEnvelope
  | BridgeAgentMessageEnvelope;

export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as {
    channel?: unknown;
    type?: unknown;
    method?: unknown;
    name?: unknown;
    auth?: unknown;
    minimumProtocolVersion?: unknown;
    challenge?: unknown;
    serverProof?: unknown;
    protocolVersion?: unknown;
    proof?: unknown;
  };
  if (v.channel !== BRIDGE_V2_CHANNEL) return false;
  if (typeof v.type !== "string") return false;
  if (v.type === "identify") {
    return typeof v.name === "string"
      && (v.auth === undefined || v.auth === "pre-shared-hmac-sha256-v1")
      && (v.minimumProtocolVersion === undefined || typeof v.minimumProtocolVersion === "number")
      && (v.challenge === undefined || typeof v.challenge === "string")
      && (v.serverProof === undefined || typeof v.serverProof === "string");
  }
  if (v.type === "bridge-hello") {
    return (v.proof === undefined || typeof v.proof === "string")
      && (v.protocolVersion === undefined || typeof v.protocolVersion === "number");
  }
  // If the envelope claims to be a command, the method must be on the
  // approved list — otherwise the fast-path in normalizeBridgeMessage
  // would let unknown commands through, defeating the validation we
  // added below (#13).
  if (v.type === "command" && !isWidgetCommandName(v.method)) return false;
  return true;
}

export function createBridgeCommandEnvelope(
  id: string,
  method: WidgetCommandName,
  params: Record<string, unknown> = {},
): BridgeCommandEnvelope {
  return {
    channel: BRIDGE_V2_CHANNEL,
    source: "server",
    type: "command",
    id,
    method,
    params,
  };
}

export function createBridgeResponseEnvelope(
  id: string,
  result?: unknown,
  error?: string,
): BridgeResponseEnvelope {
  return {
    channel: BRIDGE_V2_CHANNEL,
    source: "plugin",
    type: "response",
    id,
    result,
    error,
  };
}

export function normalizeBridgeMessage(value: unknown): BridgeEnvelope | null {
  if (isBridgeEnvelope(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const message = value as Record<string, unknown>;
  const type = typeof message.type === "string" ? message.type : null;
  if (!type) {
    return null;
  }

  switch (type) {
    case "command":
      if (typeof message.id === "string" && isWidgetCommandName(message.method)) {
        return createBridgeCommandEnvelope(message.id, message.method, asRecord(message.params));
      }
      return null;
    case "response":
      if (typeof message.id === "string") {
        return createBridgeResponseEnvelope(message.id, message.result, asString(message.error));
      }
      return null;
    case "ping":
    case "pong":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: type === "ping" ? "server" : "plugin",
        type,
      };
    case "identify":
      if (typeof message.name === "string") {
        return {
          channel: BRIDGE_V2_CHANNEL,
          source: "server",
          type,
          name: message.name,
          port: typeof message.port === "number" ? message.port : undefined,
          studioUrl: asString(message.studioUrl),
          runtimeUrl: asString(message.runtimeUrl),
          auth: message.auth === "pre-shared-hmac-sha256-v1" ? message.auth : undefined,
          minimumProtocolVersion: typeof message.minimumProtocolVersion === "number"
            ? message.minimumProtocolVersion
            : undefined,
          challenge: asString(message.challenge),
          serverProof: asString(message.serverProof),
        };
      }
      return null;
    case "bridge-hello":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "plugin",
        type,
        file: asString(message.file) ?? "unknown",
        fileKey: asString(message.fileKey) ?? "",
        editor: asString(message.editor) ?? "figma",
        protocolVersion: typeof message.protocolVersion === "number"
          ? message.protocolVersion
          : undefined,
        proof: asString(message.proof),
      };
    case "event":
      if (typeof message.message === "string") {
        return {
          channel: BRIDGE_V2_CHANNEL,
          source: "server",
          type,
          level: normalizeBridgeLevel(message.level),
          message: message.message,
          data: message.data,
        };
      }
      return null;
    case "chat":
      if (typeof message.text === "string") {
        return {
          channel: BRIDGE_V2_CHANNEL,
          source: "server",
          type,
          text: message.text,
          from: asString(message.from) ?? "memoire-terminal",
        };
      }
      return null;
    case "error":
      if (typeof message.message === "string") {
        return {
          channel: BRIDGE_V2_CHANNEL,
          source: "server",
          type,
          message: message.message,
          details: message.details,
        };
      }
      return null;
    case "selection":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "plugin",
        type,
        data: message.data as WidgetSelectionSnapshot,
      };
    case "page-changed":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "plugin",
        type,
        data: {
          page: asRecord(message.data).page as string,
          pageId: asString(asRecord(message.data).pageId) ?? null,
          updatedAt: asNumber(asRecord(message.data).updatedAt) ?? Date.now(),
        },
      };
    case "document-changed":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "plugin",
        type,
        data: {
          changes: asNumber(asRecord(message.data).changes) ?? 0,
          buffered: asNumber(asRecord(message.data).buffered) ?? 0,
          sessionId: asString(asRecord(message.data).sessionId) ?? "unknown",
          runId: asString(asRecord(message.data).runId) ?? null,
          updatedAt: asNumber(asRecord(message.data).updatedAt) ?? Date.now(),
        },
      };
    case "action-result":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "plugin",
        type,
        action: asString(message.action) ?? "unknown",
        result: message.result,
        error: asString(message.error),
      };
    case "sync-data":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "plugin",
        type: "sync-result",
        part: normalizeSyncPart(message.part),
        summary: (message.summary as WidgetSyncSummary | undefined) ?? emptySyncSummary(),
        result: message.result,
        error: asString(message.error),
      };
    case "connection-state":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "plugin",
        type,
        data: message.data as WidgetConnectionState,
      };
    case "job-status":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "plugin",
        type,
        data: message.data as WidgetJob,
      };
    case "heal-result":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "plugin",
        type,
        data: message.data as WidgetHealSummary,
      };
    case "agent-status":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "plugin",
        type,
        data: message.data as AgentBoxState,
      };
    case "token-push":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "server",
        type,
        data: message.data as BridgeTokenPushEnvelope["data"],
      };
    case "variable-changed":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "plugin",
        type,
        data: message.data as BridgeVariableChangedEnvelope["data"],
      };
    case "component-changed":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "plugin",
        type,
        data: message.data as BridgeComponentChangedEnvelope["data"],
      };
    case "agent-register":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "server",
        type,
        data: message.data as AgentRegistryEntry,
      };
    case "agent-deregister":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "server",
        type,
        data: message.data as BridgeAgentDeregisterEnvelope["data"],
      };
    case "agent-message":
      return {
        channel: BRIDGE_V2_CHANNEL,
        source: "server",
        type,
        data: message.data as AgentTaskEnvelope,
      };
    default:
      return null;
  }
}

export function serializeBridgeEnvelope(
  envelope: BridgeEnvelope,
  mode: "legacy" | "v2" = "legacy",
): Record<string, unknown> {
  if (mode === "v2") {
    return envelope as unknown as Record<string, unknown>;
  }

  switch (envelope.type) {
    case "command":
      return {
        type: "command",
        id: envelope.id,
        method: envelope.method,
        params: envelope.params,
      };
    case "response":
      return {
        type: "response",
        id: envelope.id,
        result: envelope.result,
        error: envelope.error,
      };
    case "ping":
    case "pong":
      return { type: envelope.type };
    case "identify":
      return {
        type: "identify",
        name: envelope.name,
        port: envelope.port,
        studioUrl: envelope.studioUrl,
        runtimeUrl: envelope.runtimeUrl,
        auth: envelope.auth,
        minimumProtocolVersion: envelope.minimumProtocolVersion,
        challenge: envelope.challenge,
        serverProof: envelope.serverProof,
      };
    case "bridge-hello":
      return {
        type: "bridge-hello",
        file: envelope.file,
        fileKey: envelope.fileKey,
        editor: envelope.editor,
        protocolVersion: envelope.protocolVersion,
        proof: envelope.proof,
      };
    case "event":
      return {
        type: "event",
        level: envelope.level,
        message: envelope.message,
        data: envelope.data,
      };
    case "chat":
      return {
        type: "chat",
        text: envelope.text,
        from: envelope.from,
      };
    case "error":
      return {
        type: "error",
        message: envelope.message,
        details: envelope.details,
      };
    case "selection":
      return { type: "selection", data: envelope.data };
    case "page-changed":
      return { type: "page-changed", data: envelope.data };
    case "document-changed":
      return { type: "document-changed", data: envelope.data };
    case "action-result":
      return {
        type: "action-result",
        action: envelope.action,
        result: envelope.result,
        error: envelope.error,
      };
    case "sync-result":
      return {
        type: "sync-data",
        part: envelope.part,
        summary: envelope.summary,
        result: envelope.result,
        error: envelope.error,
      };
    case "connection-state":
    case "job-status":
    case "heal-result":
    case "agent-status":
    case "token-push":
    case "variable-changed":
    case "component-changed":
    case "agent-register":
    case "agent-deregister":
    case "agent-message":
      return {
        type: envelope.type,
        data: envelope.data,
      };
  }
}

function normalizeBridgeLevel(value: unknown): BridgeEventEnvelope["level"] {
  if (value === "success" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
}

function normalizeSyncPart(value: unknown): BridgeSyncPart {
  if (value === "components" || value === "styles") {
    return value;
  }
  return "tokens";
}

function emptySyncSummary(): WidgetSyncSummary {
  return {
    tokens: 0,
    components: 0,
    styles: 0,
    partialFailures: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
