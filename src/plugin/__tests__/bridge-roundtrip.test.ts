// End-to-end-ish test for the bridge boundary. We don't spin up a real
// WebSocket — instead we pair two in-memory channels so messages flow
// UI-side → plugin-side and back, exercising the full serialize /
// normalize / adapter pipeline without mocking out the shape.

import { describe, expect, it } from "vitest";
import {
  BRIDGE_V2_CHANNEL,
  createBridgeCommandEnvelope,
  createBridgeResponseEnvelope,
  normalizeBridgeMessage,
  serializeBridgeEnvelope,
} from "../shared/bridge.js";
import {
  WIDGET_V2_CHANNEL,
  isWidgetCommandName,
} from "../shared/contracts.js";
import {
  createBridgeCommandDispatch,
  createBridgeHelloMessage,
  resolveBridgeResponse,
  trackBridgeRequest,
  type PendingBridgeRequest,
} from "../ui/bridge-adapter.js";

// A single-hop "network": anything send()-ed is delivered to the peer's
// subscriber on the next microtask so we get a realistic async ordering.
interface Channel {
  send(raw: string): void;
  onMessage(fn: (raw: string) => void): void;
}

function makePair(): [Channel, Channel] {
  let aListener: ((raw: string) => void) | null = null;
  let bListener: ((raw: string) => void) | null = null;
  const a: Channel = {
    send(raw) {
      Promise.resolve().then(() => bListener?.(raw));
    },
    onMessage(fn) {
      aListener = fn;
    },
  };
  const b: Channel = {
    send(raw) {
      Promise.resolve().then(() => aListener?.(raw));
    },
    onMessage(fn) {
      bListener = fn;
    },
  };
  return [a, b];
}

describe("bridge round-trip", () => {
  it("dispatches a command, resolves with a response, and clears the pending map", async () => {
    const [uiChannel, pluginChannel] = makePair();
    const pending = new Map<string, PendingBridgeRequest>();

    // Plugin side: decode, handle, echo a response.
    pluginChannel.onMessage((raw) => {
      const parsed = JSON.parse(raw);
      const message = normalizeBridgeMessage(parsed);
      if (!message || message.type !== "command") return;
      // Validate command name landed on the known list.
      expect(isWidgetCommandName(message.method)).toBe(true);
      const response = createBridgeResponseEnvelope(
        message.id,
        { echoed: message.params },
        undefined,
      );
      pluginChannel.send(JSON.stringify(serializeBridgeEnvelope(response)));
    });

    // UI side: capture the response so the test can assert on it.
    const received: unknown[] = [];
    uiChannel.onMessage((raw) => {
      const parsed = JSON.parse(raw);
      const message = normalizeBridgeMessage(parsed);
      if (message && message.type === "response") {
        received.push(message);
      }
    });

    const command = createBridgeCommandEnvelope("req-1", "getSelection", { nodeId: "abc" });
    const dispatch = createBridgeCommandDispatch(command);
    trackBridgeRequest(pending, dispatch.requestId, command);
    uiChannel.send(JSON.stringify(serializeBridgeEnvelope(command)));

    // Let the microtasks drain — in-memory hop resolves synchronously via
    // Promise.resolve().then so two ticks is sufficient.
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toHaveLength(1);
    const response = received[0] as { type: string; id: string; result?: { echoed: unknown } };
    expect(response.type).toBe("response");
    expect(response.id).toBe("req-1");
    expect(response.result).toEqual({ echoed: { nodeId: "abc" } });

    // Now simulate what the UI does on response arrival: resolve the
    // pending request. The map should empty.
    const resolved = resolveBridgeResponse(pending, {
      channel: WIDGET_V2_CHANNEL,
      source: "main",
      type: "command-result",
      requestId: dispatch.requestId,
      command: dispatch.command,
      ok: true,
      sessionId: "session-test",
      result: response.result,
    });
    expect(resolved).toBeTruthy();
    expect(pending.size).toBe(0);
  });

  it("normalizeBridgeMessage rejects unknown command names", () => {
    const raw = JSON.stringify({
      channel: BRIDGE_V2_CHANNEL,
      source: "server",
      type: "command",
      id: "x",
      method: "rm_rf_root", // not in WIDGET_COMMAND_NAMES
      params: {},
    });
    const parsed = JSON.parse(raw);
    expect(normalizeBridgeMessage(parsed)).toBeNull();
  });

  it("normalizeBridgeMessage rejects structurally-invalid shapes", () => {
    expect(normalizeBridgeMessage(null)).toBeNull();
    expect(normalizeBridgeMessage({})).toBeNull();
    expect(normalizeBridgeMessage({ type: "command" })).toBeNull(); // missing id/method
    expect(normalizeBridgeMessage({ type: "identify" })).toBeNull(); // missing name
    expect(normalizeBridgeMessage({ type: "event" })).toBeNull(); // missing message
  });

  it("keeps v2 identify metadata on the wire for plugin adoption", () => {
    const wire = serializeBridgeEnvelope({
      channel: BRIDGE_V2_CHANNEL,
      source: "server",
      type: "identify",
      name: "Mémoire Terminal",
      port: 9223,
    }, "v2");

    expect(wire).toMatchObject({
      channel: BRIDGE_V2_CHANNEL,
      source: "server",
      type: "identify",
      name: "Mémoire Terminal",
      port: 9223,
    });
    expect(normalizeBridgeMessage(wire)).toMatchObject({
      channel: BRIDGE_V2_CHANNEL,
      source: "server",
      type: "identify",
      name: "Mémoire Terminal",
      port: 9223,
    });
  });

  it("keeps the pre-shared capability out of identify and sends it in protocol-v3 hello", () => {
    const identify = normalizeBridgeMessage({
      channel: BRIDGE_V2_CHANNEL,
      source: "server",
      type: "identify",
      name: "Mémoire",
      auth: "pre-shared-capability-v1",
      minimumProtocolVersion: 3,
    });
    const hello = createBridgeHelloMessage({
      channel: WIDGET_V2_CHANNEL,
      source: "main",
      type: "connection-state",
      fileName: "Design System",
      fileKey: "file-key",
      editorType: "figma",
      online: true,
      sessionId: "session-test",
      updatedAt: Date.now(),
    }, "capability-1");

    expect(identify).toMatchObject({
      type: "identify",
      auth: "pre-shared-capability-v1",
      minimumProtocolVersion: 3,
    });
    expect(identify).not.toHaveProperty("capability");
    expect(hello).toMatchObject({
      type: "bridge-hello",
      protocolVersion: 3,
      capability: "capability-1",
    });
    expect(serializeBridgeEnvelope(hello!, "legacy")).toMatchObject({
      type: "bridge-hello",
      protocolVersion: 3,
      capability: "capability-1",
    });
  });

  it("resolveBridgeResponse ignores mismatched command names", () => {
    const pending = new Map<string, PendingBridgeRequest>();
    trackBridgeRequest(pending, "r1", createBridgeCommandEnvelope("bridge-1", "getSelection", {}));
    const result = resolveBridgeResponse(pending, {
      channel: WIDGET_V2_CHANNEL,
      source: "main",
      type: "command-result",
      requestId: "r1",
      // Wrong method: someone forged a response for a different op
      command: "getVariables",
      ok: true,
      sessionId: "session-test",
      result: null,
    });
    expect(result).toBeNull();
    // Original pending entry preserved (not consumed by the mismatched response)
    expect(pending.has("r1")).toBe(true);
  });

  it("serializes through a round-trip without payload loss on nested params", () => {
    const cmd = createBridgeCommandEnvelope("r1", "updateNode", {
      nodeId: "1:42",
      properties: { x: 10, visible: true, fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }] },
      expectedVersion: "v1-deadbeef",
    });
    const wire = JSON.stringify(serializeBridgeEnvelope(cmd));
    const parsed = JSON.parse(wire);
    const back = normalizeBridgeMessage(parsed);
    expect(back).not.toBeNull();
    if (back && back.type === "command") {
      expect(back.params).toEqual(cmd.params);
      expect(back.method).toBe("updateNode");
    }
  });
});
