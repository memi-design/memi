import { describe, expect, it } from "vitest";
import { EventEmitter } from "events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PREVIEW_BIND_HOST,
  PreviewApiServer,
  isAllowedPreviewHost,
  isAllowedPreviewOrigin,
  isAuthorizedPreviewMutation,
  resolvePreviewStaticPath,
} from "../api-server.js";

describe("PreviewApiServer", () => {
  it("serves the authenticated preview, registry, research, and agent APIs end to end", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-preview-api-"));
    const staticDir = join(projectRoot, "preview");
    await mkdir(staticDir, { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<h1>Memi preview</h1>");
    const componentDir = join(projectRoot, "generated", "components", "ui", "Button");
    await mkdir(componentDir, { recursive: true });
    await writeFile(join(componentDir, "Button.tsx"), [
      "import { cn } from \"clsx\";",
      "import { Badge } from \"@/components/ui/Badge\";",
      "export function Button() { return <button className={cn(\"button\")}><Badge /></button>; }",
    ].join("\n"));

    const figma = new EventEmitter() as EventEmitter & {
      isConnected: boolean;
      wsServer: {
        activePort: number;
        getStatus: () => {
          running: boolean;
          port: number;
          clients: never[];
        };
        sendCommand: (command: string) => Promise<unknown>;
      };
      getSelection: () => Promise<unknown>;
      getPageTree: () => Promise<unknown>;
      extractStickies: () => Promise<unknown>;
      extractDesignSystem: () => Promise<unknown>;
    };
    figma.isConnected = true;
    figma.wsServer = {
      activePort: 9223,
      getStatus: () => ({ running: true, port: 9223, clients: [] }),
      sendCommand: async (command) => ({ command }),
    };
    figma.getSelection = async () => ({ nodes: [{ id: "1:2", name: "Button" }] });
    figma.getPageTree = async () => ({ pages: [{ id: "page-1", name: "Home" }] });
    figma.extractStickies = async () => ({ stickies: [] });
    figma.extractDesignSystem = async () => ({ tokens: 4, components: 1 });

    const specs = [
      { name: "Dashboard", researchBacking: ["finding-1"] },
      { name: "Button" },
    ];
    const engine = new EventEmitter() as EventEmitter & Record<string, unknown>;
    Object.assign(engine, {
      config: { projectRoot },
      registry: {
        getAllSpecs: async () => specs,
        designSystem: { tokens: [{ name: "color.ruby", value: "#ff5470" }] },
      },
      figma,
      sync: {
        getConflicts: () => [{ name: "color.ruby" }],
        isGuarded: true,
        resolveConflict: (name: string, resolution: string) =>
          name === "color.ruby" && resolution === "code",
      },
      agentRegistry: {
        getAll: () => [
          { id: "agent-1", status: "online" },
          { id: "agent-2", status: "busy" },
        ],
      },
      taskQueue: {
        getStats: () => ({ pending: 1, running: 1, completed: 2, failed: 0 }),
      },
      research: {
        load: async () => undefined,
        getStore: () => ({
          version: 2,
          sources: [],
          observations: [],
          findings: [{ id: "finding-1" }],
          themes: [],
        }),
      },
    });

    const server = new PreviewApiServer(engine as never, staticDir, 0);
    server.setPipeline({
      getStats: () => ({ pullCount: 1, specCount: 2, generateCount: 3, errorCount: 0, queueDepth: 1 }),
      getRecentEvents: () => [{ type: "generate", timestamp: "2026-07-29T00:00:00.000Z", detail: "Button" }],
    });

    try {
      const port = await server.start();
      const baseUrl = `http://${PREVIEW_BIND_HOST}:${port}`;
      const firstResponse = await fetch(`${baseUrl}/api/specs`);
      const cookie = firstResponse.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toContain("memoire_preview_session=");
      expect(await firstResponse.json()).toEqual(specs);

      await expect(fetchJson(`${baseUrl}/api/tokens`)).resolves.toMatchObject({
        tokens: [{ name: "color.ruby" }],
      });
      await expect(fetchJson(`${baseUrl}/api/status`)).resolves.toMatchObject({
        connected: true,
        port: 9223,
      });
      await expect(fetchJson(`${baseUrl}/api/pipeline/stats`)).resolves.toMatchObject({
        generateCount: 3,
      });
      await expect(fetchJson(`${baseUrl}/api/pipeline/events`)).resolves.toEqual([
        expect.objectContaining({ type: "generate" }),
      ]);
      await expect(fetchJson(`${baseUrl}/api/sync/state`)).resolves.toMatchObject({
        conflictCount: 1,
        isGuarded: true,
      });
      await expect(fetchJson(`${baseUrl}/api/agents`)).resolves.toMatchObject({
        agentCount: 2,
        online: 1,
        busy: 1,
      });
      await expect(fetchJson(`${baseUrl}/api/research`)).resolves.toMatchObject({
        version: 2,
        coverage: { covered: 1, total: 2, ratio: 0.5 },
      });

      const registry = await fetchJson(`${baseUrl}/r/registry.json`) as { items: unknown[] };
      expect(registry.items).toHaveLength(1);
      await expect(fetchJson(`${baseUrl}/r/Button.json`)).resolves.toMatchObject({
        name: "Button",
        dependencies: ["clsx"],
        registryDependencies: ["Badge"],
      });
      const missingRegistryItem = await fetch(`${baseUrl}/r/Missing.json`);
      expect(missingRegistryItem.status).toBe(404);
      const invalidRegistryItem = await fetch(`${baseUrl}/r/%3Cscript%3E.json`);
      expect(invalidRegistryItem.status).toBe(400);

      const indexResponse = await fetch(baseUrl);
      expect(await indexResponse.text()).toContain("Memi preview");
      expect((await fetch(`${baseUrl}/missing.txt`)).status).toBe(404);
      expect((await fetch(`${baseUrl}/api/missing`)).status).toBe(404);

      const unauthorizedAction = await fetch(`${baseUrl}/api/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inspect" }),
      });
      expect(unauthorizedAction.status).toBe(403);

      const actionHeaders = {
        "Content-Type": "application/json",
        Origin: baseUrl,
        Cookie: cookie ?? "",
      };
      const inspectAction = await fetch(`${baseUrl}/api/action`, {
        method: "POST",
        headers: actionHeaders,
        body: JSON.stringify({ action: "inspect" }),
      });
      expect(inspectAction.status).toBe(200);
      expect(await inspectAction.json()).toMatchObject({
        ok: true,
        result: { nodes: [{ id: "1:2" }] },
      });
      for (const action of ["pull-tokens", "pull-components", "page-tree", "stickies", "full-sync"]) {
        const response = await fetch(`${baseUrl}/api/action`, {
          method: "POST",
          headers: actionHeaders,
          body: JSON.stringify({ action }),
        });
        expect(response.status).toBe(200);
      }

      const unknownAction = await fetch(`${baseUrl}/api/action`, {
        method: "POST",
        headers: actionHeaders,
        body: JSON.stringify({ action: "delete-project" }),
      });
      expect(unknownAction.status).toBe(400);

      const resolveResponse = await fetch(`${baseUrl}/api/sync/resolve`, {
        method: "POST",
        headers: actionHeaders,
        body: JSON.stringify({ name: "color.ruby", resolution: "code" }),
      });
      expect(await resolveResponse.json()).toEqual({
        ok: true,
        name: "color.ruby",
        resolution: "code",
      });

      const preflight = await fetch(`${baseUrl}/api/action`, {
        method: "OPTIONS",
        headers: { Origin: baseUrl },
      });
      expect(preflight.status).toBe(204);
      const blockedPreflight = await fetch(`${baseUrl}/api/action`, {
        method: "OPTIONS",
        headers: { Origin: "https://attacker.example" },
      });
      expect(blockedPreflight.status).toBe(403);
    } finally {
      server.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns the operating-system assigned port when started with port zero", async () => {
    const figma = new EventEmitter() as EventEmitter & {
      isConnected: boolean;
      wsServer: {
        activePort: number;
        getStatus: () => {
          running: boolean;
          port: number;
          clients: never[];
        };
      };
    };
    figma.isConnected = false;
    figma.wsServer = {
      activePort: 0,
      getStatus: () => ({ running: false, port: 0, clients: [] }),
    };

    const engine = new EventEmitter() as EventEmitter & {
      config: { projectRoot: string };
      registry: {
        getAllSpecs: () => Promise<unknown[]>;
        designSystem: unknown;
      };
      figma: typeof figma;
      on: EventEmitter["on"];
      off: EventEmitter["off"];
    };
    engine.config = { projectRoot: "/tmp/memoire-preview-port-test" };
    engine.registry = {
      getAllSpecs: async () => [],
      designSystem: { tokens: [] },
    };
    engine.figma = figma;

    const server = new PreviewApiServer(engine as never, "/tmp/memoire-preview-port-test", 0);
    try {
      const port = await server.start();
      expect(port).toBeGreaterThan(0);

      const response = await fetch(`http://${PREVIEW_BIND_HOST}:${port}/api/status`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        connected: false,
        port: null,
      });
    } finally {
      server.stop();
    }
  });

  it("binds the local preview control plane to loopback", () => {
    expect(PREVIEW_BIND_HOST).toBe("127.0.0.1");
  });

  it("resolves Windows static files without weakening the traversal guard", () => {
    const root = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\memoire\\preview";

    expect(resolvePreviewStaticPath(root, "/index.html")).toBe(`${root}\\index.html`);
    expect(resolvePreviewStaticPath(root, "/../secret.txt")).toBeNull();
    expect(resolvePreviewStaticPath(root, "D:\\secret.txt")).toBeNull();
  });

  it("rejects DNS-rebinding hosts and cross-origin mutation requests", () => {
    expect(isAllowedPreviewHost("attacker.example:4044", 4044)).toBe(false);
    expect(isAllowedPreviewHost("localhost:4044", 4044)).toBe(true);
    expect(isAllowedPreviewHost("127.0.0.1:4044", 4044)).toBe(true);
    expect(isAllowedPreviewOrigin("https://attacker.example", 4044)).toBe(false);
    expect(isAllowedPreviewOrigin("http://localhost:4044", 4044)).toBe(true);
    expect(isAllowedPreviewOrigin("http://127.0.0.1:4044", 4044)).toBe(true);
  });

  it("requires the same-site preview session for state-changing requests", () => {
    const token = "preview-session-token";
    expect(isAuthorizedPreviewMutation({
      host: "localhost:4044",
      origin: "http://localhost:4044",
      cookie: `memoire_preview_session=${token}`,
    }, 4044, token)).toBe(true);
    expect(isAuthorizedPreviewMutation({
      host: "localhost:4044",
      origin: "https://attacker.example",
      cookie: `memoire_preview_session=${token}`,
    }, 4044, token)).toBe(false);
    expect(isAuthorizedPreviewMutation({
      host: "localhost:4044",
      origin: "http://localhost:4044",
      cookie: "memoire_preview_session=wrong",
    }, 4044, token)).toBe(false);
  });

  it("builds widget status payloads from cached figma events", async () => {
    const figma = new EventEmitter() as EventEmitter & {
      isConnected: boolean;
      wsServer: {
        activePort: number;
        getStatus: () => {
          running: boolean;
          port: number;
          clients: { id: string; file: string; editor: string; connectedAt: string }[];
        };
      };
    };
    figma.isConnected = true;
    figma.wsServer = {
      activePort: 9223,
      getStatus: () => ({
        running: true,
        port: 9223,
        clients: [{ id: "plugin-1", file: "Design System", editor: "figma", connectedAt: "2026-03-27T00:00:00.000Z" }],
      }),
    };

    const engine = new EventEmitter() as EventEmitter & {
      config: { projectRoot: string };
      registry: {
        getAllSpecs: () => Promise<unknown[]>;
        designSystem: unknown;
      };
      figma: typeof figma;
      on: EventEmitter["on"];
      off: EventEmitter["off"];
    };
    engine.config = { projectRoot: "/tmp/memoire-preview-test" };
    engine.registry = {
      getAllSpecs: async () => [],
      designSystem: { tokens: [] },
    };
    engine.figma = figma;

    const server = new PreviewApiServer(engine as never, "/tmp/memoire-preview-test", 4044);
    (server as unknown as {
      attachFigmaListeners: () => void;
    }).attachFigmaListeners();

    figma.emit("connection-state", {
      stage: "connected",
      port: 9223,
      name: "Mémoire Control Plane",
      latencyMs: 12,
      fileName: "Design System",
      fileKey: "file-key",
      pageName: "Home",
      pageId: "page-1",
      editorType: "figma",
      connectedAt: 123,
      reconnectDelayMs: null,
    });
    figma.emit("selection", {
      count: 1,
      pageName: "Home",
      pageId: "page-1",
      updatedAt: 124,
      nodes: [{
        id: "1:2",
        name: "Button",
        type: "FRAME",
        visible: true,
        pageName: "Home",
      }],
    });
    figma.emit("job-status", {
      id: "job-1",
      runId: "run-1",
      kind: "sync",
      label: "Sync Design System",
      status: "running",
      startedAt: 10,
      updatedAt: 20,
      progressText: "Running",
    });
    figma.emit("agent-status", {
      runId: "run-1",
      taskId: "task-1",
      role: "figma-executor",
      title: "Sync Design System",
      status: "busy",
      summary: "Working",
      healRound: 1,
      elapsedMs: 250,
    });
    figma.emit("sync-result", {
      summary: { tokens: 4, components: 2, styles: 1, partialFailures: ["styles timeout"] },
    });
    figma.emit("heal-result", {
      round: 2,
      healed: true,
      issueCount: 1,
      issues: ["raw hex"],
    });

    const status = (server as unknown as {
      buildWidgetStatusPayload: () => Record<string, unknown>;
    }).buildWidgetStatusPayload();

    expect(status).toMatchObject({
      connected: true,
      port: 9223,
      clients: [{ id: "plugin-1" }],
      bridge: {
        running: true,
        port: 9223,
      },
      connection: {
        stage: "connected",
        port: 9223,
        fileName: "Design System",
        pageName: "Home",
      },
      selection: {
        count: 1,
        pageName: "Home",
        pageId: "page-1",
      },
      jobs: [{
        id: "job-1",
        label: "Sync Design System",
      }],
      agents: [{
        runId: "run-1",
        taskId: "task-1",
        role: "figma-executor",
      }],
      sync: {
        tokens: 4,
        components: 2,
        styles: 1,
        partialFailures: ["styles timeout"],
      },
      heal: {
        round: 2,
        healed: true,
        issueCount: 1,
        issues: ["raw hex"],
      },
    });

    expect(status.counts).toMatchObject({
      jobs: {
        total: 1,
        running: 1,
        completed: 0,
        failed: 0,
        disconnected: 0,
      },
      agents: {
        total: 1,
        idle: 0,
        busy: 1,
        done: 0,
        error: 0,
      },
    });
  });
});

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json();
}
