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
  };
  plan: ComposePlanPayload;
  execution: ComposeExecutionPayload;
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
    .option("--json", "Output compose execution as JSON")
    .action(async (intentParts: string[], opts: { dryRun?: boolean; verbose?: boolean; figma?: boolean; json?: boolean }) => {
      const intent = intentParts.join(" ");
      const startedAt = Date.now();
      const autoSync = opts.figma !== false;
      let capturedPlan: ComposePlanPayload | null = null;

      try {
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
        });

        const elapsedMs = Date.now() - startedAt;
        const tracker = getTracker();
        const payload = buildComposePayload({
          intent,
          category,
          options: {
            dryRun: Boolean(opts.dryRun),
            autoSync,
            verbose: Boolean(opts.verbose),
          },
          plan: capturedPlan ?? emptyPlanPayload(intent, category),
          result,
          elapsedMs,
          tracker,
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
            },
          }, null, 2));
          process.exitCode = 1;
          return;
        }

        throw err;
      }
    });
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
