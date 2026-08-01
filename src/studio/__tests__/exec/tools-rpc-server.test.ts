import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createConnection } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveToolsRpcEndpoint,
  ToolsRpcServer,
  type ToolRunner,
} from "../../exec/tools-rpc-server.js";
import { createDecoderState, decodeChunk, encodeMessage } from "../../exec/tools-rpc-protocol.js";

function makeRunner(allowed: string[], handler: (tool: string, args: unknown) => unknown | Promise<unknown>): ToolRunner {
  return {
    allowedTools: () => allowed,
    run: async (ctx) => handler(ctx.tool, ctx.args),
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function withClient(socketPath: string, fn: (send: (msg: unknown) => void, received: unknown[]) => Promise<void>) {
  const received: unknown[] = [];
  const decoder = createDecoderState();
  const sock = createConnection(socketPath);
  await new Promise<void>((resolve, reject) => {
    sock.once("connect", () => resolve());
    sock.once("error", reject);
  });
  sock.on("data", (chunk) => {
    for (const msg of decodeChunk(decoder, chunk.toString("utf-8"))) {
      received.push(msg);
    }
  });
  try {
    await fn((msg) => sock.write(encodeMessage(msg as Parameters<typeof encodeMessage>[0])), received);
  } finally {
    sock.destroy();
  }
}

describe("exec/tools-rpc-server", () => {
  let dir: string;
  let socketPath: string;
  let server: ToolsRpcServer | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "memi-tools-rpc-"));
    socketPath = join(dir, "tools.sock");
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("uses a Windows named pipe instead of a filesystem socket path", () => {
    const endpoint = resolveToolsRpcEndpoint(
      "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\memi-execcode-a1b2c3",
      "win32",
    );

    expect(endpoint).toMatch(/^\\\\\\.\\pipe\\memi-tools-[a-f0-9]{24}$/);
    expect(endpoint).not.toContain("runneradmin");
    expect(endpoint).not.toContain("tools.sock");
  });

  it("keeps the per-execution filesystem socket on non-Windows platforms", () => {
    expect(resolveToolsRpcEndpoint("/tmp/memi-execcode-a1b2c3", "darwin")).toBe(
      "/tmp/memi-execcode-a1b2c3/tools.sock",
    );
  });

  it("isolates named pipes for distinct execution directories", () => {
    const first = resolveToolsRpcEndpoint("C:\\Temp\\memi-execcode-first", "win32");
    const second = resolveToolsRpcEndpoint("C:\\Temp\\memi-execcode-second", "win32");

    expect(first).not.toBe(second);
  });

  it("listen + close cleanly with no clients", async () => {
    server = new ToolsRpcServer({
      socketPath,
      runner: makeRunner(["Read"], () => "ok"),
    });
    await server.listen();
    await server.close();
  });

  it("a client tool request gets dispatched + responded", async () => {
    server = new ToolsRpcServer({
      socketPath,
      runner: makeRunner(["Read"], (tool, args) => ({ tool, args })),
    });
    await server.listen();

    await withClient(socketPath, async (send, received) => {
      send({ id: 7, op: "tool", tool: "Read", args: { path: "x.ts" } });
      await waitUntil(() => received.length === 1);
      expect(received.length).toBe(1);
      const response = received[0] as { id: number; ok: boolean; result?: { tool: string } };
      expect(response.id).toBe(7);
      expect(response.ok).toBe(true);
      expect(response.result?.tool).toBe("Read");
    });
  });

  it("disallowed tool returns ok=false with an error", async () => {
    server = new ToolsRpcServer({
      socketPath,
      runner: makeRunner(["Read"], () => "should not reach"),
    });
    await server.listen();

    await withClient(socketPath, async (send, received) => {
      send({ id: 1, op: "tool", tool: "Bash", args: { command: "rm -rf /" } });
      await waitUntil(() => received.length === 1);
      const response = received[0] as { ok: boolean; error?: string };
      expect(response.ok).toBe(false);
      expect(response.error).toMatch(/not in allowlist/);
    });
  });

  it("runner throws → ok=false with error message", async () => {
    server = new ToolsRpcServer({
      socketPath,
      runner: makeRunner(["Read"], () => {
        throw new Error("disk on fire");
      }),
    });
    await server.listen();

    await withClient(socketPath, async (send, received) => {
      send({ id: 1, op: "tool", tool: "Read", args: {} });
      await waitUntil(() => received.length === 1);
      const response = received[0] as { ok: boolean; error?: string };
      expect(response.ok).toBe(false);
      expect(response.error).toBe("disk on fire");
    });
  });

  it("log requests fire onLog callback", async () => {
    const logs: Array<{ level: string; message: string }> = [];
    server = new ToolsRpcServer({
      socketPath,
      runner: makeRunner([], () => undefined),
      onLog: (entry) => logs.push({ level: entry.level, message: entry.message }),
    });
    await server.listen();

    await withClient(socketPath, async (send) => {
      send({ id: 1, op: "log", level: "info", message: "step 1 done" });
      await waitUntil(() => logs.length === 1);
    });
    expect(logs).toEqual([{ level: "info", message: "step 1 done" }]);
  });

  it("exit message resolves waitForExit", async () => {
    server = new ToolsRpcServer({
      socketPath,
      runner: makeRunner([], () => undefined),
    });
    await server.listen();

    let final: { ok: boolean; result?: unknown } | null = null;
    const waitPromise = server.waitForExit().then((r) => {
      final = r;
    });

    await withClient(socketPath, async (send) => {
      send({ id: 1, op: "exit", ok: true, result: { found: 42 } });
      await waitUntil(() => final !== null);
    });

    await waitPromise;
    expect(final).toEqual({ ok: true, result: { found: 42 }, error: undefined });
  });

  it("client disconnects without exit → waitForExit resolves with error", async () => {
    server = new ToolsRpcServer({
      socketPath,
      runner: makeRunner([], () => undefined),
    });
    await server.listen();

    const waitPromise = server.waitForExit();

    await withClient(socketPath, async () => {
      // disconnect immediately by leaving the with-block
    });

    const final = await waitPromise;
    expect(final.ok).toBe(false);
    expect(final.error).toMatch(/disconnected/);
  });

  it("waitForExit timeout fires if script hangs", async () => {
    server = new ToolsRpcServer({
      socketPath,
      runner: makeRunner([], () => undefined),
    });
    await server.listen();

    const final = await server.waitForExit(50);
    expect(final.ok).toBe(false);
    expect(final.error).toMatch(/timed out/);
  });

  it("multiple parallel tool requests get distinct responses by id", async () => {
    server = new ToolsRpcServer({
      socketPath,
      runner: makeRunner(["Read"], (tool, args) => ({ tool, args })),
    });
    await server.listen();

    await withClient(socketPath, async (send, received) => {
      for (let i = 1; i <= 5; i += 1) {
        send({ id: i, op: "tool", tool: "Read", args: { i } });
      }
      await waitUntil(() => received.length === 5);
      expect(received.length).toBe(5);
      const ids = (received as Array<{ id: number }>).map((r) => r.id).sort();
      expect(ids).toEqual([1, 2, 3, 4, 5]);
    });
  });
});
