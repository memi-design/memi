/**
 * Plan Builder — Decomposes classified intents into sub-agent task plans.
 *
 * Extracted from orchestrator.ts for independent testability and reuse.
 */

import type { IntentCategory } from "./intent-classifier.js";
import type { AGENT_PROMPTS as AgentPromptsType } from "./prompts.js";
import type { AnySpec, ComponentSpec } from "../specs/types.js";

// ── Types ────────────────────────────────────────────────

export type SubAgentType =
  | "token-engineer"
  | "component-architect"
  | "layout-designer"
  | "dataviz-specialist"
  | "figma-executor"
  | "code-generator"
  | "design-auditor"
  | "accessibility-checker"
  | "theme-builder"
  | "responsive-specialist";

export interface SubTask {
  id: string;
  name: string;
  agentType: SubAgentType;
  prompt: string;
  dependencies: string[]; // IDs of tasks that must complete first
  targetSpecs?: string[];
  status: "pending" | "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentContext {
  designSystem: import("../engine/registry.js").DesignSystem;
  specs: AnySpec[];
  figmaConnected: boolean;
  projectFramework?: string;
}

export interface AgentPlan {
  id: string;
  intent: string;
  category: IntentCategory;
  subTasks: SubTask[];
  context: AgentContext;
  skillRoute?: import("../notes/skill-router.js").SkillRouteResult;
  createdAt: string;
}

// ── Plan Builder ─────────────────────────────────────────

export class PlanBuilder {
  private prompts: typeof AgentPromptsType;
  private taskCounter = 0;

  constructor(prompts: typeof AgentPromptsType) {
    this.prompts = prompts;
  }

  resetCounter(value = 0): void {
    this.taskCounter = value;
  }

  setCounter(value: number): void {
    this.taskCounter = value;
  }

  getCounter(): number {
    return this.taskCounter;
  }

  decompose(intent: string, category: IntentCategory, ctx: AgentContext): SubTask[] {
    switch (category) {
      case "color-palette":
        return this.decomposeColorPalette(intent, ctx);
      case "spacing-system":
        return this.decomposeSpacingSystem(intent, ctx);
      case "typography-system":
        return this.decomposeTypographySystem(intent, ctx);
      case "theme-change":
        return this.decomposeThemeChange(intent, ctx);
      case "token-update":
        return this.decomposeTokenUpdate(intent, ctx);
      case "component-create":
        return this.decomposeComponentCreate(intent, ctx);
      case "component-modify":
        return this.decomposeComponentModify(intent, ctx);
      case "page-layout":
        return this.decomposePageLayout(intent, ctx);
      case "dataviz-create":
        return this.decomposeDatavizCreate(intent, ctx);
      case "responsive-layout":
        return this.decomposeResponsiveLayout(intent, ctx);
      case "figma-sync":
        return this.decomposeFigmaSync(intent, ctx);
      case "code-generate":
        return this.decomposeCodeGenerate(intent, ctx);
      case "design-audit":
        return this.decomposeDesignAudit(intent, ctx);
      case "accessibility-check":
        return this.decomposeAccessibilityCheck(intent, ctx);
      case "design-system-init":
        return this.decomposeDesignSystemInit(intent, ctx);
      case "design-extract":
        return this.decomposeDesignExtract(intent, ctx);
      default:
        return this.decomposeGeneral(intent, ctx);
    }
  }

  makeTask(
    name: string,
    agentType: SubAgentType,
    prompt: string,
    deps: string[] = [],
    targetSpecs?: string[],
  ): SubTask {
    const id = `task-${++this.taskCounter}`;
    return { id, name, agentType, prompt, dependencies: deps, targetSpecs, status: "pending" };
  }

  // ── Spec Name Resolution ──────────────────────────────

  resolveTargetSpecName(
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

  // ── Color Palette Decomposition ────────────────────────

  private decomposeColorPalette(intent: string, ctx: AgentContext): SubTask[] {
    const existingColors = ctx.designSystem.tokens.filter((t) => t.type === "color");
    const t1 = this.makeTask(
      "Analyze current color system",
      "token-engineer",
      this.prompts.colorAnalysis(intent, existingColors),
    );
    const t2 = this.makeTask(
      "Generate color palette updates",
      "token-engineer",
      this.prompts.colorGeneration(intent, existingColors),
      [t1.id],
    );
    const t3 = this.makeTask(
      "Apply color tokens to design system",
      "token-engineer",
      this.prompts.tokenApplication("color", intent),
      [t2.id],
    );
    const tasks = [t1, t2, t3];

    if (ctx.figmaConnected) {
      tasks.push(this.makeTask(
        "Sync color palette to Figma",
        "figma-executor",
        this.prompts.figmaSync("color-palette", intent),
        [t3.id],
      ));
    }

    return tasks;
  }

  // ── Spacing System Decomposition ───────────────────────

  private decomposeSpacingSystem(intent: string, ctx: AgentContext): SubTask[] {
    const spacingTokens = ctx.designSystem.tokens.filter((t) => t.type === "spacing");
    const t1 = this.makeTask(
      "Analyze spacing scale",
      "token-engineer",
      this.prompts.spacingAnalysis(intent, spacingTokens),
    );
    const t2 = this.makeTask(
      "Generate spacing token updates",
      "token-engineer",
      this.prompts.spacingGeneration(intent, spacingTokens),
      [t1.id],
    );
    const t3 = this.makeTask(
      "Apply spacing tokens",
      "token-engineer",
      this.prompts.tokenApplication("spacing", intent),
      [t2.id],
    );
    const tasks = [t1, t2, t3];

    if (ctx.figmaConnected) {
      tasks.push(this.makeTask("Sync spacing to Figma", "figma-executor", this.prompts.figmaSync("spacing", intent), [t3.id]));
    }

    return tasks;
  }

  // ── Typography System Decomposition ────────────────────

  private decomposeTypographySystem(intent: string, ctx: AgentContext): SubTask[] {
    const typoTokens = ctx.designSystem.tokens.filter((t) => t.type === "typography");
    const t1 = this.makeTask(
      "Analyze type scale",
      "token-engineer",
      this.prompts.typographyAnalysis(intent, typoTokens),
    );
    const t2 = this.makeTask(
      "Generate typography updates",
      "token-engineer",
      this.prompts.typographyGeneration(intent, typoTokens),
      [t1.id],
    );
    const tasks = [t1, t2];

    if (ctx.figmaConnected) {
      tasks.push(this.makeTask("Sync typography to Figma", "figma-executor", this.prompts.figmaSync("typography", intent), [t2.id]));
    }

    return tasks;
  }

  // ── Theme Change Decomposition ─────────────────────────

  private decomposeThemeChange(intent: string, ctx: AgentContext): SubTask[] {
    const t1 = this.makeTask(
      "Analyze current theme",
      "theme-builder",
      this.prompts.themeAnalysis(intent, ctx.designSystem),
    );
    const t2 = this.makeTask(
      "Generate theme token set",
      "theme-builder",
      this.prompts.themeGeneration(intent, ctx.designSystem),
      [t1.id],
    );
    const t3 = this.makeTask(
      "Update all token modes",
      "token-engineer",
      this.prompts.themeModeUpdate(intent),
      [t2.id],
    );
    const t4 = this.makeTask(
      "Regenerate affected components",
      "code-generator",
      this.prompts.themeCodegen(intent, ctx.specs),
      [t3.id],
    );
    const tasks = [t1, t2, t3, t4];

    if (ctx.figmaConnected) {
      tasks.push(this.makeTask("Push theme to Figma", "figma-executor", this.prompts.figmaSync("theme", intent), [t4.id]));
    }

    return tasks;
  }

  // ── Token Update Decomposition ─────────────────────────

  private decomposeTokenUpdate(intent: string, ctx: AgentContext): SubTask[] {
    const t1 = this.makeTask(
      "Parse token update intent",
      "token-engineer",
      this.prompts.tokenParse(intent, ctx.designSystem.tokens),
    );
    const t2 = this.makeTask(
      "Apply token mutation",
      "token-engineer",
      this.prompts.tokenApplication("any", intent),
      [t1.id],
    );
    const tasks = [t1, t2];

    if (ctx.figmaConnected) {
      tasks.push(this.makeTask("Sync token to Figma", "figma-executor", this.prompts.figmaSync("token", intent), [t2.id]));
    }

    return tasks;
  }

  // ── Component Create Decomposition ─────────────────────

  private decomposeComponentCreate(intent: string, ctx: AgentContext): SubTask[] {
    const targetSpec = this.resolveTargetSpecName(intent, "component", ctx);

    // Pre-check: verify component doesn't already exist via Code Connect
    const existingMappings = ctx.specs
      .filter((s) => s.type === "component")
      .map((s) => {
        const cs = s as { name: string; codeConnect?: { mapped: boolean; codebasePath?: string } };
        const path = cs.codeConnect?.codebasePath ? ` (path: ${cs.codeConnect.codebasePath})` : "";
        return `- ${cs.name}: mapped=${cs.codeConnect?.mapped ?? false}${path}`;
      })
      .join("\n") || "(none)";

    const t0 = this.makeTask(
      "Check Code Connect for existing mappings",
      "component-architect",
      `Before creating a new component, check if it already exists in the codebase via Code Connect.

## Request: "${intent}"
## Target Spec: ${targetSpec}

## Existing Component Specs
${existingMappings}

## Instructions
1. Check get_code_connect_map for existing Figma-to-code mappings
2. If the requested component already exists and is mapped, STOP and use the existing component
3. If not mapped, proceed with creation
4. Return: { exists: boolean, existingPath?: string, proceed: boolean }`,
      [],
      [targetSpec],
    );

    const t1 = this.makeTask(
      "Analyze component requirements",
      "component-architect",
      this.prompts.componentAnalysis(intent, ctx.designSystem, ctx.specs),
      [t0.id],
      [targetSpec],
    );
    const t2 = this.makeTask(
      "Design component spec",
      "component-architect",
      this.prompts.componentDesign(intent, ctx.designSystem),
      [t1.id],
      [targetSpec],
    );
    const t3 = this.makeTask(
      "Generate component code",
      "code-generator",
      this.prompts.componentCodegen(intent),
      [t2.id],
      [targetSpec],
    );
    const tasks = [t0, t1, t2, t3];

    if (ctx.figmaConnected) {
      tasks.push(this.makeTask("Create component in Figma", "figma-executor", this.prompts.figmaComponentCreate(intent), [t3.id], [targetSpec]));
    }

    return tasks;
  }

  // ── Component Modify Decomposition ─────────────────────

  private decomposeComponentModify(intent: string, ctx: AgentContext): SubTask[] {
    const targetSpec = this.resolveTargetSpecName(intent, "component", ctx);
    const t1 = this.makeTask(
      "Identify target component",
      "component-architect",
      this.prompts.componentIdentify(intent, ctx.specs),
      [],
      [targetSpec],
    );
    const t2 = this.makeTask(
      "Update component spec",
      "component-architect",
      this.prompts.componentModify(intent),
      [t1.id],
      [targetSpec],
    );
    const t3 = this.makeTask(
      "Regenerate component code",
      "code-generator",
      this.prompts.componentCodegen(intent),
      [t2.id],
      [targetSpec],
    );
    return [t1, t2, t3];
  }

  // ── Page Layout Decomposition ──────────────────────────

  private decomposePageLayout(intent: string, ctx: AgentContext): SubTask[] {
    const targetSpec = this.resolveTargetSpecName(intent, "page", ctx);
    const t1 = this.makeTask(
      "Analyze page requirements",
      "layout-designer",
      this.prompts.pageAnalysis(intent, ctx.specs),
      [],
      [targetSpec],
    );
    const t2 = this.makeTask(
      "Design page layout spec",
      "layout-designer",
      this.prompts.pageDesign(intent, ctx.designSystem, ctx.specs),
      [t1.id],
      [targetSpec],
    );
    const t3 = this.makeTask(
      "Generate page code",
      "code-generator",
      this.prompts.pageCodegen(intent),
      [t2.id],
      [targetSpec],
    );
    const tasks = [t1, t2, t3];

    if (ctx.figmaConnected) {
      tasks.push(this.makeTask("Compose page in Figma", "figma-executor", this.prompts.figmaPageCompose(intent), [t3.id], [targetSpec]));
    }

    return tasks;
  }

  // ── DataViz Create Decomposition ───────────────────────

  private decomposeDatavizCreate(intent: string, ctx: AgentContext): SubTask[] {
    const targetSpec = this.resolveTargetSpecName(intent, "dataviz", ctx);
    const t1 = this.makeTask(
      "Analyze data visualization needs",
      "dataviz-specialist",
      this.prompts.datavizAnalysis(intent),
      [],
      [targetSpec],
    );
    const t2 = this.makeTask(
      "Design chart spec",
      "dataviz-specialist",
      this.prompts.datavizDesign(intent, ctx.designSystem),
      [t1.id],
      [targetSpec],
    );
    const t3 = this.makeTask(
      "Generate chart code",
      "code-generator",
      this.prompts.datavizCodegen(intent),
      [t2.id],
      [targetSpec],
    );
    return [t1, t2, t3];
  }

  // ── Responsive Layout Decomposition ────────────────────

  private decomposeResponsiveLayout(intent: string, ctx: AgentContext): SubTask[] {
    const t1 = this.makeTask(
      "Audit responsive breakpoints",
      "responsive-specialist",
      this.prompts.responsiveAudit(intent, ctx.specs),
    );
    const t2 = this.makeTask(
      "Update responsive specs",
      "responsive-specialist",
      this.prompts.responsiveUpdate(intent),
      [t1.id],
    );
    return [t1, t2];
  }

  // ── Figma Sync Decomposition ───────────────────────────

  private decomposeFigmaSync(intent: string, ctx: AgentContext): SubTask[] {
    if (!ctx.figmaConnected) {
      return [this.makeTask("Connect to Figma", "figma-executor", this.prompts.figmaConnect())];
    }
    const t1 = this.makeTask(
      "Pull latest from Figma",
      "figma-executor",
      this.prompts.figmaPull(),
    );
    const t2 = this.makeTask(
      "Diff local vs Figma state",
      "figma-executor",
      this.prompts.figmaDiff(),
      [t1.id],
    );
    const t3 = this.makeTask(
      "Push local changes to Figma",
      "figma-executor",
      this.prompts.figmaSync("full", intent),
      [t2.id],
    );
    return [t1, t2, t3];
  }

  // ── Code Generate Decomposition ────────────────────────

  private decomposeCodeGenerate(intent: string, ctx: AgentContext): SubTask[] {
    const specs = ctx.specs;
    const tasks: SubTask[] = [
      this.makeTask("Validate all specs", "design-auditor", this.prompts.specValidation(specs)),
    ];

    for (const spec of specs) {
      tasks.push(this.makeTask(
        `Generate ${spec.name}`,
        "code-generator",
        this.prompts.specCodegen(spec),
        [tasks[0].id],
        [spec.name],
      ));
    }

    return tasks;
  }

  // ── Design Audit Decomposition ─────────────────────────

  private decomposeDesignAudit(intent: string, ctx: AgentContext): SubTask[] {
    return [
      this.makeTask("Audit token consistency", "design-auditor", this.prompts.auditTokens(ctx.designSystem)),
      this.makeTask("Audit spec completeness", "design-auditor", this.prompts.auditSpecs(ctx.specs)),
      this.makeTask("Audit accessibility", "accessibility-checker", this.prompts.auditAccessibility(ctx.designSystem, ctx.specs)),
      this.makeTask("Generate audit report", "design-auditor", this.prompts.auditReport(intent)),
    ];
  }

  // ── Accessibility Check Decomposition ──────────────────

  private decomposeAccessibilityCheck(intent: string, ctx: AgentContext): SubTask[] {
    return [
      this.makeTask("Check color contrast", "accessibility-checker", this.prompts.a11yContrast(ctx.designSystem)),
      this.makeTask("Check component ARIA", "accessibility-checker", this.prompts.a11yAria(ctx.specs)),
      this.makeTask("Check keyboard navigation", "accessibility-checker", this.prompts.a11yKeyboard(ctx.specs)),
      this.makeTask("Check cognitive accessibility", "accessibility-checker", this.prompts.a11yCognitive(ctx.specs)),
      this.makeTask("Check motion accessibility", "accessibility-checker", this.prompts.a11yMotion(ctx.designSystem, ctx.specs)),
    ];
  }

  // ── Design System Init Decomposition ───────────────────

  private decomposeDesignSystemInit(intent: string, ctx: AgentContext): SubTask[] {
    const t1 = this.makeTask(
      "Scaffold token foundation",
      "token-engineer",
      this.prompts.initTokens(intent),
    );
    const t2 = this.makeTask(
      "Create base component specs",
      "component-architect",
      this.prompts.initComponents(intent),
      [t1.id],
    );
    const t3 = this.makeTask(
      "Generate initial code",
      "code-generator",
      this.prompts.initCodegen(),
      [t2.id],
    );
    return [t1, t2, t3];
  }

  // ── General Decomposition ──────────────────────────────

  private decomposeDesignExtract(intent: string, _ctx: AgentContext): SubTask[] {
    // Extract URL from intent string
    const urlMatch = intent.match(/https?:\/\/[^\s]+/i);
    const url = urlMatch ? urlMatch[0] : "(URL not found in intent — ask user to provide one)";
    const t1 = this.makeTask(
      "Extract design system from URL",
      "design-auditor",
      `Run \`memi extract ${url}\` to extract the design system from the target URL. ` +
      `This will fetch HTML + CSS, parse tokens (colors, typography, spacing, radii, shadows), ` +
      `and use Claude to synthesize a structured DESIGN.md. ` +
      `Save the output and report: token counts, color palette, font families found.`,
      [],
      ["DESIGN.md"],
    );
    const t2 = this.makeTask(
      "Convert extracted tokens to specs",
      "token-engineer",
      `Given the extracted DESIGN.md from step 1, create DesignSpec + DesignToken records in the registry. ` +
      `Map colors to color tokens, font families to typography tokens, spacing to spacing tokens.`,
      [t1.id],
      [],
    );
    return [t1, t2];
  }

  private decomposeGeneral(intent: string, ctx: AgentContext): SubTask[] {
    return [
      this.makeTask("Analyze design intent", "design-auditor", this.prompts.generalAnalysis(intent, ctx)),
      this.makeTask("Execute design operation", "component-architect", this.prompts.generalExecute(intent)),
    ];
  }
}
