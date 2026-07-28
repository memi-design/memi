import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { defaultStudioConfig, saveStudioConfig } from "../config.js";
import { StudioRuntimeServer } from "../server.js";

const servers: StudioRuntimeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("studio provider runtime RPC", () => {
  it("replays canonical traced events for every legacy harness, including shell", async () => {
    const root = await mkdtemp(join(tmpdir(), "memi-provider-runtime-"));
    try {
      const config = defaultStudioConfig(root);
      await saveStudioConfig(root, {
        ...config,
        enabledTools: { ...config.enabledTools, shell: true },
        harnesses: config.harnesses.map((harness) =>
          harness.id === "shell"
            ? { ...harness, enabled: true, command: "sh", defaultModel: "shell-local" }
            : harness),
      });
      const server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();
      const session = await server.startSession({
        harness: "shell",
        cwd: root,
        prompt: "printf 'provider runtime\\n'",
        action: "raw",
      });
      await waitForSession(server, session.id);

      const body = await fetch(`${runtime.url}/api/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "replayEvents",
          requestId: "replay-shell",
          sessionId: session.id,
        }),
      }).then((response) => response.json()) as {
        responses: Array<{ kind: string; event?: Record<string, unknown> }>;
      };
      const events = body.responses
        .filter((response) => response.kind === "event")
        .map((response) => response.event!);

      expect(events.some((event) => event.type === "session.created")).toBe(true);
      expect(events.some((event) => event.type === "model.selected")).toBe(true);
      expect(events.some((event) => event.type === "turn.completed")).toBe(true);
      for (const event of events) {
        expect(event.schemaVersion).toBe(1);
        expect((event.trace as { traceId: string }).traceId).toMatch(/^[0-9a-f]{32}$/);
        expect((event.trace as { spanId: string }).spanId).toMatch(/^[0-9a-f]{16}$/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function waitForSession(server: StudioRuntimeServer, sessionId: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    const session = server.getSession(sessionId);
    if (session && session.status !== "running") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for Studio session");
}
