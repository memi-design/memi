/**
 * Agent Orchestrator — Claude-powered design intelligence system.
 *
 * Decomposes high-level design intents into structured sub-agent tasks,
 * each with rich prompts that maximize Claude's design reasoning.
 *
 * Architecture:
 *   User Intent (natural language)
 *     → Intent Classifier (categorize the request)
 *     → Plan Builder (decompose into sub-tasks)
 *     → Sub-Agent Router (dispatch to specialized handlers)
 *     → Figma Executor (push changes via bridge)
 *     → Result Aggregator (combine and report)
 *
 * This coordinator delegates to three focused modules:
 *   - intent-classifier.ts — classifyIntent(), IntentCategory, INTENT_PATTERNS
 *   - plan-builder.ts      — PlanBuilder class with all decompose*() methods
 *   - sub-agents.ts        — SubAgentRunner class with all execute*() heuristics
 */

import { createLogger } from "../engine/logger.js";
import type { MemoireEngine } from "../engine/core.js";
import type { AgentBoxState } from "../plugin/shared/contracts.js";
import { AGENT_PROMPTS } from "./prompts.js";
import { getAI } from "../ai/index.js";
import {
  resolveRoutedSkills,
  buildRepositoryFingerprint,
  wrapWithNotes,
  type ResolvedSkill,
  type SkillRouteResult,
} from "../notes/index.js";
import { formatAgentBoxLines, formatAgentBoxName, getAgentBoxKey, sortAgentBoxUpdates, type AgentBoxUpdate, type AgentBoxVisualStatus } from "./agent-box.js";

// ── Re-export types & functions from extracted modules ───
export { classifyIntent, INTENT_PATTERNS } from "./intent-classifier.js";
export type { IntentCategory } from "./intent-classifier.js";
export type { AgentPlan, SubTask, SubAgentType, AgentContext } from "./plan-builder.js";
export type { AgentExecutionResult, DesignMutation } from "./sub-agents.js";

// ── Internal imports from extracted modules ─────────────
import { classifyIntent } from "./intent-classifier.js";
import type { IntentCategory } from "./intent-classifier.js";
import { PlanBuilder } from "./plan-builder.js";
import type { AgentPlan, SubTask, AgentContext } from "./plan-builder.js";
import { SubAgentRunner } from "./sub-agents.js";
import type { DesignMutation } from "./sub-agents.js";
import type { FrontendTaskContractV1 } from "../frontend/task-contract.js";
import type { ContextCapsuleV1 } from "../frontend/context-capsule.js";
import {
  buildExecutionContextCapsule,
  formatExecutionContextCapsule,
} from "./execution-context-capsule.js";

const log = createLogger("agent-orchestrator");

// ── Orchestrator ─────────────────────────────────────────

export class AgentOrchestrator {
  private engine: MemoireEngine;
  private planCounter = 0;
  private planBuilder: PlanBuilder;
  private subAgentRunner: SubAgentRunner;
  private onUpdate?: (plan: AgentPlan) => void;

  constructor(engine: MemoireEngine, onUpdate?: (plan: AgentPlan) => void) {
    this.engine = engine;
    this.onUpdate = onUpdate;
    this.planBuilder = new PlanBuilder(AGENT_PROMPTS);
    this.subAgentRunner = new SubAgentRunner(engine);
  }

  /**
   * Main entry point — take a natural language intent, classify it,
   * build a plan of sub-agent tasks, and execute them.
   */
  async executeBatch(intents: string[], options: { dryRun?: boolean } = {}): Promise<import("./sub-agents.js").AgentExecutionResult[]> {
    const results: import("./sub-agents.js").AgentExecutionResult[] = [];
    // Build context once, reuse across all intents
    const ctx = await this.buildContext();
    for (const intent of intents) {
      const result = await this.execute(intent, { ...options, context: ctx });
      results.push(result);
    }
    return results;
  }

  async execute(intent: string, options?: {
    autoSync?: boolean;
    dryRun?: boolean;
    context?: AgentContext;
    taskClass?: string;
    platforms?: readonly string[];
    routingPolicy?: "repository-only" | "v3";
    taskContract?: FrontendTaskContractV1;
    budgetProfile?: "strict" | "balanced" | "deep";
  }): Promise<import("./sub-agents.js").AgentExecutionResult> {
    const category = classifyIntent(intent);
    log.info({ intent, category }, "Classified design intent");

    const context = options?.context ?? await this.buildContext();
    const repositoryFingerprint = this.engine.notes.loaded
      ? await buildRepositoryFingerprint(this.engine.config.projectRoot)
      : undefined;
    const routed = this.engine.notes.loaded && options?.routingPolicy !== "repository-only"
      ? await resolveRoutedSkills({
        intent,
        taskClass: options?.taskClass ?? category,
        notes: this.engine.notes.notes,
        capabilities: context.figmaConnected ? ["figma"] : [],
        platforms: options?.platforms
          ?? (context.projectFramework ? [context.projectFramework] : []),
        repositoryFingerprint,
        maximumSkills: 1,
        maximumContextBytes: 8_000,
      })
      : null;
    const resolvedNotes = routed?.skills ?? [];
    const contextCapsule = options?.taskContract
      ? await buildExecutionContextCapsule({
        projectRoot: this.engine.config.projectRoot,
        contract: options.taskContract,
        budgetProfile: options.budgetProfile ?? "balanced",
        routingPolicy: options.routingPolicy ?? "v3",
        route: routed?.route ?? null,
      })
      : undefined;
    if (resolvedNotes.length > 0) {
      log.info({
        route: routed?.route,
        notes: resolvedNotes.map((note) => note.noteId),
        category,
      }, "Notes deterministically routed for intent");
    }

    const plan = this.buildPlan(
      intent,
      category,
      context,
      resolvedNotes,
      routed?.route,
      contextCapsule,
    );

    log.info({ planId: plan.id, tasks: plan.subTasks.length }, "Execution plan ready");
    this.onUpdate?.(plan);

    if (options?.dryRun) {
      return {
        planId: plan.id,
        status: "completed",
        completedTasks: 0,
        totalTasks: plan.subTasks.length,
        mutations: [],
        figmaSynced: false,
      };
    }

    return this.executePlan(plan, options);
  }

  private async buildContext(): Promise<AgentContext> {
    const ds = this.engine.registry.designSystem;
    const specs = await this.engine.registry.getAllSpecs();
    return {
      designSystem: ds,
      specs,
      figmaConnected: this.engine.figma.isConnected,
      projectFramework: this.engine.project?.framework,
    };
  }

  // ── Plan Building ──────────────────────────────────────

  buildPlan(
    intent: string,
    category: IntentCategory,
    context: AgentContext,
    resolvedNotes: readonly ResolvedSkill[] = [],
    skillRoute?: SkillRouteResult,
    contextCapsule?: ContextCapsuleV1,
  ): AgentPlan {
    const planId = `plan-${++this.planCounter}-${Date.now()}`;

    const subTasks = this.planBuilder.decompose(intent, category, context);

    // Inject resolved Note skills into the first task's prompt
    if (contextCapsule && subTasks.length > 0) {
      subTasks[0].prompt = `${formatExecutionContextCapsule(contextCapsule)}\n\n---\n\n${subTasks[0].prompt}`;
    } else if (resolvedNotes.length > 0 && subTasks.length > 0) {
      subTasks[0].prompt = wrapWithNotes(subTasks[0].prompt, resolvedNotes);
    }

    return {
      id: planId,
      intent,
      category,
      subTasks,
      context,
      skillRoute,
      contextCapsule,
      createdAt: new Date().toISOString(),
    };
  }

  // ── Plan Execution Engine ──────────────────────────────

  private async executePlan(plan: AgentPlan, options?: { autoSync?: boolean }): Promise<import("./sub-agents.js").AgentExecutionResult> {
    const mutations: DesignMutation[] = [];
    let completedTasks = 0;
    const completed = new Set<string>();
    const totalTasks = plan.subTasks.length;

    await Promise.all(
      sortAgentBoxUpdates(
        plan.subTasks.map((task, index) => this.makeAgentBoxUpdate(plan, task, index, "idle")),
      ).map((update) => this.updateAgentBox(update)),
    );

    // Topological execution — respect dependencies
    while (completed.size < plan.subTasks.length) {
      const ready = plan.subTasks.filter(
        (t) => t.status === "pending" && t.dependencies.every((d) => completed.has(d)),
      );

      if (ready.length === 0 && completed.size < plan.subTasks.length) {
        // Deadlock — remaining tasks have unsatisfied dependencies
        const stuck = plan.subTasks.filter((t) => !completed.has(t.id));
        const stuckNames = stuck.map((t) => `${t.name} (deps: ${t.dependencies.join(", ")})`);
        log.error(
          { stuck: stuckNames, completed: Array.from(completed) },
          "Task dependency deadlock — %d tasks blocked, breaking execution",
          stuck.length,
        );
        for (const task of stuck) {
          if (task.status === "pending") {
            task.status = "failed";
            task.error = `Deadlocked: depends on ${task.dependencies.filter((d) => !completed.has(d)).join(", ")}`;
            task.completedAt = new Date().toISOString();
          }
        }
        break;
      }

      // Execute ready tasks in parallel
      await Promise.all(
        ready.map(async (task) => {
          const taskIndex = plan.subTasks.findIndex((candidate) => candidate.id === task.id);
          task.status = "running";
          task.startedAt = new Date().toISOString();
          this.onUpdate?.(plan);

          await this.updateAgentBox(this.makeAgentBoxUpdate(plan, task, taskIndex, "busy"));

          try {
            const result = await this.tryExternalOrInternal(task, plan.context);
            task.status = "completed";
            task.result = result;
            task.completedAt = new Date().toISOString();
            completedTasks++;

            await this.updateAgentBox(
              this.makeAgentBoxUpdate(plan, task, taskIndex, "done", result),
            );

            if (result && typeof result === "object" && "mutations" in result && Array.isArray((result as Record<string, unknown>).mutations)) {
              mutations.push(...(result as { mutations: DesignMutation[] }).mutations);
            }
          } catch (err) {
            task.status = "failed";
            task.error = err instanceof Error ? err.message : String(err);
            task.completedAt = new Date().toISOString();

            log.error(
              {
                taskId: task.id,
                taskName: task.name,
                agentType: task.agentType,
                planId: plan.id,
                error: task.error,
              },
              "Sub-task failed: [%s] %s (agent: %s) — %s",
              task.id,
              task.name,
              task.agentType,
              task.error,
            );

            await this.updateAgentBox(
              this.makeAgentBoxUpdate(plan, task, taskIndex, "error"),
            );
          }

          completed.add(task.id);
          this.onUpdate?.(plan);
        }),
      );
    }

    // Auto-sync to Figma if requested
    let figmaSynced = false;
    if (options?.autoSync && plan.context.figmaConnected && mutations.length > 0) {
      try {
        await this.subAgentRunner.syncMutationsToFigma(mutations);
        figmaSynced = true;
      } catch (err) {
        log.warn({ err }, "Auto-sync to Figma failed");
      }
    }

    return {
      planId: plan.id,
      status: completedTasks === totalTasks ? "completed" : completedTasks > 0 ? "partial" : "failed",
      completedTasks,
      totalTasks,
      mutations,
      figmaSynced,
    };
  }

  // ── Sub-Agent Execution ────────────────────────────────

  private static readonly MAX_RETRIES = 1;
  private static readonly RETRY_BASE_MS = 500;

  /**
   * Try to dispatch a task to an external agent first; fall back to internal execution.
   * External agents are matched by role via the AgentRegistry.
   */
  private async tryExternalOrInternal(task: SubTask, ctx: AgentContext): Promise<unknown> {
    const role = task.agentType as import("../plugin/shared/contracts.js").AgentRole;
    const externalAgent = this.engine.agentRegistry.getAvailableAgent(role);

    if (externalAgent) {
      log.info({ taskId: task.id, agentId: externalAgent.id, role }, "Dispatching to external agent");
      this.engine.agentRegistry.markBusy(externalAgent.id);

      const queueTaskId = this.engine.taskQueue.enqueue({
        role,
        name: task.name,
        intent: task.prompt,
        payload: { task, context: ctx },
        dependencies: [],
        timeoutMs: 120_000,
      });

      // Claim on behalf of the external agent and send assignment
      this.engine.taskQueue.claim(externalAgent.id, role);
      this.engine.taskQueue.markRunning(queueTaskId, externalAgent.id);
      this.engine.agentBridge.sendTaskAssignment(externalAgent.id, queueTaskId, { task, context: ctx });

      try {
        const queueTask = await this.engine.taskQueue.waitForTask(queueTaskId, 120_000);
        if (queueTask.status === "completed") {
          return queueTask.result;
        }
        // External failed — fall through to internal
        log.warn({ taskId: task.id, queueTaskId }, "External agent failed, falling back to internal");
      } catch {
        log.warn({ taskId: task.id }, "External agent timed out, falling back to internal");
      }
    }

    return this.executeWithRetry(task, ctx);
  }

  private async executeWithRetry(task: SubTask, ctx: AgentContext): Promise<unknown> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= AgentOrchestrator.MAX_RETRIES; attempt++) {
      try {
        const ai = getAI();
        return await this.subAgentRunner.executeSubTask(task, ctx, ai);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < AgentOrchestrator.MAX_RETRIES) {
          const delayMs = AgentOrchestrator.RETRY_BASE_MS * Math.pow(2, attempt);
          log.warn(
            { taskId: task.id, attempt: attempt + 1, delayMs, err: lastError.message },
            "Sub-task failed, retrying",
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError ?? new Error("Sub-task failed with no error captured");
  }

  // ── Self-Healing Loop (delegates to SubAgentRunner) ───

  async selfHealingLoop(nodeId: string, intent: string, maxRounds = 3): Promise<{
    healed: boolean;
    rounds: number;
    issues: string[];
  }> {
    return this.subAgentRunner.selfHealingLoop(nodeId, intent, maxRounds);
  }

  // ── Agent Box Widget ──────────────────────────────────
  // Creates/updates a visible status box in Figma for agent transparency

  async createAgentBox(update: AgentBoxUpdate): Promise<string | null> {
    const statusColors = {
      idle:  "{ r: 0.1, g: 0.1, b: 0.18 }",
      busy:  "{ r: 0.96, g: 0.62, b: 0.04 }",
      error: "{ r: 0.94, g: 0.27, b: 0.27 }",
      done:  "{ r: 0.06, g: 0.73, b: 0.51 }",
    };
    const backgroundColors = {
      idle: "{ r: 0.06, g: 0.06, b: 0.12 }",
      busy: "{ r: 0.21, g: 0.14, b: 0.04 }",
      error: "{ r: 0.18, g: 0.05, b: 0.06 }",
      done: "{ r: 0.04, g: 0.2, b: 0.15 }",
    };
    const boxKey = getAgentBoxKey(update);
    const lines = formatAgentBoxLines(update);
    const boxName = formatAgentBoxName(update);

    const code = `
      (async () => {
        const runId = ${JSON.stringify(update.runId)};
        const taskId = ${JSON.stringify(update.taskId)};
        const role = ${JSON.stringify(update.role)};
        const task = ${JSON.stringify(update.title)};
        const status = ${JSON.stringify(update.status)};
        const taskIndex = ${update.taskIndex};
        const boxKey = ${JSON.stringify(boxKey)};
        const borderColor = ${statusColors[update.status]};
        const backgroundColor = ${backgroundColors[update.status]};
        const boxName = ${JSON.stringify(boxName)};
        const titleTextValue = ${JSON.stringify(lines.title)};
        const metaTextValue = ${JSON.stringify(lines.meta)};
        const detailTextValue = ${JSON.stringify(lines.detail)};

        // Find or create "Active Agents" section
        let section = figma.currentPage.findOne(
          n => n.type === 'SECTION' && n.name === 'Active Agents'
        );
        if (!section) {
          section = figma.createSection();
          section.name = 'Active Agents';
          section.x = -400;
          section.y = 0;
        }

        let runFrame = section.findOne(
          n => n.type === 'FRAME' && n.getPluginData && n.getPluginData('memoire-run-id') === runId
        );
        if (!runFrame || runFrame.type !== 'FRAME') {
          runFrame = figma.createFrame();
          runFrame.name = 'Run ' + runId;
          runFrame.setPluginData('memoire-run-id', runId);
          runFrame.layoutMode = 'VERTICAL';
          runFrame.primaryAxisSizingMode = 'AUTO';
          runFrame.counterAxisSizingMode = 'FIXED';
          runFrame.resize(320, 1);
          runFrame.paddingLeft = runFrame.paddingRight = 12;
          runFrame.paddingTop = runFrame.paddingBottom = 12;
          runFrame.itemSpacing = 8;
          runFrame.cornerRadius = 10;
          runFrame.fills = [{ type: 'SOLID', color: { r: 0.96, g: 0.95, b: 0.92 }, opacity: 0.55 }];
          runFrame.strokes = [{ type: 'SOLID', color: { r: 0.78, g: 0.74, b: 0.69 }, opacity: 0.35 }];
          runFrame.x = 24;
          runFrame.y = 24 + section.findAll(n => n.type === 'FRAME').length * 220;
          section.appendChild(runFrame);
        }

        // Find existing box for this run/task identity or create new one
        let box = runFrame.findOne(
          n => n.type === 'FRAME' && n.getPluginData && n.getPluginData('memoire-box-key') === boxKey
        );

        if (!box || box.type !== 'FRAME') {
          box = figma.createFrame();
          box.setPluginData('memoire-box-key', boxKey);
          box.setPluginData('memoire-task-id', taskId);
          box.setPluginData('memoire-task-index', String(taskIndex));
          runFrame.appendChild(box);
        }

        box.name = boxName;
        box.layoutMode = 'VERTICAL';
        box.primaryAxisSizingMode = 'AUTO';
        box.counterAxisSizingMode = 'FIXED';
        box.resize(296, 1);
        box.paddingLeft = box.paddingRight = 12;
        box.paddingTop = box.paddingBottom = 10;
        box.itemSpacing = 4;
        box.cornerRadius = 8;
        box.fills = [{ type: 'SOLID', color: backgroundColor, opacity: status === 'done' ? 0.72 : 0.95 }];
        box.strokes = [{ type: 'SOLID', color: borderColor }];
        box.strokeWeight = 1.5;

        // Find or create status text
        await figma.loadFontAsync({ family: "Inter", style: "Medium" });
        const ensureText = (name) => {
          let textNode = box.findOne(n => n.name === name);
          if (!textNode || textNode.type !== 'TEXT') {
            textNode = figma.createText();
            textNode.name = name;
            box.appendChild(textNode);
          }
          return textNode;
        };

        const titleText = ensureText('agent-title');
        titleText.fontName = { family: 'Inter', style: 'Medium' };
        titleText.fontSize = 11;
        titleText.fills = [{ type: 'SOLID', color: { r: 0.94, g: 0.94, b: 0.94 } }];
        titleText.characters = titleTextValue;

        const metaText = ensureText('agent-meta');
        metaText.fontName = { family: 'Inter', style: 'Medium' };
        metaText.fontSize = 10;
        metaText.fills = [{ type: 'SOLID', color: { r: 0.72, g: 0.72, b: 0.76 } }];
        metaText.characters = metaTextValue;

        const detailText = ensureText('agent-detail');
        detailText.fontName = { family: 'Inter', style: 'Medium' };
        detailText.fontSize = 10;
        detailText.fills = [{ type: 'SOLID', color: { r: 0.82, g: 0.82, b: 0.86 } }];
        detailText.characters = detailTextValue;

        if (status === 'done') {
          detailText.opacity = 0.72;
        }

        return { boxId: box.id, status };
      })()
    `;

    try {
      const result = await this.engine.figma.execute(code);
      const data = typeof result === "string" ? JSON.parse(result) : result;
      return data?.boxId || null;
    } catch (err) {
      log.warn({ err, update }, "Failed to create agent box widget");
      return null;
    }
  }

  async updateAgentBox(update: AgentBoxUpdate): Promise<void> {
    this.publishAgentStatus(update);
    if (!this.engine.figma.isConnected) {
      return;
    }
    try {
      await this.createAgentBox(update);
    } catch (err) {
      log.warn({ err, update: update.taskId }, "Failed to update agent box on canvas");
    }
  }

  private makeAgentBoxUpdate(
    plan: AgentPlan,
    task: SubTask,
    taskIndex: number,
    status: AgentBoxVisualStatus,
    result?: unknown,
  ): AgentBoxUpdate {
    const startedAt = task.startedAt ? new Date(task.startedAt).getTime() : Date.now();
    const completedAt = task.completedAt ? new Date(task.completedAt).getTime() : Date.now();
    const elapsedMs = Math.max(0, (status === "busy" ? Date.now() : completedAt) - startedAt);
    const healRound = typeof result === "object" && result && "rounds" in (result as Record<string, unknown>)
      ? Number((result as Record<string, unknown>).rounds)
      : undefined;

    return {
      runId: plan.id,
      taskId: task.id,
      role: task.agentType,
      title: task.name,
      status,
      taskIndex,
      totalTasks: plan.subTasks.length,
      dependencyCount: task.dependencies.length,
      summary: this.summarizeTaskResult(result),
      error: status === "error" ? task.error : undefined,
      healRound,
      elapsedMs,
    };
  }

  private summarizeTaskResult(result: unknown): string | undefined {
    if (!result || typeof result !== "object") {
      return undefined;
    }
    const record = result as Record<string, unknown>;
    if (typeof record.action === "string") {
      return record.action;
    }
    if (Array.isArray(record.generated) && record.generated.length > 0) {
      return `${record.generated.length} file(s) generated`;
    }
    if (typeof record.issueCount === "number") {
      return `${record.issueCount} issue(s) checked`;
    }
    if (typeof record.tokens === "number") {
      return `${record.tokens} token(s) synced`;
    }
    if (Array.isArray(record.targetSpecs) && record.targetSpecs.length > 0) {
      return record.targetSpecs.join(", ");
    }
    if (typeof record.status === "string") {
      return record.status;
    }
    return undefined;
  }

  private publishAgentStatus(update: AgentBoxUpdate): void {
    this.engine.figma.publishAgentStatus(this.toAgentStatus(update));
  }

  private toAgentStatus(update: AgentBoxUpdate): AgentBoxState {
    return {
      runId: update.runId,
      taskId: update.taskId,
      role: update.role,
      title: update.title,
      status: update.status,
      summary: update.summary,
      error: update.error,
      healRound: update.healRound,
      elapsedMs: update.elapsedMs,
    };
  }
}
