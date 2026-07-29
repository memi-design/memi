import { createHash } from "node:crypto";
import { z } from "zod";
import { benchmarkConditionSchema, type BenchmarkCondition } from "./contracts.js";

const verificationKindSchema = z.enum([
  "build",
  "unit",
  "integration",
  "rendered-flow",
  "ios-simulator",
  "accessibility",
]);

const workflowProcessSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  timeoutMs: z.number().int().min(30_000).max(30 * 60_000),
}).strict();

const workflowFixtureSchema = z.object({
  path: z.string().min(1).refine(isSafeRelativePath, {
    message: "fixture path must remain inside the disposable checkout",
  }),
  content: z.string().max(1_000_000),
  executable: z.boolean().default(false),
}).strict();

export const workflowVerificationSchema = z.object({
  kind: verificationKindSchema,
  ...workflowProcessSchema.shape,
}).strict();

export const workflowTaskSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  intent: z.string().min(20),
  maximumDurationMs: z.number().int().min(2 * 60_000).max(60 * 60_000),
  steps: z.array(z.string().min(3)).min(5),
  preparation: z.array(workflowProcessSchema).max(10).default([]),
  fixtures: z.array(workflowFixtureSchema).max(50).default([]),
  verification: z.array(workflowVerificationSchema).min(2).superRefine((entries, context) => {
    if (!entries.some((entry) => entry.kind === "build")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "workflow requires build verification",
      });
    }
    if (!entries.some((entry) =>
      entry.kind === "rendered-flow" || entry.kind === "ios-simulator")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "workflow requires rendered-flow or ios-simulator verification",
      });
    }
  }),
  requiredArtifacts: z.array(z.string().min(1)).min(3),
}).strict();

export type WorkflowTask = z.infer<typeof workflowTaskSchema>;
export type WorkflowProvider = "codex" | "claude";

export interface WorkflowTrial {
  readonly id: string;
  readonly suiteId: string;
  readonly experimentId: string;
  readonly taskId: string;
  readonly provider: WorkflowProvider;
  readonly repeat: number;
  readonly condition: BenchmarkCondition;
  readonly sequence: number;
}

export interface WorkflowBenchmarkPlan {
  readonly schemaVersion: 1;
  readonly suiteId: string;
  readonly experimentId: string;
  readonly task: WorkflowTask;
  readonly repeats: number;
  readonly seed: number;
  readonly providers: readonly WorkflowProvider[];
  readonly trials: readonly WorkflowTrial[];
  readonly planHash: string;
}

export function createWorkflowBenchmarkPlan(input: {
  readonly suiteId: string;
  readonly experimentId: string;
  readonly task: WorkflowTask;
  readonly repeats: number;
  readonly seed: number;
  readonly providers: readonly WorkflowProvider[];
}): Readonly<WorkflowBenchmarkPlan> {
  const task = workflowTaskSchema.parse(input.task);
  if (!Number.isInteger(input.repeats) || input.repeats <= 0 || input.repeats > 20) {
    throw new Error("repeats must be an integer from 1 to 20");
  }
  if (input.providers.length === 0 || new Set(input.providers).size !== input.providers.length) {
    throw new Error("providers must be non-empty and unique");
  }
  const trials: WorkflowTrial[] = [];
  let sequence = 0;
  input.providers.forEach((provider, providerIndex) => {
    for (let repeat = 1; repeat <= input.repeats; repeat += 1) {
      const baselineFirst = (input.seed + providerIndex + repeat) % 2 === 0;
      const conditions: BenchmarkCondition[] = baselineFirst
        ? ["baseline", "memi"]
        : ["memi", "baseline"];
      for (const condition of conditions) {
        trials.push({
          id: `${input.experimentId}-${task.id}-${provider}-${repeat}-${condition}`,
          suiteId: input.suiteId,
          experimentId: input.experimentId,
          taskId: task.id,
          provider,
          repeat,
          condition,
          sequence,
        });
        sequence += 1;
      }
    }
  });
  const planContent = {
    schemaVersion: 1 as const,
    suiteId: input.suiteId,
    experimentId: input.experimentId,
    task,
    repeats: input.repeats,
    seed: input.seed,
    providers: [...input.providers],
    trials,
  };
  return deepFreeze({
    ...planContent,
    planHash: `sha256:${createHash("sha256")
      .update(JSON.stringify(planContent))
      .digest("hex")}`,
  });
}

export function buildWorkflowPrompt(input: {
  readonly task: WorkflowTask;
  readonly condition: BenchmarkCondition;
  readonly routedContext: string;
}): string {
  const task = workflowTaskSchema.parse(input.task);
  const shared = [
    "Work in the disposable benchmark checkout only.",
    "Do not delegate or load personal skills, plugins, memory, or unrelated instructions.",
    "Complete the product task, not only a source review.",
    `Task: ${task.intent}`,
    "Required workflow:",
    ...task.steps.map((step, index) => `${index + 1}. ${step}`),
    "Run every verification command from the task manifest.",
    "Preserve failures and unresolved gaps in the final report.",
  ].join("\n");
  const condition = benchmarkConditionSchema.parse(input.condition);
  const conditionBlock = condition === "baseline"
    ? "Condition: perform normal repository discovery without Memi."
    : `Condition: use this deterministic Memi routing receipt before repository discovery:\n${input.routedContext}`;
  return `${shared}\n\n${conditionBlock}\n`;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function isSafeRelativePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) return false;
  const segments = normalized.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
