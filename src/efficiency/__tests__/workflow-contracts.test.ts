import { describe, expect, it } from "vitest";
import {
  buildWorkflowPrompt,
  createWorkflowBenchmarkPlan,
  workflowTaskSchema,
} from "../workflow.js";

describe("multi-minute workflow benchmark contracts", () => {
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
});
