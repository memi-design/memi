import { createServer } from "node:net";
import { createHmac } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { MemoireWsServer } from "../ws-server.js";
import { authenticateBridgeIdentify } from "../../plugin/ui/bridge-auth.js";
import type { BridgeIdentifyEnvelope } from "../../plugin/shared/bridge.js";

const TEST_CAPABILITY = "A".repeat(43);
const CLIENT_PROOF_DOMAIN = "memoire-figma-bridge-v3:client:";
const SERVER_PROOF_DOMAIN = "memoire-figma-bridge-v3:server:";

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
  let fakeServer: WebSocketServer | null = null;

  afterEach(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    fakeServer?.close();
    bridge?.stop();
    socket = null;
    fakeServer = null;
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
      auth: "pre-shared-hmac-sha256-v1",
      minimumProtocolVersion: 3,
    });
    expect(identify).not.toHaveProperty("capability");
    expect(identify.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(identify.serverProof).toBe(
      createHmac("sha256", TEST_CAPABILITY)
        .update(`${SERVER_PROOF_DOMAIN}${String(identify.challenge)}`)
        .digest("base64url"),
    );
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
    const identify = await waitForMessage(socket);
    const challenge = String(identify.challenge);
    const proof = createHmac("sha256", TEST_CAPABILITY)
      .update(`${CLIENT_PROOF_DOMAIN}${challenge}`)
      .digest("base64url");
    const connected = new Promise<void>((resolve, reject) => {
      bridge?.once("client-connected", () => resolve());
      socket?.once("error", reject);
      socket?.once("close", (_code, reason) => reject(new Error(reason.toString())));
    });
    socket.send(JSON.stringify({
      channel: "memoire.bridge.v2",
      source: "plugin",
      type: "bridge-hello",
      file: "Secure plugin",
      fileKey: "file-key",
      editor: "figma",
      protocolVersion: 3,
      proof,
    }));

    await connected;
    expect(bridge.connectedClients).toHaveLength(1);
    expect(JSON.stringify({ proof })).not.toContain(TEST_CAPABILITY);
  });

  it("rejects a forged HMAC proof without exposing the shared secret", async () => {
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
      file: "Forged plugin",
      fileKey: "",
      editor: "figma",
      protocolVersion: 3,
      proof: "B".repeat(43),
    }));

    await expect(closed).resolves.toEqual({
      code: 1008,
      reason: "Invalid bridge authentication proof",
    });
    expect(bridge.connectedClients).toHaveLength(0);
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

  it("sends no client proof to a socket presenting an invalid server proof", async () => {
    const port = await availablePort();
    fakeServer = new WebSocketServer({ host: "127.0.0.1", port });
    await new Promise<void>((resolve, reject) => {
      fakeServer?.once("listening", resolve);
      fakeServer?.once("error", reject);
    });
    let receivedFrames = 0;
    fakeServer.on("connection", (peer) => {
      peer.on("message", () => {
        receivedFrames += 1;
      });
      peer.send(JSON.stringify({
        channel: "memoire.bridge.v2",
        source: "server",
        type: "identify",
        name: "Imposter",
        auth: "pre-shared-hmac-sha256-v1",
        minimumProtocolVersion: 3,
        challenge: "C".repeat(43),
        serverProof: "D".repeat(43),
      }));
    });

    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      socket?.once("message", async (data) => {
        try {
          const identify = JSON.parse(data.toString()) as Record<string, unknown>;
          const proof = await authenticateBridgeIdentify(
            TEST_CAPABILITY,
            identify as Partial<BridgeIdentifyEnvelope>,
          );
          socket?.send(JSON.stringify({ type: "bridge-hello", proof }));
          reject(new Error("Invalid server proof was accepted"));
        } catch {
          socket?.close();
          resolve();
        }
      });
      socket?.once("error", reject);
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(receivedFrames).toBe(0);
    await new Promise<void>((resolve, reject) => {
      fakeServer?.close((error) => error ? reject(error) : resolve());
    });
    fakeServer = null;
    socket = null;
  });
});
