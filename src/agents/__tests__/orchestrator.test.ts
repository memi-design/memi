import { describe, expect, it, vi } from "vitest";
import { AgentOrchestrator } from "../orchestrator.js";
import type { AnySpec, ComponentSpec, DesignSystem, PageSpec } from "../../specs/types.js";
import type { AgentPlan } from "../plan-builder.js";
import type { InstalledNote } from "../../notes/types.js";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFrontendTaskContract } from "../../frontend/task-contract.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ExecutionBudgetExceededError,
  ExecutionBudgetGuard,
} from "../execution-budget.js";

const execFileAsync = promisify(execFile);

function makeComponentSpec(name: string): ComponentSpec {
  const now = new Date().toISOString();
  return {
    name,
    type: "component",
    level: "molecule",
    purpose: `${name} component`,
    researchBacking: [],
    designTokens: { source: "none", mapped: false },
    variants: ["default"],
    props: {},
    shadcnBase: ["Card"],
    composesSpecs: [],
    codeConnect: { props: {}, mapped: false },
    accessibility: { ariaLabel: "optional", keyboardNav: false },
    dataviz: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

function makeEngine(initialSpecs: AnySpec[], notes: InstalledNote[] = []) {
  const specs = [...initialSpecs];
  const generated: string[] = [];
  const saved: AnySpec[] = [];
  const designSystem: DesignSystem = {
    tokens: [],
    components: [],
    styles: [],
    lastSync: new Date().toISOString(),
  };

  const registry = {
    designSystem,
    async getAllSpecs() {
      return [...specs];
    },
    async getSpec(name: string) {
      return specs.find((spec) => spec.name === name) ?? null;
    },
    async saveSpec(spec: AnySpec) {
      const index = specs.findIndex((entry) => entry.name === spec.name);
      if (index >= 0) {
        specs[index] = spec;
      } else {
        specs.push(spec);
      }
      saved.push(spec);
    },
    removeToken() {},
  };

  return {
    engine: {
      config: {
        projectRoot: notes[0] ? path.dirname(notes[0].path) : process.cwd(),
      },
      registry,
      notes: { loaded: notes.length > 0, notes },
      figma: { isConnected: false, publishAgentStatus() {} },
      project: { framework: "vite" },
      agentRegistry: { getAvailableAgent() { return null; } },
      taskQueue: { enqueue() { return ""; }, claim() { return null; }, markRunning() {}, waitForTask() { return Promise.resolve(null); } },
      agentBridge: { sendTaskAssignment() {} },
      sync: { enableGuard() {}, disableGuard() {}, isGuarded: false },
      async generateFromSpec(name: string) {
        generated.push(name);
        return `generated/${name}.tsx`;
      },
    },
    generated,
    saved,
  };
}

async function makeNote(
  root: string,
  name: string,
  description: string,
  intents: string[],
  routing: {
    taskClasses?: string[];
    platforms?: string[];
    actions?: string[];
  } = {},
): Promise<InstalledNote> {
  const notePath = path.join(root, name);
  await mkdir(notePath, { recursive: true });
  await writeFile(path.join(notePath, "SKILL.md"), `# ${name}\n\n${description}`);
  return {
    path: notePath,
    builtIn: false,
    enabled: true,
    manifest: {
      name,
      version: "1.0.0",
      description,
      category: "craft",
      tags: intents,
      sourceUrls: [],
      skills: [{
        file: "SKILL.md",
        name,
        activateOn: intents.join(","),
        freedomLevel: "read-only",
      }],
      dependencies: [],
      memoire: {
        harnessExtensions: [],
        routing: {
          intents,
          excludes: [],
          capabilities: [],
          platforms: routing.platforms ?? [],
          taskClasses: routing.taskClasses ?? [],
          priority: 0,
          actions: routing.actions,
        },
      },
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
  };
}

describe("AgentOrchestrator compose targeting", () => {
  it("never exceeds two implementation attempts", async () => {
    const { engine } = makeEngine([]);
    const orchestrator = new AgentOrchestrator(engine as never);
    const executeSubTask = vi.fn().mockRejectedValue(new Error("provider failure"));
    const internals = orchestrator as unknown as {
      subAgentRunner: { executeSubTask: typeof executeSubTask };
      executeWithRetry(task: unknown, context: unknown): Promise<unknown>;
    };
    const staticInternals = AgentOrchestrator as unknown as { RETRY_BASE_MS: number };
    const originalDelay = staticInternals.RETRY_BASE_MS;
    staticInternals.RETRY_BASE_MS = 0;
    internals.subAgentRunner.executeSubTask = executeSubTask;

    try {
      await expect(internals.executeWithRetry({}, {})).rejects.toThrow("provider failure");
      expect(executeSubTask).toHaveBeenCalledTimes(2);
    } finally {
      staticInternals.RETRY_BASE_MS = originalDelay;
    }
  });

  it("honors a contracted single implementation attempt", async () => {
    const { engine } = makeEngine([]);
    const orchestrator = new AgentOrchestrator(engine as never);
    const executeSubTask = vi.fn().mockRejectedValue(new Error("provider failure"));
    const internals = orchestrator as unknown as {
      subAgentRunner: { executeSubTask: typeof executeSubTask };
      executeWithRetry(task: unknown, context: unknown, budget: ExecutionBudgetGuard): Promise<unknown>;
    };
    internals.subAgentRunner.executeSubTask = executeSubTask;
    const budget = new ExecutionBudgetGuard({
      inputTokens: 10_000,
      outputTokens: 2_000,
      reasoningTokens: 2_000,
      wallTimeMs: 120_000,
      toolCalls: 20,
      implementationAttempts: 1,
    });

    await expect(internals.executeWithRetry({}, {}, budget)).rejects.toThrow("provider failure");
    expect(executeSubTask).toHaveBeenCalledOnce();
    expect(budget.report().implementationAttempts).toBe(1);
  });

  it("stops the contracted plan immediately after budget exhaustion", async () => {
    const { engine } = makeEngine([]);
    const orchestrator = new AgentOrchestrator(engine as never);
    const executeTask = vi.fn().mockRejectedValue(new ExecutionBudgetExceededError(
      "token-budget-exhausted",
      ["output-tokens"],
    ));
    const internals = orchestrator as unknown as {
      tryExternalOrInternal: typeof executeTask;
      executePlanBody(
        plan: AgentPlan,
        options: { budget: ExecutionBudgetGuard },
      ): Promise<unknown>;
    };
    internals.tryExternalOrInternal = executeTask;
    const budget = new ExecutionBudgetGuard({
      inputTokens: 10_000,
      outputTokens: 2_000,
      reasoningTokens: 2_000,
      wallTimeMs: 120_000,
      toolCalls: 20,
      implementationAttempts: 1,
    });
    const context = {
      designSystem: { tokens: [], components: [], styles: [], lastSync: "never" },
      specs: [],
      figmaConnected: false,
    };
    const plan: AgentPlan = {
      id: "budget-stop-plan",
      intent: "Audit then mutate",
      category: "general",
      context,
      createdAt: "2026-08-06T12:00:00.000Z",
      subTasks: [
        {
          id: "task-1",
          name: "Exhaust budget",
          agentType: "design-auditor",
          prompt: "Audit",
          dependencies: [],
          status: "pending",
        },
        {
          id: "task-2",
          name: "Would mutate later",
          agentType: "token-engineer",
          prompt: "Create token primary #000000",
          dependencies: [],
          status: "pending",
        },
      ],
    };

    await expect(internals.executePlanBody(plan, { budget })).rejects.toMatchObject({
      name: "ExecutionBudgetExceededError",
      stopReason: "token-budget-exhausted",
    });
    expect(executeTask).toHaveBeenCalledOnce();
    expect(plan.subTasks[1]?.status).toBe("pending");
  });

  it("marks every external-agent usage dimension unavailable without trusted totals", async () => {
    const { engine } = makeEngine([]);
    engine.agentRegistry = {
      getAvailableAgent() { return { id: "external-1" }; },
      markBusy: vi.fn(),
    } as never;
    engine.taskQueue = {
      enqueue() { return "queue-1"; },
      claim() { return null; },
      markRunning() {},
      async waitForTask() { return { status: "completed", result: { status: "completed" } }; },
    } as never;
    const orchestrator = new AgentOrchestrator(engine as never);
    const internals = orchestrator as unknown as {
      tryExternalOrInternal(task: unknown, context: unknown, budget: ExecutionBudgetGuard): Promise<unknown>;
    };
    const budget = new ExecutionBudgetGuard({
      inputTokens: 10_000,
      outputTokens: 2_000,
      reasoningTokens: 2_000,
      wallTimeMs: 120_000,
      toolCalls: 20,
      implementationAttempts: 2,
    });

    await expect(internals.tryExternalOrInternal({
      id: "task-1",
      name: "External audit",
      agentType: "design-auditor",
      prompt: "Audit",
      dependencies: [],
      status: "pending",
    }, {
      designSystem: { tokens: [], components: [], styles: [], lastSync: "never" },
      specs: [],
      figmaConnected: false,
    }, budget)).resolves.toEqual({ status: "completed" });

    expect(budget.report()).toMatchObject({
      measurement: {
        inputTokens: "unavailable",
        outputTokens: "unavailable",
        reasoningTokens: "unavailable",
        toolCalls: "unavailable",
      },
      limitations: expect.arrayContaining([
        "input-token-usage-unavailable",
        "output-token-usage-unavailable",
        "reasoning-token-usage-unavailable",
        "tool-call-usage-unavailable",
      ]),
    });
  });

  it("does not dispatch mutation-capable external agents in contracted shadow mode", async () => {
    const { engine } = makeEngine([]);
    const enqueue = vi.fn().mockReturnValue("queue-1");
    engine.agentRegistry = {
      getAvailableAgent() { return { id: "external-1" }; },
      markBusy: vi.fn(),
    } as never;
    engine.taskQueue = {
      enqueue,
      claim() { return null; },
      markRunning() {},
      async waitForTask() { return { status: "completed", result: { status: "completed" } }; },
    } as never;
    const orchestrator = new AgentOrchestrator(engine as never);
    const internals = orchestrator as unknown as {
      tryExternalOrInternal(task: unknown, context: unknown, budget: ExecutionBudgetGuard): Promise<unknown>;
    };
    const budget = new ExecutionBudgetGuard({
      inputTokens: 10_000,
      outputTokens: 2_000,
      reasoningTokens: 2_000,
      wallTimeMs: 120_000,
      toolCalls: 20,
      implementationAttempts: 2,
    });

    await expect(internals.tryExternalOrInternal({
      id: "task-1",
      name: "Create component",
      agentType: "component-architect",
      prompt: "Create a card",
      dependencies: [],
      status: "pending",
    }, {
      designSystem: { tokens: [], components: [], styles: [], lastSync: "never" },
      specs: [],
      figmaConnected: false,
    }, budget)).rejects.toThrow("transaction-safe adapter");

    expect(enqueue).not.toHaveBeenCalled();
    expect(budget.report()).toMatchObject({
      implementationAttempts: 1,
      stopReason: "attempt-limit-reached",
      attempts: [{ outcome: "fatal-failure" }],
    });
  });

  it("creates and generates only the requested page spec for page-layout intents", async () => {
    const { engine, generated, saved } = makeEngine([makeComponentSpec("ExistingCard")]);
    const orchestrator = new AgentOrchestrator(engine as never);

    const result = await orchestrator.execute("create a login page with email and password fields");

    expect(result.status).toBe("completed");
    expect(saved).toHaveLength(1);
    expect((saved[0] as PageSpec).name).toBe("LoginPage");
    expect((saved[0] as PageSpec).type).toBe("page");
    expect(generated).toEqual(["LoginPage"]);
  });

  it("still generates all specs for explicit code-generate intents", async () => {
    const { engine, generated } = makeEngine([
      makeComponentSpec("MetricCard"),
      makeComponentSpec("TrendBadge"),
    ]);
    const orchestrator = new AgentOrchestrator(engine as never);

    const result = await orchestrator.execute("generate code for all specs");

    expect(result.status).toBe("completed");
    expect(generated).toEqual(["MetricCard", "TrendBadge"]);
  });

  it("routes one exact skill from a complete uncontracted classification", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-orchestrator-routing-"));
    const notes = await Promise.all([
      makeNote(root, "accessibility-audit", "Audit WCAG and VoiceOver behavior.", [
        "accessibility-audit",
        "wcag-review",
      ], {
        taskClasses: ["accessibility-check"],
        platforms: ["web"],
        actions: ["audit"],
      }),
      makeNote(root, "better-typography", "Improve responsive typography and type scale.", [
        "typography-system",
        "responsive-typography",
      ], {
        taskClasses: ["responsive-layout"],
        platforms: ["web"],
        actions: ["modify"],
      }),
      makeNote(root, "docker", "Configure Docker containers and images.", ["docker-environment"]),
    ]);
    const { engine } = makeEngine([], notes);
    let plan: AgentPlan | undefined;
    const orchestrator = new AgentOrchestrator(engine as never, (nextPlan) => {
      plan = nextPlan;
    });

    await orchestrator.execute(
      "Audit web accessibility and WCAG issues",
      { dryRun: true },
    );

    expect(plan?.skillRoute?.decision).toBe("single");
    expect(plan?.skillRoute?.selected).toHaveLength(1);
    expect(plan?.subTasks[0].prompt).toContain("accessibility-audit");
    expect(plan?.subTasks[0].prompt).not.toContain("better-typography");
    expect(plan?.subTasks[0].prompt).not.toContain("# docker");
  });

  it("routes at most two exact skills for distinct evidence on one task class", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-orchestrator-stack-"));
    const notes = await Promise.all([
      makeNote(root, "accessibility-audit", "Audit WCAG, color contrast, and accessible UI behavior.", [
        "accessibility-audit",
        "color-contrast",
      ], {
        taskClasses: ["keyboard-focus-verification"],
        platforms: ["web"],
        actions: ["audit"],
      }),
      makeNote(root, "keyboard-accessibility", "Verify keyboard navigation and focus order.", [
        "keyboard-navigation",
        "focus-order",
      ], {
        taskClasses: ["keyboard-focus-verification"],
        platforms: ["web"],
        actions: ["audit"],
      }),
    ]);
    const { engine } = makeEngine([], notes);
    let plan: AgentPlan | undefined;
    const orchestrator = new AgentOrchestrator(engine as never, (nextPlan) => {
      plan = nextPlan;
    });

    await orchestrator.execute(
      "Audit web accessibility, color contrast, keyboard navigation, and focus order",
      { dryRun: true, routingPolicy: "v3" },
    );

    expect(plan?.skillRoute?.decision).toBe("stack");
    expect(plan?.skillRoute?.selected.map((skill) => skill.id).sort()).toEqual([
      "accessibility-audit",
      "keyboard-accessibility",
    ]);
    expect(plan?.subTasks[0].prompt).toContain("accessibility-audit");
    expect(plan?.subTasks[0].prompt).toContain("keyboard-accessibility");
  });

  it("fails an ambiguous uncontracted route closed to repository-only discovery", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-orchestrator-abstention-"));
    const notes = [await makeNote(
      root,
      "accessibility-audit",
      "Audit responsive typography, WCAG, and VoiceOver behavior.",
      ["accessibility-audit", "responsive-typography", "wcag-review"],
    )];
    const { engine } = makeEngine([], notes);
    let plan: AgentPlan | undefined;
    const orchestrator = new AgentOrchestrator(engine as never, (nextPlan) => {
      plan = nextPlan;
    });

    await orchestrator.execute(
      "Audit the responsive typography for WCAG and VoiceOver issues",
      { dryRun: true },
    );

    expect(plan?.skillRoute).toBeUndefined();
    expect(plan?.subTasks[0].prompt).not.toContain("# accessibility-audit");
  });

  it("uses classified state evidence to route an uncontracted implementation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-orchestrator-state-route-"));
    const notes = [await makeNote(
      root,
      "adaptive-interface",
      "Implement complete loading, empty, and error interface states.",
      ["adaptive-interface", "interface-states"],
      {
        taskClasses: ["interface-state-implementation"],
        platforms: ["web"],
        actions: ["modify"],
      },
    )];
    const { engine } = makeEngine([], notes);
    let plan: AgentPlan | undefined;
    const orchestrator = new AgentOrchestrator(engine as never, (nextPlan) => {
      plan = nextPlan;
    });

    await orchestrator.execute(
      "Repair the web settings screen loading, empty, and error states",
      { dryRun: true },
    );

    expect(plan?.skillRoute?.decision).toBe("single");
    expect(plan?.skillRoute?.selected[0]?.id).toBe("adaptive-interface");
  });

  it("preserves an exact caller-supplied route when the prompt omits platform evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-orchestrator-explicit-route-"));
    const notes = [await makeNote(
      root,
      "adaptive-interface",
      "Implement responsive layout from exact route evidence.",
      ["adaptive-interface", "responsive-layout"],
      {
        taskClasses: ["responsive-layout"],
        platforms: ["web"],
        actions: ["modify"],
      },
    )];
    const { engine } = makeEngine([], notes);
    let plan: AgentPlan | undefined;
    const orchestrator = new AgentOrchestrator(engine as never, (nextPlan) => {
      plan = nextPlan;
    });

    await orchestrator.execute(
      "Repair responsive breakpoints for checkout",
      {
        dryRun: true,
        taskClass: "responsive-layout",
        platforms: ["web"],
        routingPolicy: "v3",
      },
    );

    expect(plan?.skillRoute?.decision).toBe("single");
    expect(plan?.skillRoute?.selected[0]?.id).toBe("adaptive-interface");
  });

  it("injects the exact bounded context capsule used by a contracted execution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-orchestrator-capsule-"));
    const notes = [await makeNote(
      root,
      "accessibility-audit",
      "Audit WCAG, keyboard focus, and reduced-motion behavior.",
      ["accessibility-audit", "wcag-review"],
    )];
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package-lock.json"), "{\"lockfileVersion\":3}\n");
    await writeFile(
      path.join(root, "src", "SettingsPanel.tsx"),
      "export const SettingsPanel = () => null;\n",
    );
    await execFileAsync("git", ["init", "--quiet"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "Memi Test"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "test@memi.invalid"], { cwd: root });
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
    const { engine } = makeEngine([], notes);
    let plan: AgentPlan | undefined;
    const orchestrator = new AgentOrchestrator(engine as never, (nextPlan) => {
      plan = nextPlan;
    });
    const contract = createFrontendTaskContract({
      taskId: "settings-accessibility",
      taskClass: "accessibility-check",
      platform: "web",
      intent: "Audit the settings panel for accessibility",
      targetFiles: ["src/SettingsPanel.tsx"],
      targetComponents: ["SettingsPanel"],
      requiredStates: ["keyboard", "reduced-motion"],
      constraints: ["Preserve behavior"],
      verificationCommands: ["npm run test:a11y"],
      resourceCeilings: {
        inputTokens: 10_000,
        outputTokens: 2_000,
        reasoningTokens: 2_000,
        wallTimeMs: 120_000,
        toolCalls: 20,
        implementationAttempts: 2,
      },
      contextExpansion: { state: "unused" },
    });

    await orchestrator.execute(contract.intent, {
      dryRun: true,
      taskClass: contract.taskClass,
      platforms: [contract.platform],
      routingPolicy: "v3",
      taskContract: contract,
      budgetProfile: "strict",
    });

    expect(plan?.contextCapsule?.schemaVersion).toBe("context-capsule.v1");
    expect(plan?.contextCapsule?.contentByteLength).toBeLessThanOrEqual(20_480);
    expect(plan?.subTasks[0].prompt).toContain("# Memi bounded execution capsule");
    expect(plan?.subTasks[0].prompt).toContain(plan?.contextCapsule?.identitySha256);
    expect(plan?.subTasks[0].prompt).toContain("src/SettingsPanel.tsx");
    expect(plan?.subTasks[0].prompt).toContain("npm run test:a11y");
  });
});
