import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildResearchDesignPackage, writeMermaidJamArtifacts } from "../design-package.js";
import type { ResearchStore } from "../engine.js";
import type { SimulationReport } from "../../simulation/types.js";

describe("research design package", () => {
  it("maps research and simulation evidence into specs, warnings, and Mermaid Jam source", () => {
    const pkg = buildResearchDesignPackage(makeResearchStore(), {
      intent: "Design an agent-native product planning surface",
      hypothesis: "Evidence-linked planning reduces launch risk",
      simulationReport: makeSimulationReport(),
    });

    expect(pkg).toMatchObject({
      name: "Research Vibe Design Package",
      intent: "Design an agent-native product planning surface",
      hypothesis: "Evidence-linked planning reduces launch risk",
      sourceRunId: "run-swarm",
    });
    expect(pkg.brief.audience).toContain("Product manager");
    expect(pkg.brief.vibePrinciples.join(" ")).toContain("evidence");
    expect(pkg.evidenceIds).toEqual(expect.arrayContaining(["finding-evidence", "finding-risk"]));
    expect(pkg.specs.design[0]).toMatchObject({ name: "ResearchVibeDirection", type: "design" });
    expect(pkg.specs.ia[0]).toMatchObject({ name: "ResearchBackedIA", type: "ia" });
    expect(pkg.specs.pages[0]).toMatchObject({ name: "ProductDecisionPage", researchBacking: expect.arrayContaining(["finding-evidence"]) });
    expect(pkg.specs.components.map((spec) => spec.name)).toEqual(expect.arrayContaining([
      "ProductDecisionTemplate",
      "ResearchHero",
      "DecisionPanel",
      "ScenarioTimeline",
      "RiskReviewPanel",
      "EvidenceCard",
      "PersonaChip",
      "AssumptionRow",
      "MetricTile",
    ]));
    expect(pkg.specs.dataviz[0]).toMatchObject({ name: "MetricTileSignal", type: "dataviz" });
    expect(pkg.warnings.join(" ")).toContain("contradiction");
    expect(pkg.mermaidArtifacts.map((artifact) => artifact.kind)).toEqual(expect.arrayContaining([
      "journey-map",
      "ia-flow",
      "evidence-map",
      "simulation-timeline",
    ]));
    expect(pkg.mermaidArtifacts.find((artifact) => artifact.kind === "journey-map")?.source).toContain("journey");
    expect(pkg.mermaidArtifacts.find((artifact) => artifact.kind === "ia-flow")?.source).toContain("flowchart TD");
    expect(pkg.mermaidArtifacts.find((artifact) => artifact.kind === "simulation-timeline")?.source).toContain("timeline");
  });

  it("warns instead of inventing citations for low-evidence stores", () => {
    const pkg = buildResearchDesignPackage({ ...makeResearchStore(), findings: [], evidenceLinks: [], quality: { ...makeResearchStore().quality, overallScore: 40 } });

    expect(pkg.evidenceIds).toEqual([]);
    expect(pkg.warnings.join(" ")).toContain("No research findings");
    expect(pkg.specs.pages[0].researchBacking).toEqual([]);
  });

  it("writes source-plus-open Mermaid Jam artifacts without clipboard automation", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-research-design-"));
    try {
      const pkg = buildResearchDesignPackage(makeResearchStore());
      const exports = await writeMermaidJamArtifacts(pkg, {
        projectRoot: root,
        integration: {
          schemaVersion: 1,
          id: "mermaid-jam",
          name: "Mermaid Jam",
          kind: "figjam-plugin",
          description: "test",
          packageName: "mermaid-jam",
          communityUrl: "https://www.figma.com/community/plugin/1631708567749401678",
          repositoryUrl: "https://github.com/sarveshsea/mermaid-jam",
          supportedInputs: ["mermaid", "markdown"],
          supportedOutputs: ["editable-figjam"],
          local: {
            found: true,
            ready: true,
            root: root,
            source: "env",
            manifestPath: join(root, "plugin", "manifest.json"),
            manifestId: "1631708567749401678",
            manifestName: "Mermaid Jam",
            editorTypes: ["figjam"],
            packageVersion: "1.0.0",
            codePath: null,
            uiPath: null,
          },
          install: { quickLinks: [], nextSteps: ["Open Mermaid Jam and paste the saved source."] },
        },
      });

      expect(exports.length).toBeGreaterThan(2);
      expect(exports[0]).toMatchObject({ format: "mermaid", outputPath: expect.stringContaining(join(".memoire", "mermaid-jam")) });
      expect(exports[0].nextSteps.join(" ")).toContain("paste");
      expect(exports[0].nextSteps.join(" ")).not.toMatch(/clipboard|automation/i);
      const source = await readFile(exports[0].outputPath, "utf-8");
      expect(source).toContain(exports[0].source.slice(0, 20));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function makeResearchStore(): ResearchStore {
  return {
    version: 2,
    sources: [],
    observations: [],
    highlights: [],
    codebook: [],
    findings: [
      {
        id: "finding-evidence",
        statement: "Product managers need evidence links visible before they commit a roadmap decision.",
        category: "planning",
        confidence: "high",
        themeIds: ["theme-trust"],
        evidenceObservationIds: [],
        evidenceSourceIds: [],
        sourceTypeCount: 2,
        method: "qualitative",
        caveats: [],
        tags: ["planning"],
        entities: [],
        signalTags: [],
        createdAt: "2026-05-07T00:00:00.000Z",
      },
      {
        id: "finding-risk",
        statement: "Teams lose confidence when risks are not connected to measurable launch criteria.",
        category: "risk",
        confidence: "medium",
        themeIds: ["theme-risk"],
        evidenceObservationIds: [],
        evidenceSourceIds: [],
        sourceTypeCount: 1,
        method: "qualitative",
        caveats: [],
        tags: ["risk"],
        entities: [],
        signalTags: [],
        createdAt: "2026-05-07T00:00:00.000Z",
      },
    ],
    themes: [
      { id: "theme-trust", name: "Evidence trust", description: "Teams need visible proof.", findingIds: ["finding-evidence"], frequency: 8, sourceCount: 2, sourceTypeCount: 2, confidence: "high", signalTags: ["planning"], positiveCount: 7, negativeCount: 1 },
      { id: "theme-risk", name: "Launch risk", description: "Risk needs explicit review.", findingIds: ["finding-risk"], frequency: 5, sourceCount: 1, sourceTypeCount: 1, confidence: "medium", signalTags: ["risk"], positiveCount: 1, negativeCount: 4 },
    ],
    evidenceLinks: [],
    personas: [
      {
        name: "PM Priya",
        role: "Product manager",
        goals: ["Align the launch spec"],
        painPoints: ["Unclear evidence"],
        behaviors: ["Reviews research before writing PRDs"],
        source: "interviews",
        evidenceFindingIds: ["finding-evidence"],
      },
    ],
    quantitativeMetrics: [
      {
        id: "metric-confidence",
        source: "survey",
        field: "confidence",
        label: "Decision confidence",
        sampleSize: 18,
        missingCount: 0,
        missingRate: 0,
        min: 1,
        max: 5,
        mean: 3.7,
        median: 4,
        stdDev: 0.8,
        p25: 3,
        p75: 4,
        scaleType: "likert-1-5",
        buckets: [],
        outlierCount: 0,
        cohortComparisons: [],
      },
    ],
    opportunities: [{
      title: "Evidence-first spec handoff",
      summary: "Bring findings into the planning canvas.",
      theme: "Evidence trust",
      priority: "high",
      confidence: "high",
      evidenceFindingIds: ["finding-evidence"],
      sourceCount: 2,
    }],
    risks: [{
      title: "Risk review skipped",
      summary: "Teams may skip launch criteria without visible risk prompts.",
      theme: "Launch risk",
      severity: "high",
      evidenceFindingIds: ["finding-risk"],
      sourceCount: 1,
    }],
    contradictions: [{
      topic: "Speed versus confidence",
      positiveFindingIds: ["finding-evidence"],
      negativeFindingIds: ["finding-risk"],
      summary: "Some teams want speed, others want more evidence review.",
    }],
    reports: [],
    quality: { overallScore: 82, sampleSize: 18, completenessScore: 80, sourceDiversityScore: 70, triangulationScore: 75, structureScore: 85, notes: [], generatedAt: "2026-05-07T00:00:00.000Z" },
    methods: { analysisMode: "decision-grade", quantitativeApproach: "survey", qualitativeApproach: "interviews", limitations: [] },
  };
}

function makeSimulationReport(): SimulationReport {
  return {
    id: "report-swarm",
    runId: "run-swarm",
    scenarioId: "scenario-swarm",
    scenarioName: "Model Swarm Lab",
    hypothesis: "Evidence-linked planning reduces launch risk",
    generatedAt: "2026-05-07T00:00:00.000Z",
    summary: "Swarm recommends a visible evidence-to-spec handoff.",
    recommendations: ["Add evidence links to each requirement", "Show unresolved assumptions before build"],
    risks: ["Launch criteria may stay vague"],
    unresolvedAssumptions: ["PMs will trust generated evidence maps"],
    evidenceFindingIds: ["finding-evidence", "finding-risk"],
    events: [],
    interviews: [],
    budget: { maxAgents: 24, maxRounds: 2, maxTokens: 48000, maxWallTimeMs: 300000, maxEstimatedCostUsd: 0, allowLiveModels: false },
    modelProfiles: [],
    providerRuns: [],
    rounds: [
      {
        id: "round-1",
        runId: "run-swarm",
        scenarioId: "scenario-swarm",
        index: 1,
        phase: "debate",
        status: "completed",
        startedAt: "2026-05-07T00:00:00.000Z",
        completedAt: "2026-05-07T00:01:00.000Z",
        agentIds: ["agent-pm"],
        eventIds: [],
        transcriptIds: [],
        scorecard: { adoption: 0.8, resistance: 0.2, confidence: 0.7, risk: 0.3, evidenceCoverage: 0.9, modelDiversity: 0.4, recommendations: ["Make evidence visible"] },
      },
    ],
    transcripts: [],
    scorecard: { adoption: 0.8, resistance: 0.2, confidence: 0.7, risk: 0.3, evidenceCoverage: 0.9, modelDiversity: 0.4, recommendations: ["Make evidence visible"] },
    costs: { inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0 },
    comparisons: [],
  };
}
