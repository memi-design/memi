import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { StudioDownloadStore } from "../downloads.js";
import { StudioRuntimeServer } from "../server.js";

const servers: StudioRuntimeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("studio downloads and video runtime APIs", () => {
  it("keeps the runtime alive when the project download ledger is not writable", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-downloads-readonly-"));
    try {
      await writeFile(join(root, ".memoire"), "blocks ledger directory creation\n");
      const downloads = new StudioDownloadStore(root);
      await expect(downloads.init()).resolves.toBeUndefined();
      expect(downloads.list()).toEqual([]);
      expect(downloads.metrics()).toMatchObject({
        total: 0,
        active: 0,
        queued: 0,
        storageAvailable: false,
      });
      expect(downloads.metrics().storageError).toContain(".memoire");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns a download job for remote marketplace note installs and persists the installed note", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-downloads-"));
    try {
      const catalogUrl = await createFixtureCatalog(root);
      const server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();

      const listPayload = await fetch(`${runtime.url}/api/marketplace/notes?refresh=1&catalogUrl=${encodeURIComponent(catalogUrl)}`).then((res) => res.json());
      expect(listPayload.remote).toMatchObject({ status: "ready" });
      expect(listPayload.notes.find((note: { id: string }) => note.id === "remote-video-pack")).toMatchObject({
        source: "remote-catalog",
        installable: true,
        installed: false,
      });

      const response = await fetch(`${runtime.url}/api/marketplace/notes/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteId: "remote-video-pack", catalogUrl }),
      });
      expect(response.status).toBe(202);
      const { job } = await response.json();
      expect(job).toMatchObject({ type: "note-install", status: "completed", noteName: "remote-video-pack" });
      await expect(stat(join(root, ".memoire", "notes", "remote-video-pack", "note.json"))).resolves.toBeTruthy();

      const downloads = await fetch(`${runtime.url}/api/downloads`).then((res) => res.json());
      expect(downloads.downloads.map((download: { id: string }) => download.id)).toContain(job.id);

      const events = await fetch(`${runtime.url}/api/downloads/${job.id}/events`, {
        headers: { accept: "text/event-stream" },
      }).then((res) => res.text());
      expect(events).toContain("event: completed");
      expect(events).toContain("remote-video-pack");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serves video status, project creation, command prep, and render downloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-video-api-"));
    try {
      const server = new StudioRuntimeServer({ projectRoot: root, port: 0 });
      servers.push(server);
      const runtime = await server.start();

      const status = await fetch(`${runtime.url}/api/video/status`).then((res) => res.json());
      expect(status.adapters).toHaveProperty("remotion");
      expect(status.adapters).toHaveProperty("hyperframes");

      const createdResponse = await fetch(`${runtime.url}/api/video/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Launch clip", prompt: "Build a Studio launch clip", adapter: "hyperframes" }),
      });
      expect(createdResponse.status).toBe(201);
      const created = await createdResponse.json();
      expect(created.project).toMatchObject({ id: "launch-clip", adapter: "hyperframes" });
      expect(await readFile(join(root, ".memoire", "videos", "launch-clip", "index.html"), "utf-8"))
        .toContain("Build a Studio launch clip");
      expect(await readFile(join(root, ".memoire", "videos", "launch-clip", "hyperframes.json"), "utf-8"))
        .toContain("launch-clip");

      const preview = await fetch(`${runtime.url}/api/video/projects/launch-clip/preview`, { method: "POST" }).then((res) => res.json());
      expect(preview.result.command.join(" ")).toContain("hyperframes preview");

      const render = await fetch(`${runtime.url}/api/video/projects/launch-clip/render`, { method: "POST" }).then((res) => res.json());
      expect(render.result.command.join(" ")).toContain("hyperframes render");
      expect(render.result.command).toContain("--output");

      const download = await fetch(`${runtime.url}/api/video/projects/launch-clip/download`);
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toContain("application/json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createFixtureCatalog(root: string): Promise<string> {
  const sourceDir = join(root, "fixture-source", "remote-video-pack");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(join(sourceDir, "note.json"), JSON.stringify({
    name: "remote-video-pack",
    version: "0.1.0",
    description: "Current Hyperframes production guidance.",
    category: "generate",
    tags: ["video", "hyperframes"],
    sourceUrls: ["https://hyperframes.mintlify.app/packages/cli"],
    lastResearchedAt: "2026-05-06T00:00:00.000Z",
    freshnessDays: 60,
    skills: [{
      file: "remote-video-pack.md",
      name: "Remote Video Pack",
      activateOn: "motion-video",
      freedomLevel: "high",
    }],
    dependencies: [],
  }, null, 2));
  await writeFile(join(sourceDir, "remote-video-pack.md"), "# Remote Video Pack\n\nUse npx hyperframes preview.\n");

  const archivePath = join(root, "remote-video-pack-0.1.0.tgz");
  await tar(["-czf", archivePath, "-C", join(root, "fixture-source"), "remote-video-pack"]);
  const archiveBytes = await readFile(archivePath);
  const catalogPath = join(root, "catalog.v1.json");
  await writeFile(catalogPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: "2026-05-06T00:00:00.000Z",
    baseUrl: pathToFileURL(root).toString(),
    notes: [{
      id: "remote-video-pack",
      name: "remote-video-pack",
      title: "Remote Video Pack",
      version: "0.1.0",
      description: "Current Hyperframes production guidance.",
      category: "generate",
      tags: ["video", "hyperframes"],
      sourceUrls: ["https://hyperframes.mintlify.app/packages/cli"],
      lastResearchedAt: "2026-05-06T00:00:00.000Z",
      freshnessDays: 60,
      archive: {
        url: pathToFileURL(archivePath).toString(),
        sha256: createHash("sha256").update(archiveBytes).digest("hex"),
        size: archiveBytes.byteLength,
      },
    }],
  }, null, 2));
  return pathToFileURL(catalogPath).toString();
}

function tar(args: string[]): Promise<void> {
  return new Promise((resolveTar, rejectTar) => {
    execFile("tar", args, { encoding: "utf-8", env: { ...process.env, COPYFILE_DISABLE: "1" } }, (error, _stdout, stderr) => {
      if (error) {
        rejectTar(new Error(stderr || error.message));
        return;
      }
      resolveTar();
    });
  });
}
