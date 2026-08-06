/**
 * Sub-Agent Runner — Heuristic execution engines for each sub-agent type.
 *
 * Extracted from orchestrator.ts for independent testability and reuse.
 * Each execute*() method implements a fallback heuristic when AI is unavailable.
 */

import { createLogger } from "../engine/logger.js";
import type { MemoireEngine } from "../engine/core.js";
import type { DesignToken } from "../engine/registry.js";
import type { AnySpec, ComponentSpec, PageSpec, DataVizSpec } from "../specs/types.js";
import type { SubTask, SubAgentType, AgentContext } from "./plan-builder.js";
import type { AIClient } from "../ai/index.js";
import {
  ExecutionBudgetExceededError,
  type ExecutionBudgetReport,
} from "./execution-budget.js";

const log = createLogger("sub-agent-runner");

// ── Types ────────────────────────────────────────────────

export interface DesignMutation {
  type: "token-created" | "token-updated" | "token-deleted" | "spec-created" | "spec-updated" | "code-generated" | "figma-pushed";
  target: string;
  detail: string;
  before?: unknown;
  after?: unknown;
}

export interface AgentExecutionResult {
  planId: string;
  status: "completed" | "partial" | "failed";
  completedTasks: number;
  totalTasks: number;
  mutations: DesignMutation[];
  figmaSynced: boolean;
  executionBudget?: Readonly<ExecutionBudgetReport>;
}

export interface SubAgentExecutionOptions {
  readonly signal?: AbortSignal;
  readonly maxOutputTokens?: number;
  readonly beforeApplyAIResult?: () => void;
}

// ── Sub-Agent Runner ─────────────────────────────────────

export class SubAgentRunner {
  private engine: MemoireEngine;

  constructor(engine: MemoireEngine) {
    this.engine = engine;
  }

  // ── AI-Powered Sub-Agent Types ──────────────────────────

  static readonly AI_AGENT_TYPES: SubAgentType[] = [
    "token-engineer",
    "design-auditor",
    "accessibility-checker",
    "theme-builder",
    "responsive-specialist",
  ];

  // ── Main Dispatch ──────────────────────────────────────

  async executeSubTask(
    task: SubTask,
    ctx: AgentContext,
    ai?: AIClient | null,
    options: SubAgentExecutionOptions = {},
  ): Promise<unknown> {
    log.info({ taskId: task.id, agent: task.agentType, name: task.name }, "Executing sub-task");
    options.signal?.throwIfAborted();

    // Try AI-powered execution first if available
    if (ai && SubAgentRunner.AI_AGENT_TYPES.includes(task.agentType)) {
      try {
        const aiResult = await this.aiExecuteSubTask(ai, task, ctx, options);
        if (aiResult) return aiResult;
      } catch (err) {
        if (options.signal?.aborted) throw options.signal.reason;
        if (err instanceof ExecutionBudgetExceededError) throw err;
        log.warn({ taskId: task.id, err: err instanceof Error ? err.message : String(err) }, "AI execution failed, falling back to heuristic");
      }
    }

    switch (task.agentType) {
      case "token-engineer":
        return this.executeTokenEngineer(task, ctx);
      case "component-architect":
        return this.executeComponentArchitect(task, ctx);
      case "layout-designer":
        return this.executeLayoutDesigner(task, ctx);
      case "dataviz-specialist":
        return this.executeDatavizSpecialist(task, ctx);
      case "figma-executor":
        return this.executeFigmaAgent(task, ctx);
      case "code-generator":
        return this.executeCodeGenerator(task, ctx);
      case "design-auditor":
        return this.executeDesignAuditor(task, ctx);
      case "accessibility-checker":
        return this.executeAccessibilityChecker(task, ctx);
      case "theme-builder":
        return this.executeThemeBuilder(task, ctx);
      case "responsive-specialist":
        return this.executeResponsiveSpecialist(task, ctx);
      default:
        log.warn({ agentType: task.agentType }, "Unknown sub-agent type");
        return { status: "skipped" };
    }
  }

  // ── Token Engineer Sub-Agent ───────────────────────────

  private async executeTokenEngineer(task: SubTask, ctx: AgentContext): Promise<unknown> {
    const mutations: DesignMutation[] = [];
    const ds = this.engine.registry.designSystem;
    const prompt = task.prompt.toLowerCase();

    // Parse color from prompt (hex, named colors)
    const hexMatch = task.prompt.match(/#[0-9a-fA-F]{3,8}/);
    const color = hexMatch?.[0];

    // Parse token name from prompt
    const nameMatch = task.prompt.match(/(?:token|variable|color)\s+(?:named?\s+)?["']?([a-zA-Z][\w-]*)["']?/i);
    const tokenName = nameMatch?.[1] ?? (prompt.includes("primary") ? "primary" : prompt.includes("accent") ? "accent" : null);

    if (color && tokenName) {
      // Create or update a color token
      const existing = ds.tokens.find((t) => t.name === tokenName);
      const token: import("../engine/registry.js").DesignToken = {
        name: tokenName,
        collection: existing?.collection ?? "colors",
        type: "color",
        values: { ...(existing?.values ?? {}), Light: color },
        cssVariable: existing?.cssVariable ?? `--${tokenName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()}`,
      };
      this.engine.registry.updateToken(tokenName, token);
      mutations.push({ type: existing ? "token-updated" : "token-created", target: tokenName, detail: `Set to ${color}` });
    }

    // Handle spacing/radius from prompt
    const numMatch = task.prompt.match(/(\d+)\s*(?:px)?/);
    if (numMatch && !color) {
      const value = parseInt(numMatch[1], 10);
      const type = prompt.includes("radius") ? "radius" : prompt.includes("shadow") ? "shadow" : "spacing";
      const name = tokenName ?? `${type}-${value}`;
      const token: import("../engine/registry.js").DesignToken = {
        name, collection: type, type,
        values: { default: value },
        cssVariable: `--${name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()}`,
      };
      this.engine.registry.updateToken(name, token);
      mutations.push({ type: "token-created", target: name, detail: `Set to ${value}` });
    }

    log.info({ task: task.name, mutations: mutations.length }, "Token engineer completed");
    return { status: "completed", mutations, tokenCount: ds.tokens.length };
  }

  // ── Component Architect Sub-Agent ──────────────────────

  private async executeComponentArchitect(task: SubTask, ctx: AgentContext): Promise<unknown> {
    if (task.name.includes("Design") || task.name.includes("Update") || task.name.includes("Create")) {
      const specName = task.targetSpecs?.[0] ?? this.resolveTargetSpecName(task.prompt, "component", ctx);
      const existing = await this.engine.registry.getSpec(specName);

      const componentSpec: ComponentSpec = existing?.type === "component"
        ? {
            ...existing,
            updatedAt: new Date().toISOString(),
          }
        : this.scaffoldComponentSpec(specName, task.prompt);

      await this.engine.registry.saveSpec(componentSpec);
      this.upsertContextSpec(ctx, componentSpec);

      const mutationType: DesignMutation["type"] = existing ? "spec-updated" : "spec-created";
      return {
        status: "completed",
        targetSpecs: [componentSpec.name],
        mutations: [{
          type: mutationType,
          target: componentSpec.name,
          detail: `${existing ? "Updated" : "Created"} component spec ${componentSpec.name}`,
          after: componentSpec,
        }],
      };
    }

    return { status: "completed", targetSpecs: task.targetSpecs ?? [] };
  }

  // ── Layout Designer Sub-Agent ──────────────────────────

  private async executeLayoutDesigner(task: SubTask, ctx: AgentContext): Promise<unknown> {
    log.info({ task: task.name }, "Layout designer processing");

    if (task.name.includes("Design")) {
      const specName = task.targetSpecs?.[0] ?? this.resolveTargetSpecName(task.prompt, "page", ctx);
      const existing = await this.engine.registry.getSpec(specName);

      const pageSpec: PageSpec = existing?.type === "page"
        ? {
            ...existing,
            updatedAt: new Date().toISOString(),
          }
        : this.scaffoldPageSpec(specName, task.prompt, ctx);

      await this.engine.registry.saveSpec(pageSpec);
      this.upsertContextSpec(ctx, pageSpec);

      const mutationType: DesignMutation["type"] = existing ? "spec-updated" : "spec-created";
      return {
        status: "completed",
        targetSpecs: [pageSpec.name],
        mutations: [{
          type: mutationType,
          target: pageSpec.name,
          detail: `${existing ? "Updated" : "Created"} page spec ${pageSpec.name}`,
          after: pageSpec,
        }],
      };
    }

    return { status: "completed", targetSpecs: task.targetSpecs ?? [] };
  }

  // ── Dataviz Specialist Sub-Agent ───────────────────────

  private async executeDatavizSpecialist(task: SubTask, ctx: AgentContext): Promise<unknown> {
    log.info({ task: task.name }, "Dataviz specialist processing");

    if (task.name.includes("Design")) {
      const specName = task.targetSpecs?.[0] ?? this.resolveTargetSpecName(task.prompt, "dataviz", ctx);
      const existing = await this.engine.registry.getSpec(specName);

      const datavizSpec: DataVizSpec = existing?.type === "dataviz"
        ? {
            ...existing,
            updatedAt: new Date().toISOString(),
          }
        : this.scaffoldDataVizSpec(specName, task.prompt);

      await this.engine.registry.saveSpec(datavizSpec);
      this.upsertContextSpec(ctx, datavizSpec);

      const mutationType: DesignMutation["type"] = existing ? "spec-updated" : "spec-created";
      return {
        status: "completed",
        targetSpecs: [datavizSpec.name],
        mutations: [{
          type: mutationType,
          target: datavizSpec.name,
          detail: `${existing ? "Updated" : "Created"} dataviz spec ${datavizSpec.name}`,
          after: datavizSpec,
        }],
      };
    }

    return { status: "completed", targetSpecs: task.targetSpecs ?? [] };
  }

  // ── Figma Executor Sub-Agent ───────────────────────────

  private async executeFigmaAgent(task: SubTask, ctx: AgentContext): Promise<unknown> {
    if (!this.engine.figma.isConnected) {
      throw new Error("Figma not connected");
    }

    if (task.name.includes("Pull")) {
      await this.engine.pullDesignSystem();
      return { status: "completed", action: "pulled" };
    }

    if (task.name.includes("Diff")) {
      // Snapshot local state, pull remote, then compare
      const localBefore = this.engine.registry.designSystem;
      const localTokenCount = localBefore.tokens.length;
      const localComponentCount = localBefore.components.length;

      await this.engine.pullDesignSystem();

      const afterPull = this.engine.registry.designSystem;
      return {
        status: "completed",
        action: "diffed",
        localTokensBefore: localTokenCount,
        localComponentsBefore: localComponentCount,
        remoteTokens: afterPull.tokens.length,
        remoteComponents: afterPull.components.length,
        tokenDelta: afterPull.tokens.length - localTokenCount,
        componentDelta: afterPull.components.length - localComponentCount,
      };
    }

    if (task.name.includes("Sync") || task.name.includes("Push")) {
      // Push current design system to Figma
      const ds = this.engine.registry.designSystem;
      for (const token of ds.tokens) {
        try {
          await this.pushTokenToFigma(token);
        } catch (err) {
          log.warn({ token: token.name, err }, "Failed to push token");
        }
      }
      return { status: "completed", action: "synced", tokens: ds.tokens.length };
    }

    return { status: "completed" };
  }

  // ── Code Generator Sub-Agent ───────────────────────────

  private async executeCodeGenerator(task: SubTask, ctx: AgentContext): Promise<unknown> {
    const generated: string[] = [];
    const targetSpecs = task.targetSpecs && task.targetSpecs.length > 0
      ? task.targetSpecs
      : task.name.startsWith("Generate ")
        ? ctx.specs.map((spec) => spec.name)
        : [];

    if (targetSpecs.length === 0) {
      return { status: "skipped", generated, mutations: [] };
    }

    for (const specName of targetSpecs) {
      try {
        const result = await this.engine.generateFromSpec(specName);
        if (result.blocked) {
          log.warn({ spec: specName, findings: result.findings }, "Generation blocked by quality gate");
          continue;
        }
        generated.push(result.entryFile);
      } catch (err) {
        log.warn({ spec: specName, err }, "Failed to generate");
      }
    }

    return {
      status: "completed",
      generated,
      mutations: generated.map((f) => ({
        type: "code-generated" as const,
        target: f,
        detail: `Generated ${f}`,
      })),
    };
  }

  // ── Design Auditor Sub-Agent ───────────────────────────

  private async executeDesignAuditor(task: SubTask, ctx: AgentContext): Promise<unknown> {
    const { runFullAudit, auditTokenContrast, auditTokenCompleteness } = await import("../engine/accessibility.js");
    const { mapResearchToSpecs } = await import("../engine/research-mapper.js");

    const issues: string[] = [];

    // 1. Token type coverage
    const tokenTypes = new Set(ctx.designSystem.tokens.map((t) => t.type));
    const expectedTypes = ["color", "spacing", "typography", "radius", "shadow"];
    for (const type of expectedTypes) {
      if (!tokenTypes.has(type as DesignToken["type"])) {
        issues.push(`Missing token type: ${type}`);
      }
    }

    // 2. WCAG accessibility audit
    const a11yReport = runFullAudit(ctx.designSystem, ctx.specs);
    for (const issue of a11yReport.issues) {
      issues.push(`[${issue.severity.toUpperCase()}] ${issue.rule}: ${issue.message}`);
    }

    // 3. Spec quality checks
    for (const spec of ctx.specs) {
      if (!spec.purpose) issues.push(`Spec "${spec.name}" missing purpose`);
      if (spec.type === "component") {
        const cs = spec as ComponentSpec;
        if (cs.shadcnBase.length === 0) issues.push(`Component "${cs.name}" has no shadcnBase`);
        if (Object.keys(cs.props).length === 0) issues.push(`Component "${cs.name}" has no props`);
        if (cs.variants.length === 0) issues.push(`Component "${cs.name}" has no variants`);
      }
    }

    // 4. Naming consistency
    const names = ctx.specs.map((s) => s.name);
    const hasCamelCase = names.some((n) => /^[a-z]/.test(n));
    const hasPascalCase = names.some((n) => /^[A-Z]/.test(n));
    if (hasCamelCase && hasPascalCase) {
      issues.push("Inconsistent spec naming: mix of camelCase and PascalCase");
    }

    // 5. Text overflow detection via Pretext
    const textOverflows: string[] = [];
    try {
      const { getTextMeasurer } = await import("../engine/text-measurer.js");
      const measurer = getTextMeasurer();
      for (const spec of ctx.specs) {
        if (spec.type !== "component") continue;
        const cs = spec as ComponentSpec;
        // Check string props for potential overflow at common widths
        for (const [propName, propType] of Object.entries(cs.props)) {
          if (propType !== "string" && propType !== "string?") continue;
          // Simulate a typical label (30 chars) at card-width containers
          const sampleText = `Sample ${propName} content for ${cs.name}`;
          const check = measurer.checkOverflow(sampleText, {
            maxWidth: 280, // typical card inner width
            containerHeight: 24, // single line height
            font: "14px sans-serif",
          });
          if (!check.fits) {
            textOverflows.push(
              `Component "${cs.name}" prop "${propName}" may overflow at 280px (${check.lineCount} lines, ${check.actualHeight}px vs 24px container)`
            );
          }
        }
      }
    } catch {
      // TextMeasurer not available (missing native deps)
    }
    for (const overflow of textOverflows) {
      issues.push(`[TEXT-OVERFLOW] ${overflow}`);
    }

    // 6. Research coverage (if research is loaded)
    try {
      await this.engine.research.load();
      const store = this.engine.research.getStore();
      if (store.findings.length > 0) {
        const mapping = mapResearchToSpecs(store, ctx.specs);
        if (mapping.coverage < 0.5) {
          issues.push(`Low research coverage: only ${Math.round(mapping.coverage * 100)}% of findings map to specs`);
        }
      }
    } catch {
      // Research not available
    }

    return {
      status: "completed",
      issues,
      issueCount: issues.length,
      textOverflows: textOverflows.length,
      a11yScore: a11yReport.score,
      wcagLevel: a11yReport.level,
    };
  }

  // ── Accessibility Checker Sub-Agent ────────────────────

  private async executeAccessibilityChecker(task: SubTask, ctx: AgentContext): Promise<unknown> {
    const {
      runFullAudit,
      auditTokenContrast,
      auditComponentSpec,
      auditPageSpec,
      checkContrast,
    } = await import("../engine/accessibility.js");

    // Run comprehensive WCAG audit
    const report = runFullAudit(ctx.designSystem, ctx.specs);

    // Additional: compute specific contrast pairs if mentioned in task
    const contrastPairs: Array<{ fg: string; bg: string; ratio: number; passes: boolean }> = [];
    const colorTokens = ctx.designSystem.tokens.filter((t) => t.type === "color");
    for (let i = 0; i < colorTokens.length; i++) {
      for (let j = i + 1; j < colorTokens.length; j++) {
        const v1 = Object.values(colorTokens[i].values)[0];
        const v2 = Object.values(colorTokens[j].values)[0];
        if (typeof v1 === "string" && typeof v2 === "string" && v1.startsWith("#") && v2.startsWith("#")) {
          const result = checkContrast(v1, v2);
          if (!result.passesAA) {
            contrastPairs.push({ fg: v1, bg: v2, ratio: result.ratio, passes: false });
          }
        }
      }
    }

    return {
      status: "completed",
      issues: report.issues.map((i) => `[${i.severity}] [WCAG ${i.wcagCriteria}] ${i.message}`),
      issueCount: report.issues.length,
      score: report.score,
      level: report.level,
      contrastFailures: contrastPairs.length,
      passed: report.passed,
      failed: report.failed,
    };
  }

  // ── Theme Builder Sub-Agent ────────────────────────────

  private async executeThemeBuilder(task: SubTask, ctx: AgentContext): Promise<unknown> {
    const mutations: DesignMutation[] = [];
    const prompt = task.prompt.toLowerCase();

    // Parse a base color from the prompt
    const hexMatch = task.prompt.match(/#[0-9a-fA-F]{3,8}/);
    const baseColor = hexMatch?.[0];

    // Determine theme intent
    const isDark = prompt.includes("dark");
    const isLight = prompt.includes("light");

    if (baseColor) {
      const { parseHex } = await import("../engine/accessibility.js");
      const parsed = parseHex(baseColor);
      if (parsed) {
        // Generate a semantic color palette from the base
        const palette: Array<{ name: string; value: string }> = [
          { name: "primary", value: baseColor },
          { name: "primary-foreground", value: isDark ? "#ffffff" : "#000000" },
        ];

        // Generate lighter/darker variants
        const lighten = (r: number, g: number, b: number, amount: number) =>
          `#${[r, g, b].map((c) => Math.min(255, Math.round(c + (255 - c) * amount)).toString(16).padStart(2, "0")).join("")}`;
        const darken = (r: number, g: number, b: number, amount: number) =>
          `#${[r, g, b].map((c) => Math.max(0, Math.round(c * (1 - amount))).toString(16).padStart(2, "0")).join("")}`;

        palette.push({ name: "primary-light", value: lighten(parsed.r, parsed.g, parsed.b, 0.3) });
        palette.push({ name: "primary-dark", value: darken(parsed.r, parsed.g, parsed.b, 0.3) });
        palette.push({ name: "muted", value: lighten(parsed.r, parsed.g, parsed.b, 0.8) });
        palette.push({ name: "muted-foreground", value: darken(parsed.r, parsed.g, parsed.b, 0.5) });

        // Apply to design system
        for (const { name, value } of palette) {
          const token: import("../engine/registry.js").DesignToken = {
            name, collection: "colors", type: "color",
            values: { [isDark ? "Dark" : "Light"]: value },
            cssVariable: `--${name}`,
          };
          this.engine.registry.updateToken(name, token);
          mutations.push({ type: "token-created", target: name, detail: `Theme: ${value}` });
        }
      }
    }

    // Generate semantic tokens if none exist
    const ds = this.engine.registry.designSystem;
    const semanticDefaults: Array<{ name: string; value: string }> = [
      { name: "background", value: isDark ? "#0a0a0a" : "#ffffff" },
      { name: "foreground", value: isDark ? "#fafafa" : "#0a0a0a" },
      { name: "border", value: isDark ? "#27272a" : "#e4e4e7" },
      { name: "ring", value: isDark ? "#d4d4d8" : "#18181b" },
      { name: "destructive", value: "#ef4444" },
      { name: "destructive-foreground", value: "#fafafa" },
    ];

    for (const { name, value } of semanticDefaults) {
      if (!ds.tokens.find((t) => t.name === name)) {
        const token: import("../engine/registry.js").DesignToken = {
          name, collection: "colors", type: "color",
          values: { [isDark ? "Dark" : "Light"]: value },
          cssVariable: `--${name}`,
        };
        this.engine.registry.updateToken(name, token);
        mutations.push({ type: "token-created", target: name, detail: `Semantic: ${value}` });
      }
    }

    log.info({ task: task.name, mutations: mutations.length }, "Theme builder completed");
    return { status: "completed", mutations, tokenCount: ds.tokens.length };
  }

  // ── Responsive Specialist Sub-Agent ────────────────────

  private async executeResponsiveSpecialist(task: SubTask, ctx: AgentContext): Promise<unknown> {
    const pageSpecs = ctx.specs.filter((s) => s.type === "page") as PageSpec[];
    const componentSpecs = ctx.specs.filter((s) => s.type === "component") as ComponentSpec[];
    const issues: string[] = [];
    const recommendations: string[] = [];

    // 1. Page responsive layout validation
    for (const page of pageSpecs) {
      if (!page.responsive?.mobile) issues.push(`Page "${page.name}" missing mobile layout`);
      if (!page.responsive?.tablet) issues.push(`Page "${page.name}" missing tablet layout`);
      if (!page.responsive?.desktop) issues.push(`Page "${page.name}" missing desktop layout`);

      // Check for grid layouts that won't work on mobile
      if (page.responsive?.mobile && page.responsive.mobile.startsWith("grid-")) {
        const cols = parseInt(page.responsive.mobile.split("-")[1] ?? "1", 10);
        if (cols > 2) {
          issues.push(`Page "${page.name}" uses ${cols}-col grid on mobile — should stack or use max 2 columns`);
        }
      }

      // Check section layout compatibility
      for (const section of page.sections) {
        if (section.layout === "grid-4" || section.layout === "grid-3") {
          recommendations.push(
            `Page "${page.name}" section "${section.name}" uses ${section.layout} — add responsive breakpoints for tablet (grid-2) and mobile (stack)`,
          );
        }
      }
    }

    // 2. Component responsive readiness
    for (const comp of componentSpecs) {
      // Check if components that compose many specs should be responsive
      if (comp.composesSpecs.length >= 3) {
        recommendations.push(
          `Component "${comp.name}" composes ${comp.composesSpecs.length} specs — consider adding responsive variant (compact/full)`,
        );
      }

      // Flag components without a compact variant that might need one
      if (comp.level === "organism" && !comp.variants.includes("compact") && !comp.variants.includes("mobile")) {
        recommendations.push(
          `Organism "${comp.name}" has no compact/mobile variant — may need one for smaller viewports`,
        );
      }
    }

    // 3. Touch target audit for mobile
    for (const comp of componentSpecs) {
      const a11y = comp.accessibility as Record<string, unknown> | undefined;
      if (!a11y?.touchTarget) {
        const isInteractive = /button|input|select|checkbox|toggle|switch|link|tab/i.test(comp.name);
        if (isInteractive) {
          issues.push(`Interactive component "${comp.name}" has no touchTarget defined — need 44px minimum for mobile`);
        }
      }
    }

    // 4. Text reflow validation across breakpoints via Pretext
    const breakpointResults: Array<{ spec: string; prop: string; breakpoint: string; lineCount: number; fits: boolean }> = [];
    try {
      const { getTextMeasurer } = await import("../engine/text-measurer.js");
      const measurer = getTextMeasurer();
      for (const comp of componentSpecs) {
        for (const [propName, propType] of Object.entries(comp.props)) {
          if (propType !== "string" && propType !== "string?") continue;
          const sampleText = `Sample ${propName} content for testing responsive text reflow`;
          const results = measurer.checkBreakpoints(sampleText, {
            font: "14px sans-serif",
            containerHeight: 48, // 2 lines max
          });
          for (const r of results) {
            if (!r.fits) {
              issues.push(
                `Component "${comp.name}" prop "${propName}" overflows at ${r.breakpoint} (${r.width}px): ${r.lineCount} lines, ${r.height}px`
              );
            }
            breakpointResults.push({ spec: comp.name, prop: propName, breakpoint: r.breakpoint, lineCount: r.lineCount, fits: r.fits });
          }
        }
      }
    } catch {
      // TextMeasurer not available
    }

    return {
      status: "completed",
      issues,
      recommendations,
      breakpointResults: breakpointResults.length,
      pageCount: pageSpecs.length,
      componentCount: componentSpecs.length,
    };
  }

  // ── AI-Powered Execution ───────────────────────────────

  private async aiExecuteSubTask(
    ai: AIClient,
    task: SubTask,
    ctx: AgentContext,
    options: SubAgentExecutionOptions,
  ): Promise<unknown> {
    const systemPrompt = this.buildAgentSystemPrompt(task.agentType, ctx);

    const result = await ai.completeJSON<{
      status: string;
      mutations?: Array<{ type: string; target: string; detail: string }>;
      analysis?: string;
      recommendations?: string[];
      issues?: string[];
    }>({
      system: systemPrompt,
      messages: [
        { role: "user", content: task.prompt },
      ],
      model: "fast",
      ...(options.maxOutputTokens !== undefined
        ? { maxTokens: Math.max(1, options.maxOutputTokens) }
        : {}),
    });

    options.signal?.throwIfAborted();
    options.beforeApplyAIResult?.();

    // Apply any mutations from the AI result
    if (result.mutations && result.mutations.length > 0) {
      for (const m of result.mutations) {
        options.signal?.throwIfAborted();
        await this.applyAIResult(m, ctx);
      }
    }

    return {
      status: result.status || "completed",
      mutations: (result.mutations || []).map(m => ({
        type: m.type as DesignMutation["type"],
        target: m.target,
        detail: m.detail,
      })),
      analysis: result.analysis,
      recommendations: result.recommendations,
      issues: result.issues,
      aiPowered: true,
    };
  }

  private buildAgentSystemPrompt(agentType: SubAgentType, ctx: AgentContext): string {
    const roleDesc = this.getAgentRoleDescription(agentType);
    const tokenSummary = ctx.designSystem.tokens.slice(0, 20).map(t =>
      `${t.name}: ${t.type} = ${JSON.stringify(Object.values(t.values)[0] ?? "(empty)")}`
    ).join("\n");

    return [
      `You are a ${agentType} sub-agent in the Memoire design intelligence engine.`,
      `Role: ${roleDesc}`,
      "",
      "Current design system context:",
      `- ${ctx.designSystem.tokens.length} tokens`,
      `- ${ctx.designSystem.components.length} components`,
      `- ${ctx.specs.length} specs`,
      `- Framework: ${ctx.projectFramework || "unknown"}`,
      `- Figma: ${ctx.figmaConnected ? "connected" : "offline"}`,
      "",
      "Token snapshot:",
      tokenSummary,
      "",
      "Return a JSON object with: { status, mutations?, analysis?, recommendations?, issues? }",
      "mutations should be an array of { type, target, detail }",
      "type must be one of: token-created, token-updated, token-deleted, spec-created, spec-updated, code-generated, figma-pushed",
    ].join("\n");
  }

  private getAgentRoleDescription(agentType: SubAgentType): string {
    const roles: Record<SubAgentType, string> = {
      "token-engineer": "Design token expert. Analyze, create, and update design tokens (colors, spacing, typography, shadows, radii).",
      "component-architect": "Component design specialist. Decompose UI into atomic design specs with proper composition.",
      "layout-designer": "Page layout expert. Design responsive page layouts using grid systems and component placement.",
      "dataviz-specialist": "Data visualization expert. Design chart specs with appropriate chart types, axes, and interactions.",
      "figma-executor": "Figma bridge operator. Push and pull design system changes to/from Figma.",
      "code-generator": "Code generation specialist. Transform specs into shadcn/ui + Tailwind components.",
      "design-auditor": "Design system auditor. Review consistency, completeness, and quality of the design system.",
      "accessibility-checker": "Accessibility expert. Check WCAG compliance, contrast ratios, ARIA labels, keyboard nav.",
      "theme-builder": "Theme specialist. Design cohesive color themes with proper semantic token mapping.",
      "responsive-specialist": "Responsive design expert. Ensure layouts work across mobile, tablet, and desktop.",
    };
    return roles[agentType] || "General design agent.";
  }

  private async applyAIResult(mutation: { type: string; target: string; detail: string }, ctx: AgentContext): Promise<void> {
    if (!mutation.type || !mutation.target) {
      log.warn({ mutation }, "Skipping AI mutation — missing type or target");
      return;
    }
    log.info({ type: mutation.type, target: mutation.target }, "Applying AI mutation");

    switch (mutation.type) {
      case "token-created":
      case "token-updated": {
        const existing = this.engine.registry.designSystem.tokens.find(t => t.name === mutation.target);
        if (existing) {
          log.info({ token: mutation.target }, "Token mutation recorded — update via registry");
        }
        break;
      }
      case "token-deleted": {
        this.engine.registry.removeToken(mutation.target);
        break;
      }
      case "spec-created":
      case "spec-updated":
      case "code-generated":
      case "figma-pushed":
        break;
      default:
        log.warn({ type: mutation.type }, "Unknown AI mutation type — recording only");
    }
  }

  // ── Figma Push Helpers ─────────────────────────────────

  async pushTokenToFigma(token: DesignToken): Promise<void> {
    // Enable sync guard to prevent echo loops
    this.engine.sync.enableGuard();

    try {
      const value = Object.values(token.values)[0];
      if (!value) {
        return;
      }

      // Validate token name to prevent code injection
      if (!/^[A-Za-z0-9/_\- .]+$/.test(token.name)) {
        log.warn({ token: token.name }, "Skipping Figma push — unsafe token name");
        return;
      }

      // Pass data as serialized JSON payload, not inline template interpolation
      const tokenData = {
        name: String(token.name),
        value: String(value),
        isColor: token.type === "color",
      };

      const code = `
        (async () => {
          const tokenData = JSON.parse(${JSON.stringify(JSON.stringify(tokenData))});
          const collections = await figma.variables.getLocalVariableCollectionsAsync();
          for (const col of collections) {
            const varIds = col.variableIds;
            for (const vid of varIds) {
              const v = await figma.variables.getVariableByIdAsync(vid);
              if (v && v.name === tokenData.name) {
                const modeId = col.modes[0]?.modeId;
                if (modeId) {
                  if (tokenData.isColor) {
                    const hex = tokenData.value;
                    const r = parseInt(hex.slice(1,3), 16) / 255;
                    const g = parseInt(hex.slice(3,5), 16) / 255;
                    const b = parseInt(hex.slice(5,7), 16) / 255;
                    v.setValueForMode(modeId, { r, g, b, a: 1 });
                  } else {
                    v.setValueForMode(modeId, tokenData.value);
                  }
                }
                return { updated: true, variable: v.name };
              }
            }
          }
          return { updated: false };
        })()
      `;

      await this.engine.figma.execute(code);
    } finally {
      this.engine.sync.disableGuard();
    }
  }

  async syncMutationsToFigma(mutations: DesignMutation[]): Promise<void> {
    for (const mutation of mutations) {
      if (mutation.type === "token-updated" || mutation.type === "token-created") {
        const token = this.engine.registry.designSystem.tokens.find((t) => t.name === mutation.target);
        if (token) await this.pushTokenToFigma(token);
      }
    }
  }

  // ── Self-Healing Loop ──────────────────────────────────
  // MANDATORY after every canvas creation/modification.
  // Screenshot -> Analyze -> Fix -> Verify (max 3 rounds)

  async selfHealingLoop(nodeId: string, intent: string, maxRounds = 3): Promise<{
    healed: boolean;
    rounds: number;
    issues: string[];
  }> {
    const allIssues: string[] = [];

    for (let round = 1; round <= maxRounds; round++) {
      log.info({ nodeId, round, intent }, "Self-healing: taking screenshot");

      // Take screenshot via Figma bridge
      const screenshotCode = `
        (async () => {
          const node = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
          if (!node) return { error: 'Node not found' };

          // Check for common issues
          const issues = [];

          function checkNode(n, path) {
            // Issue: floating outside any frame
            if (n.parent && n.parent.type === 'PAGE' && n.type !== 'SECTION' && n.type !== 'FRAME') {
              issues.push('floating-element: ' + n.name + ' is not inside a Section or Frame');
            }

            // Issue: no auto layout on containers with children
            if (('children' in n) && n.children && n.children.length > 1) {
              if (!n.layoutMode || n.layoutMode === 'NONE') {
                issues.push('no-auto-layout: ' + n.name + ' has children but no Auto Layout');
              }
            }

            // Issue: hug contents when should fill
            if (n.layoutSizingHorizontal === 'HUG' && n.parent && n.parent.layoutMode) {
              const siblings = n.parent.children;
              if (siblings.length === 1) {
                issues.push('should-fill: ' + n.name + ' is using HUG but is the only child (should FILL)');
              }
            }

            // Issue: raw hex fills (not bound to variables)
            if (n.fills && Array.isArray(n.fills)) {
              for (const fill of n.fills) {
                if (fill.type === 'SOLID' && !fill.boundVariables?.color) {
                  issues.push('raw-color: ' + n.name + ' has unbound solid fill');
                }
              }
            }

            // Recurse children
            if ('children' in n && n.children) {
              for (const child of n.children) {
                checkNode(child, path + '/' + child.name);
              }
            }
          }

          checkNode(node, node.name);
          return { issues, nodeCount: 1, name: node.name };
        })()
      `;

      try {
        const result = await this.engine.figma.execute(screenshotCode);
        const data = typeof result === "string" ? JSON.parse(result) : result;

        if (data.error) {
          allIssues.push(`Round ${round}: ${data.error}`);
          break;
        }

        const issues = data.issues || [];
        if (issues.length === 0) {
          log.info({ nodeId, round }, "Self-healing: no issues found — design is clean");
          return { healed: true, rounds: round, issues: allIssues };
        }

        allIssues.push(...issues.map((i: string) => `Round ${round}: ${i}`));
        log.warn({ nodeId, round, issueCount: issues.length }, "Self-healing: issues found, attempting fixes");

        // Attempt automatic fixes
        const fixCode = `
          (async () => {
            const node = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
            if (!node) return { fixed: 0 };
            let fixed = 0;

            function fixNode(n) {
              // Fix: add Auto Layout to containers without it
              if (('children' in n) && n.children && n.children.length > 1) {
                if (n.type === 'FRAME' && (!n.layoutMode || n.layoutMode === 'NONE')) {
                  n.layoutMode = 'VERTICAL';
                  n.itemSpacing = 8;
                  n.paddingLeft = n.paddingRight = n.paddingTop = n.paddingBottom = 16;
                  fixed++;
                }
              }

              // Fix: change HUG to FILL for lone children
              if (n.layoutSizingHorizontal === 'HUG' && n.parent && n.parent.layoutMode) {
                const siblings = n.parent.children;
                if (siblings.length === 1) {
                  n.layoutSizingHorizontal = 'FILL';
                  fixed++;
                }
              }

              // Recurse
              if ('children' in n && n.children) {
                for (const child of n.children) {
                  fixNode(child);
                }
              }
            }

            fixNode(node);
            return { fixed };
          })()
        `;

        await this.engine.figma.execute(fixCode);
      } catch (err) {
        allIssues.push(`Round ${round}: execution error — ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }

    return { healed: allIssues.length === 0, rounds: maxRounds, issues: allIssues };
  }

  // ── Scaffolding Helpers ────────────────────────────────

  scaffoldComponentSpec(name: string, intent: string): ComponentSpec {
    const now = new Date().toISOString();
    const shadcnBase = this.inferShadcnBase(intent, "component");
    const primaryBase = shadcnBase[0] ?? "Card";
    const lowerIntent = intent.toLowerCase();
    const level = /\b(form|table|sidebar|header|footer|dialog|modal)\b/.test(lowerIntent)
      ? "organism"
      : /\b(card|search|filter|metric|stat)\b/.test(lowerIntent)
        ? "molecule"
        : "atom";

    return {
      name,
      type: "component",
      level,
      purpose: `${name} component generated from compose intent`,
      researchBacking: [],
      designTokens: { source: "none", mapped: false },
      variants: ["default"],
      props: {},
      shadcnBase,
      composesSpecs: [],
      codeConnect: { props: {}, mapped: false },
      accessibility: {
        role: primaryBase === "Dialog" ? "dialog" : undefined,
        ariaLabel: "optional",
        keyboardNav: /dialog|modal|menu|dropdown|select|sidebar/i.test(lowerIntent),
        focusStyle: "outline",
        focusWidth: "2px",
        touchTarget: "default",
        reducedMotion: false,
        liveRegion: "off",
        colorIndependent: true,
      },
      dataviz: null,
      tags: ["compose-generated"],
      createdAt: now,
      updatedAt: now,
    };
  }

  scaffoldPageSpec(name: string, intent: string, ctx: AgentContext): PageSpec {
    const now = new Date().toISOString();
    const lowerIntent = intent.toLowerCase();
    const layout: PageSpec["layout"] = lowerIntent.includes("dashboard")
      ? "dashboard"
      : /\b(login|auth|signin|signup)\b/.test(lowerIntent)
        ? "centered"
        : /\blanding|marketing|hero\b/.test(lowerIntent)
          ? "marketing"
          : "full-width";

    const componentSections = ctx.specs
      .filter((spec): spec is ComponentSpec => spec.type === "component")
      .slice(0, layout === "dashboard" ? 3 : 0)
      .map((spec, index) => ({
        name: spec.name.toLowerCase(),
        component: spec.name,
        layout: index === 0 ? "full-width" : "grid-2",
        repeat: 1,
        props: {},
      })) as PageSpec["sections"];

    return {
      name,
      type: "page",
      purpose: `${name} page generated from compose intent`,
      researchBacking: [],
      layout,
      sections: componentSections,
      shadcnLayout: layout === "dashboard" ? ["SidebarProvider", "SidebarInset"] : [],
      responsive: { mobile: "stack", tablet: "grid-2", desktop: layout === "dashboard" ? "grid-4" : "grid-2" },
      accessibility: {
        language: "en",
        landmarks: true,
        skipLink: true,
        headingHierarchy: true,
        consistentNav: true,
        consistentHelp: true,
      },
      meta: {
        title: name.replace(/Page$/, ""),
        description: intent,
      },
      tags: ["compose-generated"],
      layoutLocked: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  scaffoldDataVizSpec(name: string, intent: string): DataVizSpec {
    const now = new Date().toISOString();
    const lowerIntent = intent.toLowerCase();
    const chartType: DataVizSpec["chartType"] = lowerIntent.includes("bar")
      ? "bar"
      : lowerIntent.includes("area")
        ? "area"
        : lowerIntent.includes("pie") || lowerIntent.includes("donut")
          ? "donut"
          : lowerIntent.includes("scatter")
            ? "scatter"
            : "line";

    return {
      name,
      type: "dataviz",
      purpose: `${name} chart generated from compose intent`,
      chartType,
      library: "recharts",
      dataShape: { x: "label", y: "value" },
      interactions: ["hover-tooltip"],
      accessibility: { altText: "required", keyboardNav: true, dataTableFallback: true, patternFill: false, announceUpdates: false, highContrastMode: false },
      responsive: {
        mobile: { height: 200, simplify: true },
        desktop: { height: 400 },
      },
      shadcnWrapper: "Card",
      sampleData: [],
      tags: ["compose-generated"],
      createdAt: now,
      updatedAt: now,
    };
  }

  // ── Private Helpers ────────────────────────────────────

  private inferShadcnBase(intent: string, kind: "component" | "page" | "dataviz"): string[] {
    const text = intent.toLowerCase();
    if (kind === "dataviz") return ["Card"];
    if (text.includes("button")) return ["Button"];
    if (text.includes("input")) return ["Input"];
    if (text.includes("form")) return ["Form", "Input", "Label"];
    if (text.includes("dialog") || text.includes("modal")) return ["Dialog"];
    if (text.includes("table")) return ["Table"];
    if (text.includes("sidebar") || text.includes("nav")) return ["Sidebar"];
    if (text.includes("badge")) return ["Badge"];
    return ["Card"];
  }

  private resolveTargetSpecName(
    intent: string,
    kind: "component" | "page" | "dataviz",
    ctx: AgentContext,
  ): string {
    const exactExisting = ctx.specs.find((spec) => new RegExp(`\\b${spec.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(intent));
    if (exactExisting) {
      return exactExisting.name;
    }

    const extracted = this.extractNameFromIntent(intent, kind);
    if (extracted) {
      return extracted;
    }

    const suffix = kind === "page" ? "Page" : kind === "dataviz" ? "Chart" : "Component";
    return `Generated${suffix}`;
  }

  private extractNameFromIntent(intent: string, kind: "component" | "page" | "dataviz"): string | null {
    const patterns: Record<typeof kind, RegExp[]> = {
      component: [
        /\b(?:create|add|build|design|new)\s+(?:(?:an|a|the)\s+)?([a-z0-9][a-z0-9\s-]*?)\s+(?:component|widget|element)\b/i,
        /\b(?:create|add|build|design|new)\s+(?:(?:an|a|the)\s+)?([a-z0-9][a-z0-9\s-]*?)\s+(button|card|input|form|modal|dialog|table|nav|header|footer|sidebar)\b/i,
      ],
      page: [
        /\b(?:create|add|build|design|compose|new)\s+(?:(?:an|a|the)\s+)?([a-z0-9][a-z0-9\s-]*?)\s+(page|screen|view|layout)\b/i,
      ],
      dataviz: [
        /\b(?:create|add|build|design|new)\s+(?:(?:an|a|the)\s+)?([a-z0-9][a-z0-9\s-]*?)\s+(chart|graph|visualization|viz)\b/i,
      ],
    };

    for (const pattern of patterns[kind]) {
      const match = intent.match(pattern);
      if (!match) continue;
      const nameParts = match.slice(1).filter(Boolean);
      const normalized = this.toPascalCase(nameParts.join(" "));
      if (!normalized) continue;

      if (kind === "page" && !normalized.endsWith("Page")) return `${normalized}Page`;
      if (kind === "dataviz" && !/(Chart|Graph|Viz)$/i.test(normalized)) return `${normalized}Chart`;
      return normalized;
    }

    return null;
  }

  private toPascalCase(value: string): string {
    return value
      .replace(/[^A-Za-z0-9\s-]/g, " ")
      .trim()
      .split(/[\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("");
  }

  private upsertContextSpec(ctx: AgentContext, spec: AnySpec): void {
    const index = ctx.specs.findIndex((entry) => entry.name === spec.name);
    if (index >= 0) {
      ctx.specs[index] = spec;
      return;
    }
    ctx.specs.push(spec);
  }
}
