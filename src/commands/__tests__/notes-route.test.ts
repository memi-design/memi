import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerNotesCommand } from "../notes.js";
import { captureLogs, lastLog } from "./test-helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("notes route command", () => {
  it("returns a traceable deterministic skill stack as JSON", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-notes-route-"));
    tempDirs.push(root);
    const noteDir = path.join(root, "skills", "accessibility-audit");
    await mkdir(noteDir, { recursive: true });
    await writeFile(path.join(noteDir, "SKILL.md"), "# Accessibility\n\nVerify WCAG evidence.");
    const notes = [{
      path: noteDir,
      builtIn: false,
      enabled: true,
      manifest: {
        name: "accessibility-audit",
        version: "1.0.0",
        description: "Audit WCAG accessibility and keyboard behavior.",
        category: "craft",
        tags: ["accessibility"],
        sourceUrls: [],
        skills: [{
          file: "SKILL.md",
          name: "Accessibility Audit",
          activateOn: "accessibility-audit",
          freedomLevel: "read-only",
        }],
        dependencies: [],
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
      },
    }];
    const engine = {
      config: { projectRoot: root },
      notes: {
        loaded: true,
        notes,
        async loadAll() {},
      },
    };
    const logs = captureLogs();
    const program = new Command();
    program.exitOverride();
    registerNotesCommand(program, engine as never);

    await program.parseAsync([
      "notes",
      "route",
      "Audit this checkout for WCAG keyboard accessibility",
      "--max-skills",
      "2",
      "--max-context-bytes",
      "4000",
      "--json",
    ], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload.status).toBe("completed");
    expect(payload.route.decision).toBe("single");
    expect(payload.route.selected[0]).toMatchObject({
      id: "accessibility-audit",
      contentHash: expect.stringMatching(/^sha256:/),
    });
  });
});
