import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWorkflowPrompt,
  createWorkflowBenchmarkPlan,
  workflowTaskSchema,
} from "../workflow.js";

describe("multi-minute workflow benchmark contracts", () => {
  it("freezes all v11 tasks to the same small discovery and execution envelope", async () => {
    const manifestNames = [
      "buzzr-tab-unread-badge.json",
      "nate-options-reduce-motion.json",
      "paraform-command-menu.json",
    ];
    const tasks = await Promise.all(manifestNames.map(async (manifestName) => {
      const taskPath = path.join(
        process.cwd(),
        "docs/case-studies/memi-2.7-workflows",
        manifestName,
      );
      return workflowTaskSchema.parse(JSON.parse(await readFile(taskPath, "utf8")));
    }));

    for (const task of tasks) {
      expect(task.maximumDurationMs).toBe(12 * 60_000);
      expect(task.focusPaths.length).toBeGreaterThan(0);
      expect(task.agentBudget).toEqual({
        maxToolCalls: 16,
        maxToolOutputBytes: 160_000,
        maxInputTokens: 375_000,
        maxOutputTokens: 10_000,
        maxReasoningTokens: 4_000,
      });
    }
  });

  it("terminates the Buzzr Jest verifier after its assertions complete", async () => {
    const taskPath = path.join(
      process.cwd(),
      "docs/case-studies/memi-2.7-workflows/buzzr-tab-unread-badge.json",
    );
    const task = workflowTaskSchema.parse(
      JSON.parse(await readFile(taskPath, "utf8")),
    );
    const renderedFlow = task.verification.find(
      (entry) => entry.kind === "rendered-flow",
    );

    expect(renderedFlow?.args).toContain("--forceExit");
  });

  it("queries decorative Buzzr badges explicitly without changing global test semantics", async () => {
    const taskPath = path.join(
      process.cwd(),
      "docs/case-studies/memi-2.7-workflows/buzzr-tab-unread-badge.json",
    );
    const task = workflowTaskSchema.parse(
      JSON.parse(await readFile(taskPath, "utf8")),
    );
    const fixture = task.fixtures.find((entry) =>
      entry.path.endsWith("memi-custom-tab-bar-unread.test.tsx")
    );

    expect(fixture?.content).toContain(
      "getByTestId('tab-unread-count-chat', { includeHiddenElements: true })",
    );
    expect(fixture?.content).toContain(
      "queryByTestId('tab-unread-count-chat', { includeHiddenElements: true })",
    );
    expect(task.steps.join("\n")).toContain(
      "Do not change global Jest or React Native Testing Library configuration",
    );
  });

  it("allows subpoint XCTest projection tolerance while preserving Nate's 44-point contract", async () => {
    const taskPath = path.join(
      process.cwd(),
      "docs/case-studies/memi-2.7-workflows/nate-options-reduce-motion.json",
    );
    const task = workflowTaskSchema.parse(
      JSON.parse(await readFile(taskPath, "utf8")),
    );
    const fixture = task.fixtures.find((entry) =>
      entry.path.endsWith("MemiReduceMotionStatusUITests.swift")
    );

    expect(task.intent).toContain("44-point minimum target size");
    expect(fixture?.content).toContain(
      "XCTAssertGreaterThanOrEqual(status.frame.height, 43.5)",
    );
    expect(task.steps.join("\n")).toContain(
      "half-point XCTest accessibility-frame projection tolerance",
    );
  });

  it("requires a real build and rendered-flow verification with a multi-minute budget", () => {
    const result = workflowTaskSchema.safeParse({
      schemaVersion: 1,
      id: "frontend-polish",
      intent: "Repair and verify the checkout flow",
      maximumDurationMs: 30_000,
      steps: ["inspect source"],
      verification: [],
    });

    expect(result.success).toBe(false);
  });

  it("accepts a bounded full UX workflow", () => {
    const task = workflowTaskSchema.parse({
      schemaVersion: 1,
      id: "frontend-polish",
      intent: "Repair and verify the checkout flow",
      maximumDurationMs: 20 * 60_000,
      steps: [
        "inspect source and product-system evidence",
        "implement the requested change",
        "build the application",
        "launch the rendered application",
        "complete and verify the user journey",
      ],
      preparation: [{
        command: "npm",
        args: ["ci", "--ignore-scripts"],
        timeoutMs: 10 * 60_000,
      }],
      fixtures: [{
        path: "e2e/memi-contract.spec.ts",
        content: "test('contract', async () => {});\n",
      }],
      verification: [
        {
          kind: "build",
          command: "npm",
          args: ["run", "build"],
          timeoutMs: 5 * 60_000,
        },
        {
          kind: "rendered-flow",
          command: "npx",
          args: ["playwright", "test", "e2e/checkout.spec.ts"],
          timeoutMs: 10 * 60_000,
        },
      ],
      requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
    });

    expect(task.verification.map((entry) => entry.kind)).toEqual([
      "build",
      "rendered-flow",
    ]);
    expect(task.preparation).toHaveLength(1);
    expect(task.fixtures[0].path).toBe("e2e/memi-contract.spec.ts");
  });

  it("rejects fixture paths that escape the disposable checkout", () => {
    const result = workflowTaskSchema.safeParse({
      schemaVersion: 1,
      id: "unsafe-fixture",
      intent: "Repair and verify a rendered product flow end to end",
      maximumDurationMs: 20 * 60_000,
      steps: ["inspect", "implement", "build", "launch", "verify"],
      preparation: [],
      fixtures: [{ path: "../outside.test.ts", content: "unsafe" }],
      verification: [
        { kind: "build", command: "npm", args: ["run", "build"], timeoutMs: 300_000 },
        { kind: "rendered-flow", command: "npm", args: ["run", "test:e2e"], timeoutMs: 600_000 },
      ],
      requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
    });

    expect(result.success).toBe(false);
  });

  it("creates deterministic alternating baseline and Memi trials", () => {
    const task = workflowTaskSchema.parse({
      schemaVersion: 1,
      id: "frontend-polish",
      intent: "Repair and verify the checkout flow",
      maximumDurationMs: 20 * 60_000,
      steps: [
        "inspect source",
        "implement change",
        "build application",
        "launch application",
        "verify user journey",
      ],
      verification: [
        { kind: "build", command: "npm", args: ["run", "build"], timeoutMs: 300_000 },
        { kind: "rendered-flow", command: "npm", args: ["run", "test:e2e"], timeoutMs: 600_000 },
      ],
      requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
    });
    const first = createWorkflowBenchmarkPlan({
      suiteId: "ux-e2e-v1",
      experimentId: "nate-checkout",
      task,
      repeats: 3,
      seed: 27,
      providers: ["codex", "claude"],
    });
    const second = createWorkflowBenchmarkPlan({
      suiteId: "ux-e2e-v1",
      experimentId: "nate-checkout",
      task,
      repeats: 3,
      seed: 27,
      providers: ["codex", "claude"],
    });

    expect(first).toEqual(second);
    expect(first.trials).toHaveLength(12);
    for (const provider of ["codex", "claude"]) {
      for (let repeat = 1; repeat <= 3; repeat += 1) {
        const conditions = first.trials
          .filter((trial) => trial.provider === provider && trial.repeat === repeat)
          .map((trial) => trial.condition)
          .sort();
        expect(conditions).toEqual(["baseline", "memi"]);
      }
    }
  });

  it("keeps provider prompts symmetric except for the routed Memi context", () => {
    const common = {
      task: {
        schemaVersion: 1 as const,
        id: "frontend-polish",
        intent: "Repair and verify the checkout flow",
        maximumDurationMs: 20 * 60_000,
        steps: ["inspect", "implement", "build", "launch", "verify"],
        verification: [
          { kind: "build" as const, command: "npm", args: ["run", "build"], timeoutMs: 300_000 },
          { kind: "rendered-flow" as const, command: "npm", args: ["run", "test:e2e"], timeoutMs: 600_000 },
        ],
        requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
      },
      routedContext: "Use accessibility-audit and better-typography.",
    };
    const baseline = buildWorkflowPrompt({ ...common, condition: "baseline" });
    const memi = buildWorkflowPrompt({ ...common, condition: "memi" });

    expect(baseline).not.toContain(common.routedContext);
    expect(memi).toContain(common.routedContext);
    expect(memi.replace(common.routedContext, "")).toContain(common.task.intent);
  });

  it("gives both conditions the same bounded discovery paths and execution budget", () => {
    const task = workflowTaskSchema.parse({
      schemaVersion: 1,
      id: "focused-workflow",
      intent: "Implement a small verified interface behavior in the existing product.",
      maximumDurationMs: 12 * 60_000,
      focusPaths: ["src/ui/CommandMenu.tsx", "tests/command-menu.spec.ts"],
      agentBudget: {
        maxToolCalls: 12,
        maxInputTokens: 300_000,
        maxOutputTokens: 8_000,
        maxReasoningTokens: 4_000,
      },
      steps: ["inspect", "implement", "build", "launch", "verify"],
      verification: [
        { kind: "build", command: "npm", args: ["run", "build"], timeoutMs: 300_000 },
        { kind: "rendered-flow", command: "npm", args: ["run", "test:e2e"], timeoutMs: 600_000 },
      ],
      requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
    });

    for (const condition of ["baseline", "memi"] as const) {
      const prompt = buildWorkflowPrompt({
        task,
        condition,
        routedContext: "Memi-only bounded routing receipt.",
      });
      expect(prompt).toContain("src/ui/CommandMenu.tsx");
      expect(prompt).toContain("tests/command-menu.spec.ts");
      expect(prompt).toContain("Do not perform a repository-wide search");
      expect(prompt).toContain("at most 12 tool calls");
      expect(prompt).toContain("300000 input tokens");
    }
  });

  it("names immutable acceptance fixtures in every provider prompt", () => {
    const common = {
      task: {
        schemaVersion: 1 as const,
        id: "protected-contract",
        intent: "Implement and verify a rendered product behavior without changing its acceptance contract",
        maximumDurationMs: 20 * 60_000,
        steps: ["inspect", "implement", "build", "launch", "verify"],
        fixtures: [{
          path: "e2e/memi-acceptance.spec.ts",
          content: "test('immutable acceptance', async () => {});\n",
        }],
        verification: [
          { kind: "build" as const, command: "npm", args: ["run", "build"], timeoutMs: 300_000 },
          { kind: "rendered-flow" as const, command: "npm", args: ["run", "test:e2e"], timeoutMs: 600_000 },
        ],
        requiredArtifacts: ["git.patch", "verification.json", "events.jsonl"],
      },
      routedContext: "Use the bounded routed skill.",
    };

    for (const condition of ["baseline", "memi"] as const) {
      const prompt = buildWorkflowPrompt({ ...common, condition });
      expect(prompt).toContain("Harness acceptance fixtures are immutable");
      expect(prompt).toContain("Do not modify, delete, rename, move, replace, or weaken them");
      expect(prompt).toContain("- e2e/memi-acceptance.spec.ts");
    }
  });
});
