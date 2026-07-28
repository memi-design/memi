import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { RpcServer, type SessionResolver } from "../../rpc/server.js";
import type { RpcResponse } from "../../rpc/protocol.js";
import { CodexDriver, CODEX_HARNESS_ID, type CodexTransport } from "../../drivers/codex.js";
import { asId, makeId } from "../../contracts/ids.js";
import { MemoryEventJournal } from "../../journal/event-journal.js";
import type { HarnessDriver } from "../../drivers/base.js";
import type { HarnessId, SessionId, ThreadId } from "../../contracts/ids.js";
import type { ProviderRuntimeEvent } from "../../contracts/provider-runtime.js";

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
  return { transport };
}

function makeResolver(): {
  resolver: SessionResolver;
  drivers: Map<string, HarnessDriver>;
  registerDriver: (sessionId: SessionId, driver: HarnessDriver) => void;
} {
  const drivers = new Map<string, HarnessDriver>();
  const harnessIds = new Map<string, HarnessId>();
  const resolver: SessionResolver = {
    resolveDriver: (sessionId) => drivers.get(sessionId as unknown as string) ?? null,
    resolveHarnessId: (sessionId) => harnessIds.get(sessionId as unknown as string) ?? null,
    createDriver: (input) => {
      const driver = new CodexDriver({
        harnessId: input.harnessId,
        providerInstanceId: asId("ProviderInstanceId", makeId("ProviderInstanceId")),
        sessionId: input.sessionId,
        threadId: input.threadId,
        options: { spawnTransport: async () => fakeTransport().transport },
      });
      drivers.set(input.sessionId as unknown as string, driver);
      return driver;
    },
  };
  return {
    resolver,
    drivers,
    registerDriver: (sessionId, driver) => {
      drivers.set(sessionId as unknown as string, driver);
      harnessIds.set(sessionId as unknown as string, driver.config.harnessId);
    },
  };
}

async function collect(
  sub: { [Symbol.asyncIterator](): AsyncIterator<RpcResponse> },
  ms = 60,
): Promise<RpcResponse[]> {
  const responses: RpcResponse[] = [];
  const iter = sub[Symbol.asyncIterator]();
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const next = await Promise.race([
      iter.next(),
      new Promise<{ done: true }>((resolve) => setTimeout(() => resolve({ done: true }), 10)),
    ]);
    if (next.done) break;
    responses.push((next as { value: RpcResponse }).value);
  }
  return responses;
}

describe("rpc/server", () => {
  it("rejects malformed requests with an error response", async () => {
    const { resolver } = makeResolver();
    const server = new RpcServer({ resolver });
    const sub = server.dispatch({ op: "wat", requestId: "r1" });
    const responses = await collect(sub);
    expect(responses.length).toBeGreaterThanOrEqual(1);
    expect(responses[0].kind).toBe("error");
  });

  it("dispatchCommand on missing session returns a SessionNotFound error", async () => {
    const { resolver } = makeResolver();
    const server = new RpcServer({ resolver });
    const sub = server.dispatch({
      op: "dispatchCommand",
      requestId: "r1",
      sessionId: "ses_missing",
      command: "interrupt",
    });
    const responses = await collect(sub);
    const err = responses.find((r) => r.kind === "error") as { kind: "error"; errorTag?: string };
    expect(err).toBeDefined();
    expect(err.errorTag).toBe("SessionNotFound");
  });

  it("dispatchCommand(shutdown) on a live driver succeeds", async () => {
    const { resolver, registerDriver } = makeResolver();
    const sessionId = asId("SessionId", makeId("SessionId"));
    const driver = new CodexDriver({
      harnessId: CODEX_HARNESS_ID,
      providerInstanceId: asId("ProviderInstanceId", makeId("ProviderInstanceId")),
      sessionId,
      options: { spawnTransport: async () => fakeTransport().transport },
    });
    await Effect.runPromise(driver.start());
    registerDriver(sessionId, driver);

    const server = new RpcServer({ resolver });
    const sub = server.dispatch({
      op: "dispatchCommand",
      requestId: "r1",
      sessionId,
      command: "shutdown",
    });
    const responses = await collect(sub);
    const result = responses.find((r) => r.kind === "result");
    expect(result).toBeDefined();
    expect(driver.sessionState()).toBe("stopped");
  });

  it("replayEvents streams journal contents and ends", async () => {
    const journal = new MemoryEventJournal();
    const sessionId = asId("SessionId", makeId("SessionId"));
    for (let i = 1; i <= 3; i += 1) {
      await journal.append(sessionId, {
        eventId: asId("EventId", makeId("EventId")),
        seq: i,
        harnessId: asId("HarnessId", "hns_codex"),
        providerInstanceId: asId("ProviderInstanceId", "prv_x"),
        sessionId,
        createdAt: new Date().toISOString(),
        type: "stream.heartbeat",
      });
    }

    const { resolver } = makeResolver();
    const server = new RpcServer({ resolver, journal });
    const sub = server.dispatch({
      op: "replayEvents",
      requestId: "r1",
      sessionId,
    });
    const responses = await collect(sub);
    const events = responses.filter((r) => r.kind === "event");
    expect(events.length).toBe(3);
    expect(responses.some((r) => r.kind === "end")).toBe(true);
  });

  it("replayEvents without a journal returns JournalUnavailable", async () => {
    const { resolver } = makeResolver();
    const server = new RpcServer({ resolver });
    const sub = server.dispatch({
      op: "replayEvents",
      requestId: "r1",
      sessionId: "ses_x",
    });
    const responses = await collect(sub);
    const err = responses.find((r) => r.kind === "error") as { kind: "error"; errorTag?: string };
    expect(err.errorTag).toBe("JournalUnavailable");
  });

  it("replayEvents honors fromSeq cursor", async () => {
    const journal = new MemoryEventJournal();
    const sessionId = asId("SessionId", makeId("SessionId"));
    for (let i = 1; i <= 5; i += 1) {
      await journal.append(sessionId, {
        eventId: asId("EventId", makeId("EventId")),
        seq: i,
        harnessId: asId("HarnessId", "hns_codex"),
        providerInstanceId: asId("ProviderInstanceId", "prv_x"),
        sessionId,
        createdAt: new Date().toISOString(),
        type: "stream.heartbeat",
      });
    }

    const { resolver } = makeResolver();
    const server = new RpcServer({ resolver, journal });
    const sub = server.dispatch({
      op: "replayEvents",
      requestId: "r1",
      sessionId,
      fromSeq: 3,
    });
    const responses = await collect(sub);
    const events = responses.filter((r) => r.kind === "event") as Array<{
      kind: "event";
      event: { seq: number };
    }>;
    expect(events.map((e) => e.event.seq)).toEqual([3, 4, 5]);
  });

  it("subscribeShell + getTurnDiff acknowledge today (stub responses)", async () => {
    const { resolver } = makeResolver();
    const server = new RpcServer({ resolver });
    const shell = await collect(
      server.dispatch({
        op: "subscribeShell",
        requestId: "r1",
        sessionId: "ses_x",
      }),
    );
    expect(shell.some((r) => r.kind === "ack")).toBe(true);

    const diff = await collect(
      server.dispatch({
        op: "getTurnDiff",
        requestId: "r2",
        sessionId: "ses_x",
        turnId: "trn_x",
      }),
    );
    expect(diff.some((r) => r.kind === "result")).toBe(true);
  });

  it("subscribeThread streams canonical live events through the resolver bridge", async () => {
    const { resolver } = makeResolver();
    let subscriber: ((event: ProviderRuntimeEvent) => void) | null = null;
    resolver.subscribeEvents = (_sessionId, onEvent) => {
      subscriber = onEvent;
      return { unsubscribe: () => { subscriber = null; } };
    };
    const server = new RpcServer({ resolver });
    const sessionId = asId("SessionId", "ses_live");
    const sub = server.dispatch({
      op: "subscribeThread",
      requestId: "r-live",
      sessionId,
    });
    subscriber?.({
      eventId: asId("EventId", makeId("EventId")),
      seq: 1,
      harnessId: asId("HarnessId", "hns_codex"),
      providerInstanceId: asId("ProviderInstanceId", "prv_live"),
      sessionId,
      createdAt: new Date().toISOString(),
      type: "stream.heartbeat",
    });

    const responses = await collect(sub);
    expect(responses.some((response) => response.kind === "ack")).toBe(true);
    expect(responses.some((response) => response.kind === "event")).toBe(true);
    sub.cancel();
    expect(subscriber).toBeNull();
  });

  it("subscribeThread applies metadata-only privacy before exposing live events", async () => {
    const { resolver } = makeResolver();
    let subscriber: ((event: ProviderRuntimeEvent) => void) | null = null;
    resolver.subscribeEvents = (_sessionId, onEvent) => {
      subscriber = onEvent;
      return { unsubscribe: () => { subscriber = null; } };
    };
    const server = new RpcServer({ resolver });
    const sessionId = asId("SessionId", "ses_private_live");
    const sub = server.dispatch({
      op: "subscribeThread",
      requestId: "r-private",
      sessionId,
    });
    subscriber?.({
      eventId: asId("EventId", makeId("EventId")),
      seq: 1,
      harnessId: asId("HarnessId", "hns_codex"),
      providerInstanceId: asId("ProviderInstanceId", "prv_live"),
      sessionId,
      createdAt: new Date().toISOString(),
      type: "tool.call.started",
      toolCallId: asId("ToolCallId", "tcl_private"),
      tool: "Bash",
      args: { env: { OPENAI_API_KEY: "sk-proj-private" } },
    });

    const responses = await collect(sub);
    const eventResponse = responses.find((response) => response.kind === "event") as
      | { kind: "event"; event: ProviderRuntimeEvent }
      | undefined;
    expect(eventResponse?.event).toMatchObject({
      type: "tool.call.started",
      args: "[content omitted]",
    });
    expect(JSON.stringify(responses)).not.toContain("sk-proj-private");
    sub.cancel();
  });
});
