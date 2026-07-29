import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InstalledNote } from "../types.js";
import {
  routeInstalledSkills,
  searchCatalogSkills,
} from "../skill-router.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("deterministic skill router", () => {
  it("stacks two complementary skills in stable score order", async () => {
    const notes = await Promise.all([
      note("accessibility-audit", {
        description: "Audit WCAG, keyboard, VoiceOver, contrast, and accessible UI states.",
        intents: ["accessibility-audit", "wcag-review"],
      }),
      note("better-typography", {
        description: "Improve type scale, line height, responsive text, and typography tokens.",
        intents: ["typography-system", "responsive-typography"],
      }),
      note("figma-use", {
        description: "Operate a Figma canvas and inspect component instances.",
        intents: ["figma-canvas-operation"],
        capabilities: ["figma"],
      }),
    ]);

    const first = await routeInstalledSkills({
      intent: "Audit this responsive type system for WCAG and VoiceOver problems",
      notes,
      capabilities: [],
      maximumSkills: 2,
      maximumContextBytes: 8_000,
    });
    const second = await routeInstalledSkills({
      intent: "Audit this responsive type system for WCAG and VoiceOver problems",
      notes,
      capabilities: [],
      maximumSkills: 2,
      maximumContextBytes: 8_000,
    });

    expect(first.decision).toBe("stack");
    expect(first.selected.map((skill) => skill.id).sort()).toEqual([
      "accessibility-audit",
      "better-typography",
    ]);
    expect(first).toEqual(second);
    expect(first.excluded).toContainEqual(expect.objectContaining({
      id: "figma-use",
      reason: "missing-capability:figma",
    }));
  });

  it("abstains on an unrelated request instead of spending context", async () => {
    const result = await routeInstalledSkills({
      intent: "Optimize this PostgreSQL index and query plan",
      notes: [await note("better-ui", {
        description: "Polish interface hierarchy, controls, borders, and interaction states.",
        intents: ["interface-polish"],
      })],
      capabilities: [],
      maximumSkills: 2,
      maximumContextBytes: 8_000,
    });

    expect(result.decision).toBe("abstain");
    expect(result.selected).toEqual([]);
    expect(result.contextBytes).toBe(0);
  });

  it("enforces the context budget without partially injecting a skill", async () => {
    const result = await routeInstalledSkills({
      intent: "Audit WCAG accessibility",
      notes: [await note("accessibility-audit", {
        description: "Audit WCAG accessibility and keyboard behavior.",
        intents: ["accessibility-audit"],
        body: "x".repeat(2_000),
      })],
      capabilities: [],
      maximumSkills: 1,
      maximumContextBytes: 500,
    });

    expect(result.decision).toBe("abstain");
    expect(result.excluded).toContainEqual(expect.objectContaining({
      id: "accessibility-audit",
      reason: "context-budget-exceeded",
    }));
  });

  it("ranks catalog search by intent evidence rather than substring order", () => {
    const results = searchCatalogSkills({
      query: "build an accessible SwiftUI settings screen",
      entries: [
        {
          id: "better-ui",
          name: "better-ui",
          title: "Better UI",
          description: "Build and polish a general interface screen.",
          tags: ["ui"],
          intents: ["interface-polish"],
        },
        {
          id: "swiftui-design-engineering",
          name: "swiftui-design-engineering",
          title: "SwiftUI Design Engineering",
          description: "Build and verify accessible SwiftUI screens and navigation.",
          tags: ["swiftui", "ios", "accessibility"],
          intents: ["swiftui-interface", "ios-interface"],
        },
      ],
      limit: 2,
    });

    expect(results[0]).toMatchObject({
      id: "swiftui-design-engineering",
      matchedTerms: expect.arrayContaining(["swiftui", "accessible"]),
    });
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});

async function note(
  name: string,
  options: {
    description: string;
    intents: string[];
    capabilities?: string[];
    body?: string;
  },
): Promise<InstalledNote> {
  const root = await mkdtemp(path.join(tmpdir(), `memi-skill-router-${name}-`));
  tempDirs.push(root);
  const noteDir = path.join(root, name);
  await mkdir(noteDir, { recursive: true });
  await writeFile(
    path.join(noteDir, "SKILL.md"),
    options.body ?? `# ${name}\n\nUse repository evidence and verify the result.`,
  );
  return {
    path: noteDir,
    builtIn: false,
    enabled: true,
    manifest: {
      name,
      version: "1.0.0",
      description: options.description,
      category: "craft",
      tags: [],
      sourceUrls: [],
      skills: [{
        file: "SKILL.md",
        name,
        activateOn: options.intents.join(", "),
        freedomLevel: "read-only",
      }],
      dependencies: [],
      memoire: {
        harnessExtensions: [],
        routing: {
          intents: options.intents,
          excludes: [],
          capabilities: options.capabilities ?? [],
          platforms: [],
          priority: 0,
        },
      },
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
  };
}
