import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { defaultStudioConfig, saveStudioConfig } from "../config.js";
import { StudioRuntimeServer } from "../server.js";

const servers: StudioRuntimeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("studio runtime server", () => {
  it("serves status and harness metadata as localhost JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-server-"));
    try {
      const server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();

      const status = await fetch(`${runtime.url}/api/status`).then((res) => res.json());
      const harnesses = await fetch(`${runtime.url}/api/harnesses`).then((res) => res.json());

      expect(status.status).toBe("running");
      expect(status.projectRoot).toBe(root);
      expect(status.config.defaultHarness).toBe("codex");
      expect(status.sessions).toBeUndefined();
      expect(status.indexedSessions).toBeUndefined();
      expect(status.metrics.indexedSessions).toEqual(expect.any(Number));
      expect(harnesses.harnesses.map((harness: { id: string }) => harness.id)).toContain("codex");
    } finally {
      await stopServersAndRemove(root);
    }
  });

  it("serves a stable empty usage snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-usage-"));
    try {
      const server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();

      const response = await fetch(`${runtime.url}/api/usage`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.usage).toMatchObject({
        sessions: [],
        totals: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          estimatedCostUsd: 0,
        },
        byHarness: {},
        byProvider: {},
        rateLimits: [],
        budgets: {
          warningThreshold: 0.8,
          providers: {},
          harnesses: {},
        },
      });
    } finally {
      await stopServersAndRemove(root);
    }
  });

  it("rejects session starts outside configured workspace roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-server-"));
    try {
      const server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();

      const response = await fetch(`${runtime.url}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          harness: "memoire",
          cwd: join(root, "..", "outside-workspace"),
          prompt: "hello",
        }),
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/workspace/i) });
    } finally {
      await stopServersAndRemove(root);
    }
  });

  it("serves agent kit install plans and dry-run installer results", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-agent-kits-"));
    try {
      const server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();

      const planned = await fetch(`${runtime.url}/api/agents/kits?target=openclaw`).then((res) => res.json());
      const installed = await fetch(`${runtime.url}/api/agents/kits/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "openclaw", dryRun: true }),
      }).then((res) => res.json());

      expect(planned.targets).toContain("openclaw");
      expect(planned.plans).toEqual([
        expect.objectContaining({
          target: "openclaw",
          kind: "skill",
          destination: join(root, "skills", "memoire", "memoire-design-tooling"),
        }),
      ]);
      expect(installed).toMatchObject({
        action: "install",
        status: "planned",
        target: "openclaw",
        dryRun: true,
      });
    } finally {
      await stopServersAndRemove(root);
    }
  });

  it("journals Codex sessions as ProviderRuntimeEvents and replays them through /api/rpc", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-rpc-"));
    try {
      const codexScript = join(root, "exec");
      const outputScript = "process.stdout.write(JSON.stringify({ type: 'agent_message', message: 'done' }) + '\\n');\n";
      await writeFile(codexScript, outputScript);
      const config = defaultStudioConfig(root);
      await saveStudioConfig(root, {
        ...config,
        harnesses: config.harnesses.map((harness) =>
          harness.id === "codex"
            ? { ...harness, command: process.execPath }
            : harness),
      });

      const server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();

      const created = await fetch(`${runtime.url}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          harness: "codex",
          cwd: root,
          prompt: "hello",
          action: "raw",
        }),
      }).then((res) => res.json());

      await waitFor(() => server.getSession(created.session.id)?.status === "completed");
      await waitFor(async () => {
        const rpc = await replayEvents(runtime.url, created.session.id);
        return eventTypesFromRpc(rpc).includes("turn.completed");
      });
      const rpc = await replayEvents(runtime.url, created.session.id);

      const eventTypes = eventTypesFromRpc(rpc);
      expect(eventTypes).toEqual(expect.arrayContaining([
        "message.user",
        "session.created",
        "turn.completed",
      ]));
      expect(rpc.responses.some((response: { kind: string }) => response.kind === "end")).toBe(true);
    } finally {
      await stopServersAndRemove(root);
    }
  });
});

async function stopServersAndRemove(root: string): Promise<void> {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: process.platform === "win32" ? 5 : 0,
    retryDelay: 50,
  });
}

async function replayEvents(runtimeUrl: string, sessionId: string): Promise<{ responses: Array<{ kind: string; event?: { type: string } }> }> {
  return fetch(`${runtimeUrl}/api/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      op: "replayEvents",
      requestId: "r1",
      sessionId,
    }),
  }).then((res) => res.json());
}

function eventTypesFromRpc(rpc: { responses: Array<{ kind: string; event?: { type: string } }> }): string[] {
  return rpc.responses
    .filter((response) => response.kind === "event" && response.event)
    .map((response) => response.event?.type ?? "");
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}
