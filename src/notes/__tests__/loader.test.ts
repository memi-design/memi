import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { NoteLoader, resolveForIntent } from "../index.js";

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `memoire-notes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(testDir, "skills", "clawhub-mobile-craft"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("NoteLoader workspace skills", () => {
  it("loads SKILL.md workspace directories without note.json", async () => {
    await writeFile(
      join(testDir, "skills", "clawhub-mobile-craft", "SKILL.md"),
      `---
name: clawhub-mobile-craft
category: craft
activateOn: design-creation
freedomLevel: high
description: Mobile-first guidance for AgentSkills workspaces.
tags: [mobile, ui]
---

# ClawHub Mobile Craft

Workspace skill body.
`,
      "utf-8",
    );

    const loader = new NoteLoader(testDir);
    await loader.loadAll();

    const note = loader.getNote("clawhub-mobile-craft");
    expect(note).not.toBeNull();
    expect(note?.builtIn).toBe(false);
    expect(note?.manifest.skills[0]).toMatchObject({
      file: "SKILL.md",
      activateOn: "design-creation",
      freedomLevel: "high",
    });
    expect(note?.manifest.tags).toEqual(["mobile", "ui"]);
    expect(note?.path).toBe(join(testDir, "skills", "clawhub-mobile-craft"));

    const resolved = await resolveForIntent("page-layout", loader.notes);
    expect(resolved.some((skill) => skill.noteId === "clawhub-mobile-craft")).toBe(true);
  });

  it("prefers workspace SKILL.md bundles over installed .memoire notes with the same name", async () => {
    const installedDir = join(testDir, ".memoire", "notes", "clawhub-mobile-craft");
    await mkdir(installedDir, { recursive: true });
    await writeFile(
      join(installedDir, "note.json"),
      JSON.stringify({
        name: "clawhub-mobile-craft",
        version: "1.0.0",
        description: "Installed note loses to workspace skill",
        category: "craft",
        tags: [],
        skills: [{
          file: "clawhub-mobile-craft.md",
          name: "Installed Mobile Craft",
          activateOn: "always",
          freedomLevel: "high",
        }],
        dependencies: [],
      }, null, 2),
      "utf-8",
    );
    await writeFile(
      join(installedDir, "clawhub-mobile-craft.md"),
      "Installed note body",
      "utf-8",
    );
    await writeFile(
      join(testDir, "skills", "clawhub-mobile-craft", "SKILL.md"),
      `---
name: clawhub-mobile-craft
category: craft
activateOn: design-creation
freedomLevel: high
description: Workspace skill takes precedence.
tags: [mobile, ui]
---

# ClawHub Mobile Craft

Workspace skill body.
`,
      "utf-8",
    );

    const loader = new NoteLoader(testDir);
    await loader.loadAll();

    const note = loader.getNote("clawhub-mobile-craft");
    expect(note).toBeDefined();
    expect(note?.manifest.description).toBe("Workspace skill takes precedence.");
    expect(note?.manifest.skills[0].file).toBe("SKILL.md");
    expect(note?.path).toBe(join(testDir, "skills", "clawhub-mobile-craft"));
  });

  it("applies canonical registry routing and disables deprecated aliases", async () => {
    await mkdir(join(testDir, "skills", "current-skill"), { recursive: true });
    await mkdir(join(testDir, "skills", "old-alias"), { recursive: true });
    await mkdir(join(testDir, "registry"), { recursive: true });
    await writeFile(
      join(testDir, "skills", "current-skill", "SKILL.md"),
      "---\nname: current-skill\ndescription: Current skill.\n---\n# Current\n",
    );
    await writeFile(
      join(testDir, "skills", "old-alias", "SKILL.md"),
      "---\nname: old-alias\ndescription: Deprecated alias.\n---\n# Old\n",
    );
    await writeFile(join(testDir, "registry", "skills.json"), JSON.stringify({
      version: "2.0.0",
      skills: [
        {
          name: "current-skill",
          displayName: "Current Skill",
          status: "canonical",
          legacyCategory: "craft",
          tags: ["web", "accessibility"],
          actions: ["create", "audit"],
          lifecycle: ["design", "validate"],
          routing: {
            intents: ["accessible-web-interface"],
            excludes: ["native-only"],
            role: "primary",
          },
          runtime: { requires: [] },
        },
        {
          name: "old-alias",
          displayName: "Old Alias",
          status: "deprecated",
          legacyCategory: "craft",
          tags: ["web"],
          routing: { intents: ["old-alias"], excludes: [], role: "reference" },
          runtime: { requires: [] },
        },
      ],
    }));

    const loader = new NoteLoader(testDir);
    await loader.loadAll();

    const current = loader.getNote("current-skill");
    expect(current?.enabled).toBe(true);
    expect(current?.manifest.memoire?.routing).toMatchObject({
      intents: ["accessible-web-interface"],
      excludes: ["native-only"],
      platforms: ["web"],
      priority: 3,
      actions: ["create", "audit"],
      lifecycle: ["design", "validate"],
    });
    expect(loader.getNote("old-alias")?.enabled).toBe(false);
  });
});
