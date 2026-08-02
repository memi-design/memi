import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InstalledNote } from "../types.js";
import {
  compileSafeRoutingPattern,
  formatRoutedSkillContext,
  resolveRoutedSkills,
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

  it("formats the exact selected skill stack with its trace receipt", async () => {
    const routed = await resolveRoutedSkills({
      intent: "Audit WCAG accessibility",
      notes: [await note("accessibility-audit", {
        description: "Audit WCAG accessibility and keyboard behavior.",
        intents: ["accessibility-audit"],
      })],
      capabilities: [],
    });

    const context = formatRoutedSkillContext(routed);

    expect(context).toContain("\"routerVersion\": \"skill-router-v2\"");
    expect(context).toContain("# accessibility-audit");
    expect(context).toContain(routed.route.selected[0].contentHash);
    expect(context).toContain("The task manifest and closest repository evidence are authoritative.");
    expect(context).toContain("Do not broaden scope, inventory the whole repository");
    expect(context).toContain("Run only the manifest verification commands");
    expect(context).toContain("\"toolCallRole\": \"diagnostic_only\"");
    expect(context).toContain("\"primaryObjectives\"");
    expect(context).toContain("Extra narrow tool calls are allowed when they reduce total cost");
    expect(context).not.toContain("\"candidates\"");
    expect(context).not.toContain("\"excluded\"");
  });

  it("does not stack a second skill that adds no novel routing evidence", async () => {
    const notes = await Promise.all([
      note("accessibility-audit", {
        description: "Audit accessibility, keyboard focus, and reduced motion.",
        intents: ["accessibility-audit", "keyboard-focus", "reduced-motion"],
      }),
      note("motion-performance", {
        description: "Audit accessibility and reduced motion performance.",
        intents: ["reduced-motion", "motion-performance"],
      }),
    ]);

    const routed = await routeInstalledSkills({
      intent: "Audit keyboard focus accessibility and reduced motion",
      notes,
      capabilities: [],
      maximumSkills: 2,
    });

    expect(routed.selected.map((skill) => skill.id)).toEqual(["accessibility-audit"]);
    expect(routed.excluded).toContainEqual({
      id: "motion-performance",
      reason: "redundant-evidence",
    });
  });

  it("does not fill a stack with a weakly related fallback after pruning redundancy", async () => {
    const notes = await Promise.all([
      note("accessibility-audit", {
        description: "Audit accessibility, keyboard focus, and reduced motion.",
        intents: ["accessibility-audit", "keyboard-focus", "reduced-motion"],
      }),
      note("motion-performance", {
        description: "Audit accessibility and reduced motion performance.",
        intents: ["reduced-motion", "motion-performance"],
      }),
      note("creative-rendering-audit", {
        description: "Review visual rendering quality.",
        intents: ["creative-rendering-audit"],
      }),
    ]);

    const routed = await routeInstalledSkills({
      intent: "Audit keyboard focus accessibility, reduced motion, and visual quality",
      notes,
      capabilities: [],
      maximumSkills: 2,
    });

    expect(routed.selected.map((skill) => skill.id)).toEqual(["accessibility-audit"]);
    expect(routed.excluded).toContainEqual({
      id: "creative-rendering-audit",
      reason: "insufficient-stack-confidence",
    });
  });

  it("rejects audit-only guidance for a product implementation task", async () => {
    const audit = await note("accessibility-audit", {
      description: "Audit WCAG accessibility and keyboard focus.",
      intents: ["accessibility-audit"],
      actions: ["audit"],
    });
    const implementation = await note("accessible-interface", {
      description: "Create accessible keyboard interactions.",
      intents: ["accessible-interface"],
      actions: ["create"],
    });

    const routed = await routeInstalledSkills({
      intent: "Implement an accessible keyboard dialog and add focus restoration",
      notes: [audit, implementation],
      capabilities: [],
      maximumSkills: 2,
    });

    expect(routed.selected.map((skill) => skill.id)).toEqual(["accessible-interface"]);
    expect(routed.excluded).toContainEqual({
      id: "accessibility-audit",
      reason: "action-mismatch:create",
    });
  });

  it("does not treat a preserved existing system as a requested creation domain", async () => {
    const systems = await note("design-systems", {
      description: "Create visual systems and reusable design tokens.",
      intents: ["design-systems"],
      actions: ["create"],
    });

    const routed = await routeInstalledSkills({
      intent: "Implement a dialog while preserving the existing visual system",
      notes: [systems],
      capabilities: [],
      maximumSkills: 2,
    });

    expect(routed.decision).toBe("abstain");
  });

  it("formats portable skill paths and records references that exceed the context budget", async () => {
    const installed = await note("accessibility-audit", {
      description: "Audit WCAG accessibility and keyboard behavior.",
      intents: ["accessibility-audit"],
      body: "# accessibility-audit\n\nRead [the guide](references/guide.md) before auditing.",
    });
    await mkdir(path.join(installed.path, "references"), { recursive: true });
    await writeFile(
      path.join(installed.path, "references", "guide.md"),
      `# Full guide\n\n${"Detailed accessibility evidence. ".repeat(100)}`,
    );

    const routed = await resolveRoutedSkills({
      intent: "Audit WCAG accessibility",
      notes: [installed],
      capabilities: [],
      maximumContextBytes: 500,
    });
    const context = formatRoutedSkillContext(routed);

    expect(context).not.toContain(installed.path);
    expect(context).toContain("\"skillPath\": \"accessibility-audit/SKILL.md\"");
    expect(context).toContain("references/guide.md");
    expect(context).toContain("context-budget-exceeded");
    expect(context).toContain("Do not attempt to read omitted resources outside the disposable workspace.");
  });

  it("embeds small directly referenced markdown resources within the same context budget", async () => {
    const installed = await note("motion-performance", {
      description: "Review interface motion performance and reduced motion.",
      intents: ["motion-performance"],
      body: "# motion-performance\n\nFollow [the checklist](references/checklist.md).",
    });
    await mkdir(path.join(installed.path, "references"), { recursive: true });
    await writeFile(
      path.join(installed.path, "references", "checklist.md"),
      "# Motion checklist\n\nMeasure frame pacing and verify reduced motion.",
    );

    const routed = await resolveRoutedSkills({
      intent: "Review motion performance",
      notes: [installed],
      capabilities: [],
      maximumContextBytes: 1_000,
    });
    const context = formatRoutedSkillContext(routed);

    expect(routed.resources).toEqual([
      expect.objectContaining({
        noteId: "motion-performance",
        relativePath: "references/checklist.md",
        status: "embedded",
      }),
    ]);
    expect(context).toContain("# Motion checklist");
    expect(routed.contextBytes).toBeGreaterThan(routed.route.contextBytes);
    expect(routed.contextBytes).toBeLessThanOrEqual(1_000);
  });

  it("does not route a compound intent from one generic matching word", async () => {
    const result = await routeInstalledSkills({
      intent: "Build and test a trustworthy clinical dashboard navigation",
      notes: [await note("dashboard-from-research", {
        description: "Transform research data into interactive dashboards.",
        intents: ["dashboard-from-research"],
      })],
      capabilities: [],
    });

    expect(result.decision).toBe("abstain");
  });

  it("does not confuse a generic iOS app interface with App Intents", async () => {
    const appIntents = await note("ios-app-intents", {
      description: "Design and implement iOS App Intents, Siri, Shortcuts, and Spotlight actions.",
      intents: ["ios-app-intents"],
      actions: ["create"],
    });
    const swiftUI = await note("swiftui-design-engineering", {
      description: "Build and verify accessible SwiftUI interfaces on iOS Simulator.",
      intents: ["swiftui-design-engineering"],
      actions: ["create"],
    });

    const result = await routeInstalledSkills({
      intent: "Implement an accessible SwiftUI settings row in the existing iOS app and verify it on Simulator",
      notes: [appIntents, swiftUI],
      capabilities: [],
      platforms: ["swiftui"],
      maximumSkills: 1,
    });

    expect(result.selected.map((skill) => skill.id)).toEqual([
      "swiftui-design-engineering",
    ]);
  });

  it("does not treat one shared word as an exact routing exclusion", async () => {
    const candidate = await note("swiftui-design-engineering", {
      description: "Build and repair accessible SwiftUI interfaces.",
      intents: ["swiftui-interface", "ios-interface"],
    });
    candidate.manifest.memoire!.routing!.excludes = ["creative-rendering-audit"];

    const result = await routeInstalledSkills({
      intent: "Audit and repair a SwiftUI game HUD",
      notes: [candidate],
      capabilities: [],
      platforms: ["swiftui"],
    });

    expect(result.excluded).not.toContainEqual(expect.objectContaining({
      id: "swiftui-design-engineering",
      reason: "routing-exclusion",
    }));
    expect(result.selected[0]?.id).toBe("swiftui-design-engineering");
  });

  it("uses repository fingerprints to choose a niche Expo route over generic mobile guidance", async () => {
    const expo = await note("expo-router-bottom-tabs", {
      description: "Implement Expo Router bottom tabs, badges, and accessible tab state.",
      intents: ["expo-router-bottom-tabs", "bottom-tab-badge"],
      platforms: ["react-native"],
      repository: {
        dependenciesAny: ["^expo-router$"],
        filesAny: ["^app/\\(tabs\\)/_layout\\.tsx$"],
      },
    });
    const generic = await note("mobile-craft", {
      description: "Review general mobile interaction craft.",
      intents: ["mobile-craft"],
    });

    const result = await routeInstalledSkills({
      intent: "Add an unread badge to the bottom tab and verify the navigation state",
      notes: [generic, expo],
      capabilities: [],
      platforms: ["react-native"],
      repositoryFingerprint: {
        schemaVersion: 1,
        languages: ["typescript"],
        frameworks: ["expo", "react-native"],
        dependencies: ["expo", "expo-router", "react-native"],
        files: ["app/(tabs)/_layout.tsx", "package.json"],
        imports: ["expo-router"],
        scripts: ["test", "ios"],
      },
      maximumSkills: 1,
    });

    expect(result.selected.map((skill) => skill.id)).toEqual([
      "expo-router-bottom-tabs",
    ]);
    expect(result.repositoryFingerprintHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.selected[0]?.explanation.repositoryEvidence).toEqual([
      "dependency:expo-router",
      "file:app/(tabs)/_layout.tsx",
    ]);
  });

  it("rejects an otherwise relevant route when its repository eligibility does not match", async () => {
    const expo = await note("expo-router-bottom-tabs", {
      description: "Implement Expo Router bottom tabs and badges.",
      intents: ["expo-router-bottom-tabs", "bottom-tab-badge"],
      repository: {
        dependenciesAny: ["^expo-router$"],
      },
    });

    const result = await routeInstalledSkills({
      intent: "Add a bottom tab badge",
      notes: [expo],
      capabilities: [],
      repositoryFingerprint: {
        schemaVersion: 1,
        languages: ["swift"],
        frameworks: ["swiftui"],
        dependencies: [],
        files: ["NateTheBait/App.swift"],
        imports: ["SwiftUI"],
        scripts: [],
      },
    });

    expect(result.decision).toBe("abstain");
    expect(result.excluded).toContainEqual({
      id: "expo-router-bottom-tabs",
      reason: "repository-mismatch:dependenciesAny",
    });
  });

  it("compiles bounded routing regexes and rejects catastrophic or stateful patterns", () => {
    expect(compileSafeRoutingPattern("^expo-router$").test("expo-router")).toBe(true);
    expect(() => compileSafeRoutingPattern("(a+)+$")).toThrow(/unsafe routing pattern/);
    expect(() => compileSafeRoutingPattern("^(a|aa)+$")).toThrow(/unsafe routing pattern/);
    expect(() => compileSafeRoutingPattern("(foo)\\1")).toThrow(/unsafe routing pattern/);
    expect(() => compileSafeRoutingPattern("expo", "g")).toThrow(/unsupported routing flags/);
  });

  it("does not route on one-character or generic procedural token noise", async () => {
    const result = await routeInstalledSkills({
      intent: "Apply the current production fix after tests",
      notes: [await note("shader-design-engineering", {
        description: "Build stable shader effects and production rendering.",
        intents: ["shader-design-engineering"],
      })],
      capabilities: [],
    });

    expect(result.decision).toBe("abstain");
    expect(result.candidates).toEqual([]);
  });

  it("honors an eligible exclusive route instead of stacking broader platform guidance", async () => {
    const expo = await note("expo-router-navigation", {
      description: "Implement Expo Router bottom tabs, badges, and accessible tab state.",
      intents: ["expo-bottom-tab-badge"],
      priority: 20,
      stackPolicy: "exclusive",
      repository: { dependenciesAny: ["^expo-router$"] },
    });
    const accessibility = await note("react-native-accessibility", {
      description: "Implement React Native screen-reader semantics and accessible state.",
      intents: ["react-native-accessibility", "native-screen-reader-flow"],
      repository: { dependenciesAny: ["^(?:react-native|expo)$"] },
    });

    const result = await routeInstalledSkills({
      intent: "Implement an accessible Expo bottom-tab unread badge with a screen-reader label",
      notes: [accessibility, expo],
      capabilities: [],
      repositoryFingerprint: {
        schemaVersion: 1,
        languages: ["typescript"],
        frameworks: ["expo", "expo-router", "react-native"],
        dependencies: ["expo", "expo-router", "react-native"],
        files: ["app/(tabs)/_layout.tsx"],
        imports: ["expo-router"],
        scripts: ["test"],
      },
      maximumSkills: 2,
    });

    expect(result.decision).toBe("single");
    expect(result.selected.map((skill) => skill.id)).toEqual([
      "expo-router-navigation",
    ]);
    expect(result.excluded).toContainEqual({
      id: "react-native-accessibility",
      reason: "exclusive-selection:expo-router-navigation",
    });
  });
});

async function note(
  name: string,
  options: {
    description: string;
    intents: string[];
    capabilities?: string[];
    body?: string;
    actions?: string[];
    platforms?: string[];
    repository?: {
      dependenciesAny?: string[];
      filesAny?: string[];
      importsAny?: string[];
      scriptsAny?: string[];
      frameworksAny?: string[];
      languagesAny?: string[];
      excludeFilesAny?: string[];
    };
    priority?: number;
    stackPolicy?: "compatible" | "exclusive";
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
          platforms: options.platforms ?? [],
          priority: options.priority ?? 0,
          actions: options.actions ?? [],
          lifecycle: [],
          repository: options.repository,
          stackPolicy: options.stackPolicy,
        },
      },
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
  };
}
