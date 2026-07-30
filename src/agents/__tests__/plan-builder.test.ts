import { describe, expect, it } from "vitest";
import { ComponentSpecSchema, DataVizSpecSchema, PageSpecSchema } from "../../specs/types.js";
import { AGENT_PROMPTS } from "../prompts.js";
import { PlanBuilder, type AgentContext } from "../plan-builder.js";
import type { IntentCategory } from "../intent-classifier.js";

const context: AgentContext = {
  designSystem: {
    tokens: [
      { name: "color.primary", collection: "semantic", type: "color", values: { default: "#ff5470" }, cssVariable: "--color-primary" },
      { name: "space.md", collection: "semantic", type: "spacing", values: { default: 16 }, cssVariable: "--space-md" },
      { name: "type.body", collection: "semantic", type: "typography", values: { default: 15 }, cssVariable: "--type-body" },
    ],
    components: [],
    styles: [],
    lastSync: "2026-07-29T00:00:00.000Z",
  },
  specs: [
    ComponentSpecSchema.parse({
      name: "ActionButton",
      type: "component",
      purpose: "Submit a form",
      props: { label: "string" },
      shadcnBase: ["Button"],
      codeConnect: { mapped: true, codebasePath: "src/components/ActionButton.tsx" },
    }),
    PageSpecSchema.parse({
      name: "Dashboard",
      type: "page",
      purpose: "Review product health",
      sections: [],
    }),
    DataVizSpecSchema.parse({
      name: "QualityTrend",
      type: "dataviz",
      purpose: "Review quality over time",
      chartType: "line",
      dataShape: { x: "date", y: "score" },
    }),
  ],
  figmaConnected: true,
  projectFramework: "Next.js",
};

const categoryIntents: Array<[IntentCategory, string]> = [
  ["color-palette", "Refresh the ruby color palette"],
  ["spacing-system", "Normalize the spacing system"],
  ["typography-system", "Refine the typography system"],
  ["theme-change", "Create a neutral dark theme"],
  ["token-update", "Update the primary color token"],
  ["component-create", "Create a notification banner component"],
  ["component-modify", "Modify the ActionButton component"],
  ["page-layout", "Create an analytics dashboard page"],
  ["dataviz-create", "Create a retention line chart"],
  ["responsive-layout", "Improve responsive layout behavior"],
  ["figma-sync", "Sync the design system with Figma"],
  ["code-generate", "Generate code from every spec"],
  ["design-audit", "Audit the complete design system"],
  ["accessibility-check", "Check WCAG accessibility"],
  ["design-system-init", "Initialize a product design system"],
  ["design-extract", "Extract the design system from https://example.com/product"],
  ["general", "Improve the current product experience"],
];

describe("PlanBuilder", () => {
  it.each(categoryIntents)("decomposes %s into ordered, traceable tasks", (category, intent) => {
    const builder = new PlanBuilder(AGENT_PROMPTS);
    const tasks = builder.decompose(intent, category, context);

    expect(tasks.length).toBeGreaterThan(0);
    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length);
    expect(tasks.every((task) => task.status === "pending")).toBe(true);
    expect(tasks.every((task) => task.prompt.length > 40)).toBe(true);
    for (const task of tasks) {
      for (const dependency of task.dependencies) {
        expect(tasks.some((candidate) => candidate.id === dependency)).toBe(true);
      }
    }
  });

  it("uses connection-aware branches for Figma operations", () => {
    const connected = new PlanBuilder(AGENT_PROMPTS).decompose(
      "Sync the full design system",
      "figma-sync",
      context,
    );
    const disconnected = new PlanBuilder(AGENT_PROMPTS).decompose(
      "Sync the full design system",
      "figma-sync",
      { ...context, figmaConnected: false },
    );

    expect(connected.map((task) => task.name)).toEqual([
      "Pull latest from Figma",
      "Diff local vs Figma state",
      "Push local changes to Figma",
    ]);
    expect(disconnected).toEqual([
      expect.objectContaining({ name: "Connect to Figma" }),
    ]);
  });

  it("resolves existing and inferred target names without leaking task counters", () => {
    const builder = new PlanBuilder(AGENT_PROMPTS);
    expect(builder.resolveTargetSpecName("Modify ActionButton", "component", context)).toBe("ActionButton");
    expect(builder.resolveTargetSpecName("Create an account settings page", "page", context)).toBe("AccountSettingsPage");
    expect(builder.resolveTargetSpecName("Build a retention chart", "dataviz", context)).toBe("RetentionChart");
    expect(builder.resolveTargetSpecName("Improve this component", "component", context)).toBe("GeneratedComponent");

    builder.setCounter(10);
    expect(builder.getCounter()).toBe(10);
    expect(builder.makeTask("Test", "design-auditor", "Test prompt").id).toBe("task-11");
    builder.resetCounter();
    expect(builder.getCounter()).toBe(0);
  });
});
