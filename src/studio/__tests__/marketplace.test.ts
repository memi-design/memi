import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { StudioRuntimeServer } from "../server.js";

const servers: StudioRuntimeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("studio marketplace", () => {
  it("lists built-in and installed Memoire Notes for the Studio marketplace", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-marketplace-"));
    try {
      const server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();

      const payload = await fetch(`${runtime.url}/api/marketplace/notes`).then((res) => res.json());
      const note = payload.notes.find((candidate: { id: string }) => candidate.id === "design-systems");

      expect(payload.summary.total).toBeGreaterThan(10);
      expect(payload.summary.builtIn).toBeGreaterThan(0);
      expect(note).toMatchObject({
        id: "design-systems",
        name: "design-systems",
        category: "craft",
        installed: false,
        builtIn: true,
        installable: true,
      });
      expect(note.tags).toEqual(expect.any(Array));
      expect(note.sourcePath).toEqual(expect.stringContaining(join("notes", "design-systems")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("installs and removes installable notes through marketplace endpoints", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-marketplace-"));
    try {
      const server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();

      const installResponse = await fetch(`${runtime.url}/api/marketplace/notes/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteId: "design-systems" }),
      });
      expect(installResponse.status).toBe(202);
      const installPayload = await installResponse.json();
      expect(installPayload.job).toMatchObject({ status: "completed", noteName: "design-systems" });
      const installedPayload = await fetch(`${runtime.url}/api/marketplace/notes`).then((res) => res.json());
      const installedNote = installedPayload.notes.find((candidate: { id: string }) => candidate.id === "design-systems");
      expect(installedNote.installed).toBe(true);
      await expect(stat(join(root, ".memoire", "notes", "design-systems", "note.json"))).resolves.toBeTruthy();

      const removeResponse = await fetch(`${runtime.url}/api/marketplace/notes/remove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "design-systems" }),
      });
      expect(removeResponse.status).toBe(200);
      const removedPayload = await removeResponse.json();
      const removedNote = removedPayload.notes.find((candidate: { id: string }) => candidate.id === "design-systems");
      expect(removedNote.installed).toBe(false);
      await expect(stat(join(root, ".memoire", "notes", "design-systems", "note.json"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("forks marketplace notes, exposes editable files, validates, diffs, and exports PR handoff commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-marketplace-fork-"));
    try {
      const server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();

      const forkResponse = await fetch(`${runtime.url}/api/marketplace/notes/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteId: "design-systems" }),
      });
      expect(forkResponse.status).toBe(201);
      const forkPayload = await forkResponse.json();
      expect(forkPayload.fork).toMatchObject({
        name: "design-systems-fork",
        reviewStatus: "draft",
        forkOf: { name: "design-systems" },
      });

      const filesPayload = await fetch(`${runtime.url}/api/marketplace/notes/forks/design-systems-fork/files`).then((res) => res.json());
      expect(filesPayload.files.map((file: { path: string }) => file.path)).toContain("note.json");
      expect(filesPayload.files.some((file: { path: string }) => file.path.endsWith(".md"))).toBe(true);

      const markdownPath = filesPayload.files.find((file: { path: string }) => file.path.endsWith(".md")).path;
      const updateResponse = await fetch(`${runtime.url}/api/marketplace/notes/forks/design-systems-fork/files`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: markdownPath, content: "# Community update\n\nTighten review guidance.\n" }),
      });
      expect(updateResponse.status).toBe(200);
      expect(await readFile(join(root, ".memoire", "notes", "design-systems-fork", markdownPath), "utf-8"))
        .toContain("Community update");

      const validatePayload = await fetch(`${runtime.url}/api/marketplace/notes/forks/design-systems-fork/validate`, {
        method: "POST",
      }).then((res) => res.json());
      expect(validatePayload.validation.ok).toBe(true);

      const diffPayload = await fetch(`${runtime.url}/api/marketplace/notes/forks/design-systems-fork/diff`).then((res) => res.json());
      expect(diffPayload.diff.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: markdownPath, status: "modified" }),
      ]));

      const handoffPayload = await fetch(`${runtime.url}/api/marketplace/notes/forks/design-systems-fork/export-pr`, {
        method: "POST",
      }).then((res) => res.json());
      expect(handoffPayload.handoff.commands.join("\n")).toContain("design-skills");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
