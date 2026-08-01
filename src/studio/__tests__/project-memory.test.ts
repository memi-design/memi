import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { indexProjectMemory, projectMemoryIndexPath, refreshProjectMemory } from "../project-memory.js";

describe("project memory index", () => {
  it("indexes existing research, specs, dashboard, sessions, preview, and changelog files", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-project-memory-"));
    try {
      await mkdir(join(root, "research"), { recursive: true });
      await mkdir(join(root, "specs", "components"), { recursive: true });
      await mkdir(join(root, ".memoire", "dashboard"), { recursive: true });
      await mkdir(join(root, ".memoire", "studio"), { recursive: true });
      await mkdir(join(root, ".memoire", "project-memory", "changelog"), { recursive: true });
      await mkdir(join(root, "preview"), { recursive: true });

      await writeFile(join(root, "research", "Interview Notes.md"), "# Interview Notes\n\nA research summary.");
      await writeFile(join(root, "specs", "components", "MetricCard.json"), JSON.stringify({
        name: "MetricCard",
        type: "component",
        level: "molecule",
        purpose: "Show a KPI",
        tags: ["dashboard"],
        updatedAt: "2026-05-01T00:00:00.000Z",
      }));
      await writeFile(join(root, ".memoire", "dashboard", "data.json"), JSON.stringify({
        designSystem: { tokens: [{ name: "gray-50" }], components: [{ name: "Button" }] },
      }));
      await writeFile(join(root, ".memoire", "studio", "session-index.json"), JSON.stringify({
        sessions: [{ id: "s1", harness: "memoire", status: "completed", prompt: "compose hero", eventCount: 4 }],
      }));
      await writeFile(join(root, "preview", "design-system.html"), "<title>memoire / systems</title>");
      await writeFile(join(root, "CHANGELOG.md"), "# Changelog\n\n## 0.14.4\n\n- Trust patch.");
      await writeFile(join(root, ".memoire", "project-memory", "changelog", "studio-spacing.json"), JSON.stringify({
        schemaVersion: 1,
        id: "studio-spacing",
        title: "Studio spacing pass",
        summary: "Captured design memory for the Studio sidebar spacing.",
        bodyMarkdown: "## Decision\n\nUse compact sidebar spacing.",
        status: "active",
        tags: ["studio", "spacing"],
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z",
        authoredBy: "agent",
        harness: "codex",
        action: "self-design",
        sessionId: "studio-spacing-session",
        eventIds: ["design_decision-spacing"],
        fileRefs: [{ path: "apps/studio/src/styles.css", kind: "style", status: "M", insertions: 8, deletions: 2, designSystem: true }],
        captureWarnings: [],
      }));

      const index = await refreshProjectMemory(root);

      expect(index.projectRoot).toBe(root);
      expect(index.counts).toMatchObject({
        research: 1,
        spec: 1,
        system: 2,
        monitor: 1,
        changelog: 2,
      });
      expect(index.items.map((item) => item.kind)).toEqual(expect.arrayContaining([
        "research",
        "spec",
        "system",
        "monitor",
        "changelog",
      ]));
      expect(index.items.find((item) => item.title === "MetricCard")).toMatchObject({
        kind: "spec",
        status: "molecule",
        tags: ["dashboard"],
      });
      expect(index.items.find((item) => item.title === "Studio spacing pass")).toMatchObject({
        kind: "changelog",
        status: "active",
        sourcePath: join(".memoire", "project-memory", "changelog", "studio-spacing.json"),
        tags: expect.arrayContaining(["design-changelog", "studio"]),
      });

      const persisted = JSON.parse(await readFile(projectMemoryIndexPath(root), "utf-8"));
      expect(persisted.items.length).toBe(index.items.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is deterministic and handles missing source folders", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-project-memory-empty-"));
    try {
      const first = await indexProjectMemory(root);
      const second = await indexProjectMemory(root);

      expect(first.items).toEqual(second.items);
      expect(first.counts).toMatchObject({
        home: 1,
        research: 0,
        spec: 0,
        system: 0,
        monitor: 0,
        changelog: 0,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("excludes stale Dibs, AICP, and bidding memory sources", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-project-memory-filter-"));
    try {
      await mkdir(join(root, "research"), { recursive: true });
      await mkdir(join(root, "preview", "generated"), { recursive: true });
      await mkdir(join(root, "preview", "standalone"), { recursive: true });
      await mkdir(join(root, "preview"), { recursive: true });

      await writeFile(join(root, "research", "AICP_BIDDING_RESEARCH.md"), "# AICP Bidding\n\nDibs bid research.");
      await writeFile(join(root, "research", "memoire-product.md"), "# Memoire Product\n\nFresh memory.");
      await writeFile(join(root, "preview", "generated", "gallery.html"), "Dibs active bids and AICP budget intelligence");
      await writeFile(join(root, "preview", "changelog.html"), "Added Dibs preview screens");
      await writeFile(join(root, "preview", "standalone", "changelog.html"), "AICP bidding archive");
      await writeFile(join(root, "preview", "design-system.html"), "<title>Memoire systems</title>");
      await writeFile(join(root, "CHANGELOG.md"), "# Changelog\n\n## Older\n\n- Added Dibs bidding memory.");

      const index = await indexProjectMemory(root);
      const searchable = JSON.stringify(index.items).toLowerCase();

      expect(index.counts.research).toBe(1);
      expect(index.items.find((item) => item.kind === "changelog")).toBeUndefined();
      expect(index.items.map((item) => item.sourcePath)).toContain(join("preview", "design-system.html"));
      expect(index.items.map((item) => item.sourcePath)).not.toContain(join("preview", "generated", "gallery.html"));
      expect(index.items.map((item) => item.sourcePath)).not.toContain(join("preview", "changelog.html"));
      expect(index.items.map((item) => item.sourcePath)).not.toContain(join("preview", "standalone", "changelog.html"));
      expect(searchable).not.toMatch(/dibs|aicp|bidding|\\bbids?\\b/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
