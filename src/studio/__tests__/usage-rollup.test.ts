import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { UsageRollup } from "../usage-rollup.js";
import { EventBus } from "../event-bus.js";
import { CodexDriver, CODEX_HARNESS_ID, type CodexTransport } from "../drivers/codex.js";
import { asId, makeId } from "../contracts/ids.js";
import type { ProviderRuntimeEvent } from "../contracts/provider-runtime.js";

function fakeTransport() {
  const lineSubs = new Set<(line: string, stream: "stdout" | "stderr") => void>();
  const exitSubs = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  const transport: CodexTransport = {
    write: async () => {},
    close: async () => {
      for (const cb of exitSubs) cb(0, null);
    },
    kill: async (signal) => {
      for (const cb of exitSubs) cb(null, signal ?? "SIGTERM");
    },
    onLine: (cb) => {
      lineSubs.add(cb);
      return () => lineSubs.delete(cb);
    },
    onExit: (cb) => {
      exitSubs.add(cb);
      return () => exitSubs.delete(cb);
    },
  };
  return {
    transport,
    pushLine: (line: string) => {
      for (const cb of lineSubs) cb(line, "stdout");
    },
  };
}

function makeEvent(overrides: Partial<ProviderRuntimeEvent>): ProviderRuntimeEvent {
  return {
    eventId: asId("EventId", makeId("EventId")),
    seq: 1,
    harnessId: asId("HarnessId", "hns_codex"),
    providerInstanceId: asId("ProviderInstanceId", "prv_x"),
    sessionId: asId("SessionId", "ses_x"),
    createdAt: new Date().toISOString(),
    type: "stream.heartbeat",
    ...overrides,
  } as ProviderRuntimeEvent;
}

describe("usage-rollup", () => {
  it("accumulates input + output tokens per session", () => {
    const rollup = new UsageRollup();
    const sessionId = asId("SessionId", "ses_a");
    rollup.consume(
      makeEvent({
        type: "usage.updated",
        sessionId,
        inputTokens: 100,
        outputTokens: 50,
      } as Partial<ProviderRuntimeEvent>),
    );
    rollup.consume(
      makeEvent({
        type: "usage.updated",
        sessionId,
        inputTokens: 25,
        outputTokens: 75,
      } as Partial<ProviderRuntimeEvent>),
    );
    const snap = rollup.sessionUsage(sessionId);
    expect(snap?.inputTokens).toBe(125);
    expect(snap?.outputTokens).toBe(125);
  });

  it("accumulates reasoning tokens + estimated cost", () => {
    const rollup = new UsageRollup();
    const sessionId = asId("SessionId", "ses_a");
    rollup.consume(
      makeEvent({
        type: "usage.updated",
        sessionId,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 200,
        estimatedCostUsd: 0.05,
      } as Partial<ProviderRuntimeEvent>),
    );
    rollup.consume(
      makeEvent({
        type: "usage.updated",
        sessionId,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 100,
        estimatedCostUsd: 0.02,
      } as Partial<ProviderRuntimeEvent>),
    );
    const snap = rollup.sessionUsage(sessionId);
    expect(snap?.reasoningTokens).toBe(300);
    expect(snap?.estimatedCostUsd).toBeCloseTo(0.07, 5);
  });

  it("counts tool calls + tool errors + total tool ms", () => {
    const rollup = new UsageRollup();
    const sessionId = asId("SessionId", "ses_a");
    rollup.consume(
      makeEvent({
        type: "tool.call.completed",
        sessionId,
        toolCallId: asId("ToolCallId", "tcl_1"),
        ok: true,
        elapsedMs: 30,
      } as Partial<ProviderRuntimeEvent>),
    );
    rollup.consume(
      makeEvent({
        type: "tool.call.completed",
        sessionId,
        toolCallId: asId("ToolCallId", "tcl_2"),
        ok: false,
        elapsedMs: 5,
      } as Partial<ProviderRuntimeEvent>),
    );
    const snap = rollup.sessionUsage(sessionId);
    expect(snap?.toolCallCount).toBe(2);
    expect(snap?.toolErrorCount).toBe(1);
    expect(snap?.totalToolMs).toBe(35);
  });

  it("tool timeline records tool name from started+completed pairs", () => {
    const rollup = new UsageRollup();
    const sessionId = asId("SessionId", "ses_a");
    rollup.consume(
      makeEvent({
        type: "tool.call.started",
        sessionId,
        toolCallId: asId("ToolCallId", "tcl_1"),
        tool: "Bash",
        args: {},
      } as Partial<ProviderRuntimeEvent>),
    );
    rollup.consume(
      makeEvent({
        type: "tool.call.completed",
        sessionId,
        toolCallId: asId("ToolCallId", "tcl_1"),
        ok: true,
        elapsedMs: 12,
      } as Partial<ProviderRuntimeEvent>),
    );
    const timeline = rollup.toolTimeline(sessionId);
    expect(timeline.length).toBe(1);
    expect(timeline[0].tool).toBe("Bash");
    expect(timeline[0].elapsedMs).toBe(12);
  });

  it("toolTimeline filters by tool name", () => {
    const rollup = new UsageRollup();
    const sessionId = asId("SessionId", "ses_a");
    for (const [tool, id] of [
      ["Bash", "tcl_1"],
      ["Read", "tcl_2"],
      ["Bash", "tcl_3"],
    ] as const) {
      rollup.consume(
        makeEvent({
          type: "tool.call.started",
          sessionId,
          toolCallId: asId("ToolCallId", id),
          tool,
          args: {},
        } as Partial<ProviderRuntimeEvent>),
      );
      rollup.consume(
        makeEvent({
          type: "tool.call.completed",
          sessionId,
          toolCallId: asId("ToolCallId", id),
          ok: true,
          elapsedMs: 5,
        } as Partial<ProviderRuntimeEvent>),
      );
    }
    expect(rollup.toolTimeline(sessionId, "Bash").length).toBe(2);
    expect(rollup.toolTimeline(sessionId, "Read").length).toBe(1);
  });

  it("session.created + session.shutdown stamp startedAt + endedAt", () => {
    const rollup = new UsageRollup();
    const sessionId = asId("SessionId", "ses_a");
    rollup.consume(
      makeEvent({
        type: "session.created",
        sessionId,
        harnessConfigSummary: { harness: asId("HarnessId", "hns_codex") },
      } as Partial<ProviderRuntimeEvent>),
    );
    const startedAt = rollup.sessionUsage(sessionId)?.startedAt;
    expect(startedAt).toBeDefined();

    rollup.consume(
      makeEvent({
        type: "session.shutdown",
        sessionId,
        reason: "user",
      } as Partial<ProviderRuntimeEvent>),
    );
    const endedAt = rollup.sessionUsage(sessionId)?.endedAt;
    expect(endedAt).toBeDefined();
  });

  it("harnessTotals aggregates across sessions for the same harness", () => {
    const rollup = new UsageRollup();
    for (const sessionLabel of ["ses_a", "ses_b", "ses_c"]) {
      rollup.consume(
        makeEvent({
          type: "usage.updated",
          sessionId: asId("SessionId", sessionLabel),
          harnessId: asId("HarnessId", "hns_codex"),
          inputTokens: 100,
          outputTokens: 50,
        } as Partial<ProviderRuntimeEvent>),
      );
    }
    rollup.consume(
      makeEvent({
        type: "usage.updated",
        sessionId: asId("SessionId", "ses_d"),
        harnessId: asId("HarnessId", "hns_claude-code"),
        inputTokens: 200,
        outputTokens: 100,
      } as Partial<ProviderRuntimeEvent>),
    );
    const codex = rollup.harnessTotals(asId("HarnessId", "hns_codex"));
    expect(codex.sessionCount).toBe(3);
    expect(codex.inputTokens).toBe(300);
    expect(codex.outputTokens).toBe(150);

    const claude = rollup.harnessTotals(asId("HarnessId", "hns_claude-code"));
    expect(claude.sessionCount).toBe(1);
    expect(claude.inputTokens).toBe(200);
  });

  it("subscribes to a bus on construction and receives events", async () => {
    const bus = new EventBus();
    const rollup = new UsageRollup(bus);
    const fake = fakeTransport();
    const sessionId = asId("SessionId", makeId("SessionId"));
    const driver = new CodexDriver({
      harnessId: CODEX_HARNESS_ID,
      providerInstanceId: asId("ProviderInstanceId", makeId("ProviderInstanceId")),
      sessionId,
      options: { spawnTransport: async () => fake.transport },
      eventBus: bus,
    });
    await Effect.runPromise(driver.start());
    fake.pushLine(JSON.stringify({ kind: "usage", inputTokens: 42, outputTokens: 24 }));
    await new Promise((r) => setTimeout(r, 30));

    const snap = rollup.sessionUsage(sessionId);
    expect(snap?.inputTokens).toBe(42);
    expect(snap?.outputTokens).toBe(24);
    await Effect.runPromise(driver.shutdown());
  });

  it("detach + reset cleanly empty the rollup", () => {
    const bus = new EventBus();
    const rollup = new UsageRollup(bus);
    rollup.consume(
      makeEvent({
        type: "usage.updated",
        sessionId: asId("SessionId", "ses_a"),
        inputTokens: 10,
        outputTokens: 10,
      } as Partial<ProviderRuntimeEvent>),
    );
    expect(rollup.all().length).toBe(1);
    rollup.detach();
    rollup.reset();
    expect(rollup.all().length).toBe(0);
  });

  it("all() returns every session snapshot", () => {
    const rollup = new UsageRollup();
    rollup.consume(
      makeEvent({
        type: "usage.updated",
        sessionId: asId("SessionId", "ses_a"),
        inputTokens: 1,
        outputTokens: 1,
      } as Partial<ProviderRuntimeEvent>),
    );
    rollup.consume(
      makeEvent({
        type: "usage.updated",
        sessionId: asId("SessionId", "ses_b"),
        inputTokens: 1,
        outputTokens: 1,
      } as Partial<ProviderRuntimeEvent>),
    );
    expect(rollup.all().length).toBe(2);
  });

  it("accounts for cached input tokens without counting them twice", () => {
    const rollup = new UsageRollup();
    const sessionId = asId("SessionId", "ses_cached");
    rollup.consume(
      makeEvent({
        type: "usage.updated",
        sessionId,
        inputTokens: 120,
        cachedInputTokens: 80,
        outputTokens: 30,
        reasoningTokens: 10,
      } as Partial<ProviderRuntimeEvent>),
    );

    expect(rollup.sessionUsage(sessionId)).toMatchObject({
      inputTokens: 120,
      cachedInputTokens: 80,
      outputTokens: 30,
      reasoningTokens: 10,
      totalTokens: 160,
    });
  });

  it("returns immutable copies so consumers cannot corrupt accumulated usage", () => {
    const rollup = new UsageRollup();
    const sessionId = asId("SessionId", "ses_immutable");
    rollup.consume(
      makeEvent({
        type: "usage.updated",
        sessionId,
        inputTokens: 40,
        outputTokens: 2,
      } as Partial<ProviderRuntimeEvent>),
    );

    const snapshot = rollup.sessionUsage(sessionId);
    const all = rollup.all();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(all)).toBe(true);
    expect(Object.isFrozen(all[0])).toBe(true);

    expect(() => {
      (snapshot as { inputTokens: number }).inputTokens = 999;
    }).toThrow();
    expect(rollup.sessionUsage(sessionId)?.inputTokens).toBe(40);
  });

  it("captures tool names without patching the class prototype", () => {
    const descriptor = Object.getOwnPropertyDescriptor(UsageRollup.prototype, "consume");
    expect(descriptor?.value?.name).toBe("consume");
  });
});
