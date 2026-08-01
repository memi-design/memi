import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { StudioBrowserAdapter } from "../browser-adapter.js";
import { defaultStudioConfig } from "../config.js";
import { StudioToolBroker } from "../tool-broker.js";

describe("studio simulation tools", () => {
  it("plans and runs local simulations through the tool broker", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-sim-"));
    try {
      const broker = new StudioToolBroker({
        projectRoot: root,
        getConfig: async () => defaultStudioConfig(root),
        browser: new StudioBrowserAdapter({ projectRoot: root }),
      });

      expect(broker.listTools().map((tool) => tool.id)).toEqual(expect.arrayContaining([
        "simulation_models",
        "simulation_generate_agents",
        "simulation_plan",
        "simulation_run",
        "simulation_run_matrix",
        "simulation_stream",
        "simulation_transcript",
        "simulation_compare",
        "simulation_costs",
        "simulation_interview",
        "simulation_report",
        "simulation_export_spec",
        "research_design_package",
        "research.design_package",
        "research_generate_specs",
        "research.generate_specs",
        "mermaid_jam_export",
        "mermaid_jam.export",
        "board.create",
        "board.add_node",
        "board.update_node",
        "board.connect",
        "board.layout",
        "board.capture_ia",
        "board.export_mermaid_jam",
        "board.apply_template",
        "board.sync_figjam",
      ]));

      const planned = await broker.call({
        toolId: "simulation_plan",
        cwd: root,
        input: {
          name: "Agent-native PM lab",
          hypothesis: "Product teams need scenario testing before specs ship.",
          research: {
            personas: [{ name: "PM", role: "Product manager", goals: ["Align roadmap"], painPoints: ["Weak evidence"], behaviors: ["Reviews insights"], source: "manual" }],
            findings: [{ id: "finding", statement: "PMs need clearer evidence links.", category: "planning", confidence: "high", themeIds: [], evidenceObservationIds: [], evidenceSourceIds: [], sourceTypeCount: 1, method: "qualitative", caveats: [], tags: ["pm"], entities: [], signalTags: [], createdAt: "2026-05-07T00:00:00.000Z" }],
            themes: [],
            opportunities: [],
            risks: [],
            contradictions: [],
            quantitativeMetrics: [],
            sources: [],
            observations: [],
            evidenceLinks: [],
            highlights: [],
            codebook: [],
            reports: [],
            version: 2,
            quality: { overallScore: 75, sampleSize: 1, completenessScore: 80, sourceDiversityScore: 50, triangulationScore: 60, structureScore: 85, notes: [], generatedAt: "2026-05-07T00:00:00.000Z" },
            methods: { analysisMode: "decision-grade", quantitativeApproach: "", qualitativeApproach: "", limitations: [] },
          },
        },
      });

      expect(planned).toMatchObject({
        status: "completed",
        toolId: "simulation_plan",
        data: { scenario: { name: "Agent-native PM lab" } },
      });

      const scenarioId = (planned.data as { scenario: { id: string } }).scenario.id;
      await expect(broker.call({
        toolId: "simulation_run",
        cwd: root,
        input: { scenarioId },
      })).resolves.toMatchObject({
        status: "completed",
        toolId: "simulation_run",
        data: { run: { status: "completed" } },
      });

      await expect(broker.call({
        toolId: "simulation_models",
        cwd: root,
        input: {},
      })).resolves.toMatchObject({
        status: "completed",
        data: { profiles: expect.arrayContaining([expect.objectContaining({ provider: "codex" })]) },
      });

      await expect(broker.call({
        toolId: "simulation_generate_agents",
        cwd: root,
        input: {
          adapter: "model-swarm",
          agentCount: 24,
          research: (planned.data as { scenario: unknown }).scenario,
        },
      })).resolves.toMatchObject({
        status: "completed",
        data: { agents: expect.any(Array) },
      });

      const swarmPlan = await broker.call({
        toolId: "simulation_plan",
        cwd: root,
        input: {
          adapter: "model-swarm",
          agentCount: 20,
          name: "Model swarm lab",
          hypothesis: "Multi-model debate improves specs.",
          research: (planned.data as { scenario: unknown }).scenario,
        },
      });
      const swarmScenarioId = (swarmPlan.data as { scenario: { id: string } }).scenario.id;
      const swarmRun = await broker.call({
        toolId: "simulation_run",
        cwd: root,
        input: { scenarioId: swarmScenarioId, adapter: "model-swarm", maxAgents: 20, rounds: 2 },
      });
      const swarmRunId = (swarmRun.data as { run: { id: string } }).run.id;

      await expect(broker.call({ toolId: "simulation_stream", cwd: root, input: { runId: swarmRunId } })).resolves.toMatchObject({
        status: "completed",
        data: { events: expect.arrayContaining([expect.objectContaining({ kind: "model-response" })]) },
      });
      await expect(broker.call({ toolId: "simulation_transcript", cwd: root, input: { runId: swarmRunId } })).resolves.toMatchObject({
        status: "completed",
        data: { transcripts: expect.arrayContaining([expect.objectContaining({ modelProfileId: expect.any(String) })]) },
      });
      await expect(broker.call({ toolId: "simulation_costs", cwd: root, input: { runId: swarmRunId } })).resolves.toMatchObject({
        status: "completed",
        data: { costs: expect.objectContaining({ estimatedCostUsd: 0 }) },
      });
      await expect(broker.call({ toolId: "simulation_compare", cwd: root, input: { runIds: [swarmRunId, swarmRunId] } })).resolves.toMatchObject({
        status: "completed",
        data: { comparison: expect.objectContaining({ winnerRunId: swarmRunId }) },
      });
      await expect(broker.call({
        toolId: "simulation_run_matrix",
        cwd: root,
        input: { adapter: "model-swarm", hypotheses: ["A better spec", "A safer roadmap"], maxAgents: 20, rounds: 1 },
      })).resolves.toMatchObject({
        status: "completed",
        data: { comparison: expect.objectContaining({ winnerRunId: expect.any(String) }) },
      });

      const research = makeResearchStore();
      const designPackage = await broker.call({
        toolId: "research_design_package",
        cwd: root,
        input: {
          intent: "Design an evidence-backed planning board",
          hypothesis: "Evidence-linked design improves planning confidence",
          research,
        },
      });
      expect(designPackage).toMatchObject({
        status: "completed",
        data: {
          package: {
            specs: { pages: [expect.objectContaining({ name: "ProductDecisionPage" })] },
            mermaidArtifacts: expect.arrayContaining([expect.objectContaining({ kind: "journey-map" })]),
          },
        },
      });

      await expect(broker.call({
        toolId: "research_generate_specs",
        cwd: root,
        input: { research },
      })).resolves.toMatchObject({
        status: "approval_required",
      });

      await expect(broker.call({
        toolId: "research_generate_specs",
        cwd: root,
        approved: true,
        input: { research },
      })).resolves.toMatchObject({
        status: "completed",
        data: { specWrite: { written: expect.arrayContaining(["ResearchVibeDirection", "ProductDecisionPage"]) } },
      });

      const figjamExport = await broker.call({
        toolId: "mermaid_jam_export",
        cwd: root,
        input: { source: "research", research },
      });
      expect(figjamExport).toMatchObject({
        status: "completed",
        data: { exports: expect.arrayContaining([expect.objectContaining({ outputPath: expect.stringContaining(join(".memoire", "mermaid-jam")) })]) },
      });
      const exportedPath = ((figjamExport.data as { exports: Array<{ outputPath: string }> }).exports[0].outputPath);
      await expect(readFile(exportedPath, "utf-8")).resolves.toContain("journey");

      const boardCreate = await broker.call({
        toolId: "board.create",
        cwd: root,
        input: {
          id: "studio-e2e-board",
          prompt: "Create a designer-friendly onboarding research board.",
        },
      });
      expect(boardCreate).toMatchObject({
        status: "completed",
        data: {
          board: {
            id: "studio-e2e-board",
            mode: "pm-brainstorm",
            nodes: expect.any(Array),
          },
        },
      });

      const boardAdd = await broker.call({
        toolId: "board.add_node",
        cwd: root,
        input: {
          boardId: "studio-e2e-board",
          kind: "risk",
          laneId: "risks",
          title: "Friction risk",
          body: "The onboarding flow may hide source evidence from designers.",
        },
      });
      expect(boardAdd).toMatchObject({
        status: "completed",
        data: {
          board: {
            nodes: expect.arrayContaining([expect.objectContaining({ title: "Friction risk" })]),
          },
        },
      });

      const boardExport = await broker.call({
        toolId: "board.export_mermaid_jam",
        cwd: root,
        input: { boardId: "studio-e2e-board" },
      });
      expect(boardExport).toMatchObject({
        status: "completed",
        data: {
          exports: expect.arrayContaining([expect.objectContaining({
            outputPath: expect.stringContaining(".memoire/mermaid-jam/boards"),
          })]),
        },
      });
      const boardExportPath = ((boardExport.data as { exports: Array<{ outputPath: string }> }).exports[0].outputPath);
      await expect(readFile(boardExportPath, "utf-8")).resolves.toContain("Friction risk");

      await expect(broker.call({
        toolId: "board.sync_figjam",
        cwd: root,
        input: { boardId: "studio-e2e-board" },
      })).resolves.toMatchObject({
        status: "completed",
        data: {
          sync: {
            status: "fallback",
            createdNodeCount: 0,
          },
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function makeResearchStore() {
  return {
    personas: [{ name: "PM", role: "Product manager", goals: ["Ship a clear plan"], painPoints: ["Missing evidence"], behaviors: ["Reviews research"], source: "manual", evidenceFindingIds: ["finding"] }],
    findings: [{ id: "finding", statement: "PMs need research evidence visible in design planning.", category: "planning", confidence: "high", themeIds: [], evidenceObservationIds: [], evidenceSourceIds: [], sourceTypeCount: 1, method: "qualitative", caveats: [], tags: ["pm"], entities: [], signalTags: [], createdAt: "2026-05-07T00:00:00.000Z" }],
    themes: [],
    opportunities: [],
    risks: [],
    contradictions: [],
    quantitativeMetrics: [],
    sources: [],
    observations: [],
    evidenceLinks: [],
    highlights: [],
    codebook: [],
    reports: [],
    version: 2,
    quality: { overallScore: 75, sampleSize: 1, completenessScore: 80, sourceDiversityScore: 50, triangulationScore: 60, structureScore: 85, notes: [], generatedAt: "2026-05-07T00:00:00.000Z" },
    methods: { analysisMode: "decision-grade", quantitativeApproach: "", qualitativeApproach: "", limitations: [] },
  };
}
