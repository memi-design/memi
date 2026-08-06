import { describe, expect, it, vi } from "vitest";
import type { MemoireEngine } from "../../engine/core.js";
import type { DesignSystem, DesignToken } from "../../engine/registry.js";
import { ComponentSpecSchema, PageSpecSchema } from "../../specs/types.js";
import type { AgentContext, SubTask } from "../plan-builder.js";
import { SubAgentRunner } from "../sub-agents.js";
import { TokenTracker, type AIClient } from "../../ai/index.js";

function makeTask(overrides: Partial<SubTask>): SubTask {
  return {
    id: "task-1",
    name: "Test task",
    agentType: "token-engineer",
    prompt: "Test prompt",
    dependencies: [],
    status: "pending",
    ...overrides,
  };
}

function makeHarness(tokens: DesignToken[] = []) {
  const designSystem: DesignSystem = {
    tokens: [...tokens],
    components: [],
    styles: [],
    lastSync: "never",
  };
  const sync = {
    enableGuard: vi.fn(),
    disableGuard: vi.fn(),
  };
  const registry = {
    designSystem,
    updateToken: vi.fn((name: string, token: DesignToken) => {
      const index = designSystem.tokens.findIndex((entry) => entry.name === name);
      designSystem.tokens = index >= 0
        ? designSystem.tokens.map((entry, current) => current === index ? token : entry)
        : [...designSystem.tokens, token];
    }),
    removeToken: vi.fn(),
    getSpec: vi.fn().mockResolvedValue(null),
    saveSpec: vi.fn().mockResolvedValue(undefined),
  };
  const engine = {
    registry,
    sync,
    figma: {
      isConnected: true,
      execute: vi.fn().mockResolvedValue({ updated: true }),
    },
    pullDesignSystem: vi.fn().mockResolvedValue(undefined),
    generateFromSpec: vi.fn().mockImplementation(async (name: string) => ({
      blocked: false,
      entryFile: `src/generated/${name}.tsx`,
      findings: [],
    })),
    research: {
      load: vi.fn().mockResolvedValue(undefined),
      getStore: vi.fn().mockReturnValue({ findings: [] }),
    },
  } as unknown as MemoireEngine;
  const context: AgentContext = {
    designSystem,
    specs: [],
    figmaConnected: true,
    projectFramework: "React",
  };

  return { context, designSystem, engine, registry, runner: new SubAgentRunner(engine), sync };
}

describe("SubAgentRunner release contracts", () => {
  it("never falls back to a mutating heuristic after contracted cancellation", async () => {
    const { context, registry, runner } = makeHarness();
    const controller = new AbortController();
    const cancellation = new Error("contracted wall-time exhausted");
    const ai = {
      provider: "anthropic",
      capabilities: { text: true, vision: true, streaming: true, json: true, tools: false },
      tracker: new TokenTracker(),
      completeJSON: vi.fn().mockImplementation(async () => {
        controller.abort(cancellation);
        return {
          status: "completed",
          mutations: [{ type: "token-created", target: "primary", detail: "late mutation" }],
        };
      }),
    } as unknown as AIClient;

    await expect(runner.executeSubTask(
      makeTask({ prompt: "Create primary color #ff5470" }),
      context,
      ai,
      { signal: controller.signal },
    )).rejects.toBe(cancellation);
    expect(registry.updateToken).not.toHaveBeenCalled();
  });

  it("reports the actual theme token count after applying defaults", async () => {
    const { context, designSystem, runner } = makeHarness();

    const result = await runner.executeSubTask(
      makeTask({
        agentType: "theme-builder",
        name: "Build theme",
        prompt: "Build a dark theme from #ff5470",
      }),
      context,
    ) as { tokenCount: number };

    expect(result.tokenCount).toBe(designSystem.tokens.length);
  });

  it("always releases the sync guard when an unsafe Figma token is rejected", async () => {
    const { runner, sync } = makeHarness();

    await runner.pushTokenToFigma({
      name: "unsafe;token",
      collection: "colors",
      type: "color",
      values: { default: "#ff5470" },
      cssVariable: "--unsafe-token",
    });

    expect(sync.enableGuard).toHaveBeenCalledOnce();
    expect(sync.disableGuard).toHaveBeenCalledOnce();
  });
});

describe("SubAgentRunner routing", () => {
  it("creates and updates color, spacing, and radius tokens", async () => {
    const { context, designSystem, runner } = makeHarness();

    const color = await runner.executeSubTask(
      makeTask({ prompt: "Create primary color #ff5470" }),
      context,
    ) as { mutations: Array<{ type: string }> };
    const spacing = await runner.executeSubTask(
      makeTask({ prompt: "Create spacing token gutter 24px" }),
      context,
    ) as { mutations: Array<{ target: string }> };
    const radius = await runner.executeSubTask(
      makeTask({ prompt: "Create radius token corner 12px" }),
      context,
    ) as { mutations: Array<{ target: string }> };
    const updated = await runner.executeSubTask(
      makeTask({ prompt: "Update primary color #08090a" }),
      context,
    ) as { mutations: Array<{ type: string }> };

    expect(color.mutations[0]?.type).toBe("token-created");
    expect(spacing.mutations[0]?.target).toBe("gutter");
    expect(radius.mutations[0]?.target).toBe("corner");
    expect(updated.mutations[0]?.type).toBe("token-updated");
    expect(designSystem.tokens.find((token) => token.name === "primary")?.values.Light).toBe("#08090a");
  });

  it.each([
    ["component-architect", "Design component", "Create a notification card component", "NotificationCard"],
    ["layout-designer", "Design layout", "Create an account page", "AccountPage"],
    ["dataviz-specialist", "Design chart", "Create a retention bar chart", "RetentionBarChart"],
  ] as const)("routes %s scaffolding and persists its inferred spec", async (agentType, name, prompt, expectedName) => {
    const { context, registry, runner } = makeHarness();

    const result = await runner.executeSubTask(
      makeTask({ agentType, name, prompt }),
      context,
    ) as { targetSpecs: string[] };

    expect(result.targetSpecs).toEqual([expectedName]);
    expect(registry.saveSpec).toHaveBeenCalledOnce();
    expect(context.specs[0]?.name).toBe(expectedName);
  });

  it("updates an existing component spec without replacing its identity", async () => {
    const { context, registry, runner } = makeHarness();
    const existing = ComponentSpecSchema.parse({
      name: "ActionButton",
      type: "component",
      purpose: "Submit",
      shadcnBase: ["Button"],
    });
    context.specs = [existing];
    registry.getSpec.mockResolvedValue(existing);

    const result = await runner.executeSubTask(
      makeTask({
        agentType: "component-architect",
        name: "Update component",
        prompt: "Update ActionButton",
        targetSpecs: ["ActionButton"],
      }),
      context,
    ) as { mutations: Array<{ type: string }> };

    expect(result.mutations[0]?.type).toBe("spec-updated");
    expect(context.specs).toHaveLength(1);
    expect(context.specs[0]?.name).toBe("ActionButton");
  });

  it("handles every Figma route and rejects disconnected execution", async () => {
    const token: DesignToken = {
      name: "primary",
      collection: "colors",
      type: "color",
      values: { default: "#ff5470" },
      cssVariable: "--primary",
    };
    const harness = makeHarness([token]);

    await expect(harness.runner.executeSubTask(
      makeTask({ agentType: "figma-executor", name: "Pull latest", prompt: "Pull" }),
      harness.context,
    )).resolves.toMatchObject({ action: "pulled" });
    await expect(harness.runner.executeSubTask(
      makeTask({ agentType: "figma-executor", name: "Diff systems", prompt: "Diff" }),
      harness.context,
    )).resolves.toMatchObject({ action: "diffed", tokenDelta: 0 });
    await expect(harness.runner.executeSubTask(
      makeTask({ agentType: "figma-executor", name: "Push system", prompt: "Push" }),
      harness.context,
    )).resolves.toMatchObject({ action: "synced", tokens: 1 });

    (harness.engine.figma as { isConnected: boolean }).isConnected = false;
    await expect(harness.runner.executeSubTask(
      makeTask({ agentType: "figma-executor", name: "Pull latest", prompt: "Pull" }),
      harness.context,
    )).rejects.toThrow("Figma not connected");
  });

  it("generates explicit and contextual specs while isolating blocked and failed outputs", async () => {
    const harness = makeHarness();
    harness.context.specs = [
      ComponentSpecSchema.parse({ name: "Card", type: "component", purpose: "Card", shadcnBase: ["Card"] }),
      PageSpecSchema.parse({ name: "Home", type: "page", purpose: "Home", sections: [] }),
    ];
    const generate = harness.engine.generateFromSpec as ReturnType<typeof vi.fn>;
    generate
      .mockResolvedValueOnce({ blocked: false, entryFile: "src/Card.tsx", findings: [] })
      .mockResolvedValueOnce({ blocked: true, entryFile: "src/Home.tsx", findings: ["gate"] });

    const result = await harness.runner.executeSubTask(
      makeTask({ agentType: "code-generator", name: "Generate all", prompt: "Generate" }),
      harness.context,
    ) as { generated: string[] };
    const skipped = await harness.runner.executeSubTask(
      makeTask({ agentType: "code-generator", name: "Check generation", prompt: "Check" }),
      harness.context,
    );

    expect(result.generated).toEqual(["src/Card.tsx"]);
    expect(skipped).toMatchObject({ status: "skipped", generated: [] });
  });

  it("runs design, accessibility, and responsive analysis routes", async () => {
    const { context, runner } = makeHarness([
      { name: "light", collection: "colors", type: "color", values: { default: "#ffffff" }, cssVariable: "--light" },
      { name: "near-light", collection: "colors", type: "color", values: { default: "#fefefe" }, cssVariable: "--near-light" },
    ]);
    context.specs = [
      ComponentSpecSchema.parse({
        name: "NavigationButton",
        type: "component",
        level: "organism",
        purpose: "",
        props: { label: "string" },
        shadcnBase: [],
        variants: [],
        composesSpecs: ["One", "Two", "Three"],
      }),
      PageSpecSchema.parse({
        name: "Dashboard",
        type: "page",
        purpose: "Dashboard",
        sections: [{ name: "metrics", component: "NavigationButton", layout: "grid-4", repeat: 1, props: {} }],
        responsive: { mobile: "grid-4" },
      }),
    ];

    const audit = await runner.executeSubTask(
      makeTask({ agentType: "design-auditor", name: "Audit", prompt: "Audit" }),
      context,
    ) as { issueCount: number };
    const accessibility = await runner.executeSubTask(
      makeTask({ agentType: "accessibility-checker", name: "Check", prompt: "Check" }),
      context,
    ) as { contrastFailures: number };
    const responsive = await runner.executeSubTask(
      makeTask({ agentType: "responsive-specialist", name: "Check responsive", prompt: "Check" }),
      context,
    ) as { issueCount?: number; issues: string[]; recommendations: string[] };

    expect(audit.issueCount).toBeGreaterThan(0);
    expect(accessibility.contrastFailures).toBeGreaterThan(0);
    expect(responsive.issues.length).toBeGreaterThan(0);
    expect(responsive.recommendations.length).toBeGreaterThan(0);
  });

  it("prefers AI routes, applies deletion mutations, and falls back after AI failure", async () => {
    const harness = makeHarness();
    const ai = {
      completeJSON: vi.fn().mockResolvedValue({
        status: "completed",
        mutations: [{ type: "token-deleted", target: "obsolete", detail: "Remove obsolete token" }],
        analysis: "clean",
      }),
    };

    const result = await harness.runner.executeSubTask(
      makeTask({ agentType: "design-auditor", name: "Audit", prompt: "Audit" }),
      harness.context,
      ai as never,
    ) as { aiPowered: boolean };
    expect(result.aiPowered).toBe(true);
    expect(harness.registry.removeToken).toHaveBeenCalledWith("obsolete");

    ai.completeJSON.mockRejectedValueOnce(new Error("provider unavailable"));
    const fallback = await harness.runner.executeSubTask(
      makeTask({ agentType: "theme-builder", name: "Build theme", prompt: "Build light theme" }),
      harness.context,
      ai as never,
    ) as { aiPowered?: boolean; status: string };
    expect(fallback).toMatchObject({ status: "completed" });
    expect(fallback.aiPowered).toBeUndefined();
  });

  it("syncs only token mutations and covers empty, unsafe, and executable token payloads", async () => {
    const empty: DesignToken = {
      name: "empty",
      collection: "colors",
      type: "color",
      values: {},
      cssVariable: "--empty",
    };
    const safe: DesignToken = {
      name: "space/md",
      collection: "spacing",
      type: "spacing",
      values: { default: 16 },
      cssVariable: "--space-md",
    };
    const harness = makeHarness([empty, safe]);

    await harness.runner.pushTokenToFigma(empty);
    await harness.runner.syncMutationsToFigma([
      { type: "token-created", target: "space/md", detail: "created" },
      { type: "spec-created", target: "Card", detail: "created" },
      { type: "token-updated", target: "missing", detail: "missing" },
    ]);

    expect(harness.engine.figma.execute).toHaveBeenCalledOnce();
    expect(harness.sync.enableGuard).toHaveBeenCalledTimes(2);
    expect(harness.sync.disableGuard).toHaveBeenCalledTimes(2);
  });

  it("self-heals clean, fixable, missing, and failing Figma nodes", async () => {
    const clean = makeHarness();
    clean.engine.figma.execute = vi.fn().mockResolvedValue({ issues: [] });
    await expect(clean.runner.selfHealingLoop("1:1", "clean")).resolves.toEqual({
      healed: true,
      rounds: 1,
      issues: [],
    });

    const fixable = makeHarness();
    fixable.engine.figma.execute = vi.fn()
      .mockResolvedValueOnce({ issues: ["no-auto-layout: Frame"] })
      .mockResolvedValueOnce({ fixed: 1 })
      .mockResolvedValueOnce({ issues: [] });
    await expect(fixable.runner.selfHealingLoop("1:2", "fix")).resolves.toMatchObject({
      healed: true,
      rounds: 2,
      issues: ["Round 1: no-auto-layout: Frame"],
    });

    const missing = makeHarness();
    missing.engine.figma.execute = vi.fn().mockResolvedValue({ error: "Node not found" });
    await expect(missing.runner.selfHealingLoop("1:3", "missing", 2)).resolves.toMatchObject({
      healed: false,
      issues: ["Round 1: Node not found"],
    });

    const failing = makeHarness();
    failing.engine.figma.execute = vi.fn().mockRejectedValue(new Error("bridge down"));
    await expect(failing.runner.selfHealingLoop("1:4", "failure", 1)).resolves.toMatchObject({
      healed: false,
      issues: ["Round 1: execution error — bridge down"],
    });
  });

  it("scaffolds atomic, responsive, and chart variants from intent", () => {
    const { context, runner } = makeHarness();

    expect(runner.scaffoldComponentSpec("ConfirmDialog", "Build a dialog form")).toMatchObject({
      level: "organism",
      shadcnBase: ["Form", "Input", "Label"],
    });
    expect(runner.scaffoldComponentSpec("MetricCard", "Build a metric card")).toMatchObject({
      level: "molecule",
      shadcnBase: ["Card"],
    });
    expect(runner.scaffoldComponentSpec("SubmitButton", "Build a button")).toMatchObject({
      level: "atom",
      shadcnBase: ["Button"],
    });
    expect(runner.scaffoldPageSpec("LoginPage", "Build an auth screen", context).layout).toBe("centered");
    expect(runner.scaffoldPageSpec("LandingPage", "Build a marketing hero", context).layout).toBe("marketing");
    expect(runner.scaffoldDataVizSpec("Revenue", "Build a pie chart").chartType).toBe("donut");
    expect(runner.scaffoldDataVizSpec("Cohorts", "Build a scatter graph").chartType).toBe("scatter");
  });

  it("skips unknown routed agents without mutating state", async () => {
    const { context, runner } = makeHarness();
    const result = await runner.executeSubTask(
      makeTask({ agentType: "unknown" as SubTask["agentType"] }),
      context,
    );

    expect(result).toEqual({ status: "skipped" });
    expect(context.specs).toEqual([]);
  });
});
