import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { CodexDriver, CODEX_HARNESS_ID, type CodexTransport } from "../../drivers/codex.js";
import { asId, makeId } from "../../contracts/ids.js";
import type { ProviderRuntimeEvent } from "../../contracts/provider-runtime.js";

function fakeTransport() {
  const written: string[] = [];
  const lineSubs = new Set<(line: string, stream: "stdout" | "stderr") => void>();
  const exitSubs = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();

  const transport: CodexTransport = {
    write: async (line) => {
      written.push(line);
    },
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
    written,
    pushLine: (line: string, stream: "stdout" | "stderr" = "stdout") => {
      for (const cb of lineSubs) cb(line, stream);
    },
    pushExit: (code: number | null, signal: NodeJS.Signals | null = null) => {
      for (const cb of exitSubs) cb(code, signal);
    },
  };
}

function makeDriver(spawnTransport: () => Promise<CodexTransport>) {
  return new CodexDriver({
    harnessId: CODEX_HARNESS_ID,
    providerInstanceId: asId("ProviderInstanceId", makeId("ProviderInstanceId")),
    sessionId: asId("SessionId", makeId("SessionId")),
    options: { model: "gpt-5.5", effort: "xhigh", spawnTransport },
  });
}

async function collectEvents(driver: CodexDriver, max: number, ms = 50): Promise<ProviderRuntimeEvent[]> {
  const events: ProviderRuntimeEvent[] = [];
  const stream = driver.events();
  // We can't easily run an Effect Stream synchronously across pushes; subscribe via the lower-level API instead.
  // For testing, we read through the same subscription mechanism the driver uses internally.
  // Since events() is a Stream.async, we drain in the background.
  const handle = (driver as unknown as { ["subscribers"]: Set<(e: ProviderRuntimeEvent) => void> }).subscribers;
  const cb = (e: ProviderRuntimeEvent) => {
    events.push(e);
  };
  handle.add(cb);
  await new Promise((r) => setTimeout(r, ms));
  return events.slice(0, max);
}

describe("drivers/codex", () => {
  it("start emits session.created and reaches ready", async () => {
    const fake = fakeTransport();
    const driver = makeDriver(async () => fake.transport);
    const events = collectEvents(driver, 50, 0);
    await Effect.runPromise(driver.start());
    expect(driver.sessionState()).toBe("ready");
    const collected = await events;
    expect(collected).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "session.state.changed",
        from: "idle",
        to: "starting",
      }),
      expect.objectContaining({
        type: "session.state.changed",
        from: "starting",
        to: "ready",
      }),
      expect.objectContaining({
        type: "model.selected",
        providerId: "openai",
        resolvedModel: "gpt-5.5",
      }),
    ]));
    for (const event of collected) {
      expect(event.trace?.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(event.trace?.spanId).toMatch(/^[0-9a-f]{16}$/);
    }
    await Effect.runPromise(driver.shutdown());
  });

  it("sendTurn writes to transport and sets running", async () => {
    const fake = fakeTransport();
    const driver = makeDriver(async () => fake.transport);
    await Effect.runPromise(driver.start());

    const turnId = asId("TurnId", makeId("TurnId"));
    await Effect.runPromise(driver.sendTurn({ turnId, prompt: "hello" }));

    expect(driver.sessionState()).toBe("running");
    expect(fake.written.length).toBe(1);
    const sent = JSON.parse(fake.written[0]);
    expect(sent.kind).toBe("user_turn");
    expect(sent.prompt).toBe("hello");

    await Effect.runPromise(driver.shutdown());
  });

  it("turn.completed transitions back to ready", async () => {
    const fake = fakeTransport();
    const driver = makeDriver(async () => fake.transport);
    await Effect.runPromise(driver.start());
    const turnId = asId("TurnId", makeId("TurnId"));
    await Effect.runPromise(driver.sendTurn({ turnId, prompt: "hi" }));

    fake.pushLine(JSON.stringify({ kind: "turn_completed", ok: true }));
    await new Promise((r) => setTimeout(r, 5));

    expect(driver.sessionState()).toBe("ready");
    await Effect.runPromise(driver.shutdown());
  });

  it("interrupt moves session to interrupted", async () => {
    const fake = fakeTransport();
    const driver = makeDriver(async () => fake.transport);
    await Effect.runPromise(driver.start());
    await Effect.runPromise(driver.interrupt("user-pressed-esc"));
    expect(driver.sessionState()).toBe("interrupted");
  });

  it("non-zero exit moves session to error", async () => {
    const fake = fakeTransport();
    const driver = makeDriver(async () => fake.transport);
    await Effect.runPromise(driver.start());
    fake.pushExit(2, null);
    await new Promise((r) => setTimeout(r, 5));
    expect(driver.sessionState()).toBe("error");
  });

  it("emits canonical events for tool lifecycle", async () => {
    const fake = fakeTransport();
    const driver = makeDriver(async () => fake.transport);
    const events = collectEvents(driver, 50, 0);
    await Effect.runPromise(driver.start());

    const toolId = makeId("ToolCallId");
    fake.pushLine(JSON.stringify({ kind: "tool_started", toolCallId: toolId, tool: "Bash", args: { command: "ls" } }));
    fake.pushLine(JSON.stringify({ kind: "tool_output", toolCallId: toolId, chunk: "file.txt\n", stream: "stdout" }));
    fake.pushLine(JSON.stringify({ kind: "tool_completed", toolCallId: toolId, ok: true, elapsedMs: 12 }));

    await new Promise((r) => setTimeout(r, 30));
    const collected = await events;
    const types = collected.map((e) => e.type);
    expect(types).toContain("tool.call.started");
    expect(types).toContain("tool.call.output");
    expect(types).toContain("tool.call.completed");

    await Effect.runPromise(driver.shutdown());
  });

  it("ignores non-JSON output as a diagnostic", async () => {
    const fake = fakeTransport();
    const driver = makeDriver(async () => fake.transport);
    const events = collectEvents(driver, 50, 0);
    await Effect.runPromise(driver.start());

    fake.pushLine("this is plain text not json\n", "stderr");
    await new Promise((r) => setTimeout(r, 20));

    const collected = await events;
    expect(collected.some((e) => e.type === "diagnostic.error")).toBe(true);

    await Effect.runPromise(driver.shutdown());
  });

  it("rejects start without a spawnTransport in options", async () => {
    const driver = new CodexDriver({
      harnessId: CODEX_HARNESS_ID,
      providerInstanceId: asId("ProviderInstanceId", makeId("ProviderInstanceId")),
      sessionId: asId("SessionId", makeId("SessionId")),
      options: {},
    });
    await expect(Effect.runPromise(driver.start())).rejects.toThrow(/spawnTransport/);
  });
});
