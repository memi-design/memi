/**
 * MCP Tool registrations for Mémoire.
 *
 * Each tool wraps an existing engine method and returns structured
 * CallToolResult payloads. Errors are caught and returned as
 * { isError: true } per MCP convention.
 */

import { z } from "zod";
import { stat } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MemoireEngine } from "../engine/core.js";
import { AgentOrchestrator } from "../agents/orchestrator.js";
import { DesignAnalyzer } from "../agents/design-analyzer.js";
import { buildDesignAgentBrief, DESIGN_AGENT_BRIEF_DETAIL_LEVELS, DESIGN_AGENT_BRIEF_MODES } from "../agents/design-agent-brief.js";
import { buildAgentFileScaffoldPlan, markAgentFileScaffoldWritten } from "../scaffold/agent-file-scaffold.js";
import { APPLE_DESIGN_BRIEF_DETAILS, APPLE_DESIGN_BRIEF_PLATFORMS, buildAppleDesignBrief } from "../ios/apple-design-brief.js";
import { buildSwiftUiScaffoldPlan, SWIFTUI_ATOMIC_LEVELS, SWIFTUI_SCAFFOLD_KINDS, writeSwiftUiScaffold } from "../ios/swiftui-scaffold.js";
import { getAI, getTracker } from "../ai/index.js";
import { ComponentSpecSchema, PageSpecSchema, DataVizSpecSchema, type ComponentSpec } from "../specs/types.js";
import { fetchPageAssets, parseCSSTokens } from "../research/css-extractor.js";
import { buildShadcnRegistry, toShadcnItemName } from "../shadcn/index.js";
import { auditContextFromDiagnosis, diagnoseAppQuality } from "../app-quality/engine.js";
import { runFullAudit, auditTokenContrast } from "../engine/accessibility.js";
import { buildUiFixPlan } from "../app-quality/fix-plan.js";
import { buildUxAuditReport } from "../ux/tenets-traps.js";
import { buildInterfaceCraftReport } from "../ux/interface-craft.js";
import { resolveMermaidJamIntegration } from "../integrations/mermaid-jam.js";
import {
  DESIGN_SYSTEMS_MCP_CATEGORIES,
  normalizeDesignSystemsMcpCategoryManifest,
  normalizeDesignSystemsMcpCorpus,
} from "../integrations/design-systems-mcp.js";
import {
  buildResearchDesignPackage,
  saveResearchDesignSpecs,
  writeMermaidJamArtifacts,
} from "../research/design-package.js";
import {
  compareSimulationRuns,
  FileSimulationStore,
  LocalSimulationAdapter,
  ModelSwarmSimulationAdapter,
  SimulationModelRouter,
  buildProductSimulationScenarioFromResearch,
  exportProductSpecFromRun,
  simulationCosts,
  type SimulationAdapter,
  type SimulationAdapterKind,
  type SimulationBudget,
  type SimulationReport,
} from "../simulation/index.js";
import type { ResearchStore } from "../research/engine.js";

/**
 * Wrap every registered tool handler so unexpected throws come back as
 * structured { isError: true } results instead of raw protocol errors —
 * agents can read the message and retry/adjust instead of failing opaquely.
 */
function installSafeToolErrors(server: McpServer): void {
  const originalTool = (server.tool as (...args: unknown[]) => unknown).bind(server);
  (server as unknown as { tool: (...args: unknown[]) => unknown }).tool = (...args: unknown[]) => {
    const cbIndex = args.length - 1;
    const cb = args[cbIndex];
    if (typeof cb === "function") {
      const name = typeof args[0] === "string" ? args[0] : "tool";
      args[cbIndex] = async (...cbArgs: unknown[]) => {
        try {
          return await (cb as (...a: unknown[]) => unknown)(...cbArgs);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { isError: true, content: [{ type: "text", text: `${name} failed: ${message}` }] };
        }
      };
    }
    return originalTool(...args);
  };
}

/**
 * Parse a caller-supplied ResearchStore JSON string with structural checks —
 * a malformed payload must produce a readable error, not a raw SyntaxError
 * or a silently wrong cast.
 */
function parseResearchStore(raw: string): ResearchStore {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`research parameter is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("research parameter must be a JSON object (a ResearchStore), not a primitive or array");
  }
  const store = parsed as Partial<ResearchStore>;
  if (store.observations !== undefined && !Array.isArray(store.observations)) {
    throw new Error("research.observations must be an array when present");
  }
  if (store.findings !== undefined && !Array.isArray(store.findings)) {
    throw new Error("research.findings must be an array when present");
  }
  return parsed as ResearchStore;
}

function parseJsonParameter(raw: string, name: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${name} parameter is not valid JSON: ${(err as Error).message}`);
  }
}

function requireFigma(engine: MemoireEngine): void {
  if (!engine.figma.isConnected) {
    throw new Error("Figma not connected. Start the daemon (`memi daemon start`) or connect (`memi connect`) first.");
  }
}

export function registerTools(server: McpServer, engine: MemoireEngine): void {
  installSafeToolErrors(server);
  // ── pull_design_system ──────────────────────────────────
  server.tool(
    "pull_design_system",
    `Pull the full design system from Figma (tokens, components, styles) into the local registry.

Prereq: Figma bridge running + plugin connected — verify with check_bridge_health; start via \`memi connect\`.
Returns: { tokens, components, styles, lastSync }.
Errors: isError "Figma not connected" if no plugin. Run at session start or after designer changes; inspect results with get_tokens.`,
    {},
    async () => {
      requireFigma(engine);
      await engine.pullDesignSystem();
      const ds = engine.registry.designSystem;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            tokens: ds.tokens.length,
            components: ds.components.length,
            styles: ds.styles.length,
            lastSync: ds.lastSync,
          }),
        }],
      };
    },
  );

  // ── pull_design_system_rest ─────────────────────────────
  server.tool(
    "pull_design_system_rest",
    `Pull the design system from Figma via REST API — no plugin or bridge required.

Prereq: FIGMA_TOKEN and FIGMA_FILE_KEY env vars.
Returns: { tokens, components, styles, lastSync }.
Errors: missing env vars, or Figma API errors (403 = bad token, 404 = bad file key). Use in CI/headless; equivalent to \`memi pull --rest\`.`,
    {},
    async () => {
      await engine.pullDesignSystemREST();
      const ds = engine.registry.designSystem;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            tokens: ds.tokens.length,
            components: ds.components.length,
            styles: ds.styles.length,
            lastSync: ds.lastSync,
          }),
        }],
      };
    },
  );

  // ── get_specs ───────────────────────────────────────────
  server.tool(
    "get_specs",
    `List all saved specs (cheap summary operation).

Returns: [{ name, type: "component"|"page"|"dataviz"|"design"|"ia", purpose? }]; [] when none exist.
Use before create_spec (overwrite check) or generate_code; fetch a full body with get_spec.`,
    {},
    async () => {
      const specs = await engine.registry.getAllSpecs();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(specs.map((s) => ({
            name: s.name,
            type: s.type,
            purpose: "purpose" in s ? s.purpose : undefined,
          }))),
        }],
      };
    },
  );

  // ── get_spec ────────────────────────────────────────────
  server.tool(
    "get_spec",
    `Fetch the full body of one spec by name.

Returns: full spec JSON — ComponentSpec: atomicLevel, props, variants, composesSpecs, codeConnect, WCAG fields; PageSpec: sections, meta; DataVizSpec: chartType, dataShape.
Errors: isError if the name is not found (list names via get_specs).`,
    { name: z.string().describe("Name of the spec to retrieve (case-sensitive, matches the spec's 'name' field, not the filename). Use get_specs first to list available names.") },
    async ({ name }) => {
      const spec = await engine.registry.getSpec(name);
      if (!spec) {
        return { isError: true, content: [{ type: "text" as const, text: `Spec "${name}" not found` }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(spec) }] };
    },
  );

  // ── create_spec ─────────────────────────────────────────
  server.tool(
    "create_spec",
    `Create or overwrite a spec in the registry (Zod-validated). Same-name specs are silently overwritten — check get_specs first.

Returns: \`Spec "<name>" saved (<type>)\`.
Errors: isError with Zod details on schema/JSON/type failures.
Schemas — component: name, type, atomicLevel ("atom"|"molecule"|"organism"|"template"), purpose, props[], variants[], composesSpecs[] (atoms must be []), codeConnect{}; page: name, type, purpose, sections[]; dataviz: name, type, chartType, dataShape.`,
    { spec: z.string().describe("JSON string of the full spec object. Must include a 'type' field ('component', 'page', or 'dataviz') and all required fields for that spec type. Zod validation errors are returned as structured error messages if the shape is invalid.") },
    async ({ spec: specJson }) => {
      try {
        const raw = JSON.parse(specJson);
        let parsed;
        switch (raw.type) {
          case "component": parsed = ComponentSpecSchema.parse(raw); break;
          case "page": parsed = PageSpecSchema.parse(raw); break;
          case "dataviz": parsed = DataVizSpecSchema.parse(raw); break;
          default: return { isError: true, content: [{ type: "text" as const, text: `Unknown spec type: ${raw.type}. Must be component, page, or dataviz.` }] };
        }
        // Validate prop names are valid TypeScript identifiers
        if (raw.type === "component" && raw.props) {
          for (const key of Object.keys(raw.props as Record<string, unknown>)) {
            if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
              return { isError: true, content: [{ type: "text" as const, text: `Invalid prop name "${key}" — must be a valid TypeScript identifier (letters, numbers, _, $)` }] };
            }
          }
        }
        await engine.registry.saveSpec(parsed);
        return { content: [{ type: "text" as const, text: `Spec "${parsed.name}" saved (${parsed.type})` }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: `Failed to create spec: ${(err as Error).message}` }] };
      }
    },
  );

  // ── generate_code ───────────────────────────────────────
  server.tool(
    "generate_code",
    `Generate shadcn/ui + Tailwind code from a saved spec and write files into atomic design folders (atoms → components/ui/, molecules/organisms/templates → components/<level>/).

Returns: { entryFile, files[], generatedAt, findings[], critique? }. For page specs, critique is an AI layout score (0-100) + hierarchy/spacing/consistency notes when an AI provider is configured — informational only, never blocks.
Errors: isError if specName is not found. isError with { blocked: true, findings } if a critical quality-gate finding (raw hex/color when tokens exist, a token-pair contrast failure, or a strict-mode skill-compliance violation) prevented the write — pass force:true to write anyway after reviewing the findings.`,
    {
      specName: z.string().describe("Name of the spec to generate code for (case-sensitive, must match a spec returned by get_specs)."),
      force: z.boolean().optional().describe("Set true to write files despite critical quality-gate findings. Only pass this after reviewing the findings and intentionally deciding to override them."),
    },
    async ({ specName, force }) => {
      const result = await engine.generateFromSpec(specName, { force });
      if (result.blocked) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              blocked: true,
              findings: result.findings,
              message: "Generation blocked by quality gate. Fix the issue(s) below in the spec/design system, or call generate_code again with force: true to write anyway.",
            }),
          }],
        };
      }
      const gen = engine.registry.getGenerationState(specName);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            entryFile: result.entryFile,
            files: gen?.files ?? [],
            generatedAt: gen?.generatedAt,
            findings: gen?.findings ?? result.findings,
            critique: gen?.critique ?? result.critique ?? null,
          }),
        }],
      };
    },
  );

  // ── get_tokens ──────────────────────────────────────────
  server.tool(
    "get_tokens",
    `Get design tokens from the local registry, optionally filtered.

Prereq: none — local read; run pull_design_system if empty.
Returns: [{ name, type: "color"|"spacing"|"typography"|"radius"|"shadow"|"other", values (keyed by mode), cssVariable? }]; [] when none.
format "dtcg" returns the same tokens as a W3C Design Tokens (DTCG) document instead — nested groups, $type/$value, lossless via $extensions.
Filter by type/name to keep payloads small on large token sets. For a Tailwind-ready mapping use sync_design_tokens.`,
    {
      type: z.enum(["color", "spacing", "typography", "radius", "shadow", "other"]).optional().describe("Only return tokens of this type."),
      name: z.string().optional().describe("Case-insensitive substring filter on token names (e.g. 'primary')."),
      format: z.enum(["memi", "dtcg"]).default("memi").describe("Output format: \"memi\" = flat token array (default); \"dtcg\" = W3C Design Tokens document for interop with other DTCG tooling."),
    },
    async ({ type, name, format }) => {
      let tokens = engine.registry.designSystem.tokens;
      if (type) tokens = tokens.filter((t) => t.type === type);
      if (name) {
        const needle = name.toLowerCase();
        tokens = tokens.filter((t) => t.name.toLowerCase().includes(needle));
      }
      if (format === "dtcg") {
        const { toDtcg } = await import("../tokens/dtcg.js");
        return { content: [{ type: "text" as const, text: JSON.stringify(toDtcg(tokens)) }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(tokens),
        }],
      };
    },
  );

  // ── get_shadcn_registry ────────────────────────────────
  server.tool(
    "get_shadcn_registry",
    `Build a shadcn registry.json-compatible index from the workspace (component specs; tokens map to a registry:theme item when present).

Returns: { $schema, name, homepage, items[] } with file targets, registryDependencies, cssVars. For a single item use get_registry_item.`,
    {
      name: z.string().default("memoire").describe("Registry name to embed in the shadcn registry index."),
      homepage: z.string().url().optional().describe("Public homepage used to generate /r/*.json and Open-in-v0 metadata."),
    },
    async ({ name, homepage }) => {
      const specs = (await engine.registry.getAllSpecs()).filter((spec): spec is ComponentSpec => spec.type === "component");
      const registry = buildShadcnRegistry({
        name,
        homepage,
        designSystem: engine.registry.designSystem,
        specs,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(registry) }] };
    },
  );

  // ── get_registry_item ──────────────────────────────────
  server.tool(
    "get_registry_item",
    `Return one shadcn registry-item.json-compatible item from the workspace.

Returns: files, targets, dependencies, cssVars, and Atomic Design metadata.
Errors: isError if the item is unknown (discover names via get_shadcn_registry).`,
    {
      name: z.string().describe("Component spec name or shadcn item slug, e.g. Button or button."),
      homepage: z.string().url().optional().describe("Public homepage used to generate item URL and Open-in-v0 metadata."),
    },
    async ({ name, homepage }) => {
      const specs = (await engine.registry.getAllSpecs()).filter((spec): spec is ComponentSpec => spec.type === "component");
      const registry = buildShadcnRegistry({
        name: "memoire",
        homepage,
        designSystem: engine.registry.designSystem,
        specs,
      });
      const itemName = toShadcnItemName(name);
      const item = registry.items.find((candidate) => toShadcnItemName(candidate.name) === itemName);
      if (!item) {
        return { isError: true, content: [{ type: "text" as const, text: `Registry item "${name}" not found` }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(item) }] };
    },
  );

  // ── diagnose_app_quality ───────────────────────────────
  server.tool(
    "diagnose_app_quality",
    `Diagnose UI quality for an existing shadcn/Tailwind app from code or a public URL.

Returns on success: App-quality diagnosis V2 with scores, issues, evidence locations, affected files, confidence, effort estimates, fix categories, and app graph summary.

Use this tool: before planning UI fixes, exporting a registry, or giving an AI editor context on real app design debt.`,
    {
      target: z.string().optional().describe("Local path or public URL to scan. Defaults to the current project root."),
      maxFiles: z.number().int().min(1).max(5000).default(500).describe("Maximum source files to scan."),
      files: z.array(z.string()).optional().describe("PR scope: emit only issues touching these repo-relative files. Whole-tree stats/scores are still computed — this reduces noise, not runtime."),
    },
    async ({ target, maxFiles, files }) => {
      const diagnosis = await diagnoseAppQuality({
        projectRoot: engine.config.projectRoot,
        target,
        maxFiles,
        write: false,
        scope: files && files.length > 0 ? { files } : undefined,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(diagnosis) }] };
    },
  );

  // ── generate_health_report ──────────────────────────────
  server.tool(
    "generate_health_report",
    `Compose one self-contained design-health report (HTML + markdown) from all persisted .memoire audits — app quality, UX tenets/traps, interface craft, skill compliance, and the score trend, with provenance badges, the not-assessed legend, and the active policy hash.

Prereq: run diagnose_app_quality (or the CLI audits) first so artifacts exist; missing sections are listed, never silently omitted.
Returns: { html, markdown, score, sections[], missing[] }. Static content — write it wherever needed. redact=true strips evidence excerpts (paths stay) for NDA-safe sharing.`,
    {
      redact: z.boolean().optional().describe("Strip evidence excerpts — paths and counts only."),
    },
    async ({ redact }) => {
      const { composeReport } = await import("../reporters/report-html.js");
      const composed = await composeReport({ projectRoot: engine.config.projectRoot, redact });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            html: composed.html,
            markdown: composed.markdown,
            score: composed.score,
            sections: composed.sections,
            missing: composed.missing,
          }),
        }],
      };
    },
  );

  // ── check_skill_compliance ──────────────────────────────
  server.tool(
    "check_skill_compliance",
    `Check real source files for the objectively-checkable rules in skills/ATOMIC_DESIGN.md (composition, state, data-fetching, naming) and skills/MOTION_VIDEO_DESIGN.md (motion tokens, reduced-motion, GPU-safe properties) — a post-hoc, deterministic verification pass, the same mechanism a linter uses to enforce a style guide.

This does not read the skill docs at check time or make an agent obey markdown — the checkable rules are hand-extracted into regex/string checks. It closes the gap where nothing downstream ever notices whether an agent actually followed those docs. skills/DESIGN_SYSTEM_REFERENCE.md is a pure external-system catalog with zero checkable rules and contributes nothing here.

Prereq: none — no Figma, no AI, works entirely offline.
Returns: { version, target, generatedAt, findings: [{ severity, rule, file, message, fix?, docRef }], summary: { critical, warning, filesChecked } }.
Real enforcement requires wiring \`memi audit --skill-compliance\` into CI or a pre-commit hook — this MCP tool remains something an agent can choose not to call, same as any other tool.`,
    {
      target: z.string().optional().describe("Local path to scan. Defaults to the current project root."),
      maxFiles: z.number().int().min(1).max(5000).default(500).describe("Maximum source files to scan."),
    },
    async ({ target, maxFiles }) => {
      const diagnosis = await diagnoseAppQuality({
        projectRoot: engine.config.projectRoot,
        target,
        maxFiles,
        write: false,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(diagnosis.compliance) }] };
    },
  );

  // ── plan_ui_fixes ──────────────────────────────────────
  server.tool(
    "plan_ui_fixes",
    `Build a dry-run UI fix plan from diagnosis evidence and app graph data.

Returns on success: { patches[], summary, caveats[] } where every patch includes risk, confidence, affected files, operations, and writeSafe. This tool never modifies source files.

Use this tool: to decide what a human or coding agent should patch before calling memi fix apply or making manual edits.`,
    {
      target: z.string().optional().describe("Local path or public URL to scan. Defaults to the current project root."),
      maxFiles: z.number().int().min(1).max(5000).default(500).describe("Maximum source files to scan."),
    },
    async ({ target, maxFiles }) => {
      const plan = await buildUiFixPlan({
        projectRoot: engine.config.projectRoot,
        target,
        maxFiles,
        write: false,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(plan) }] };
    },
  );

  // ── audit_ux_tenets_traps ──────────────────────────────
  server.tool(
    "audit_ux_tenets_traps",
    `Audit UX tenets and traps from app-quality evidence or a screenshot artifact.

Returns on success: UX audit JSON with score, tenetCoverage, trapRisks, findings, and recommendedTweaks. This tool does not modify source files.

Use this tool: when an agent needs a focused design critique packet for clarity, feedback, control, consistency, accessibility, error recovery, progressive disclosure, workflow fit, trust, and state continuity.`,
    {
      target: z.string().optional().describe("Local path or public URL to scan. Defaults to the current project root."),
      screenshotPath: z.string().optional().describe("Optional screenshot artifact path to attach to the UX audit."),
      maxFiles: z.number().int().min(1).max(5000).default(500).describe("Maximum source files to scan when target evidence is used."),
    },
    async ({ target, screenshotPath, maxFiles }) => {
      if (screenshotPath) await assertReadableArtifact(screenshotPath);

      if (screenshotPath && !target) {
        const report = buildUxAuditReport({
          target: "screenshot",
          artifactPath: screenshotPath,
          source: "mcp",
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(report) }] };
      }

      const diagnosis = await diagnoseAppQuality({
        projectRoot: engine.config.projectRoot,
        target,
        maxFiles,
        write: false,
      });
      const auditContext = auditContextFromDiagnosis(diagnosis);
      const report = screenshotPath
        ? buildUxAuditReport({
          target: diagnosis.target,
          issues: diagnosis.issues,
          appQualityScore: diagnosis.summary.score,
          artifactPath: screenshotPath,
          source: "mcp",
          ...auditContext,
        })
        : diagnosis.ux;
      return { content: [{ type: "text" as const, text: JSON.stringify(report) }] };
    },
  );

  // ── audit_interface_craft ──────────────────────────────
  server.tool(
    "audit_interface_craft",
    `Audit interface design craft from local app-quality evidence or a screenshot artifact.

Returns: InterfaceCraftReport JSON — score, critique, dimensions, findings, topOpportunities (lenses: visual design, interface design, conventions, user context). Use before UI edits or after a redesign; pairs with diagnose_app_quality and audit_ux_tenets_traps.`,
    {
      target: z.string().optional().describe("Local path or public URL to scan. Defaults to the current project root."),
      screenshotPath: z.string().optional().describe("Optional screenshot artifact path to attach to the craft audit."),
      maxFiles: z.number().int().min(1).max(5000).default(500).describe("Maximum source files to scan when target evidence is used."),
    },
    async ({ target, screenshotPath, maxFiles }) => {
      if (screenshotPath) await assertReadableArtifact(screenshotPath);

      if (screenshotPath && !target) {
        const report = buildInterfaceCraftReport({
          target: "screenshot",
          artifactPath: screenshotPath,
          source: "mcp",
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(report) }] };
      }

      const diagnosis = await diagnoseAppQuality({
        projectRoot: engine.config.projectRoot,
        target,
        maxFiles,
        write: false,
      });
      const auditContext = auditContextFromDiagnosis(diagnosis);
      const report = buildInterfaceCraftReport({
        target: diagnosis.target,
        issues: diagnosis.issues,
        appQualityScore: diagnosis.summary.score,
        artifactPath: screenshotPath,
        source: "mcp",
        ...auditContext,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(report) }] };
    },
  );

  // ── prepare_design_agent_brief ─────────────────────────
  server.tool(
    "prepare_design_agent_brief",
    `Prepare a cost-aware design-agent brief before editing UI.

Returns on success: JSON with mission, evidenceCommands, designRules, costControls, compatibility installs, MCP command, Agent Skills command, and handoffChecklist.

Use this tool: as the first MCP call when a coding agent is asked to design, polish, audit, refactor, or generate interface code. It is local-first and does not call Figma, browsers, or models.`,
    {
      target: z.string().optional().describe("Local path or URL the agent should inspect. Defaults to '.'."),
      intent: z.string().optional().describe("Natural language product/design task to optimize the brief around."),
      mode: z.enum(DESIGN_AGENT_BRIEF_MODES).default("local").describe("Evidence mode: local, figma, research, or full."),
      agent: z.string().default("design-agent").describe("Agent stack to prioritize in compatibility guidance, such as codex, hermes, openclaw, cursor, or claude-code."),
      detail: z.enum(DESIGN_AGENT_BRIEF_DETAIL_LEVELS).default("standard").describe("Payload detail: compact for token-sensitive first turns, standard for runnable guidance, full for complete context."),
    },
    async ({ target, intent, mode, agent, detail }) => {
      const brief = buildDesignAgentBrief({
        projectRoot: engine.config.projectRoot,
        target,
        intent,
        mode,
        agent,
        detail,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(brief) }] };
    },
  );

  // ── prepare_apple_design_brief ─────────────────────────
  server.tool(
    "prepare_apple_design_brief",
    `Prepare a compact, local-first Apple-platform design and verification brief.

Returns: mission, skill triggers, availability policy, Xcode preflight, design checks, build/test commands, and handoff requirements.
Use before creating or changing SwiftUI, SwiftData, App Intents, Liquid Glass, or concurrency-sensitive UI. This tool does not run Xcode or mutate files.`,
    {
      platform: z.enum(APPLE_DESIGN_BRIEF_PLATFORMS).default("ios").describe("Apple platform to target: ios or macos."),
      intent: z.string().optional().describe("Product, interaction, or implementation intent used to select focused skills."),
      detail: z.enum(APPLE_DESIGN_BRIEF_DETAILS).default("compact").describe("Response size: compact, standard, or full."),
    },
    async ({ platform, intent, detail }) => {
      const brief = buildAppleDesignBrief({
        projectRoot: engine.config.projectRoot,
        platform,
        intent,
        detail,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(brief) }] };
    },
  );

  // ── scaffold_swiftui_files ─────────────────────────────
  server.tool(
    "scaffold_swiftui_files",
    `Preview or write a deterministic SwiftUI feature scaffold.

Default approved=false is non-mutating and returns every planned path and file body: Memi iOS spec, SwiftUI view, optional screen model, preview, and Swift Testing file.
Set approved=true only after reviewing the plan. Writes never alter Xcode project files and refuse to overwrite existing files.`,
    {
      name: z.string().describe("PascalCase feature or component type name, such as Settings or CommandBar."),
      kind: z.enum(SWIFTUI_SCAFFOLD_KINDS).default("screen").describe("screen creates model + view + test; component creates view + test."),
      moduleName: z.string().describe("Swift module imported by the generated @testable test target."),
      atomicLevel: z.enum(SWIFTUI_ATOMIC_LEVELS).default("molecule").describe("Atomic Design level for component scaffolds; screens are always page."),
      intent: z.string().optional().describe("Product and design intent recorded in the generated spec."),
      deploymentTarget: z.string().default("17.0").describe("Minimum iOS deployment target in major.minor form."),
      outputRoot: z.string().default("Sources").describe("Workspace-relative Swift source root."),
      testsRoot: z.string().default("Tests").describe("Workspace-relative Swift test root."),
      liquidGlass: z.boolean().default(false).describe("Add an iOS 26+ glassEffect branch with a native material fallback."),
      approved: z.boolean().default(false).describe("Must be true to write. false returns a complete dry-run plan."),
    },
    async ({ name, kind, moduleName, atomicLevel, intent, deploymentTarget, outputRoot, testsRoot, liquidGlass, approved }) => {
      const plan = buildSwiftUiScaffoldPlan({
        projectRoot: engine.config.projectRoot,
        name,
        kind,
        moduleName,
        atomicLevel,
        intent,
        deploymentTarget,
        outputRoot,
        testsRoot,
        liquidGlass,
        dryRun: !approved,
        approved,
      });
      const result = approved ? await writeSwiftUiScaffold(plan) : plan;
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  );

  // ── scaffold_agent_design_files ────────────────────────
  server.tool(
    "scaffold_agent_design_files",
    `Preview or write a spec-first Atomic Design scaffold for agent-created files.

Default is non-mutating: approved=false returns a dry-run JSON plan with the exact spec path, guardrails, and next generation commands.
To write the spec, pass approved=true. This writes only the registry spec; generated code still requires generate_code or memi generate, so quality gates stay intact.`,
    {
      kind: z.enum(["component", "page"]).describe("Scaffold kind. component writes specs/components/<Name>.json; page writes specs/pages/<Name>.json."),
      name: z.string().describe("Spec name. Must start with a letter and contain only letters, numbers, hyphens, or underscores."),
      purpose: z.string().optional().describe("Purpose copied into the generated spec."),
      intent: z.string().optional().describe("Agent task or product intent behind the scaffold."),
      level: z.enum(["atom", "molecule", "organism", "template"]).optional().describe("Atomic Design level for component scaffolds. Inferred when omitted."),
      layout: z.enum(["sidebar-main", "full-width", "centered", "split", "dashboard", "marketing"]).optional().describe("Page layout for page scaffolds."),
      shadcnBase: z.array(z.string()).default(["Card"]).describe("shadcn/ui base components for component scaffolds."),
      composesSpecs: z.array(z.string()).default([]).describe("Existing component specs this component composes. Invalid for atom scaffolds."),
      sections: z.array(z.object({
        name: z.string(),
        component: z.string(),
        layout: z.enum(["full-width", "half", "third", "quarter", "grid-2", "grid-3", "grid-4", "stack", "inline"]).optional(),
      })).default([]).describe("Page sections for page scaffolds."),
      approved: z.boolean().default(false).describe("Must be true to write the spec. false returns a dry-run plan."),
    },
    async ({ kind, name, purpose, intent, level, layout, shadcnBase, composesSpecs, sections, approved }) => {
      const plan = buildAgentFileScaffoldPlan({
        projectRoot: engine.config.projectRoot,
        kind,
        name,
        purpose,
        intent,
        level,
        layout,
        shadcnBase,
        composesSpecs,
        sections,
        dryRun: !approved,
        approved,
      });

      if (!approved) {
        return { content: [{ type: "text" as const, text: JSON.stringify(plan) }] };
      }

      await engine.registry.saveSpec(plan.spec);
      return { content: [{ type: "text" as const, text: JSON.stringify(markAgentFileScaffoldWritten(plan)) }] };
    },
  );

  // ── update_token ────────────────────────────────────────
  server.tool(
    "update_token",
    `Update a design token value in the local registry, optionally pushing to Figma.

Prereq: token must exist (names via get_tokens); Figma connection only for pushToFigma.
Returns: { updated: true, name, pushedToFigma, reason? } — a requested-but-skipped or failed push is reported in reason, never silently dropped.
Errors: isError if the token name is not found. For bulk Tailwind mapping use sync_design_tokens.`,
    {
      name: z.string().describe("Token name as it appears in get_tokens output (e.g. \"Colors/Primary\") or as a DTCG dot-path (e.g. \"colors.primary\") — exact match tried first, then case-insensitive path match."),
      values: z.record(z.union([z.string(), z.number()])).describe("Mode-to-value map to merge into existing values (e.g. { \"Light\": \"#FF0000\", \"Dark\": \"#FF6666\" }). Only the modes you provide are updated — other modes are preserved."),
      pushToFigma: z.boolean().default(false).describe("If true and Figma is connected, push this token change to the Figma file immediately. Defaults to false (local registry only)."),
    },
    async ({ name, values, pushToFigma }) => {
      const { normalizeTokenPath } = await import("../tokens/dtcg.js");
      const token = engine.registry.designSystem.tokens.find((t) => t.name === name)
        ?? engine.registry.designSystem.tokens.find((t) => normalizeTokenPath(t.name) === normalizeTokenPath(name));
      if (!token) {
        return { isError: true, content: [{ type: "text" as const, text: `Token "${name}" not found` }] };
      }
      const updated = { ...token, values: { ...token.values, ...values } };
      engine.registry.updateToken(name, updated);

      let pushedToFigma = false;
      let reason: string | undefined;
      if (pushToFigma) {
        if (!engine.figma.isConnected) {
          reason = "Figma not connected — push skipped, local update applied";
        } else {
          try {
            await engine.figma.pushTokens([{ name: updated.name, values: updated.values }]);
            pushedToFigma = true;
          } catch (err) {
            reason = `Figma push failed: ${(err as Error).message} — local update applied`;
          }
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ updated: true, name, pushedToFigma, ...(reason ? { reason } : {}) }),
        }],
      };
    },
  );

  // ── capture_screenshot ──────────────────────────────────
  server.tool(
    "capture_screenshot",
    `Capture a screenshot of a Figma node (or the current page) as image data.

Prereq: bridge + plugin connected (check_bridge_health); node IDs from get_selection or get_page_tree.
Returns: { type: "image", data: base64, mimeType }. Feed into analyze_design; first step of the self-heal loop (CREATE → SCREENSHOT → ANALYZE → FIX). Prefer SVG for vector components, PNG for complex frames.
Errors: isError if not connected or the node is invalid.`,
    {
      nodeId: z.string().optional().describe("Figma node ID to capture (e.g. '123:456'). Omit to capture the entire current page. Obtain IDs from get_selection or get_page_tree."),
      format: z.enum(["PNG", "SVG"]).default("PNG").describe("Export format. PNG for raster output (default, works for all node types). SVG for vector output (best for icons and simple components)."),
      scale: z.number().min(0.5).max(4).default(2).describe("Export scale multiplier (default 2 = @2x, max 4). Use 1 for quick inspection, 2–3 for high-quality analysis."),
    },
    async ({ nodeId, format, scale }) => {
      requireFigma(engine);
      const result = await engine.figma.captureScreenshot(nodeId, format, scale);
      return {
        content: [{
          type: "image" as const,
          data: result.base64,
          mimeType: format === "SVG" ? "image/svg+xml" : "image/png",
        }],
      };
    },
  );

  // ── get_selection ───────────────────────────────────────
  server.tool(
    "get_selection",
    `Get the nodes currently selected in Figma with layout/style details.

Prereq: bridge + plugin connected; returns [] if nothing is selected.
Returns: [{ id, name, type, width, height, x, y, layoutMode?, padding/sizing/itemSpacing?, fills?, strokes?, effects?, styles?, variantProperties? }]. Use for node IDs (capture_screenshot, analyze_design) or reading layout/variants before writing a spec.
Errors: isError if not connected.`,
    {},
    async () => {
      requireFigma(engine);
      const selection = await engine.figma.getSelection();
      return { content: [{ type: "text" as const, text: JSON.stringify(selection) }] };
    },
  );

  // ── compose ─────────────────────────────────────────────
  server.tool(
    "compose",
    `Run the agent orchestrator on a natural-language design intent — classifies, builds a multi-step plan, executes it.

Prereq: Figma bridge only for Figma-touching intents.
Returns: { success, plan: { steps[] }, results[], summary, errors? }; success=false with errors on failure (per-step failures do not abort the plan).
Examples: "create a dashboard page with KPI cards, a chart, and a data table"; "audit button variants for WCAG contrast"; "pull design system, then generate all missing component specs". Be specific — name components, atomic levels, and target output.`,
    {
      intent: z.string().describe("Natural language design task. Be specific about what to create, modify, or check. Include atomic level if relevant (atom/molecule/organism/template/page), component names, and target output (spec, code, audit). Examples: 'create a KPI card atom with value, label, and trend props', 'audit all organism specs for WCAG 2.2 compliance', 'generate the LoginPage template from the AuthForm organism spec'."),
      dryRun: z.boolean().default(false).describe("If true, returns the execution plan without running any steps. Use to inspect what the orchestrator intends to do before committing. Defaults to false."),
    },
    async ({ intent, dryRun }) => {
      const orchestrator = new AgentOrchestrator(engine);
      const result = await orchestrator.execute(intent, { dryRun });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  );

  // ── run_audit ───────────────────────────────────────────
  server.tool(
    "run_audit",
    `Run a deterministic design-system audit (WCAG contrast, token completeness, spec accessibility) and return structured findings.

Prereq: none — token/spec level, no Figma, no AI.
Returns: { success, results: issues[], score, level, summary }. focus="contrast" narrows to token contrast pairs; focus="skill-compliance" checks real source files against ATOMIC_DESIGN.md/MOTION_VIDEO_DESIGN.md's checkable rules.
vs analyze_design: run_audit = systematic spec/token compliance; analyze_design = AI vision review of a live Figma frame.`,
    {
      focus: z.string().optional().describe("Optional focus area to narrow the audit scope. Examples: 'accessibility' (runs all 5 WCAG checks), 'token coverage' (checks which components use design tokens vs hardcoded values), 'naming' (validates spec name conventions), 'contrast' (color contrast only), 'skill-compliance' (checks ATOMIC_DESIGN.md composition/state/data-fetching/naming rules and MOTION_VIDEO_DESIGN.md token/reduced-motion/GPU-property rules against real source files), 'touch-targets' (interactive element sizing only). Omit to run the full default audit suite."),
      target: z.string().optional().describe("Local path to scan when focus='skill-compliance'. Defaults to the current project root."),
      maxFiles: z.number().int().min(1).max(5000).default(500).describe("Maximum source files to scan when focus='skill-compliance'."),
    },
    async ({ focus, target, maxFiles }) => {
      try {
        // Deterministic path — run the real checkers directly instead of
        // routing a deterministic-sounding contract through an LLM planner.
        const designSystem = engine.registry.designSystem;
        const specs = await engine.registry.getAllSpecs();

        if (focus === "contrast") {
          const issues = auditTokenContrast(designSystem.tokens);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                results: issues,
                summary: `${issues.length} contrast issue(s) across ${designSystem.tokens.length} tokens`,
              }),
            }],
          };
        }

        if (focus === "skill-compliance") {
          const diagnosis = await diagnoseAppQuality({
            projectRoot: engine.config.projectRoot,
            target,
            maxFiles,
            write: false,
          });
          const compliance = diagnosis.compliance;
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                results: compliance?.findings ?? [],
                summary: compliance
                  ? `${compliance.summary.critical} critical, ${compliance.summary.warning} warning finding(s) across ${compliance.summary.filesChecked} files`
                  : "No files scanned",
              }),
            }],
          };
        }

        const report = runFullAudit(designSystem, specs);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              results: report.issues,
              score: report.score,
              level: report.level,
              summary: `Score ${report.score}/100 (WCAG ${report.level}) — ${report.failed} failed, ${report.warnings} warnings across ${specs.length} specs and ${designSystem.tokens.length} tokens${focus ? ` (focus: ${focus})` : ""}`,
            }),
          }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `run_audit failed: ${(err as Error).message}` }],
        };
      }
    },
  );

  // ── design_systems_context ──────────────────────────────
  server.tool(
    "design_systems_context",
    `Normalize design-systems-mcp corpus data into compact, deterministic agent context.

This read-only tool validates caller-supplied JSON and never fetches URLs, reads files, writes files, or executes corpus content. Use mode=corpus with a native manifest plus filename-keyed entries, or mode=category with the proposed category-manifest/v1 envelope. Returns byte-capped context plus inclusion counts.`,
    {
      mode: z.enum(["corpus", "category"]).describe("Native corpus manifest plus entries, or category-manifest/v1."),
      manifest: z.string().min(2).describe("Manifest JSON string."),
      entries: z.string().optional().describe("Filename-keyed entry JSON object. Required only for mode=corpus."),
      category: z.enum(DESIGN_SYSTEMS_MCP_CATEGORIES).optional().describe("Optional category filter for mode=corpus."),
      maxBytes: z.number().int().min(256).max(64_000).optional(),
      maxEntries: z.number().int().min(1).max(50).optional(),
      summaryCharacters: z.number().int().min(40).max(1_000).optional(),
    },
    async ({ mode, manifest, entries, category, maxBytes, maxEntries, summaryCharacters }) => {
      const parsedManifest = parseJsonParameter(manifest, "manifest");
      const limits = { maxBytes, maxEntries, summaryCharacters };
      const context = mode === "category"
        ? normalizeDesignSystemsMcpCategoryManifest(parsedManifest, limits)
        : normalizeDesignSystemsMcpCorpus({
          manifest: parsedManifest,
          entries: parseJsonParameter(entries ?? "", "entries"),
        }, { ...limits, category });
      return { content: [{ type: "text" as const, text: JSON.stringify(context) }] };
    },
  );

  // ── get_research ────────────────────────────────────────
  server.tool(
    "get_research",
    `Load and return the project's user research V2 store — observations, findings, personas, themes, quantitative metrics, and quality metadata.

Prerequisites: None — reads from the local .memoire/research/ directory. Research data is populated by running \`memi research from-file\`, \`memi research from-stickies\`, \`memi research from-transcript\`, \`memi research web\`, or \`memi research synthesize\`. Returns an empty V2 store if no research has been imported yet.

Returns on success: Research store object with shape { version, sources, observations, findings, themes, personas, quantitativeMetrics, opportunities, risks, contradictions, quality, summary, methods }. Findings include auditable evidence links via \`evidenceObservationIds\` and \`evidenceSourceIds\`. Themes reference \`findingIds[]\`.

Error behavior: Never throws — loads gracefully and returns an empty store if files are missing.

Use this tool: before running compose with a research-driven intent (e.g. "generate a dashboard based on user research"), to inspect what research context is available, or to verify that a research import or synthesis succeeded. Combine with compose to ground design decisions in actual user data. Research stores grow large — request only the sections you need (default is a summary with per-section counts).`,
    {
      sections: z.array(z.enum([
        "sources", "observations", "findings", "themes", "personas",
        "quantitativeMetrics", "opportunities", "risks", "contradictions",
        "quality", "summary", "methods",
      ])).optional().describe("Sections to include in full. Omit for a lightweight overview: summary + per-section counts. Pass the sections you actually need to keep the payload small."),
    },
    async ({ sections }) => {
      await engine.research.load();
      const store = engine.research.getStore() as unknown as Record<string, unknown>;

      if (!sections || sections.length === 0) {
        const counts: Record<string, number> = {};
        for (const key of ["sources", "observations", "findings", "themes", "personas", "quantitativeMetrics", "opportunities", "risks", "contradictions"]) {
          const value = store[key];
          counts[key] = Array.isArray(value) ? value.length : 0;
        }
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              version: store.version,
              summary: store.summary,
              quality: store.quality,
              counts,
              hint: "Pass sections: [\"findings\", ...] to fetch full section content.",
            }),
          }],
        };
      }

      const picked: Record<string, unknown> = { version: store.version };
      for (const key of sections) picked[key] = store[key];
      return { content: [{ type: "text" as const, text: JSON.stringify(picked) }] };
    },
  );

  // ── research_design_package ─────────────────────────────
  server.tool(
    "research_design_package",
    `Preview a research-backed vibe design package from ResearchStore V2 plus an optional simulation run.

Returns on success: { package } with brief, Atomic Design specs, evidence ids, Mermaid Jam-ready source artifacts, and warnings. This tool is non-mutating; call research_generate_specs to write specs or mermaid_jam_export to write FigJam source files.`,
    {
      intent: z.string().optional().describe("Design intent for the package."),
      hypothesis: z.string().optional().describe("Product/design hypothesis to ground generated specs."),
      runId: z.string().optional().describe("Optional simulation run id to fold report recommendations and timeline into the package."),
      research: z.string().optional().describe("Optional ResearchStore JSON string. Omit to load workspace research."),
    },
    async ({ intent, hypothesis, runId, research }) => {
      const store = research ? parseResearchStore(research) : await loadMcpResearchStore(engine);
      const simulationReport = runId ? await loadMcpSimulationReport(engine.config.projectRoot, runId) : null;
      const designPackage = buildResearchDesignPackage(store, { intent, hypothesis, simulationReport });
      return { content: [{ type: "text" as const, text: JSON.stringify({ package: designPackage }) }] };
    },
  );

  server.tool(
    "research_generate_specs",
    `Write research-backed Atomic Design specs generated from ResearchStore V2.

Prerequisites: Call research_design_package first to preview. This tool requires approved=true to make the write explicit. Writes DesignSpec, IASpec, PageSpec, ComponentSpec, and DataVizSpec objects through the Memoire registry.`,
    {
      intent: z.string().optional(),
      hypothesis: z.string().optional(),
      runId: z.string().optional(),
      research: z.string().optional().describe("Optional ResearchStore JSON string. Omit to load workspace research."),
      approved: z.boolean().default(false).describe("Must be true to write generated specs."),
    },
    async ({ intent, hypothesis, runId, research, approved }) => {
      if (!approved) {
        return { isError: true, content: [{ type: "text" as const, text: "Approval required: pass approved=true to write generated research specs." }] };
      }
      const store = research ? parseResearchStore(research) : await loadMcpResearchStore(engine);
      const simulationReport = runId ? await loadMcpSimulationReport(engine.config.projectRoot, runId) : null;
      const designPackage = buildResearchDesignPackage(store, { intent, hypothesis, simulationReport });
      const specWrite = await saveResearchDesignSpecs(designPackage, engine.registry);
      return { content: [{ type: "text" as const, text: JSON.stringify({ package: designPackage, specWrite }) }] };
    },
  );

  server.tool(
    "mermaid_jam_export",
    `Write Mermaid Jam-ready FigJam source artifacts from research or a simulation run.

This is source + open friendly: it writes .mmd/.md files under .memoire/mermaid-jam and returns next steps. It does not attempt clipboard or direct paste automation.`,
    {
      source: z.string().default("research").describe("Use 'research' or a simulation run id."),
      intent: z.string().optional(),
      hypothesis: z.string().optional(),
      research: z.string().optional().describe("Optional ResearchStore JSON string. Omit to load workspace research."),
    },
    async ({ source, intent, hypothesis, research }) => {
      const store = research ? parseResearchStore(research) : await loadMcpResearchStore(engine);
      const simulationReport = source && source !== "research"
        ? await loadMcpSimulationReport(engine.config.projectRoot, source)
        : null;
      const designPackage = buildResearchDesignPackage(store, { intent, hypothesis, simulationReport });
      const integration = await resolveMermaidJamIntegration({ projectRoot: engine.config.projectRoot });
      const exports = await writeMermaidJamArtifacts(designPackage, { projectRoot: engine.config.projectRoot, integration });
      return { content: [{ type: "text" as const, text: JSON.stringify({ package: designPackage, exports, integration }) }] };
    },
  );

  // ── simulation_models ───────────────────────────────────
  server.tool(
    "simulation_models",
    `List Codex-first model profiles available to Memoire model-swarm simulations. Live model execution is opt-in; unavailable providers automatically fall back to deterministic clean-room simulation.`,
    {},
    async () => {
      const profiles = new SimulationModelRouter().listProfiles();
      return { content: [{ type: "text" as const, text: JSON.stringify({ profiles }) }] };
    },
  );

  server.tool(
    "simulation_list_runs",
    `List persisted simulation runs with lightweight summaries. Use this to discover runIds for simulation_status, simulation_stream, simulation_transcript, simulation_costs, simulation_report, and simulation_compare.`,
    {},
    async () => {
      const store = new FileSimulationStore(engine.config.projectRoot);
      const runs = await store.listRuns();
      const summaries = runs.map((run) => ({
        id: run.id,
        scenarioId: run.scenarioId,
        adapter: run.adapter,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        eventCount: run.eventCount,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify({ runs: summaries }) }] };
    },
  );

  server.tool(
    "simulation_generate_agents",
    `Generate a 20-60 agent model-swarm cohort from Memoire research evidence without starting a run.`,
    {
      count: z.number().int().min(1).max(60).optional().describe("Target agent count. Model-swarm defaults to 24."),
      adapter: z.enum(["local", "model-swarm"]).optional().describe("Adapter mode. Defaults to model-swarm."),
      research: z.string().optional().describe("Optional ResearchStore JSON string. Omit to load workspace research."),
    },
    async ({ count, adapter, research }) => {
      const store = research ? parseResearchStore(research) : await loadMcpResearchStore(engine);
      const scenario = buildProductSimulationScenarioFromResearch(store, {
        adapter: adapter ?? "model-swarm",
        agentCount: count ?? (adapter === "local" ? undefined : 24),
      });
      return { content: [{ type: "text" as const, text: JSON.stringify({ agents: scenario.agents, graph: scenario.graph, budget: scenario.metadata.budget }) }] };
    },
  );

  // ── simulation_plan ─────────────────────────────────────
  server.tool(
    "simulation_plan",
    `Create a clean-room product simulation scenario from Memoire research evidence.

Prereq: research/store.v2.json or a ResearchStore JSON string. Local TypeScript simulation core only; adapter=model-swarm plans Codex-first profiles with deterministic fallback.
Returns: { scenario (agents, variables, graph, evidenceFindingIds), warnings }.`,
    {
      name: z.string().optional().describe("Scenario name. Defaults to the top research theme."),
      hypothesis: z.string().optional().describe("Product hypothesis to pressure-test."),
      research: z.string().optional().describe("Optional ResearchStore JSON string. Omit to load the current workspace research store."),
      adapter: z.enum(["local", "model-swarm"]).optional().describe("Adapter mode. Defaults to local."),
      agentCount: z.number().int().min(1).max(60).optional().describe("Target model-swarm agent count."),
      maxAgents: z.number().int().min(1).max(60).optional().describe("Run budget max agents."),
      rounds: z.number().int().min(1).max(12).optional().describe("Run budget max rounds."),
    },
    async ({ name, hypothesis, research, adapter, agentCount, maxAgents, rounds }) => {
      const store = research ? parseResearchStore(research) : await loadMcpResearchStore(engine);
      const adapterKind = adapter ?? "local";
      const budget = budgetFromMcp({ maxAgents, rounds });
      const scenario = buildProductSimulationScenarioFromResearch(store, {
        name,
        hypothesis,
        adapter: adapterKind,
        agentCount: agentCount ?? (adapterKind === "model-swarm" ? 24 : undefined),
        budget,
        modelProfiles: adapterKind === "model-swarm" ? new SimulationModelRouter().listProfiles() : [],
      });
      const simulationAdapter = createMcpSimulationAdapter(engine.config.projectRoot, adapterKind, budget);
      const prepared = await simulationAdapter.prepare(scenario);
      return { content: [{ type: "text" as const, text: JSON.stringify(prepared) }] };
    },
  );

  server.tool(
    "simulation_run",
    `Run a prepared local or model-swarm product simulation scenario.

Prerequisites: Call simulation_plan first and pass the returned scenario.id.

Returns on success: SimulationRun with status, events, eventCount, and persisted run id.`,
    {
      scenarioId: z.string().describe("Scenario id returned by simulation_plan."),
      adapter: z.enum(["local", "model-swarm"]).optional().describe("Adapter mode. Defaults to the scenario adapter."),
      maxAgents: z.number().int().min(1).max(60).optional(),
      rounds: z.number().int().min(1).max(12).optional(),
      allowLiveModels: z.boolean().optional().describe("Opt into live provider calls. Defaults to false."),
    },
    async ({ scenarioId, adapter, maxAgents, rounds, allowLiveModels }) => {
      const store = new FileSimulationStore(engine.config.projectRoot);
      const scenario = await store.loadScenario(scenarioId);
      const adapterKind = adapter ?? scenario?.adapter ?? "local";
      const run = await createMcpSimulationAdapter(engine.config.projectRoot, adapterKind, budgetFromMcp({ maxAgents, rounds, allowLiveModels })).start(scenarioId);
      return { content: [{ type: "text" as const, text: JSON.stringify({ run }) }] };
    },
  );

  server.tool(
    "simulation_run_matrix",
    `Plan and run multiple model-swarm hypotheses, then compare outcomes for product-spec decision work.`,
    {
      hypotheses: z.array(z.string()).min(1).describe("Hypotheses to run."),
      maxAgents: z.number().int().min(1).max(60).optional(),
      rounds: z.number().int().min(1).max(12).optional(),
      research: z.string().optional().describe("Optional ResearchStore JSON string."),
    },
    async ({ hypotheses, maxAgents, rounds, research }) => {
      const store = research ? parseResearchStore(research) : await loadMcpResearchStore(engine);
      const budget = budgetFromMcp({ maxAgents, rounds });
      const adapter = createMcpSimulationAdapter(engine.config.projectRoot, "model-swarm", budget);
      const runs = [];
      for (let index = 0; index < hypotheses.length; index += 1) {
        const scenario = buildProductSimulationScenarioFromResearch(store, {
          adapter: "model-swarm",
          name: `MCP simulation matrix ${index + 1}`,
          hypothesis: hypotheses[index],
          agentCount: maxAgents ?? 24,
          budget,
          modelProfiles: new SimulationModelRouter().listProfiles(),
        });
        const prepared = await adapter.prepare(scenario);
        const run = await adapter.start(prepared.scenario.id);
        runs.push({ hypothesis: hypotheses[index], scenario: prepared.scenario, run });
      }
      const comparison = compareSimulationRuns(runs.map((entry) => entry.run));
      return { content: [{ type: "text" as const, text: JSON.stringify({ runs, comparison }) }] };
    },
  );

  server.tool(
    "simulation_stream",
    `Read persisted simulation events in stream order. Paginated — use offset/limit to page through long runs instead of materializing the full event log.`,
    {
      runId: z.string().describe("Simulation run id."),
      offset: z.number().int().min(0).default(0).describe("Skip this many events from the start."),
      limit: z.number().int().min(1).max(1000).default(200).describe("Maximum events to return (default 200)."),
    },
    async ({ runId, offset, limit }) => {
      const adapter = await createMcpAdapterForRun(engine.config.projectRoot, runId);
      const events = [];
      let index = 0;
      let total = 0;
      for await (const event of adapter.stream(runId)) {
        total++;
        if (index >= offset && events.length < limit) events.push(event);
        index++;
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ events, offset, limit, total, hasMore: offset + events.length < total }),
        }],
      };
    },
  );

  server.tool(
    "simulation_status",
    `Read a local simulation run status from .memoire/simulations/runs.`,
    {
      runId: z.string().describe("Simulation run id."),
    },
    async ({ runId }) => {
      const store = new FileSimulationStore(engine.config.projectRoot);
      const run = await store.loadRun(runId);
      if (!run) return { isError: true, content: [{ type: "text" as const, text: `Unknown simulation run: ${runId}` }] };
      return { content: [{ type: "text" as const, text: JSON.stringify({ run }) }] };
    },
  );

  server.tool(
    "simulation_interview",
    `Interview a simulated product stakeholder from a completed local or model-swarm run.`,
    {
      runId: z.string().describe("Simulation run id."),
      agentId: z.string().describe("Agent id from the scenario."),
      prompt: z.string().describe("Question to ask the simulated agent."),
    },
    async ({ runId, agentId, prompt }) => {
      const adapter = await createMcpAdapterForRun(engine.config.projectRoot, runId);
      const interview = await adapter.interview(runId, { agentId, prompt });
      return { content: [{ type: "text" as const, text: JSON.stringify({ interview }) }] };
    },
  );

  server.tool(
    "simulation_transcript",
    `Read model-swarm transcript memory for a run.`,
    { runId: z.string().describe("Simulation run id.") },
    async ({ runId }) => {
      const store = new FileSimulationStore(engine.config.projectRoot);
      const run = await store.loadRun(runId);
      if (!run) return { isError: true, content: [{ type: "text" as const, text: `Unknown simulation run: ${runId}` }] };
      return { content: [{ type: "text" as const, text: JSON.stringify({ transcripts: run.transcripts }) }] };
    },
  );

  server.tool(
    "simulation_compare",
    `Compare completed simulation runs by adoption, confidence, evidence coverage, risk, and cost.`,
    { runIds: z.array(z.string()).min(1).describe("Simulation run ids.") },
    async ({ runIds }) => {
      const store = new FileSimulationStore(engine.config.projectRoot);
      const runs = await Promise.all(runIds.map(async (runId) => {
        const run = await store.loadRun(runId);
        if (!run) throw new Error(`Unknown simulation run: ${runId}`);
        return run;
      }));
      const comparison = compareSimulationRuns(runs);
      return { content: [{ type: "text" as const, text: JSON.stringify({ comparison }) }] };
    },
  );

  server.tool(
    "simulation_costs",
    `Summarize token and cost usage for a simulation run.`,
    { runId: z.string().describe("Simulation run id.") },
    async ({ runId }) => {
      const store = new FileSimulationStore(engine.config.projectRoot);
      const run = await store.loadRun(runId);
      if (!run) return { isError: true, content: [{ type: "text" as const, text: `Unknown simulation run: ${runId}` }] };
      return { content: [{ type: "text" as const, text: JSON.stringify({ costs: simulationCosts(run) }) }] };
    },
  );

  server.tool(
    "simulation_report",
    `Export a simulation report with recommendations, risks, assumptions, events, interviews, and evidenceFindingIds.`,
    {
      runId: z.string().describe("Simulation run id."),
    },
    async ({ runId }) => {
      const adapter = await createMcpAdapterForRun(engine.config.projectRoot, runId);
      const report = await adapter.exportReport(runId);
      return { content: [{ type: "text" as const, text: JSON.stringify({ report }) }] };
    },
  );

  server.tool(
    "simulation_export_spec",
    `Convert a simulation report into a product-spec impact artifact that agents can paste into specs or handoff docs.`,
    {
      runId: z.string().describe("Simulation run id."),
    },
    async ({ runId }) => {
      const adapter = await createMcpAdapterForRun(engine.config.projectRoot, runId);
      const report = await adapter.exportReport(runId);
      const spec = exportProductSpecFromRun(report);
      return { content: [{ type: "text" as const, text: JSON.stringify({ spec }) }] };
    },
  );

  // ── analyze_design ──────────────────────────────────────
  server.tool(
    "analyze_design",
    `Capture a Figma node and analyze it with configured AI vision.

Prereq: bridge + plugin connected; a vision-capable AI provider configured; spec-compliance mode needs the spec in the registry.
Returns by mode — general: { summary, issues[], suggestions[], qualityScore }; accessibility: { summary, contrastIssues[], touchTargetIssues[], focusIssues[], wcagLevel }; spec-compliance: { summary, compliant, mismatches[], missingProps[], extraElements[] }.
Errors: isError on missing key, no connection, bad node, or missing spec.
Modes: general = visual polish; accessibility = WCAG checks of a frame; spec-compliance = rendered design vs saved spec before codegen. Core of the self-heal loop: create → capture_screenshot → analyze_design → fix → verify.`,
    {
      nodeId: z.string().optional().describe("Figma node ID to capture and analyze (e.g. '123:456'). Omit to capture the entire current page. Obtain IDs from get_selection or get_page_tree."),
      mode: z.enum(["general", "accessibility", "spec-compliance"]).default("general").describe("Analysis mode: 'general' for visual quality and polish, 'accessibility' for WCAG contrast/touch/focus checks, 'spec-compliance' to verify the design matches a saved spec (requires specName)."),
      specName: z.string().optional().describe("Name of the spec to compare against (required when mode='spec-compliance'). Use get_specs to list available spec names."),
    },
    async ({ nodeId, mode, specName }) => {
      requireFigma(engine);
      const ai = getAI();
      if (!ai) {
        return { isError: true, content: [{ type: "text" as const, text: "No AI provider configured — AI vision requires Anthropic, OpenAI, or a vision-capable compatible endpoint" }] };
      }

      const screenshot = await engine.figma.captureScreenshot(nodeId, "PNG", 2);
      const analyzer = new DesignAnalyzer(ai);

      let analysis;
      switch (mode) {
        case "accessibility":
          analysis = await analyzer.auditAccessibility(screenshot.base64);
          break;
        case "spec-compliance": {
          if (!specName) {
            return { isError: true, content: [{ type: "text" as const, text: "specName required for spec-compliance mode" }] };
          }
          const spec = await engine.registry.getSpec(specName);
          if (!spec) {
            return { isError: true, content: [{ type: "text" as const, text: `Spec "${specName}" not found` }] };
          }
          analysis = await analyzer.checkSpecCompliance(screenshot.base64, JSON.stringify(spec), engine.registry.designSystem);
          break;
        }
        default:
          analysis = await analyzer.analyzeDesign(screenshot.base64);
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(analysis) }] };
    },
  );

  // ── get_page_tree ───────────────────────────────────────
  server.tool(
    "get_page_tree",
    `Get the hierarchical node tree of the current Figma file.

Prereq: bridge + plugin connected.
Returns: array of pages { id, name, type: "PAGE", children[] }; child nodes { id, name, type, children? }. IDs feed capture_screenshot and analyze_design.
depth=1 pages only, 2 (default) top-level frames, 3+ component internals — high depths may be slow on large files.`,
    { depth: z.number().int().min(1).max(8).default(2).describe("Maximum tree depth to traverse (default 2, max 8). Depth 1 = pages only, depth 2 = pages + top-level frames, depth 3+ = deeper into component trees. Large files at depth 4+ may be slow.") },
    async ({ depth }) => {
      requireFigma(engine);
      const tree = await engine.figma.getPageTree(depth);
      return { content: [{ type: "text" as const, text: JSON.stringify(tree) }] };
    },
  );

  // ── measure_text ───────────────────────────────────────
  server.tool(
    "measure_text",
    `Predict text layout — height, line count, overflow, breakpoint behavior — via Node canvas. No browser, Figma, or AI needed.

Returns: { height, lineCount, lines[] }; plus { overflow } when containerHeight is given; plus { breakpoints: { mobile, tablet, desktop } } when checkBreakpoints=true. Never throws (0 height / 1 line for unparseable fonts).
Use to verify labels or body copy fit fixed containers or maxLines constraints before generating designs or code.`,
    {
      text: z.string().describe("The text content to measure. Include all characters including newlines if the source content has them."),
      maxWidth: z.number().describe("Maximum container width in pixels for line wrapping calculations."),
      font: z.string().default("16px sans-serif").describe("CSS font shorthand string used for measurement (e.g. '16px Inter', 'bold 14px sans-serif', '500 13px/1.4 system-ui'). Use the same font as your target UI for accurate results."),
      lineHeight: z.number().optional().describe("Line height in pixels. Defaults to fontSize × 1.5 if omitted. Provide this to match your Tailwind leading-* or Figma line height setting."),
      containerHeight: z.number().optional().describe("If provided, checks whether the measured text fits within this height (in pixels) and reports overflow. Omit if you only need dimensions."),
      checkBreakpoints: z.boolean().default(false).describe("If true, also measures text at mobile (375px), tablet (768px), and desktop (1280px) widths in addition to maxWidth. Useful for responsive overflow detection."),
    },
    async ({ text, maxWidth, font, lineHeight, containerHeight, checkBreakpoints: doBreakpoints }) => {
      const { getTextMeasurer } = await import("../engine/text-measurer.js");
      const measurer = getTextMeasurer();

      const result: Record<string, unknown> = {};

      // Basic measurement
      const measurement = measurer.measureDetailed(text, { maxWidth, font, lineHeight });
      result.height = measurement.height;
      result.lineCount = measurement.lineCount;
      result.lines = measurement.lines;

      // Overflow check
      if (containerHeight !== undefined) {
        const overflow = measurer.checkOverflow(text, { maxWidth, font, lineHeight, containerHeight });
        result.overflow = overflow;
      }

      // Breakpoint analysis
      if (doBreakpoints) {
        const breakpoints = measurer.checkBreakpoints(text, { font, lineHeight, containerHeight });
        result.breakpoints = breakpoints;
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  );

  // ── sync_design_tokens ─────────────────────────────────
  server.tool(
    "sync_design_tokens",
    `Map registry tokens to a Tailwind theme.extend object; optionally import a W3C DTCG token file first.

Prereq: tokens in the registry (pull_design_system first) — or pass dtcgFile to import them here. Never throws — returns {} when empty.
Returns: partial theme (colors, spacing, fontSize, borderRadius, boxShadow) using var(--token) references; keys from the last token-name segment; "other" tokens skipped. With dtcgFile also { imported, warnings }.
vs get_tokens: get_tokens = raw data for inspection (format "dtcg" exports the DTCG document); this = paste-ready Tailwind patch.`,
    {
      dtcgFile: z.string().optional().describe("Path to a W3C Design Tokens (.tokens.json / DTCG) file to import into the registry before mapping. Upserts by token name; parse warnings are returned, never silently dropped."),
    },
    async ({ dtcgFile }) => {
      let imported: number | undefined;
      let importWarnings: string[] | undefined;
      if (dtcgFile) {
        const { readFile } = await import("node:fs/promises");
        const { fromDtcg, isDtcgDocument } = await import("../tokens/dtcg.js");
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readFile(dtcgFile, "utf-8"));
        } catch (err) {
          return { isError: true, content: [{ type: "text" as const, text: `Could not read DTCG file "${dtcgFile}": ${(err as Error).message}` }] };
        }
        if (!isDtcgDocument(parsed)) {
          return { isError: true, content: [{ type: "text" as const, text: `"${dtcgFile}" is not a DTCG document — no member with a $value was found.` }] };
        }
        const result = fromDtcg(parsed);
        for (const token of result.tokens) engine.registry.addToken(token);
        imported = result.tokens.length;
        importWarnings = result.warnings;
      }

      const tokens = engine.registry.designSystem.tokens;
      const patch: Record<string, Record<string, string>> = {
        colors: {},
        spacing: {},
        fontSize: {},
        borderRadius: {},
        boxShadow: {},
      };

      for (const token of tokens) {
        // Derive a Tailwind-friendly key from the token name
        // e.g. "Colors/Primary" → "primary", "Spacing/XS" → "xs"
        const parts = token.name.split("/");
        const key = (parts[parts.length - 1] ?? token.name)
          .replace(/\s+/g, "-")
          .toLowerCase();

        // Pick first mode value as the default, or use the CSS variable
        const firstValue = Object.values(token.values)[0];
        const value = token.cssVariable
          ? `var(${token.cssVariable})`
          : String(firstValue ?? "");

        switch (token.type) {
          case "color":
            patch.colors[key] = value;
            break;
          case "spacing":
            patch.spacing[key] = value;
            break;
          case "typography":
            patch.fontSize[key] = value;
            break;
          case "radius":
            patch.borderRadius[key] = value;
            break;
          case "shadow":
            patch.boxShadow[key] = value;
            break;
          // "other" tokens are skipped — no standard Tailwind mapping
        }
      }

      // Remove empty groups
      for (const group of Object.keys(patch)) {
        if (Object.keys(patch[group]).length === 0) {
          delete patch[group];
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(imported !== undefined ? { ...patch, imported, warnings: importWarnings } : patch),
        }],
      };
    },
  );

  // ── check_bridge_health ────────────────────────────────
  server.tool(
    "check_bridge_health",
    `Check health of the Figma WebSocket bridge. Works with no plugin connected; never throws.

Returns: { status: "healthy"|"degraded"|"down", connected, clientCount, latencyMs, uptimeSeconds, port, error? } — clientCount 0 means no plugin open in Figma.
Call this first before any Figma-dependent tool.`,
    {},
    async () => {
      const health = await engine.figma.wsServer.checkHealth();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(health),
        }],
      };
    },
  );

  // ── design_doc ────────────────────────────────────────
  server.tool(
    "design_doc",
    `Scrape a public URL and extract its design system — parses CSS custom properties, colors, fonts, spacing, radii, shadows; the configured AI provider synthesizes a DESIGN.md.

Prereq: publicly accessible URL; configured AI provider for synthesis (pass raw=true without it).
Returns (raw=false): DESIGN.md with Color System, Typography, Spacing, Borders & Surfaces, Component Patterns, Voice & Tone, Do/Don't, Tailwind Config Sketch. Returns (raw=true): { url, title, tokens: { cssVars, colors, fonts, fontSizes, spacing, radii, shadows, counts } }.
Errors: isError if the URL is unreachable/has no usable CSS, or the key is missing in synthesis mode.
Use to reverse-engineer a reference site's system or extract tokens for comparison.`,
    {
      url: z.string().url().describe("Fully-qualified public URL to extract design tokens from (e.g. 'https://stripe.com', 'https://linear.app'). Must be accessible without authentication."),
      raw: z.boolean().default(false).describe("If false (default), returns an AI-synthesized DESIGN.md document (requires a configured AI provider). If true, returns raw parsed token data without calling AI."),
    },
    async ({ url, raw }) => {
      try {
        const assets = await fetchPageAssets(url);
        if (!assets.html && assets.cssBlocks.length === 0) {
          return { isError: true, content: [{ type: "text" as const, text: `Could not fetch ${url}` }] };
        }
        const tokens = parseCSSTokens(assets.cssBlocks);

        if (raw) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                url,
                title: assets.title,
                tokens: {
                  cssVarCount: Object.keys(tokens.cssVars).length,
                  colorCount: tokens.colors.length,
                  fontCount: tokens.fonts.length,
                  cssVars: tokens.cssVars,
                  colors: tokens.colors,
                  fonts: tokens.fonts,
                  fontSizes: tokens.fontSizes,
                  spacing: tokens.spacing,
                  radii: tokens.radii,
                  shadows: tokens.shadows,
                },
              }),
            }],
          };
        }

        const ai = getAI();
        if (!ai) {
          return { isError: true, content: [{ type: "text" as const, text: "A configured AI provider is required for synthesis. Use raw=true for parsed tokens without AI." }] };
        }

        const varSample = Object.entries(tokens.cssVars).slice(0, 60).map(([k, v]) => `${k}: ${v}`).join("\n");
        const response = await ai.complete({
          system: "You are a design system analyst. Extract precise, actionable design systems from raw CSS data.",
          messages: [{
            role: "user",
            content: `Extract a DESIGN.md from: ${url}\nTitle: ${assets.title}\n\nCSS Variables:\n${varSample || "(none)"}\n\nColors: ${tokens.colors.slice(0, 30).join(", ") || "(none)"}\nFonts: ${tokens.fonts.slice(0, 8).join(" | ") || "(none)"}\nFont sizes: ${tokens.fontSizes.slice(0, 12).join(", ") || "(none)"}\nSpacing: ${tokens.spacing.slice(0, 12).join(", ") || "(none)"}\nRadii: ${tokens.radii.slice(0, 8).join(", ") || "(none)"}\nShadows: ${tokens.shadows.slice(0, 4).join("; ") || "(none)"}\n\nOutput a DESIGN.md with: ## Color System, ## Typography, ## Spacing, ## Borders & Surfaces, ## Component Patterns, ## Voice & Tone, ## Do / Don't, ## Tailwind Config Sketch. Be specific, use actual values.`,
          }],
          model: "deep",
          maxTokens: 4096,
        });

        return { content: [{ type: "text" as const, text: response.content }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: `design_doc failed: ${(err as Error).message}` }] };
      }
    },
  );

  // ── get_ai_usage ──────────────────────────────────────
  server.tool(
    "get_ai_usage",
    `AI token usage and estimated cost for this MCP session (in-memory tracker; never throws; unknown when provider pricing is not configured).

Returns: { calls, inputTokens, outputTokens, estimatedCost, knownEstimatedCost, costComplete, unpricedCalls, summary }. Use to monitor spend from analyze_design, design_doc, or compose.`,
    {},
    async () => {
      const tracker = getTracker();
      if (!tracker) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCost: "$0.0000",
          knownEstimatedCost: "$0.0000",
          costComplete: true,
          unpricedCalls: 0,
          summary: "No AI client initialized",
        }) }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            calls: tracker.callCount,
            inputTokens: tracker.totalInput,
            outputTokens: tracker.totalOutput,
            estimatedCost: tracker.isCostComplete ? `$${tracker.totalCost.toFixed(4)}` : "unknown",
            knownEstimatedCost: `$${tracker.totalCost.toFixed(4)}`,
            costComplete: tracker.isCostComplete,
            unpricedCalls: tracker.unpricedCallCount,
            summary: tracker.summary,
          }),
        }],
      };
    },
  );
}

async function assertReadableArtifact(path: string): Promise<void> {
  const info = await stat(path).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Artifact is not readable: ${path}. ${message}`);
  });
  if (!info.isFile()) {
    throw new Error(`Artifact is not a file: ${path}`);
  }
}

async function loadMcpResearchStore(engine: MemoireEngine): Promise<ResearchStore> {
  await engine.research.load();
  return engine.research.getStore();
}

async function loadMcpSimulationReport(projectRoot: string, runId: string): Promise<SimulationReport | null> {
  const store = new FileSimulationStore(projectRoot);
  const run = await store.loadRun(runId);
  if (!run) return null;
  const adapter = createMcpSimulationAdapter(projectRoot, run.adapter);
  return adapter.exportReport(runId);
}

function createMcpSimulationAdapter(projectRoot: string, adapter: SimulationAdapterKind, budget?: Partial<SimulationBudget>): SimulationAdapter {
  if (adapter === "model-swarm") {
    return new ModelSwarmSimulationAdapter({ store: new FileSimulationStore(projectRoot), defaultBudget: budget });
  }
  return new LocalSimulationAdapter({ store: new FileSimulationStore(projectRoot) });
}

async function createMcpAdapterForRun(projectRoot: string, runId: string): Promise<SimulationAdapter> {
  const store = new FileSimulationStore(projectRoot);
  const run = await store.loadRun(runId);
  return createMcpSimulationAdapter(projectRoot, run?.adapter ?? "local");
}

function budgetFromMcp(input: {
  maxAgents?: number;
  rounds?: number;
  allowLiveModels?: boolean;
}): Partial<SimulationBudget> | undefined {
  const budget: Partial<SimulationBudget> = {};
  if (input.maxAgents !== undefined) budget.maxAgents = input.maxAgents;
  if (input.rounds !== undefined) budget.maxRounds = input.rounds;
  if (input.allowLiveModels !== undefined) budget.allowLiveModels = input.allowLiveModels;
  return Object.keys(budget).length ? budget : undefined;
}
