import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { AgentRole, AgentTaskEnvelope } from "../../plugin/shared/contracts.js";
import { AgentBridge } from "../agent-bridge.js";
import { AgentWorker } from "../agent-worker.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentBridge", () => {
  it("serializes registrations, assignments, cancellation, and routed results", () => {
    const broadcast = vi.fn();
    const bridge = new AgentBridge({ broadcast } as never);
    const results: unknown[] = [];
    const assignments: unknown[] = [];
    const cancellations: unknown[] = [];
    bridge.on("task-result", (event) => results.push(event));
    bridge.on("task-assign", (event) => assignments.push(event));
    bridge.on("task-cancel", (event) => cancellations.push(event));

    bridge.broadcastRegistration({
      id: "agent-1",
      name: "Audit agent",
      role: "design-auditor",
      pid: 1,
      port: 9223,
      status: "online",
      lastHeartbeat: 10,
      registeredAt: 5,
      capabilities: ["design-audit"],
    });
    bridge.broadcastDeregistration("agent-1");
    bridge.sendTaskAssignment("agent-1", "task-1", { target: "Dashboard" });
    bridge.sendTaskCancel("agent-1", "task-1");

    expect(broadcast).toHaveBeenCalledTimes(4);
    expect(broadcast.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({ type: "agent-register" }),
      expect.objectContaining({ type: "agent-deregister" }),
      expect.objectContaining({
        type: "agent-message",
        data: expect.objectContaining({ type: "task-assign", taskId: "task-1" }),
      }),
      expect.objectContaining({
        type: "agent-message",
        data: expect.objectContaining({ type: "task-cancel", taskId: "task-1" }),
      }),
    ]);

    bridge.handleAgentMessage(makeEnvelope("task-result", { result: { ok: true } }));
    bridge.handleAgentMessage(makeEnvelope("task-assign", { payload: { target: "Button" } }));
    bridge.handleAgentMessage(makeEnvelope("task-cancel"));

    expect(results).toEqual([
      { agentId: "agent-1", taskId: "task-1", result: { ok: true }, error: undefined },
    ]);
    expect(assignments).toHaveLength(1);
    expect(cancellations).toHaveLength(1);
  });
});

describe("AgentWorker", () => {
  it.each([
    ["token-engineer", "token-create"],
    ["component-architect", "component-create"],
    ["layout-designer", "page-layout"],
    ["dataviz-specialist", "dataviz-create"],
    ["code-generator", "code-generate"],
    ["accessibility-checker", "wcag-audit"],
    ["design-auditor", "design-audit"],
    ["research-analyst", "research-synthesis"],
    ["general", "general-task"],
  ] as Array<[AgentRole, string]>)("advertises deterministic %s capabilities", (role, capability) => {
    const worker = new AgentWorker({
      id: `agent-${role}`,
      name: `${role} worker`,
      role,
      daemonPort: 9230,
    });
    const entry = worker.toRegistryEntry();

    expect(entry).toMatchObject({
      id: `agent-${role}`,
      name: `${role} worker`,
      role,
      port: 9230,
      status: "online",
    });
    expect(entry.capabilities).toContain(capability);
    expect(entry.lastHeartbeat).toBeGreaterThan(0);
  });

  it("starts and stops in-process workers without opening remote sockets", async () => {
    vi.useFakeTimers();
    const worker = new AgentWorker({
      id: "agent-local",
      name: "Local worker",
      role: "general",
      mode: "in-process",
      heartbeatIntervalMs: 20,
    });

    await worker.start();
    await worker.start();
    expect(worker.isRunning).toBe(true);
    expect(worker.connected).toBe(false);
    expect(worker.mode).toBe("in-process");
    expect(worker.id).toBe("agent-local");
    expect(worker.role).toBe("general");
    expect(worker.name).toBe("Local worker");
    await vi.advanceTimersByTimeAsync(50);

    worker.stop();
    worker.stop();
    expect(worker.isRunning).toBe(false);
    expect(worker.connected).toBe(false);
  });

  it("routes assigned and cancelled envelopes and ignores malformed or foreign messages", () => {
    const worker = new AgentWorker({ id: "agent-1", role: "design-auditor" });
    const assigned: unknown[] = [];
    const cancelled: unknown[] = [];
    worker.on("task-assigned", (event) => assigned.push(event));
    worker.on("task-cancelled", (event) => cancelled.push(event));

    const socket = new EventEmitter() as EventEmitter & {
      send: ReturnType<typeof vi.fn>;
      readyState: number;
      close: ReturnType<typeof vi.fn>;
    };
    socket.send = vi.fn();
    socket.close = vi.fn();
    socket.readyState = WebSocket.OPEN;
    (worker as unknown as { setupMessageHandler: (ws: unknown) => void }).setupMessageHandler(socket);

    socket.emit("message", JSON.stringify({
      type: "agent-message",
      data: makeEnvelope("task-assign", { payload: { target: "Dashboard" } }),
    }));
    socket.emit("message", JSON.stringify({
      type: "agent-message",
      data: makeEnvelope("task-cancel"),
    }));
    socket.emit("message", JSON.stringify({
      type: "agent-message",
      data: { ...makeEnvelope("task-assign"), agentId: "agent-2" },
    }));
    socket.emit("message", "{malformed");

    expect(assigned).toEqual([{ taskId: "task-1", payload: { target: "Dashboard" } }]);
    expect(cancelled).toEqual([{ taskId: "task-1" }]);
  });

  it("sends task results and heartbeats only through an open remote socket", () => {
    const worker = new AgentWorker({
      id: "agent-1",
      role: "design-auditor",
      mode: "remote",
    });
    const socket = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      close: vi.fn(),
    };
    Object.assign(worker as object, { ws: socket });

    worker.sendTaskResult("task-1", { score: 100 });
    (worker as unknown as { sendHeartbeat: () => void }).sendHeartbeat();

    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
      type: "agent-message",
      data: {
        type: "task-result",
        agentId: "agent-1",
        taskId: "task-1",
        result: { score: 100 },
      },
    });
    expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual({ type: "ping" });

    socket.readyState = WebSocket.CLOSED;
    worker.sendTaskResult("task-2", { score: 0 });
    expect(socket.send).toHaveBeenCalledTimes(2);
  });
});

function makeEnvelope(
  type: AgentTaskEnvelope["type"],
  patch: Partial<AgentTaskEnvelope> = {},
): AgentTaskEnvelope {
  return {
    id: `message-${type}`,
    type,
    agentId: "agent-1",
    taskId: "task-1",
    ...patch,
  };
}
