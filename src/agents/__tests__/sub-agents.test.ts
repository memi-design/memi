import { describe, expect, it, vi } from "vitest";
import type { MemoireEngine } from "../../engine/core.js";
import type { DesignSystem, DesignToken } from "../../engine/registry.js";
import type { AgentContext, SubTask } from "../plan-builder.js";
import { SubAgentRunner } from "../sub-agents.js";

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
