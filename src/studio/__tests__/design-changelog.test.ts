import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  archiveDesignChangelogEntry,
  captureDesignChangelogEntry,
  createDesignChangelogEntry,
  designChangelogDir,
  listDesignChangelogEntries,
  restoreDesignChangelogEntry,
  updateDesignChangelogEntry,
} from "../design-changelog.js";
import type { StudioDesignSystemTrace, StudioEvent, StudioSession } from "../types.js";

describe("design changelog store", () => {
  it("creates, updates, archives, and restores local project-memory entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-design-changelog-crud-"));
    try {
      const created = await createDesignChangelogEntry(root, {
        title: "Button token cleanup",
        summary: "Aligned button states to the rose accent system.",
        bodyMarkdown: "## Decision\n\nUse the existing accent tokens.",
        tags: ["tokens", "button"],
        authoredBy: "human",
        harness: "codex",
        action: "audit",
        sessionId: "studio-manual-session",
        fileRefs: [{ path: "apps/studio/src/styles.css", kind: "style", status: "M", insertions: 8, deletions: 2, designSystem: true }],
      });

      const updated = await updateDesignChangelogEntry(root, created.id, {
        title: "Button token and radius cleanup",
        tags: ["tokens", "button", "radius"],
      });
      const archived = await archiveDesignChangelogEntry(root, created.id);
      const restored = await restoreDesignChangelogEntry(root, created.id);
      const persisted = JSON.parse(await readFile(join(designChangelogDir(root), `${created.id}.json`), "utf-8"));

      expect(updated).toMatchObject({ title: "Button token and radius cleanup", tags: ["tokens", "button", "radius"] });
      expect(archived).toMatchObject({ id: created.id, status: "archived" });
      expect(restored).toMatchObject({ id: created.id, status: "active" });
      expect(persisted).toMatchObject({ id: created.id, title: "Button token and radius cleanup" });
      expect(await listDesignChangelogEntries(root)).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("captures design events and design-system file evidence with warnings for weak evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-design-changelog-capture-"));
    try {
      const session = makeSession(root, "studio-design-session", "audit", "Pull design system into Memoire");
      const events = [
        makeEvent(session.id, "design_decision", "Use the memi rose accent for active states.", { rationale: "Matches web brand." }),
        makeEvent(session.id, "design_system_artifact", "Captured design-system artifact for button states."),
        makeEvent(session.id, "artifact", "Wrote design evidence to .memoire/project-memory/design-system.md"),
      ];
      const trace = makeTrace([
        { path: "apps/studio/src/styles.css", kind: "style", status: "M", insertions: 12, deletions: 4, designSystem: true },
        { path: "README.md", kind: "other", status: "M", insertions: 1, deletions: 0, designSystem: false },
      ]);

      const captured = await captureDesignChangelogEntry(root, { session, events, trace });
      const repeated = await captureDesignChangelogEntry(root, {
        session,
        events: [...events, makeEvent(session.id, "session_result", "Design trace complete.")],
        trace,
      });

      expect(captured.entry).toMatchObject({
        title: "codex audit design change",
        authoredBy: "agent",
        harness: "codex",
        action: "audit",
        sessionId: session.id,
        eventIds: expect.arrayContaining(["design_decision-use-the-memi-rose-accent-for-active-states"]),
      });
      expect(captured.entry?.fileRefs).toEqual([
        expect.objectContaining({ path: "apps/studio/src/styles.css", kind: "style", designSystem: true }),
      ]);
      expect(captured.entry?.captureWarnings).toEqual([]);
      expect(repeated.entry?.id).toBe(captured.entry?.id);
      expect(repeated.entry?.eventIds).toContain("session_result-design-trace-complete");
      expect(await listDesignChangelogEntries(root)).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("captures design-system file evidence even when structured design events are incomplete", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-design-changelog-warnings-"));
    try {
      const session = makeSession(root, "studio-file-evidence-session", "app-build", "Update Studio sidebar spacing");
      const captured = await captureDesignChangelogEntry(root, {
        session,
        events: [makeEvent(session.id, "session_done", "Session completed")],
        trace: makeTrace([
          { path: "apps/studio/src/workbench-components.tsx", kind: "component", status: "M", insertions: 22, deletions: 6, designSystem: true },
        ]),
      });

      expect(captured.entry).toMatchObject({
        title: "codex app-build design change",
        captureWarnings: expect.arrayContaining([
          expect.stringContaining("design_decision"),
        ]),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not create entries for non-design sessions without design evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-design-changelog-non-design-"));
    try {
      const session = makeSession(root, "studio-docs-session", "raw", "List package scripts");
      const captured = await captureDesignChangelogEntry(root, {
        session,
        events: [makeEvent(session.id, "terminal_output", "npm scripts listed")],
        trace: makeTrace([{ path: "package.json", kind: "config", status: "M", insertions: 1, deletions: 0, designSystem: false }]),
      });

      expect(captured).toEqual({ entry: null, captured: false, warnings: [] });
      expect(await listDesignChangelogEntries(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function makeSession(root: string, id: string, action: StudioSession["action"], prompt: string): StudioSession {
  return {
    id,
    harness: "codex",
    action,
    cwd: root,
    prompt,
    status: "completed",
    startedAt: "2026-05-07T00:00:00.000Z",
    completedAt: "2026-05-07T00:01:00.000Z",
    exitCode: 0,
    activeStreamId: null,
    pendingPrompt: null,
    events: [],
  };
}

function makeEvent(sessionId: string, type: StudioEvent["type"], message: string, data?: unknown): StudioEvent {
  return {
    id: `${type}-${message.toLowerCase().replace(/\W+/g, "-").replace(/^-|-$/g, "")}`,
    sessionId,
    type,
    timestamp: "2026-05-07T00:00:10.000Z",
    message,
    data,
  };
}

function makeTrace(files: StudioDesignSystemTrace["files"]): StudioDesignSystemTrace {
  return {
    generatedAt: "2026-05-07T00:00:30.000Z",
    projectRoot: "/tmp/memoire",
    status: "changed",
    filesChanged: files.length,
    insertions: files.reduce((sum, file) => sum + file.insertions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    reviewLabel: `${files.length} files changed`,
    files,
    designSystemFiles: files.filter((file) => file.designSystem),
    error: null,
  };
}
