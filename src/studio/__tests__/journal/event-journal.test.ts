import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileEventJournal,
  MemoryEventJournal,
  collectReplay,
  type EventJournal,
} from "../../journal/event-journal.js";
import { asId, makeId } from "../../contracts/ids.js";
import type { SessionId } from "../../contracts/ids.js";
import type { ProviderRuntimeEvent } from "../../contracts/provider-runtime.js";

function makeEvent(seq: number, sessionId: SessionId): ProviderRuntimeEvent {
  return {
    eventId: asId("EventId", makeId("EventId")),
    seq,
    harnessId: asId("HarnessId", "hns_codex"),
    providerInstanceId: asId("ProviderInstanceId", "prv_x"),
    sessionId,
    createdAt: new Date().toISOString(),
    type: "stream.heartbeat",
  };
}

function suite(name: string, factory: () => EventJournal) {
  describe(`journal/${name}`, () => {
    it("append + replay round-trips events in seq order", async () => {
      const journal = factory();
      const sessionId = asId("SessionId", makeId("SessionId"));
      for (let i = 1; i <= 5; i += 1) {
        await journal.append(sessionId, makeEvent(i, sessionId));
      }
      const replayed = await collectReplay(journal, sessionId);
      expect(replayed.length).toBe(5);
      expect(replayed.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    });

    it("replay with fromSeq skips earlier events", async () => {
      const journal = factory();
      const sessionId = asId("SessionId", makeId("SessionId"));
      for (let i = 1; i <= 5; i += 1) {
        await journal.append(sessionId, makeEvent(i, sessionId));
      }
      const replayed = await collectReplay(journal, sessionId, 3);
      expect(replayed.map((e) => e.seq)).toEqual([3, 4, 5]);
    });

    it("replay of unknown session yields no events", async () => {
      const journal = factory();
      const replayed = await collectReplay(journal, asId("SessionId", "ses_unknown"));
      expect(replayed).toEqual([]);
    });

    it("list returns sessions with journals", async () => {
      const journal = factory();
      const a = asId("SessionId", makeId("SessionId"));
      const b = asId("SessionId", makeId("SessionId"));
      await journal.append(a, makeEvent(1, a));
      await journal.append(b, makeEvent(1, b));
      const ids = await journal.list();
      expect(ids.length).toBe(2);
    });

    it("delete removes a journal", async () => {
      const journal = factory();
      const sessionId = asId("SessionId", makeId("SessionId"));
      await journal.append(sessionId, makeEvent(1, sessionId));
      await journal.delete(sessionId);
      const replayed = await collectReplay(journal, sessionId);
      expect(replayed).toEqual([]);
    });

    it("delete on missing session is a no-op", async () => {
      const journal = factory();
      await expect(journal.delete(asId("SessionId", "ses_missing"))).resolves.toBeUndefined();
    });

    it("concurrent appends preserve order within a single session", async () => {
      const journal = factory();
      const sessionId = asId("SessionId", makeId("SessionId"));
      // Fire 10 appends concurrently.
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => journal.append(sessionId, makeEvent(i + 1, sessionId))),
      );
      const replayed = await collectReplay(journal, sessionId);
      expect(replayed.length).toBe(10);
      // Sequence numbers should be contiguous (no drops).
      const seqs = replayed.map((e) => e.seq).sort((a, b) => a - b);
      expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });
}

suite("MemoryEventJournal", () => new MemoryEventJournal());

describe("journal/FileEventJournal extras", () => {
  let root: string;
  let journal: FileEventJournal;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "memoire-journal-"));
    journal = new FileEventJournal(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("replay tolerates partial-write garbage at end of file", async () => {
    const sessionId = asId("SessionId", makeId("SessionId"));
    await journal.append(sessionId, makeEvent(1, sessionId));
    await journal.append(sessionId, makeEvent(2, sessionId));
    // Manually append a partial line (simulates a crash mid-write).
    const path = join(root, ".memoire/studio/events", `${sessionId}.jsonl`);
    await writeFile(path, '\n{"seq":3,"incomplete\n', { flag: "a" });
    const replayed = await collectReplay(journal, sessionId);
    // The 2 valid events come back; the broken line is silently skipped.
    expect(replayed.length).toBe(2);
  });

  it("prune by age removes old journals from disk", async () => {
    const sessionId = asId("SessionId", makeId("SessionId"));
    await journal.append(sessionId, makeEvent(1, sessionId));
    // Backdate the file's mtime to simulate age.
    const fs = await import("node:fs/promises");
    const path = join(root, ".memoire/studio/events", `${sessionId}.jsonl`);
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await fs.utimes(path, old, old);
    const removed = await journal.prune({ olderThanMs: 30 * 24 * 60 * 60 * 1000 });
    expect(removed).toBe(1);
  });

  it("prune by max keeps the N newest journals", async () => {
    for (let i = 0; i < 5; i += 1) {
      const sessionId = asId("SessionId", makeId("SessionId"));
      await journal.append(sessionId, makeEvent(1, sessionId));
      // Different mtime per file so prune has a deterministic order.
      await new Promise((r) => setTimeout(r, 5));
    }
    const removed = await journal.prune({ max: 3 });
    expect(removed).toBe(2);
    expect((await journal.list()).length).toBe(3);
  });

  it("persists metadata-only content by default", async () => {
    const sessionId = asId("SessionId", makeId("SessionId"));
    await journal.append(sessionId, {
      eventId: asId("EventId", makeId("EventId")),
      seq: 1,
      harnessId: asId("HarnessId", "hns_codex"),
      providerInstanceId: asId("ProviderInstanceId", "prv_x"),
      sessionId,
      createdAt: new Date().toISOString(),
      type: "message.user",
      text: "ANTHROPIC_API_KEY=sk-ant-secret email me at person@example.com",
    });

    const path = join(root, ".memoire/studio/events", `${sessionId}.jsonl`);
    const raw = await import("node:fs/promises").then((fs) => fs.readFile(path, "utf-8"));
    expect(raw).not.toContain("sk-ant-secret");
    expect(raw).not.toContain("person@example.com");
    expect(raw).not.toContain("ANTHROPIC_API_KEY=");

    const replayed = await collectReplay(journal, sessionId);
    expect(replayed[0]).toMatchObject({
      type: "message.user",
      text: "[content omitted]",
    });
  });
});

suite("FileEventJournal", () => {
  // A throwaway directory per call. Suite() is invoked once, so we share
  // a single directory across the suite's tests but each test creates its
  // own session IDs so they don't collide.
  const tempRoot = `${tmpdir()}/memoire-file-journal-${process.pid}-${Date.now()}`;
  return new FileEventJournal(tempRoot);
});
