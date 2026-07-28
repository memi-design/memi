/**
 * EventJournal — append-only per-session event log.
 *
 * Every ProviderRuntimeEvent emitted by a HarnessDriver is appended to
 * <projectRoot>/.memoire/studio/events/<sessionId>.jsonl as a single JSON
 * line with the event's monotonic seq as the index.
 *
 * Unlocks:
 *   - Audit trails: replay every action a session performed
 *   - Offline playback: re-render a finished session without keeping it
 *     warm in memory
 *   - Crash forensics: see exactly the last events before a runtime kill
 *   - Replay-from-cursor: a UI client that lost connection mid-session
 *     can request `replay(sessionId, fromSeq)` and stream the tail
 *
 * Two implementations:
 *   - FileEventJournal — appends JSONL files to disk
 *   - MemoryEventJournal — for tests
 *
 * The journal is injected into HarnessDriverConfig.eventJournal. When
 * absent, drivers behave exactly as before (no journal writes). Like
 * snapshots, the integration is opt-in.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { SessionId } from "../contracts/ids.js";
import type { ProviderRuntimeEvent } from "../contracts/provider-runtime.js";
import { safeParseProviderRuntimeEvent } from "../contracts/provider-runtime.js";
import {
  DEFAULT_TRACE_PRIVACY_POLICY,
  sanitizeRuntimeEvent,
  type TracePrivacyPolicy,
} from "../tracing/privacy.js";

export interface EventJournalOptions {
  readonly privacyPolicy?: TracePrivacyPolicy;
  readonly maxBytesPerSession?: number;
}

export interface EventJournal {
  append(sessionId: SessionId, event: ProviderRuntimeEvent): Promise<void>;
  /** Returns events for the session in seq order, optionally from a cursor. */
  replay(sessionId: SessionId, fromSeq?: number): AsyncIterable<ProviderRuntimeEvent>;
  /** Returns the list of session IDs with persisted journals. */
  list(): Promise<SessionId[]>;
  /** Removes the journal for a single session. */
  delete(sessionId: SessionId): Promise<void>;
  /** Removes journals matching the prune criteria. Returns the count removed. */
  prune(opts: { olderThanMs?: number; max?: number }): Promise<number>;
}

/**
 * In-memory implementation. Useful for tests and dry-runs.
 */
export class MemoryEventJournal implements EventJournal {
  private readonly buffers = new Map<string, ProviderRuntimeEvent[]>();
  private readonly mtimes = new Map<string, number>();
  private readonly privacyPolicy: TracePrivacyPolicy;

  constructor(options: EventJournalOptions = {}) {
    this.privacyPolicy = options.privacyPolicy ?? DEFAULT_TRACE_PRIVACY_POLICY;
  }

  async append(sessionId: SessionId, event: ProviderRuntimeEvent): Promise<void> {
    if (this.privacyPolicy.captureMode === "off") return;
    const key = sessionId as unknown as string;
    const buf = this.buffers.get(key) ?? [];
    buf.push(sanitizeRuntimeEvent(event, this.privacyPolicy));
    this.buffers.set(key, buf);
    this.mtimes.set(key, Date.now());
  }

  async *replay(sessionId: SessionId, fromSeq?: number): AsyncIterable<ProviderRuntimeEvent> {
    const buf = this.buffers.get(sessionId as unknown as string) ?? [];
    for (const event of buf) {
      if (fromSeq !== undefined && event.seq < fromSeq) continue;
      yield event;
    }
  }

  async list(): Promise<SessionId[]> {
    return Array.from(this.buffers.keys()) as unknown as SessionId[];
  }

  async delete(sessionId: SessionId): Promise<void> {
    this.buffers.delete(sessionId as unknown as string);
    this.mtimes.delete(sessionId as unknown as string);
  }

  async prune(opts: { olderThanMs?: number; max?: number }): Promise<number> {
    const now = Date.now();
    let removed = 0;
    if (opts.olderThanMs !== undefined) {
      for (const [key, mtime] of this.mtimes) {
        if (now - mtime > opts.olderThanMs) {
          this.buffers.delete(key);
          this.mtimes.delete(key);
          removed += 1;
        }
      }
    }
    if (opts.max !== undefined && this.buffers.size > opts.max) {
      const sorted = Array.from(this.mtimes.entries()).sort((a, b) => a[1] - b[1]);
      while (this.buffers.size > opts.max) {
        const [key] = sorted.shift()!;
        this.buffers.delete(key);
        this.mtimes.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

/**
 * Disk-backed implementation. Each session gets its own JSONL file under
 * <projectRoot>/.memoire/studio/events/<sessionId>.jsonl. Appends are
 * serialized per session via an inflight promise chain so out-of-order
 * concurrent writes can't interleave bytes.
 */
export class FileEventJournal implements EventJournal {
  private readonly dir: string;
  private ensureDirPromise: Promise<void> | null = null;
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly privacyPolicy: TracePrivacyPolicy;
  private readonly maxBytesPerSession: number;

  constructor(projectRoot: string, options: EventJournalOptions = {}) {
    this.dir = join(projectRoot, ".memoire", "studio", "events");
    this.privacyPolicy = options.privacyPolicy ?? DEFAULT_TRACE_PRIVACY_POLICY;
    this.maxBytesPerSession = options.maxBytesPerSession ?? 10 * 1024 * 1024;
  }

  private ensureDir(): Promise<void> {
    if (!this.ensureDirPromise) {
      this.ensureDirPromise = fs.mkdir(this.dir, { recursive: true, mode: 0o700 }).then(() => undefined);
    }
    return this.ensureDirPromise;
  }

  private filePath(sessionId: SessionId): string {
    return join(this.dir, `${sessionId}.jsonl`);
  }

  async append(sessionId: SessionId, event: ProviderRuntimeEvent): Promise<void> {
    if (this.privacyPolicy.captureMode === "off") return;
    const key = sessionId as unknown as string;
    const previous = this.inflight.get(key) ?? Promise.resolve();
    const persistedEvent = sanitizeRuntimeEvent(event, this.privacyPolicy);
    const line = `${JSON.stringify(persistedEvent)}\n`;
    const next = previous.then(async () => {
      await this.ensureDir();
      const path = this.filePath(sessionId);
      const currentSize = await fs.stat(path).then((stat) => stat.size).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return 0;
        throw error;
      });
      if (currentSize + Buffer.byteLength(line) > this.maxBytesPerSession) {
        throw new Error(`event journal exceeded ${this.maxBytesPerSession} bytes for session ${sessionId}`);
      }
      await fs.appendFile(path, line, { encoding: "utf-8", mode: 0o600 });
    });
    this.inflight.set(key, next.catch(() => undefined));
    await next;
  }

  async *replay(sessionId: SessionId, fromSeq?: number): AsyncIterable<ProviderRuntimeEvent> {
    await (this.inflight.get(sessionId as unknown as string) ?? Promise.resolve());
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(sessionId), "utf-8");
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") return;
      throw error;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = safeParseProviderRuntimeEvent(JSON.parse(trimmed));
        if (!parsed.ok) continue;
        const event = parsed.event;
        if (fromSeq !== undefined && event.seq < fromSeq) continue;
        yield event;
      } catch {
        // skip malformed lines (e.g., partial write at crash time)
      }
    }
  }

  async list(): Promise<SessionId[]> {
    try {
      const entries = await fs.readdir(this.dir);
      return entries
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => name.slice(0, -".jsonl".length) as unknown as SessionId);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") return [];
      throw error;
    }
  }

  async delete(sessionId: SessionId): Promise<void> {
    try {
      await fs.unlink(this.filePath(sessionId));
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") throw error;
    }
  }

  async prune(opts: { olderThanMs?: number; max?: number }): Promise<number> {
    const ids = await this.list();
    const now = Date.now();
    let removed = 0;
    const survivors: { id: SessionId; mtimeMs: number }[] = [];

    for (const id of ids) {
      try {
        const stat = await fs.stat(this.filePath(id));
        if (opts.olderThanMs !== undefined && now - stat.mtimeMs > opts.olderThanMs) {
          await this.delete(id);
          removed += 1;
        } else {
          survivors.push({ id, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // stat failed; skip
      }
    }

    if (opts.max !== undefined && survivors.length > opts.max) {
      survivors.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const toRemove = survivors.length - opts.max;
      for (let i = 0; i < toRemove; i += 1) {
        await this.delete(survivors[i].id);
        removed += 1;
      }
    }

    return removed;
  }
}

/**
 * Helper: collect a journal replay into an array. Convenient for tests.
 */
export async function collectReplay(
  journal: EventJournal,
  sessionId: SessionId,
  fromSeq?: number,
): Promise<ProviderRuntimeEvent[]> {
  const out: ProviderRuntimeEvent[] = [];
  for await (const event of journal.replay(sessionId, fromSeq)) {
    out.push(event);
  }
  return out;
}
