/**
 * Compose Command — Natural language design intent → structured execution.
 *
 * This is the autonomous agent entry point. Give it a design intent
 * and it will:
 *   1. Classify the intent (token-update, component-create, page-layout, etc.)
 *   2. Build a plan of sub-agent tasks with dependencies
 *   3. Execute tasks topologically (parallel where possible)
 *   4. Report results with mutations and timing
 *
 * Usage:
 *   memi compose "create a login page with email and password fields"
 *   memi compose "update the color palette to use warmer tones" --dry-run
 *   memi compose "audit the design system for accessibility" --verbose
 */

import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";
import { AgentOrchestrator, classifyIntent } from "../agents/index.js";
import type { AgentPlan, SubTask } from "../agents/index.js";
import { hasAI, getTracker } from "../ai/index.js";
import { ui } from "../tui/format.js";
import { checkCapabilities } from "../engine/capabilities.js";
import { formatElapsed } from "../utils/format.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FrontendTaskContractV1Schema,
  type FrontendTaskContractV1,
} from "../frontend/task-contract.js";
import {
  writeComposeReceiptV3,
  type ComposeReceiptSummary,
} from "./compose-receipt.js";

type BudgetProfile = "strict" | "balanced" | "deep";
type RoutingPolicy = "repository-only" | "v3";

export interface ComposePayload {
  intent: string;
  category: string;
  ai: {
    apiKey: boolean;
    calls: number;
    usage: string | null;
    mode: string;
  };
  options: {
    dryRun: boolean;
    autoSync: boolean;
    verbose: boolean;
    budgetProfile: BudgetProfile;
    routingPolicy: RoutingPolicy;
    taskContract: Pick<FrontendTaskContractV1, "taskId" | "taskClass" | "platform"> | null;
    receiptRoot: boolean;
  };
  plan: ComposePlanPayload;
  execution: ComposeExecutionPayload;
  receipt: ComposeReceiptSummary | null;
}

export interface ComposePlanPayload {
  id: string;
  intent: string;
  category: string;
  createdAt: string;
  totalTasks: number;
  skillRoute: AgentPlan["skillRoute"] | null;
  tasks: ComposeTaskPayload[];
}

export interface ComposeTaskPayload {
  id: string;
  name: string;
  agentType: string;
  dependencies: string[];
  targetSpecs: string[];
  status: SubTask["status"];
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  result: unknown;
}

export interface ComposeExecutionPayload {
  planId: string;
  status: "completed" | "partial" | "failed";
  completedTasks: number;
  totalTasks: number;
  mutationCount: number;
  mutations: {
    type: string;
    target: string;
    detail: string;
    before?: unknown;
    after?: unknown;
  }[];
  figmaSynced: boolean;
  elapsedMs: number;
}

export function registerComposeCommand(program: Command, engine: MemoireEngine) {
  program
    .command("compose <intent...>")
    .description("Execute a natural language design intent via the agent orchestrator")
    .option("--dry-run", "Show the execution plan without running it")
    .option("--verbose", "Show detailed sub-task progress")
    .option("--no-figma", "Skip Figma sync steps")
    .option("--task-contract <path>", "Load a FrontendTaskContractV1 JSON file")
    .option("--budget-profile <profile>", "Execution budget: strict, balanced, or deep", "balanced")
    .option("--routing-policy <policy>", "Routing policy: repository-only or v3", "v3")
    .option("--receipt-root <path>", "Write a WorkflowReceiptV3 under this directory")
    .option("--json", "Output compose execution as JSON")
    .action(async (intentParts: string[], opts: {
      dryRun?: boolean;
      verbose?: boolean;
      figma?: boolean;
      json?: boolean;
      taskContract?: string;
      budgetProfile?: string;
      routingPolicy?: string;
      receiptRoot?: string;
    }) => {
      const intent = intentParts.join(" ");
      const startedAt = Date.now();
      const autoSync = opts.figma !== false;
      let capturedPlan: ComposePlanPayload | null = null;

      try {
        const budgetProfile = parseBudgetProfile(opts.budgetProfile);
        const routingPolicy = parseRoutingPolicy(opts.routingPolicy);
        const taskContract = opts.taskContract
          ? await loadTaskContract(opts.taskContract, intent)
          : null;
        await engine.init();

        // Inform about degraded capabilities (compose works without AI via heuristics)
        const caps = checkCapabilities("compose", {
          figma: engine.figma.isConnected,
          ai: hasAI(),
          specs: (await engine.registry.getAllSpecs()).length > 0,
          generatedCode: false,
          research: false,
          daemon: false,
        });
        if (!opts.json && caps.degraded.length > 0) {
          for (const cap of caps.degraded) {
            if (cap === "ai") console.log(ui.dim("  Note: No API key — agents will use heuristic fallbacks"));
            if (cap === "figma") console.log(ui.dim("  Note: No Figma connection — canvas operations will be skipped"));
          }
        }

        const category = classifyIntent(intent);
        const orchestrator = new AgentOrchestrator(engine, (plan: AgentPlan) => {
          capturedPlan = serializePlan(plan);

          if (opts.json) return;

          // Always print the execution plan before running (or for dry-run)
          console.log(`\n  Plan (${plan.subTasks.length} step${plan.subTasks.length === 1 ? "" : "s"}):`);
          for (let i = 0; i < plan.subTasks.length; i++) {
            const task = plan.subTasks[i];
            console.log(`    ${i + 1}. ${task.name}`);
          }

          if (opts.dryRun) return; // dry-run stops here — no "Executing..." line

          console.log("  Executing...\n");
        });

        const result = await orchestrator.execute(intent, {
          dryRun: opts.dryRun,
          autoSync,
          taskClass: taskContract?.taskClass,
          platforms: taskContract ? [taskContract.platform] : undefined,
          routingPolicy,
        });

        const elapsedMs = Date.now() - startedAt;
        const tracker = getTracker();
        if (opts.receiptRoot && !taskContract) {
          throw new Error("--receipt-root requires --task-contract");
        }
        const planPayload = capturedPlan ?? emptyPlanPayload(intent, category);
        const receipt = opts.receiptRoot && taskContract
          ? await writeComposeReceiptV3({
            projectRoot: engine.config.projectRoot,
            receiptRoot: opts.receiptRoot,
            contract: taskContract,
            budgetProfile,
            routingPolicy,
            plan: planPayload,
            result,
            dryRun: Boolean(opts.dryRun),
            startedAtMs: startedAt,
            completedAtMs: Date.now(),
            tracker,
          })
          : null;
        const payload = buildComposePayload({
          intent,
          category,
          options: {
            dryRun: Boolean(opts.dryRun),
            autoSync,
            verbose: Boolean(opts.verbose),
            budgetProfile,
            routingPolicy,
            taskContract: taskContract ? {
              taskId: taskContract.taskId,
              taskClass: taskContract.taskClass,
              platform: taskContract.platform,
            } : null,
            receiptRoot: Boolean(opts.receiptRoot),
          },
          plan: planPayload,
          result,
          elapsedMs,
          tracker,
          receipt,
        });

        if (opts.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }

        console.log(ui.brand("COMPOSE"));
        console.log(ui.dots("Intent", `"${intent}"`));
        console.log(ui.dots("Category", category));
        console.log(ui.dots("AI", payload.ai.apiKey ? ui.green("enabled") : ui.dim("heuristic")));

        console.log();
        console.log(ui.rule());
        console.log();
        console.log(ui.dots("Status", result.status));
        console.log(ui.dots("Tasks", `${result.completedTasks}/${result.totalTasks}  ${ui.progress(result.completedTasks, result.totalTasks, 12)}`));
        console.log(ui.dots("Mutations", String(result.mutations.length)));
        console.log(ui.dots("Figma synced", result.figmaSynced ? ui.green("yes") : "no"));
        console.log(ui.dots("Time", formatElapsed(elapsedMs)));

        if (result.mutations.length > 0) {
          console.log(ui.section("CHANGES"));
          for (const m of result.mutations) {
            console.log(`  ${mutationIcon(m.type)} ${ui.bold(m.target)}: ${m.detail}`);
          }
        }

        if (payload.ai.calls > 0) {
          console.log();
          console.log(ui.dots("AI Usage", payload.ai.usage ?? "unknown"));
        }
        if (payload.receipt) {
          console.log(ui.dots("Receipt", payload.receipt.file));
        }

        if (opts.dryRun) {
          console.log();
          console.log(ui.pending("Dry run — no changes applied"));
        }

        console.log();
      } catch (err) {
        if (opts.json) {
          const message = err instanceof Error ? err.message : String(err);
          console.log(JSON.stringify({
            intent,
            category: classifyIntent(intent),
            error: {
              message,
            },
            options: {
              dryRun: Boolean(opts.dryRun),
              autoSync,
              verbose: Boolean(opts.verbose),
              budgetProfile: opts.budgetProfile ?? "balanced",
              routingPolicy: opts.routingPolicy ?? "v3",
              taskContract: null,
              receiptRoot: Boolean(opts.receiptRoot),
            },
          }, null, 2));
          process.exitCode = 1;
          return;
        }

        throw err;
      }
    });
}

async function loadTaskContract(
  contractPath: string,
  intent: string,
): Promise<FrontendTaskContractV1> {
  const parsed = FrontendTaskContractV1Schema.parse(
    JSON.parse(await readFile(resolve(contractPath), "utf8")),
  );
  if (parsed.intent !== intent) {
    throw new Error("Task contract intent must exactly match the compose intent");
  }
  return parsed;
}

function parseBudgetProfile(value = "balanced"): BudgetProfile {
  if (value === "strict" || value === "balanced" || value === "deep") return value;
  throw new Error("budget-profile must be strict, balanced, or deep");
}

function parseRoutingPolicy(value = "v3"): RoutingPolicy {
  if (value === "repository-only" || value === "v3") return value;
  throw new Error("routing-policy must be repository-only or v3");
}

function serializePlan(plan: AgentPlan): ComposePlanPayload {
  return {
    id: plan.id,
    intent: plan.intent,
    category: plan.category,
    createdAt: plan.createdAt,
    totalTasks: plan.subTasks.length,
    skillRoute: plan.skillRoute ?? null,
    tasks: plan.subTasks.map(serializeTask),
  };
}

function serializeTask(task: SubTask): ComposeTaskPayload {
  return {
    id: task.id,
    name: task.name,
    agentType: task.agentType,
    dependencies: [...task.dependencies],
    targetSpecs: [...(task.targetSpecs ?? [])],
    status: task.status,
    error: task.error ?? null,
    startedAt: task.startedAt ?? null,
    completedAt: task.completedAt ?? null,
    result: task.result ?? null,
  };
}

function buildComposePayload(input: {
  intent: string;
  category: string;
  options: ComposePayload["options"];
  plan: ComposePlanPayload;
  result: {
    planId: string;
    status: "completed" | "partial" | "failed";
    completedTasks: number;
    totalTasks: number;
    mutations: Array<{
      type: string;
      target: string;
      detail: string;
      before?: unknown;
      after?: unknown;
    }>;
    figmaSynced: boolean;
  };
  elapsedMs: number;
  tracker: ReturnType<typeof getTracker>;
  receipt: ComposeReceiptSummary | null;
}): ComposePayload {
  const tracker = input.tracker;
  return {
    intent: input.intent,
    category: input.category,
    ai: {
      apiKey: hasAI(),
      calls: tracker?.callCount ?? 0,
      usage: tracker?.summary ?? null,
      mode: tracker ? "direct-api" : "agent-cli",
    },
    options: input.options,
    plan: input.plan,
    execution: {
      planId: input.result.planId,
      status: input.result.status,
      completedTasks: input.result.completedTasks,
      totalTasks: input.result.totalTasks,
      mutationCount: input.result.mutations.length,
      mutations: input.result.mutations.map((mutation) => ({
        type: mutation.type,
        target: mutation.target,
        detail: mutation.detail,
        before: mutation.before,
        after: mutation.after,
      })),
      figmaSynced: input.result.figmaSynced,
      elapsedMs: input.elapsedMs,
    },
    receipt: input.receipt,
  };
}

function emptyPlanPayload(intent: string, category: string): ComposePlanPayload {
  return {
    id: "unknown",
    intent,
    category,
    createdAt: new Date().toISOString(),
    totalTasks: 0,
    skillRoute: null,
    tasks: [],
  };
}

function statusIcon(status: SubTask["status"]): string {
  switch (status) {
    case "completed": return "\u2714";
    case "running": return "\u25CB";
    case "failed": return "\u2716";
    default: return "\u00B7";
  }
}

function mutationIcon(type: string): string {
  if (type.includes("created")) return "+";
  if (type.includes("updated")) return "~";
  if (type.includes("deleted")) return "-";
  if (type.includes("pushed")) return "\u2191";
  if (type.includes("generated")) return "\u25A0";
  return "\u00B7";
}
