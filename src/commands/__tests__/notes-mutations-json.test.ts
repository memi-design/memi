import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Command } from "commander";
import { registerNotesCommand } from "../notes.js";
import { captureLogs, lastLog } from "./test-helpers.js";

let projectRoot: string;
let sourceDir: string;

beforeEach(async () => {
  projectRoot = join(tmpdir(), `memoire-notes-json-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  sourceDir = join(projectRoot, "source-note");
  await mkdir(sourceDir, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("notes mutation JSON output", () => {
  it("emits structured JSON for notes install --json", async () => {
    await writeFile(
      join(sourceDir, "SKILL.md"),
      `---
name: capture-workflows
category: connect
activateOn: always
freedomLevel: high
description: Clipboard-first capture workflows for Figma.
tags: [figma, capture]
---

# Capture Workflows

Use clipboard-first capture flows.
`,
      "utf-8",
    );

    const logs = captureLogs();
    const program = new Command();
    registerNotesCommand(program, makeNotesEngine(projectRoot) as never);

    await program.parseAsync(["notes", "install", sourceDir, "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      action: "install",
      status: "completed",
      options: { json: true },
      source: sourceDir,
      installedPath: join(projectRoot, ".memoire", "notes", "capture-workflows"),
      note: {
        name: "capture-workflows",
        category: "connect",
        description: "Clipboard-first capture workflows for Figma.",
        skills: [{
          file: "SKILL.md",
          name: "Capture Workflows",
          activateOn: "always",
          freedomLevel: "high",
        }],
      },
    });
  });

  it("emits structured JSON for notes create --json", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerNotesCommand(program, makeNotesEngine(projectRoot) as never);

    await program.parseAsync(["notes", "create", "clawhub-interop", "--category", "connect", "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      action: "create",
      status: "completed",
      options: { json: true },
      name: "clawhub-interop",
      category: "connect",
      noteDir: join(projectRoot, ".memoire", "notes", "clawhub-interop"),
      filesCreated: ["note.json", "clawhub-interop.md"],
      note: {
        name: "clawhub-interop",
        category: "connect",
        skills: [{
          file: "clawhub-interop.md",
          activateOn: "always",
          freedomLevel: "high",
        }],
      },
    });

    const createdStat = await stat(join(projectRoot, ".memoire", "notes", "clawhub-interop", "note.json"));
    expect(createdStat.isFile()).toBe(true);
  });

  it("emits structured JSON for notes remove --json", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerNotesCommand(program, makeNotesEngine(projectRoot) as never);

    await program.parseAsync(["notes", "create", "temporary-note", "--json"], { from: "user" });
    logs.length = 0;

    await program.parseAsync(["notes", "remove", "temporary-note", "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      action: "remove",
      status: "completed",
      options: { json: true },
      name: "temporary-note",
      removedPath: join(projectRoot, ".memoire", "notes", "temporary-note"),
    });

    await expect(stat(join(projectRoot, ".memoire", "notes", "temporary-note"))).rejects.toThrow();
  });

  it("emits structured JSON for notes outdated and doctor", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerNotesCommand(program, makeNotesEngine(projectRoot, [{
      manifest: {
        name: "stale-motion",
        version: "0.1.0",
        description: "Old motion guidance.",
        category: "craft",
        tags: ["motion"],
        skills: [{ file: "stale-motion.md", name: "Stale Motion", activateOn: "motion-video", freedomLevel: "high" }],
        dependencies: [],
        updatedAt: "2026-03-01T00:00:00.000Z",
        lastResearchedAt: "2026-03-01T00:00:00.000Z",
        freshnessDays: 30,
      },
      path: projectRoot,
      builtIn: true,
      enabled: true,
    }]) as never);

    await program.parseAsync(["notes", "outdated", "--json"], { from: "user" });
    const outdated = JSON.parse(lastLog(logs));
    expect(outdated.status).toBe("completed");
    expect(outdated.outdated).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "stale-motion", reason: expect.stringMatching(/researched/i) }),
    ]));

    logs.length = 0;
    await program.parseAsync(["notes", "doctor", "--json"], { from: "user" });
    const doctor = JSON.parse(lastLog(logs));
    expect(doctor).toMatchObject({
      status: "completed",
      notesChecked: 1,
      issues: [],
    });
  });

  it("emits strict community doctor errors for missing review metadata", async () => {
    await mkdir(join(projectRoot, "community-note"), { recursive: true });
    await writeFile(join(projectRoot, "community-note", "note.json"), JSON.stringify({
      name: "community-note",
      version: "0.1.0",
      description: "Community supplied workflow.",
      category: "craft",
      tags: [],
      skills: [{
        file: "community-note.md",
        name: "Community Note",
        activateOn: "always",
        freedomLevel: "high",
      }],
      dependencies: [],
    }, null, 2));
    await writeFile(join(projectRoot, "community-note", "community-note.md"), "# Community Note\n");

    const logs = captureLogs();
    const program = new Command();
    registerNotesCommand(program, makeNotesEngine(projectRoot) as never);

    await program.parseAsync(["notes", "doctor", "--community", "--path", join(projectRoot, "community-note"), "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      status: "failed",
      notesChecked: 1,
    });
    expect(payload.issues.map((issue: { message: string }) => issue.message).join("\n")).toMatch(/sourceUrls|lastResearchedAt|freshnessDays/i);
    expect(process.exitCode).toBe(1);
  });

  it("reports executable legacy routing syntax with a migration target", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerNotesCommand(program, makeNotesEngine(projectRoot, [{
      manifest: {
        name: "unsafe-route",
        version: "0.1.0",
        description: "A note with a legacy executable routing expression.",
        category: "craft",
        tags: [],
        skills: [{ file: "unsafe-route.md", name: "Unsafe Route", activateOn: "always", freedomLevel: "high" }],
        dependencies: [],
        memoire: {
          harnessExtensions: [],
          routing: {
            intents: [],
            excludes: [],
            capabilities: [],
            platforms: [],
            priority: 0,
            repository: { dependenciesAny: ["expo.*"] },
          },
        },
      },
      path: projectRoot,
      builtIn: false,
      enabled: true,
    }]) as never);

    await program.parseAsync(["notes", "doctor", "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({ status: "failed", notesChecked: 1 });
    expect(payload.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "unsafe-route",
        message: expect.stringMatching(/dependenciesAny.*contains:expo\./i),
      }),
    ]));
  });
});

function makeNotesEngine(projectRootPath: string, notes: unknown[] = []) {
  return {
    config: { projectRoot: projectRootPath },
    notes: {
      loaded: true,
      notes,
      async loadAll() {},
      getNote() {
        return null;
      },
    },
  };
}
