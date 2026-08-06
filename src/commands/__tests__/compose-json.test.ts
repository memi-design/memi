import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { MemoireEngine } from "../../engine/core.js";
import { registerComposeCommand } from "../compose.js";
import { captureLogs, lastLog } from "./test-helpers.js";
import { createFrontendTaskContract } from "../../frontend/task-contract.js";

vi.mock("../../ai/index.js", () => ({
  hasAI: () => false,
  getTracker: () => null,
  getAI: () => null,
}));

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("compose --json", () => {
  it("emits a structured dry-run payload with plan tasks", async () => {
    const engine = await createEngine();
    const logs = captureLogs();
    const program = new Command();

    registerComposeCommand(program, engine);
    await program.parseAsync([
      "compose",
      "create",
      "a",
      "login",
      "page",
      "with",
      "email",
      "and",
      "password",
      "fields",
      "--dry-run",
      "--json",
    ], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload.intent).toBe("create a login page with email and password fields");
    expect(payload.category).toBe("page-layout");
    expect(payload.options).toEqual({
      dryRun: true,
      autoSync: true,
      verbose: false,
      budgetProfile: "balanced",
      routingPolicy: "v3",
      taskContract: null,
      receiptRoot: false,
    });
    expect(payload.plan.totalTasks).toBeGreaterThan(0);
    expect(payload.plan.tasks[0]).toMatchObject({
      status: "pending",
      error: null,
      startedAt: null,
      completedAt: null,
      result: null,
    });
    expect(payload.execution).toMatchObject({
      status: "completed",
      completedTasks: 0,
      totalTasks: payload.plan.totalTasks,
      mutationCount: 0,
      figmaSynced: false,
    });
    expect(payload.ai).toEqual({
      apiKey: false,
      calls: 0,
      usage: null,
      mode: "agent-cli",
    });
  });

  it("loads a strict task contract and can fail closed to repository-only routing", async () => {
    const engine = await createEngine();
    const contract = createFrontendTaskContract({
      taskId: "responsive-settings-panel",
      taskClass: "responsive-layout",
      platform: "web",
      intent: "make the settings panel responsive",
      targetFiles: ["src/SettingsPanel.tsx"],
      targetComponents: ["SettingsPanel"],
      requiredStates: ["desktop", "mobile"],
      constraints: ["Preserve behavior"],
      verificationCommands: ["npm test"],
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
    const contractPath = join(engine.config.projectRoot, "task-contract.json");
    await writeFile(contractPath, JSON.stringify(contract));
    const logs = captureLogs();
    const program = new Command();

    registerComposeCommand(program, engine);
    await program.parseAsync([
      "compose",
      "make",
      "the",
      "settings",
      "panel",
      "responsive",
      "--task-contract",
      contractPath,
      "--budget-profile",
      "strict",
      "--routing-policy",
      "repository-only",
      "--dry-run",
      "--json",
    ], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload.options).toMatchObject({
      budgetProfile: "strict",
      routingPolicy: "repository-only",
      taskContract: {
        taskId: "responsive-settings-panel",
        taskClass: "responsive-layout",
        platform: "web",
      },
      receiptRoot: false,
    });
    expect(payload.plan.skillRoute).toBeNull();
  });

  it("reports autoSync false when compose runs with --no-figma", async () => {
    const engine = await createEngine();
    const logs = captureLogs();
    const program = new Command();

    registerComposeCommand(program, engine);
    await program.parseAsync([
      "compose",
      "create",
      "a",
      "login",
      "page",
      "--dry-run",
      "--json",
      "--no-figma",
    ], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload.options.autoSync).toBe(false);
    expect(payload.execution.figmaSynced).toBe(false);
  });

  it("includes final task state and mutation summaries after execution", async () => {
    const engine = await createEngine();
    vi.spyOn(engine, "generateFromSpec").mockResolvedValue(join("generated", "pages", "LoginPage.tsx"));

    const logs = captureLogs();
    const program = new Command();

    registerComposeCommand(program, engine);
    await program.parseAsync([
      "compose",
      "create",
      "a",
      "login",
      "page",
      "with",
      "email",
      "and",
      "password",
      "fields",
      "--json",
    ], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload.execution.status).toBe("completed");
    expect(payload.execution.completedTasks).toBe(payload.plan.totalTasks);
    expect(payload.execution.mutationCount).toBeGreaterThan(0);
    expect(payload.execution.mutations.some((mutation: { type: string; target: string }) =>
      mutation.type === "spec-created" && mutation.target === "LoginPage")).toBe(true);
    expect(payload.plan.tasks.some((task: { completedAt: string | null; result: unknown }) =>
      task.completedAt !== null && task.result !== null)).toBe(true);
  });
});

async function createEngine(): Promise<MemoireEngine> {
  const dir = join(tmpdir(), `memoire-compose-json-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tempDirs.push(dir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "compose-json-test" }, null, 2));

  const engine = new MemoireEngine({ projectRoot: dir });
  await engine.init();
  return engine;
}
