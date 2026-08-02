import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { StudioRuntimeServer } from "../server.js";
import type { StudioEvent, StudioSession } from "../types.js";

const servers: StudioRuntimeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("studio design changelog APIs", () => {
  it("lists, creates, updates, archives, restores, and exports entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-design-changelog-api-"));
    let server: StudioRuntimeServer | null = null;
    try {
      server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();

      const created = await fetch(`${runtime.url}/api/design-changelog`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Spacing pass",
          summary: "Cleaned Studio sidebar spacing.",
          bodyMarkdown: "## Notes\n\nKept the rose accent tokens.",
          tags: ["studio", "spacing"],
          authoredBy: "human",
        }),
      }).then((res) => res.json());
      const updated = await fetch(`${runtime.url}/api/design-changelog/${encodeURIComponent(created.entry.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary: "Cleaned Studio sidebar and composer spacing.", tags: ["studio", "spacing", "composer"] }),
      }).then((res) => res.json());
      const archived = await fetch(`${runtime.url}/api/design-changelog/${encodeURIComponent(created.entry.id)}`, { method: "DELETE" }).then((res) => res.json());
      const restored = await fetch(`${runtime.url}/api/design-changelog/${encodeURIComponent(created.entry.id)}/restore`, { method: "POST" }).then((res) => res.json());
      const listed = await fetch(`${runtime.url}/api/design-changelog`).then((res) => res.json());
      const exported = await fetch(`${runtime.url}/api/design-changelog?format=markdown`).then((res) => res.text());

      expect(updated.entry).toMatchObject({ id: created.entry.id, summary: "Cleaned Studio sidebar and composer spacing." });
      expect(archived.entry).toMatchObject({ id: created.entry.id, status: "archived" });
      expect(restored.entry).toMatchObject({ id: created.entry.id, status: "active" });
      expect(listed.entries).toContainEqual(expect.objectContaining({ id: created.entry.id, title: "Spacing pass" }));
      expect(exported).toContain("# Mémoire Studio Design Changelog");
      expect(exported).toContain("Spacing pass");
    } finally {
      if (server) {
        await server.stop();
        servers.splice(servers.indexOf(server), 1);
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("captures and deduplicates session-driven changelog entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-design-changelog-capture-api-"));
    let server: StudioRuntimeServer | null = null;
    try {
      server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();
      const session = makeSession(root);
      const events = [
        makeEvent(session.id, "design_decision", "Use one Changelog page for design memory."),
        makeEvent(session.id, "artifact", "Wrote Studio changelog page mockup."),
      ];

      const first = await fetch(`${runtime.url}/api/design-changelog/capture`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session, events }),
      }).then((res) => res.json());
      const second = await fetch(`${runtime.url}/api/design-changelog/capture`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session, events: [...events, makeEvent(session.id, "session_result", "Changelog complete.")] }),
      }).then((res) => res.json());
      const listed = await fetch(`${runtime.url}/api/design-changelog`).then((res) => res.json());

      expect(first).toMatchObject({ captured: true, entry: { sessionId: session.id, authoredBy: "agent" } });
      expect(second.entry.id).toBe(first.entry.id);
      expect(second.entry.eventIds).toContain("session_result-changelog-complete");
      expect(listed.entries).toHaveLength(1);
    } finally {
      if (server) {
        await server.stop();
        servers.splice(servers.indexOf(server), 1);
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});

function makeSession(root: string): StudioSession {
  return {
    id: "studio-capture-design-changelog",
    harness: "codex",
    action: "self-design",
    cwd: root,
    prompt: "Add the Studio design changelog page.",
    status: "completed",
    startedAt: "2026-05-07T00:00:00.000Z",
    completedAt: "2026-05-07T00:02:00.000Z",
    exitCode: 0,
    activeStreamId: null,
    pendingPrompt: null,
    events: [],
  };
}

function makeEvent(sessionId: string, type: StudioEvent["type"], message: string): StudioEvent {
  return {
    id: `${type}-${message.toLowerCase().replace(/\W+/g, "-").replace(/^-|-$/g, "")}`,
    sessionId,
    type,
    timestamp: "2026-05-07T00:00:30.000Z",
    message,
  };
}
