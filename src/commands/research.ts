import { existsSync } from "fs";
import type { Command } from "commander";
import { join } from "path";
import type { MemoireEngine } from "../engine/core.js";
import { ui } from "../tui/format.js";
import {
  buildResearchDesignPackage,
  saveResearchDesignSpecs,
  writeMermaidJamArtifacts,
  type MermaidJamExport,
  type ResearchDesignPackage,
  type ResearchDesignSpecWriteResult,
} from "../research/design-package.js";
import { openMermaidJamTarget, resolveMermaidJamIntegration } from "../integrations/mermaid-jam.js";
import { FileSimulationStore, LocalSimulationAdapter, ModelSwarmSimulationAdapter } from "../simulation/index.js";
import type { SimulationReport } from "../simulation/types.js";

type ResearchAction =
  | "from-file"
  | "from-stickies"
  | "from-transcript"
  | "web"
  | "synthesize"
  | "report"
  | "quality"
  | "design";

interface ResearchArtifacts {
  researchDir: string;
  storePath: string;
  notesDir: string;
  reportMarkdownPath: string;
  reportJsonPath: string;
}

interface ResearchSummary {
  observations: number;
  findings: number;
  themes: number;
  personas: number;
  sources: number;
  quantitativeMetrics: number;
}

interface ResearchCommandPayload {
  action: ResearchAction;
  status: "completed";
  options: {
    json: boolean;
  };
  summary: ResearchSummary;
  artifacts: ResearchArtifacts;
  source?: {
    type: "file";
    path: string;
  };
  stickies?: {
    total: number;
    clusters: number;
    unclustered: number;
    summary: string;
    autoConnected: boolean;
  };
  transcript?: {
    segments: number;
    findings: number;
    speakers: string[];
    sentiment: { positive: number; negative: number; neutral: number; mixed: number };
    summary: string;
  };
  web?: {
    topic: string;
    sources: number;
    findings: number;
    crossValidated: number;
    gaps: string[];
    summary: string;
  };
  synthesis?: {
    summary: string;
    themes: number;
    topTheme: string | null;
    personas: number;
    opportunities: number;
    topOpportunity: string | null;
    risks: number;
    topRisk: string | null;
    contradictions: number;
    quantitativeMetrics: number;
    qualityScore: number | null;
    sampleSize: number;
  };
  quality?: {
    overallScore: number;
    sampleSize: number;
    completenessScore: number;
    sourceDiversityScore: number;
    triangulationScore: number;
    structureScore: number;
    notes: string[];
  };
  report?: {
    markdownPath: string;
    jsonPath: string;
    markdownBytes: number;
    markdownLines: number;
  };
  package?: ResearchDesignPackage;
  specWrite?: ResearchDesignSpecWriteResult;
  mermaidJam?: {
    exports: MermaidJamExport[];
  };
  opened?: {
    target: string;
    opened: string;
    openedAt: string;
  };
}

export function registerResearchCommand(program: Command, engine: MemoireEngine) {
  const research = program
    .command("research")
    .description("Decision-grade mixed-methods research pipeline");

  research
    .command("from-file <path>")
    .description("Parse Excel/CSV research data into the V2 research store")
    .option("--json", "Output file import result as JSON")
    .action(async (filePath: string, opts: { json?: boolean }) => {
      const json = Boolean(opts.json);
      if (!existsSync(filePath)) {
        console.log(ui.fail(`File not found: ${filePath}`));
        process.exitCode = 1;
        return;
      }

      await engine.init();
      await engine.research.load();

      if (!json) {
        console.log(`\n  Processing: ${filePath}\n`);
      }

      await engine.research.fromFile(filePath);
      const summary = buildResearchSummary(engine);
      const payload: ResearchCommandPayload = {
        action: "from-file",
        status: "completed",
        options: { json },
        source: { type: "file", path: filePath },
        summary,
        artifacts: buildResearchArtifacts(engine),
      };

      if (json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      if (summary.findings === 0) {
        console.log("\n  Warning: No findings extracted — check your file format");
        console.log("  Supported formats: Excel (.xlsx), CSV (.csv)");
        console.log("  Expected columns: response/answer/feedback, rating/score, user/participant\n");
        return;
      }

      console.log(
        `\n  Extracted ${summary.findings} finding${summary.findings === 1 ? "" : "s"}, `
        + `${summary.themes} theme${summary.themes === 1 ? "" : "s"}, `
        + `${summary.personas} persona${summary.personas === 1 ? "" : "s"}`,
      );
      console.log("  Canonical store saved to research/store.v2.json");
      console.log("  Markdown notes written to research/notes/");
      console.log("  Run `memi research synthesize` for themes, risks, and opportunities");
      console.log("  Run `memi preview` to view the research dashboard\n");
    });

  research
    .command("from-stickies")
    .description("Convert FigJam stickies from the connected Figma file into research observations and findings")
    .option("--json", "Output sticky import result as JSON")
    .action(async (opts: { json?: boolean }) => {
      const json = Boolean(opts.json);
      await engine.init();
      await engine.research.load();

      let autoConnected = false;
      if (!engine.figma.isConnected) {
        autoConnected = true;
        if (!json) {
          console.log("\n  Connecting to Figma...\n");
        }
        await engine.connectFigma();
      }

      if (!json) {
        console.log("\n  Reading FigJam stickies...\n");
      }

      const stickies = await engine.figma.extractStickies();
      const result = await engine.research.fromStickies(stickies);
      const summary = buildResearchSummary(engine);
      const payload: ResearchCommandPayload = {
        action: "from-stickies",
        status: "completed",
        options: { json },
        summary,
        artifacts: buildResearchArtifacts(engine),
        stickies: {
          total: result.totalStickies,
          clusters: result.clusters.length,
          unclustered: result.unclustered.length,
          summary: result.summary,
          autoConnected,
        },
      };

      if (json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log(`\n  ${result.summary}`);
      if (summary.findings === 0) {
        console.log("  Warning: No findings extracted — check your FigJam content.\n");
        return;
      }

      console.log(
        `  Extracted ${summary.findings} finding${summary.findings === 1 ? "" : "s"}, `
        + `${summary.themes} theme${summary.themes === 1 ? "" : "s"}, `
        + `${summary.personas} persona${summary.personas === 1 ? "" : "s"}`,
      );
      console.log("  Canonical store saved to research/store.v2.json");
      console.log("  Markdown notes written to research/notes/");
      console.log("  Run `memi preview` to view the research dashboard\n");
    });

  research
    .command("from-transcript <path>")
    .description("Parse interview transcripts, user testing sessions, or meeting notes")
    .option("--label <label>", "Label for the transcript source")
    .option("--json", "Output transcript analysis as JSON")
    .action(async (filePath: string, opts: { label?: string; json?: boolean }) => {
      const json = Boolean(opts.json);
      if (!existsSync(filePath)) {
        console.log(ui.fail(`File not found: ${filePath}`));
        process.exitCode = 1;
        return;
      }

      await engine.init();
      await engine.research.load();

      if (!json) {
        console.log(`\n  Processing transcript: ${filePath}\n`);
      }

      const analysis = await engine.research.fromTranscript(filePath, opts.label);
      const summary = buildResearchSummary(engine);
      const payload: ResearchCommandPayload = {
        action: "from-transcript",
        status: "completed",
        options: { json },
        summary,
        artifacts: buildResearchArtifacts(engine),
        transcript: {
          segments: analysis.segments.length,
          findings: analysis.insights.length,
          speakers: analysis.speakers.map((speaker) => speaker.name),
          sentiment: analysis.sentiment,
          summary: analysis.summary,
        },
      };

      if (json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log(`  ${analysis.summary}`);
      console.log(`\n  Speakers: ${analysis.speakers.map((speaker) => `${speaker.name} (${speaker.wordCount} words)`).join(", ")}`);
      console.log(`  Findings: ${analysis.insights.length}`);
      console.log(`  Sentiment: +${analysis.sentiment.positive} -${analysis.sentiment.negative} ~${analysis.sentiment.mixed}`);
      console.log("\n  Canonical store saved to research/store.v2.json");
      console.log("  Markdown notes written to research/notes/\n");
    });

  research
    .command("web <topic>")
    .description("Research a topic from web URLs and merge evidence into the V2 research store")
    .option("--urls <urls>", "Comma-separated URLs to research from")
    .option("--depth <depth>", "Research depth: quick, standard, deep", "standard")
    .option("--plan-only", "Show the research plan without executing")
    .option("--json", "Output web research result as JSON")
    .action(async (topic: string, opts: { urls?: string; depth?: string; planOnly?: boolean; json?: boolean }) => {
      const json = Boolean(opts.json);
      const { buildResearchPlan } = await import("../research/web-researcher.js");
      const depth = (opts.depth ?? "standard") as "quick" | "standard" | "deep";
      const urls = opts.urls?.split(",").map((url) => url.trim()).filter(Boolean) ?? [];

      if (opts.planOnly) {
        const plan = buildResearchPlan(topic, { depth });
        if (json) {
          console.log(JSON.stringify({ action: "web", mode: "plan-only", plan }, null, 2));
        } else {
          console.log(`\n${plan.strategy}\n`);
        }
        return;
      }

      if (urls.length === 0) {
        const plan = buildResearchPlan(topic, { depth });
        if (json) {
          console.log(JSON.stringify({
            action: "web",
            mode: "plan-only",
            plan,
            hint: "Provide --urls to fetch and analyze. Or use the plan queries with a web search tool.",
          }, null, 2));
          return;
        }

        console.log(`\n${plan.strategy}`);
        console.log("\n  No URLs provided. Use --urls to specify pages to research:");
        console.log(`  memi research web "${topic}" --urls https://example.com/article1,https://example.com/article2`);
        console.log("\n  Or use the plan queries above with a web search tool, then pass the result URLs.\n");
        return;
      }

      await engine.init();
      await engine.research.load();

      if (!json) {
        console.log(`\n  Researching "${topic}" from ${urls.length} URLs...\n`);
      }

      const result = await engine.research.fromUrls(topic, urls);
      const payload: ResearchCommandPayload = {
        action: "web",
        status: "completed",
        options: { json },
        summary: buildResearchSummary(engine),
        artifacts: buildResearchArtifacts(engine),
        web: {
          topic: result.topic,
          sources: result.sources.length,
          findings: result.findings.length,
          crossValidated: result.crossValidated.length,
          gaps: result.gaps,
          summary: result.summary,
        },
      };

      if (json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log(`  ${result.summary}`);
      if (result.crossValidated.length > 0) {
        console.log(`\n  Cross-validated findings (${result.crossValidated.length}):`);
        for (const finding of result.crossValidated.slice(0, 5)) {
          console.log(`    [${finding.confidence}] ${finding.text.slice(0, 100)}...`);
        }
      }
      if (result.gaps.length > 0) {
        console.log("\n  Research gaps:");
        for (const gap of result.gaps) {
          console.log(`    ! ${gap}`);
        }
      }
      console.log("\n  Canonical store saved to research/store.v2.json");
      console.log("  Markdown notes written to research/notes/\n");
    });

  research
    .command("synthesize")
    .description("Synthesize findings into themes, personas, opportunities, risks, and contradictions")
    .option("--json", "Output synthesis result as JSON")
    .action(async (opts: { json?: boolean }) => {
      const json = Boolean(opts.json);
      await engine.init();
      await engine.research.load();

      if (!json) {
        console.log("\n  Synthesizing research...\n");
      }

      const { themes, summary } = await engine.research.synthesize();
      const store = engine.research.getStore();
      const payload: ResearchCommandPayload = {
        action: "synthesize",
        status: "completed",
        options: { json },
        summary: buildResearchSummary(engine),
        artifacts: buildResearchArtifacts(engine),
        synthesis: {
          summary,
          themes: themes.length,
          topTheme: themes[0]?.name ?? null,
          personas: store.personas.length,
          opportunities: store.opportunities.length,
          topOpportunity: store.opportunities[0]?.title ?? null,
          risks: store.risks.length,
          topRisk: store.risks[0]?.title ?? null,
          contradictions: store.contradictions.length,
          quantitativeMetrics: store.quantitativeMetrics.length,
          qualityScore: store.quality.overallScore,
          sampleSize: store.quality.sampleSize,
        },
      };

      if (json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log(`\n  ${summary}\n`);
      console.log(`  Quality score: ${store.quality.overallScore}/100`);
      console.log(`  Sample size: ${store.quality.sampleSize}`);
      console.log(`  Quantitative metrics: ${store.quantitativeMetrics.length}\n`);
    });

  research
    .command("report")
    .description("Generate both Markdown and JSON research reports")
    .option("--json", "Output report generation result as JSON")
    .action(async (opts: { json?: boolean }) => {
      const json = Boolean(opts.json);
      await engine.init();
      await engine.research.load();

      if (!json) {
        console.log("\n  Generating report...\n");
      }

      const report = await engine.research.generateReport();
      const artifacts = buildResearchArtifacts(engine);
      const payload: ResearchCommandPayload = {
        action: "report",
        status: "completed",
        options: { json },
        summary: buildResearchSummary(engine),
        artifacts,
        report: {
          markdownPath: artifacts.reportMarkdownPath,
          jsonPath: artifacts.reportJsonPath,
          markdownBytes: Buffer.byteLength(report, "utf-8"),
          markdownLines: report.split(/\r?\n/).length,
        },
      };

      if (json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log("  Report saved to research/reports/report.md");
      console.log("  Report JSON saved to research/reports/report.json");
      console.log("  Run `memi preview` to view the research dashboard\n");
    });

  research
    .command("quality")
    .description("Inspect research quality, completeness, and triangulation")
    .option("--json", "Output quality result as JSON")
    .action(async (opts: { json?: boolean }) => {
      const json = Boolean(opts.json);
      await engine.init();
      await engine.research.load();

      const quality = engine.research.assessQuality();
      const payload: ResearchCommandPayload = {
        action: "quality",
        status: "completed",
        options: { json },
        summary: buildResearchSummary(engine),
        artifacts: buildResearchArtifacts(engine),
        quality: {
          overallScore: quality.overallScore,
          sampleSize: quality.sampleSize,
          completenessScore: quality.completenessScore,
          sourceDiversityScore: quality.sourceDiversityScore,
          triangulationScore: quality.triangulationScore,
          structureScore: quality.structureScore,
          notes: quality.notes,
        },
      };

      if (json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log("\n  Research quality");
      console.log(`  Overall score: ${quality.overallScore}/100`);
      console.log(`  Sample size: ${quality.sampleSize}`);
      console.log(`  Completeness: ${quality.completenessScore}/100`);
      console.log(`  Source diversity: ${quality.sourceDiversityScore}/100`);
      console.log(`  Triangulation: ${quality.triangulationScore}/100`);
      console.log(`  Structure: ${quality.structureScore}/100`);
      if (quality.notes.length > 0) {
        console.log("");
        for (const note of quality.notes) {
          console.log(`  - ${note}`);
        }
      }
      console.log("");
    });

  research
    .command("trace [spec]")
    .description("Show which research findings back each spec — and which citations no longer resolve")
    .option("--json", "Output the traceability report as JSON")
    .action(async (specName: string | undefined, opts: { json?: boolean }) => {
      const { buildTraceabilityReport } = await import("../research/traceability.js");
      await engine.init();
      await engine.research.load();
      const store = engine.research.getStore();
      const specs = await engine.registry.getAllSpecs();
      const report = buildTraceabilityReport(specs, store.findings);
      const entries = specName
        ? report.entries.filter((entry) => entry.spec.toLowerCase().includes(specName.toLowerCase()))
        : report.entries;

      if (opts.json) {
        console.log(JSON.stringify({ ...report, entries }, null, 2));
        return;
      }

      console.log(ui.brand("Research Traceability"));
      if (report.coverage !== null) console.log(ui.dots("Coverage", `${report.coverage}% (${report.backedSpecs}/${report.totalSpecs} specs backed)`));
      if (report.staleCitations > 0) console.log(ui.warn(`${report.staleCitations} stale citation(s) — cited findings no longer exist in the store`));
      for (const entry of entries) {
        const marker = entry.backed ? "[+]" : entry.cited.length > 0 ? "[x]" : "[-]";
        console.log(`  ${marker} ${entry.spec} (${entry.type}) — ${entry.resolved.length} resolved${entry.unresolved.length ? `, ${entry.unresolved.length} stale` : ""}${entry.cited.length === 0 ? ", no citations" : ""}`);
        for (const finding of entry.resolved.slice(0, 3)) {
          console.log(ui.dim(`      ${finding.id} (${finding.confidence}) ${finding.statement.slice(0, 70)}`));
        }
        for (const stale of entry.unresolved.slice(0, 3)) {
          console.log(ui.dim(`      ${stale} — NOT FOUND in research store`));
        }
      }
      console.log();
    });

  research
    .command("coverage")
    .description("Summary of research-backing coverage across all specs")
    .option("--json", "Output coverage as JSON")
    .action(async (opts: { json?: boolean }) => {
      const { buildTraceabilityReport } = await import("../research/traceability.js");
      await engine.init();
      await engine.research.load();
      const store = engine.research.getStore();
      const specs = await engine.registry.getAllSpecs();
      const report = buildTraceabilityReport(specs, store.findings);

      if (opts.json) {
        const { entries: _entries, ...summary } = report;
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      console.log(ui.brand("Research Coverage"));
      console.log(ui.dots("Specs with researchBacking", String(report.totalSpecs)));
      console.log(ui.dots("Backed by live findings", String(report.backedSpecs)));
      console.log(ui.dots("Unbacked", String(report.unbackedSpecs)));
      console.log(ui.dots("Stale citations", String(report.staleCitations)));
      if (report.coverage !== null) console.log(ui.dots("Coverage", `${report.coverage}%`));
      if (report.totalSpecs === 0) console.log(ui.dim("  No specs carry researchBacking yet — nothing to measure."));
      console.log();
    });

  research
    .command("design")
    .description("Generate research-backed Atomic Design specs and Mermaid Jam-ready FigJam source")
    .option("--intent <text>", "Design intent for the generated package")
    .option("--hypothesis <text>", "Product/design hypothesis to ground the package")
    .option("--run-id <id>", "Optional simulation run id to fold into the design package")
    .option("--write-specs", "Write generated specs through the Memoire registry")
    .option("--mermaid-jam", "Write Mermaid Jam source artifacts under .memoire/mermaid-jam")
    .option("--open", "Open Mermaid Jam after writing source artifacts")
    .option("--json", "Output design package as JSON")
    .action(async (opts: {
      intent?: string;
      hypothesis?: string;
      runId?: string;
      writeSpecs?: boolean;
      mermaidJam?: boolean;
      open?: boolean;
      json?: boolean;
    }) => {
      const json = Boolean(opts.json);
      await engine.init();
      await engine.research.load();

      const report = opts.runId ? await loadSimulationReport(engine.config.projectRoot, opts.runId) : null;
      const designPackage = buildResearchDesignPackage(engine.research.getStore(), {
        intent: opts.intent,
        hypothesis: opts.hypothesis,
        simulationReport: report,
      });
      const payload: ResearchCommandPayload = {
        action: "design",
        status: "completed",
        options: { json },
        summary: buildResearchSummary(engine),
        artifacts: buildResearchArtifacts(engine),
        package: designPackage,
      };

      if (opts.writeSpecs) {
        payload.specWrite = await saveResearchDesignSpecs(designPackage, engine.registry);
      }

      if (opts.mermaidJam || opts.open) {
        const integration = await resolveMermaidJamIntegration({ projectRoot: engine.config.projectRoot });
        payload.mermaidJam = {
          exports: await writeMermaidJamArtifacts(designPackage, {
            projectRoot: engine.config.projectRoot,
            integration,
          }),
        };
        if (opts.open) {
          const target = integration.local.ready ? "local-manifest" : "community";
          payload.opened = await openMermaidJamTarget(integration, target);
        }
      }

      if (json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log("\n  Research design package");
      console.log(ui.dots("Package", designPackage.id));
      console.log(ui.dots("Evidence", `${designPackage.evidenceIds.length} finding ids`));
      console.log(ui.dots("Specs", String(payload.specWrite?.count ?? Object.values(designPackage.specs).flat().length)));
      if (payload.mermaidJam) console.log(ui.dots("Mermaid Jam artifacts", String(payload.mermaidJam.exports.length)));
      for (const warning of designPackage.warnings) console.log(`  ${ui.promptPrefix()} ${warning}`);
      console.log("");
    });
}

function buildResearchArtifacts(engine: MemoireEngine): ResearchArtifacts {
  const researchDir = join(engine.config.projectRoot, "research");
  return {
    researchDir,
    storePath: join(researchDir, "store.v2.json"),
    notesDir: join(researchDir, "notes"),
    reportMarkdownPath: join(researchDir, "reports", "report.md"),
    reportJsonPath: join(researchDir, "reports", "report.json"),
  };
}

function buildResearchSummary(engine: MemoireEngine): ResearchSummary {
  const store = engine.research.getStore();
  return {
    observations: store.observations.length,
    findings: store.findings.length,
    themes: store.themes.length,
    personas: store.personas.length,
    sources: store.sources.length,
    quantitativeMetrics: store.quantitativeMetrics.length,
  };
}

async function loadSimulationReport(projectRoot: string, runId: string): Promise<SimulationReport | null> {
  const store = new FileSimulationStore(projectRoot);
  const run = await store.loadRun(runId);
  if (!run) return null;
  const adapter = run.adapter === "model-swarm"
    ? new ModelSwarmSimulationAdapter({ store })
    : new LocalSimulationAdapter({ store });
  return adapter.exportReport(runId);
}
