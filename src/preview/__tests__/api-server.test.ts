import { describe, expect, it } from "vitest";
import { EventEmitter } from "events";
import { PREVIEW_BIND_HOST, PreviewApiServer } from "../api-server.js";

describe("PreviewApiServer", () => {
  it("binds the local preview control plane to loopback", () => {
    expect(PREVIEW_BIND_HOST).toBe("127.0.0.1");
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
