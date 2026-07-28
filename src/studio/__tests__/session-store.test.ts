import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { defaultStudioConfig, saveStudioConfig } from "../config.js";
import { StudioRuntimeServer } from "../server.js";

const servers: StudioRuntimeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("studio session store", () => {
  it("redacts prompts, reasoning, and structured secrets before persistence", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-private-store-"));
    try {
      const store = new (await import("../session-store.js")).StudioSessionStore(root);
      store.init();
      const now = new Date().toISOString();
      const session = {
        id: "private-session",
        harness: "codex" as const,
        action: "raw" as const,
        cwd: root,
        prompt: "Audit this OPENAI_API_KEY=sk-proj-secret person@example.com",
        status: "completed" as const,
        startedAt: now,
        completedAt: now,
        exitCode: 0,
        activeStreamId: null,
        pendingPrompt: null,
        events: [],
      };
      store.appendEvent(session, {
        id: "reasoning-1",
        sessionId: session.id,
        type: "reasoning",
        timestamp: now,
        message: "private chain of thought",
        data: { cookie: "session=private", safe: "metadata" },
      });

      const indexRaw = await readFile(join(root, ".memoire", "studio", "session-index.json"), "utf-8");
      const eventRaw = await readFile(join(root, ".memoire", "studio", "sessions", `${session.id}.jsonl`), "utf-8");
      const persisted = `${indexRaw}\n${eventRaw}`;
      expect(persisted).not.toContain("sk-proj-secret");
      expect(persisted).not.toContain("person@example.com");
      expect(persisted).not.toContain("private chain of thought");
      expect(persisted).not.toContain("session=private");
      expect(store.readSessionEvents(session.id)[0]).toMatchObject({
        type: "reasoning",
        message: "[reasoning omitted]",
      });
      expect(store.getSession(session.id)).toMatchObject({
        prompt: "[content omitted]",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists events to jsonl, indexes sessions, and reports runtime metrics", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-store-"));
    try {
      const config = defaultStudioConfig(root);
      await saveStudioConfig(root, {
        ...config,
        enabledTools: { ...config.enabledTools, shell: true },
        harnesses: config.harnesses.map((harness) => (
          harness.id === "shell" ? { ...harness, enabled: true, command: "sh" } : harness
        )),
      });

      const server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();
      const session = await server.startSession({
        harness: "shell",
        cwd: root,
        prompt: "printf 'hello studio\\n'",
        action: "raw",
        conversationId: "conv-store",
        goal: "Keep the persisted session easy to reopen.",
      });
      const finalSession = await waitForSession(server, session.id);

      expect(finalSession.status).toBe("completed");
      expect(finalSession.conversationId).toBe("conv-store");
      expect(finalSession.turnIndex).toBe(0);
      expect(finalSession.goal).toBe("Keep the persisted session easy to reopen.");
      expect(finalSession.events.some((event) => event.type === "stdout" && event.message.includes("hello studio"))).toBe(true);

      const jsonl = await readFile(join(root, ".memoire", "studio", "sessions", `${session.id}.jsonl`), "utf-8");
      const index = JSON.parse(await readFile(join(root, ".memoire", "studio", "session-index.json"), "utf-8"));
      const status = await fetch(`${runtime.url}/api/status`).then((res) => res.json());

      expect(jsonl).toContain("\"type\":\"stdout\"");
      expect(index.sessions[0]).toMatchObject({
        id: session.id,
        harness: "shell",
        status: "completed",
        action: "raw",
        conversationId: "conv-store",
        turnIndex: 0,
        goal: "[content omitted]",
      });
      expect(status.metrics).toMatchObject({
        indexedSessions: 1,
        activeProcesses: 0,
        enabledHarnesses: expect.any(Number),
      });
      expect(status.metrics.eventBufferSize).toBeGreaterThan(0);

      const logs = await fetch(`${runtime.url}/api/logs/${encodeURIComponent(session.id)}?limit=1`).then((res) => res.json());
      expect(logs.session).toMatchObject({ id: session.id, status: "completed", conversationId: "conv-store", goal: "[content omitted]" });
      expect(logs.events).toHaveLength(1);
      expect(logs.events[0].type).toBe("session_done");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("closes subprocess stdin so non-interactive harnesses do not hang waiting for input", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-stdin-"));
    try {
      const config = defaultStudioConfig(root);
      await saveStudioConfig(root, {
        ...config,
        enabledTools: { ...config.enabledTools, shell: true },
        harnesses: config.harnesses.map((harness) => (
          harness.id === "shell" ? { ...harness, enabled: true, command: "sh" } : harness
        )),
      });

      const server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      await server.start();
      const session = await server.startSession({
        harness: "shell",
        cwd: root,
        prompt: "node -e \"process.stdin.resume(); process.stdin.on('end', () => { console.log('stdin closed'); });\"",
        action: "raw",
      });
      const finalSession = await waitForSession(server, session.id);

      expect(finalSession.status).toBe("completed");
      expect(finalSession.events.some((event) => event.type === "stdout" && event.message.includes("stdin closed"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function waitForSession(server: StudioRuntimeServer, sessionId: string) {
  for (let i = 0; i < 60; i += 1) {
    const session = server.getSession(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    if (session.status !== "running") return session;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for session");
}
