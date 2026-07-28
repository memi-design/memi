import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StudioChatMode, StudioEvent, StudioPermissionMode, StudioRunAction, StudioSession, StudioSessionMode } from "./types.js";
import { redactSecrets, redactSensitiveValue } from "./redact.js";

export interface StudioSessionIndexEntry {
  id: string;
  conversationId?: string;
  turnIndex?: number;
  goal?: string;
  model?: string | null;
  effort?: string | null;
  harness: string;
  action: StudioRunAction;
  mode?: StudioSessionMode;
  chatMode?: StudioChatMode;
  permissionMode?: StudioPermissionMode;
  cwd: string;
  prompt: string;
  status: StudioSession["status"];
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  eventCount: number;
  updatedAt: string;
}

interface StudioSessionIndex {
  schemaVersion: 1;
  sessions: StudioSessionIndexEntry[];
}

export class StudioSessionStore {
  private readonly root: string;
  private index: StudioSessionIndex = { schemaVersion: 1, sessions: [] };

  constructor(projectRoot: string) {
    this.root = join(projectRoot, ".memoire", "studio");
  }

  init(): void {
    mkdirSync(this.sessionsDir, { recursive: true, mode: 0o700 });
    try {
      this.index = JSON.parse(readFileSync(this.indexPath, "utf-8")) as StudioSessionIndex;
      if (this.index.schemaVersion !== 1 || !Array.isArray(this.index.sessions)) {
        this.index = { schemaVersion: 1, sessions: [] };
      }
    } catch {
      this.index = { schemaVersion: 1, sessions: [] };
      this.flushIndex();
    }
    this.finalizeAbandonedRunningSessions();
  }

  appendEvent(session: StudioSession, event: StudioEvent): void {
    mkdirSync(this.sessionsDir, { recursive: true, mode: 0o700 });
    appendFileSync(this.eventLogPath(session.id), `${JSON.stringify(sanitizeStudioEvent(event, "local_content"))}\n`, {
      mode: 0o600,
    });
    this.upsertSession(session);
  }

  upsertSession(session: StudioSession): void {
    const entry: StudioSessionIndexEntry = {
      id: session.id,
      conversationId: session.conversationId,
      turnIndex: session.turnIndex,
      goal: session.goal ? "[content omitted]" : undefined,
      model: session.model,
      effort: session.effort,
      harness: session.harness,
      action: session.action,
      mode: session.mode,
      chatMode: session.chatMode,
      permissionMode: session.permissionMode,
      cwd: redactSecrets(session.cwd),
      prompt: "[content omitted]",
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      exitCode: session.exitCode,
      eventCount: session.events.length,
      updatedAt: new Date().toISOString(),
    };
    const next = this.index.sessions.filter((candidate) => candidate.id !== session.id);
    next.unshift(entry);
    this.index = { schemaVersion: 1, sessions: next.slice(0, 500) };
    this.flushIndex();
  }

  listSessions(): StudioSessionIndexEntry[] {
    return this.index.sessions;
  }

  getSession(sessionId: string): StudioSessionIndexEntry | null {
    return this.index.sessions.find((session) => session.id === sessionId) ?? null;
  }

  readSessionEvents(sessionId: string, options: { limit?: number } = {}): StudioEvent[] {
    const path = this.eventLogPath(sessionId);
    if (!existsSync(path)) return [];
    const events = readFileSync(path, "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StudioEvent);
    return options.limit && options.limit > 0 ? events.slice(-options.limit) : events;
  }

  get indexedSessionCount(): number {
    return this.index.sessions.length;
  }

  private eventLogPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  private get sessionsDir(): string {
    return join(this.root, "sessions");
  }

  private get indexPath(): string {
    return join(this.root, "session-index.json");
  }

  private flushIndex(): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    writeFileSync(this.indexPath, `${JSON.stringify(this.index, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  private finalizeAbandonedRunningSessions(): void {
    const running = this.index.sessions.filter((session) => session.status === "running");
    if (running.length === 0) return;
    const completedAt = new Date().toISOString();
    const message = "Session interrupted because the Studio runtime restarted before it completed.";
    this.index = {
      schemaVersion: 1,
      sessions: this.index.sessions.map((session) => session.status === "running"
        ? {
            ...session,
            status: "failed",
            completedAt,
            exitCode: null,
            updatedAt: completedAt,
          }
        : session),
    };
    for (const session of running) {
      appendFileSync(this.eventLogPath(session.id), `${JSON.stringify({
        id: randomUUID(),
        sessionId: session.id,
        type: "session_error",
        timestamp: completedAt,
        message,
        data: { reason: "runtime-restart" },
      })}\n`);
    }
    this.flushIndex();
  }
}

export function sanitizeStudioEvent(
  event: StudioEvent,
  captureMode: "metadata_only" | "local_content" = "metadata_only",
): StudioEvent {
  if (event.type === "reasoning") {
    return {
      ...event,
      message: "[reasoning omitted]",
      data: event.data === undefined ? undefined : "[content omitted]",
    };
  }
  if (captureMode === "metadata_only") {
    const safeMessageTypes = new Set<StudioEvent["type"]>([
      "session_started",
      "session_done",
      "session_error",
      "auth_status",
      "auth_state",
      "token_usage",
      "approval_request",
      "approval_resolved",
      "tool_call",
    ]);
    return {
      ...event,
      message: safeMessageTypes.has(event.type)
        ? redactSecrets(event.message)
        : "[content omitted]",
      data: event.type === "token_usage" && event.data !== undefined
        ? redactSensitiveValue(event.data)
        : event.data === undefined ? undefined : "[content omitted]",
    };
  }
  return {
    ...event,
    message: redactSecrets(event.message),
    data: event.data === undefined ? undefined : redactSensitiveValue(event.data),
  };
}
