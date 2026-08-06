import { describe, expect, it, vi } from "vitest";
import { AgentOrchestrator } from "../orchestrator.js";
import type { AnySpec, ComponentSpec, DesignSystem, PageSpec } from "../../specs/types.js";
import type { AgentPlan } from "../plan-builder.js";
import type { InstalledNote } from "../../notes/types.js";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFrontendTaskContract } from "../../frontend/task-contract.js";

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
          platforms: [],
          priority: 0,
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

  it("routes one skill from the full task and preserves the receipt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-orchestrator-routing-"));
    const notes = await Promise.all([
      makeNote(root, "accessibility-audit", "Audit WCAG and VoiceOver behavior.", [
        "accessibility-audit",
        "wcag-review",
      ]),
      makeNote(root, "better-typography", "Improve responsive typography and type scale.", [
        "typography-system",
        "responsive-typography",
      ]),
      makeNote(root, "docker", "Configure Docker containers and images.", ["docker-environment"]),
    ]);
    const { engine } = makeEngine([], notes);
    let plan: AgentPlan | undefined;
    const orchestrator = new AgentOrchestrator(engine as never, (nextPlan) => {
      plan = nextPlan;
    });

    await orchestrator.execute(
      "Audit the responsive typography for WCAG and VoiceOver issues",
      { dryRun: true },
    );

    expect(plan?.skillRoute?.decision).toBe("single");
    expect(plan?.skillRoute?.selected).toHaveLength(1);
    expect(plan?.subTasks[0].prompt).toContain("accessibility-audit");
    expect(plan?.subTasks[0].prompt).not.toContain("better-typography");
    expect(plan?.subTasks[0].prompt).not.toContain("# docker");
  });

  it("injects the exact bounded context capsule used by a contracted execution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-orchestrator-capsule-"));
    const notes = [await makeNote(
      root,
      "accessibility-audit",
      "Audit WCAG, keyboard focus, and reduced-motion behavior.",
      ["accessibility-audit", "wcag-review"],
    )];
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
