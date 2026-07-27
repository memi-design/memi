import type {
  WidgetCommandResultEnvelope,
  WidgetConnectionState,
  WidgetJob,
  WidgetSelectionSnapshot,
  WidgetSyncSummary,
  WidgetCommandName,
} from "../shared/contracts.js";
import { createRunId } from "../shared/contracts.js";
import type {
  BridgeCommandEnvelope,
  BridgeComponentChangedEnvelope,
  BridgeConnectionStateEnvelope,
  BridgeDocumentChangedEnvelope,
  BridgeHelloEnvelope,
  BridgeJobStatusEnvelope,
  BridgePageChangedEnvelope,
  BridgeResponseEnvelope,
  BridgeSelectionEnvelope,
  BridgeSyncPart,
  BridgeSyncResultEnvelope,
  BridgeVariableChangedEnvelope,
} from "../shared/bridge.js";
import { BRIDGE_V2_CHANNEL, createBridgeResponseEnvelope } from "../shared/bridge.js";

export interface PendingBridgeRequest {
  bridgeId: string;
  command: WidgetCommandName;
}

export function createBridgeCommandDispatch(message: BridgeCommandEnvelope): {
  requestId: string;
  command: WidgetCommandName;
  params: Record<string, unknown>;
} {
  return {
    requestId: createRunId("bridge"),
    command: message.method,
    params: message.params,
  };
}

export function trackBridgeRequest(
  pending: Map<string, PendingBridgeRequest>,
  requestId: string,
  message: BridgeCommandEnvelope,
): void {
  pending.set(requestId, {
    bridgeId: message.id,
    command: message.method,
  });
}

export function resolveBridgeResponse(
  pending: Map<string, PendingBridgeRequest>,
  message: WidgetCommandResultEnvelope,
): BridgeResponseEnvelope | null {
  const matched = pending.get(message.requestId);
  if (!matched || matched.command !== message.command) {
    return null;
  }
  pending.delete(message.requestId);
  return createBridgeResponseEnvelope(matched.bridgeId, message.result, message.error);
}

export function createBridgeHelloMessage(
  connection: WidgetConnectionState,
  capability?: string,
): BridgeHelloEnvelope {
  return {
    channel: BRIDGE_V2_CHANNEL,
    source: "plugin",
    type: "bridge-hello",
    file: connection.fileName || "unknown",
    fileKey: connection.fileKey || "",
    editor: connection.editorType || "figma",
    capability,
  };
}

export function createBridgeSelectionMessage(
  selection: WidgetSelectionSnapshot,
): BridgeSelectionEnvelope {
  return {
    channel: BRIDGE_V2_CHANNEL,
    source: "plugin",
    type: "selection",
    data: selection,
  };
}

export function createBridgePageChangedMessage(
  pageName: string,
  pageId: string | null,
  updatedAt: number,
): BridgePageChangedEnvelope {
  return {
    channel: BRIDGE_V2_CHANNEL,
    source: "plugin",
    type: "page-changed",
    data: {
      page: pageName,
      pageId,
      updatedAt,
    },
  };
}

export function createBridgeDocumentChangedMessage(
  changes: number,
  buffered: number,
  sessionId: string,
  runId: string | null,
  updatedAt: number,
): BridgeDocumentChangedEnvelope {
  return {
    channel: BRIDGE_V2_CHANNEL,
    source: "plugin",
    type: "document-changed",
    data: {
      changes,
      buffered,
      sessionId,
      runId,
      updatedAt,
    },
  };
}

export function createBridgeConnectionStateMessage(
  connection: WidgetConnectionState,
): BridgeConnectionStateEnvelope {
  return {
    channel: BRIDGE_V2_CHANNEL,
    source: "plugin",
    type: "connection-state",
    data: connection,
  };
}

export function createBridgeJobStatusMessage(job: WidgetJob): BridgeJobStatusEnvelope {
  return {
    channel: BRIDGE_V2_CHANNEL,
    source: "plugin",
    type: "job-status",
    data: job,
  };
}

export function createBridgeSyncResultMessage(
  part: BridgeSyncPart,
  result: unknown,
  error?: string,
): BridgeSyncResultEnvelope {
  return {
    channel: BRIDGE_V2_CHANNEL,
    source: "plugin",
    type: "sync-result",
    part,
    summary: summarizeSyncResult(part, result, error),
    result,
    error,
  };
}

export function createBridgeVariableChangedMessage(
  data: { name: string; collection: string; values: Record<string, string | number>; updatedAt: number },
): BridgeVariableChangedEnvelope {
  return {
    channel: BRIDGE_V2_CHANNEL,
    source: "plugin",
    type: "variable-changed",
    data,
  };
}

export function createBridgeComponentChangedMessage(
  data: { name: string; key: string; figmaNodeId: string; updatedAt: number },
): BridgeComponentChangedEnvelope {
  return {
    channel: BRIDGE_V2_CHANNEL,
    source: "plugin",
    type: "component-changed",
    data,
  };
}

export function summarizeSyncResult(
  part: BridgeSyncPart,
  result: unknown,
  error?: string,
): WidgetSyncSummary {
  const summary: WidgetSyncSummary = {
    tokens: 0,
    components: 0,
    styles: 0,
    partialFailures: error ? [error] : [],
  };

  if (part === "tokens") {
    const collections = (result as { collections?: unknown[] } | null)?.collections || [];
    summary.tokens = Array.isArray(collections) ? collections.length : 0;
  }

  if (part === "components") {
    summary.components = Array.isArray(result) ? result.length : 0;
  }

  if (part === "styles") {
    summary.styles = Array.isArray(result) ? result.length : 0;
  }

  return summary;
}
