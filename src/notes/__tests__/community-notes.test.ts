import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildNoteForkPrHandoff,
  diffNoteFork,
  forkNoteDirectory,
  listNoteForks,
  validateCommunityNoteDir,
} from "../community.js";

let root: string;
let sourceNote: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "memoire-community-notes-"));
  sourceNote = join(root, "source", "design-systems");
  await mkdir(sourceNote, { recursive: true });
  await writeFile(join(sourceNote, "note.json"), JSON.stringify({
    name: "design-systems",
    version: "0.1.0",
    description: "Design system quality guidance.",
    author: "Memoire",
    category: "craft",
    tags: ["design-systems"],
    sourceUrls: ["https://www.w3.org/WAI/"],
    lastResearchedAt: "2026-05-07T00:00:00.000Z",
    freshnessDays: 60,
    skills: [{
      file: "design-systems.md",
      name: "Design Systems",
      activateOn: "design-system-init",
      freedomLevel: "high",
    }],
    dependencies: [],
  }, null, 2));
  await writeFile(join(sourceNote, "design-systems.md"), "# Design Systems\n\nUse tokens and components.\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("community Notes validation and forks", () => {
  it("validates strict community metadata and rejects unsafe skill paths", async () => {
    const valid = await validateCommunityNoteDir(sourceNote, { strictCommunity: true });
    expect(valid.ok).toBe(true);
    expect(valid.issues).toEqual([]);

    await writeFile(join(sourceNote, "note.json"), JSON.stringify({
      name: "unsafe-note",
      version: "0.1.0",
      description: "Unsafe note.",
      category: "craft",
      tags: [],
      skills: [{
        file: "../escape.md",
        name: "Escape",
        activateOn: "always",
        freedomLevel: "high",
      }],
      dependencies: [],
    }, null, 2));

    const invalid = await validateCommunityNoteDir(sourceNote, { strictCommunity: true });
    expect(invalid.ok).toBe(false);
    expect(invalid.issues.map((issue) => issue.message).join("\n")).toMatch(/sourceUrls|lastResearchedAt|freshnessDays|path traversal/i);
  });

  it("forks a Note into .memoire/notes with fork metadata, computes a diff, and exports PR commands", async () => {
    const fork = await forkNoteDirectory(root, {
      sourcePath: sourceNote,
      sourceRepo: "https://github.com/memi-design/memi",
      sourcePathInRepo: "notes/design-systems",
    });

    expect(fork.name).toBe("design-systems-fork");
    expect(fork.path).toBe(join(root, ".memoire", "notes", "design-systems-fork"));
    const manifest = JSON.parse(await readFile(join(fork.path, "note.json"), "utf-8"));
    expect(manifest).toMatchObject({
      name: "design-systems-fork",
      reviewStatus: "draft",
      forkOf: {
        name: "design-systems",
        version: "0.1.0",
        sourceRepo: "https://github.com/memi-design/memi",
        sourcePath: "notes/design-systems",
      },
    });

    await writeFile(join(fork.path, "design-systems.md"), "# Design Systems\n\nUse tokens, components, and contribution review.\n");
    const diff = await diffNoteFork(root, "design-systems-fork");
    expect(diff.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "design-systems.md", status: "modified" }),
    ]));

    const handoff = await buildNoteForkPrHandoff(root, "design-systems-fork");
    expect(handoff).toMatchObject({
      sourceRepo: "https://github.com/memi-design/design-skills",
      targetPath: "skills/design-systems-fork",
      commitMessage: "Update design-systems-fork Note",
    });
    expect(handoff.branchName).toMatch(/^notes\/design-systems-fork-/);
    expect(handoff.commands.join("\n")).toContain("git clone https://github.com/memi-design/design-skills.git");
    expect(handoff.commands.join("\n")).toContain("git commit -m \"Update design-systems-fork Note\"");

    const forks = await listNoteForks(root);
    expect(forks.map((item) => item.name)).toContain("design-systems-fork");
  });
});
