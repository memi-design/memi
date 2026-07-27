import { createServer } from "node:net";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { MemoireWsServer } from "../ws-server.js";

const TEST_CAPABILITY = "A".repeat(43);

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate an ephemeral test port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

function waitForMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    socket.once("error", reject);
  });
}

describe("Figma bridge authenticated WebSocket boundary", () => {
  let bridge: MemoireWsServer | null = null;
  let socket: WebSocket | null = null;

  afterEach(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    bridge?.stop();
    socket = null;
    bridge = null;
  });

  it("never discloses the pre-shared capability to an unauthenticated socket", async () => {
    const port = await availablePort();
    bridge = new MemoireWsServer({ port, capabilityToken: TEST_CAPABILITY });
    await bridge.start();

    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const identify = await waitForMessage(socket);

    expect(identify).toMatchObject({
      type: "identify",
      auth: "pre-shared-capability-v1",
      minimumProtocolVersion: 3,
    });
    expect(identify).not.toHaveProperty("capability");
    expect(JSON.stringify(identify)).not.toContain(TEST_CAPABILITY);
    expect(bridge.connectedClients).toHaveLength(0);
  });

  it("rejects a legacy capability-less plugin with an explicit upgrade path", async () => {
    const port = await availablePort();
    bridge = new MemoireWsServer({ port, capabilityToken: TEST_CAPABILITY });
    await bridge.start();

    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await waitForMessage(socket);
    const closed = waitForClose(socket);
    socket.send(JSON.stringify({
      channel: "memoire.bridge.v2",
      source: "plugin",
      type: "bridge-hello",
      file: "Legacy plugin",
      fileKey: "",
      editor: "figma",
    }));

    await expect(closed).resolves.toEqual({
      code: 1008,
      reason: "Plugin upgrade required: run memi setup plugin",
    });
    expect(bridge.connectedClients).toHaveLength(0);
  });

  it("accepts only a protocol-v3 plugin that already possesses the capability", async () => {
    const port = await availablePort();
    bridge = new MemoireWsServer({ port, capabilityToken: TEST_CAPABILITY });
    await bridge.start();

    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await waitForMessage(socket);
    socket.send(JSON.stringify({
      channel: "memoire.bridge.v2",
      source: "plugin",
      type: "bridge-hello",
      file: "Secure plugin",
      fileKey: "file-key",
      editor: "figma",
      protocolVersion: 3,
      capability: TEST_CAPABILITY,
    }));

    await new Promise<void>((resolve, reject) => {
      bridge?.once("client-connected", () => resolve());
      socket?.once("error", reject);
    });
    expect(bridge.connectedClients).toHaveLength(1);
  });

  it("rejects ordinary browser origins during the HTTP upgrade", async () => {
    const port = await availablePort();
    bridge = new MemoireWsServer({ port, capabilityToken: TEST_CAPABILITY });
    await bridge.start();

    const status = await new Promise<number>((resolve, reject) => {
      socket = new WebSocket(`ws://127.0.0.1:${port}`, {
        origin: "https://attacker.example",
      });
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      socket.once("open", () => reject(new Error("Attacker origin reached the bridge")));
      socket.once("error", () => {
        // ws emits an error after an intentionally rejected upgrade.
      });
    });

    expect(status).toBe(403);
    expect(bridge.connectedClients).toHaveLength(0);
  });
});
