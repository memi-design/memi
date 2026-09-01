import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerResearchCommand } from "../research.js";
import { captureLogs, lastLog } from "./test-helpers.js";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe("research --json", () => {
  it.each([
    ["plan-only", ["research", "web", "offline planning", "--plan-only", "--json"]],
    ["no URLs", ["research", "web", "offline planning", "--json"]],
  ])("keeps %s web research planning read-only", async (_label, argv) => {
    const logs = captureLogs();
    const engine = makeResearchEngine();
    const init = vi.spyOn(engine, "init");
    const load = vi.spyOn(engine.research, "load");
    const program = new Command();

    registerResearchCommand(program, engine as never);
    await program.parseAsync(argv, { from: "user" });

    expect(init).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(logs).toHaveLength(1);
    expect(JSON.parse(lastLog(logs))).toMatchObject({
      action: "web",
      mode: "plan-only",
      plan: { queries: expect.arrayContaining(["offline planning"]) },
    });
  });

  it("emits a single structured payload for from-file --json", async () => {
    const logs = captureLogs();
    const program = new Command();

    registerResearchCommand(program, makeResearchEngine() as never);
    await program.parseAsync(["research", "from-file", "fixtures/interviews.csv", "--json"], { from: "user" });

    expect(logs).toHaveLength(1);
    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      action: "from-file",
      status: "completed",
      options: { json: true },
      source: {
        type: "file",
        path: "fixtures/interviews.csv",
      },
      summary: {
        observations: 6,
        findings: 3,
        themes: 2,
        personas: 1,
        sources: 2,
        quantitativeMetrics: 2,
      },
      artifacts: {
        researchDir: join("/workspace", "research"),
        storePath: join("/workspace", "research", "store.v2.json"),
        notesDir: join("/workspace", "research", "notes"),
        reportMarkdownPath: join("/workspace", "research", "reports", "report.md"),
        reportJsonPath: join("/workspace", "research", "reports", "report.json"),
      },
    });
  });

  it("emits sticky metadata without preamble logs for from-stickies --json", async () => {
    const logs = captureLogs();
    const program = new Command();

    registerResearchCommand(program, makeResearchEngine({ figmaConnected: false }) as never);
    await program.parseAsync(["research", "from-stickies", "--json"], { from: "user" });

    expect(logs).toHaveLength(1);
    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      action: "from-stickies",
      status: "completed",
      stickies: {
        total: 5,
        clusters: 2,
        unclustered: 1,
        summary: "Processed 5 sticky notes",
        autoConnected: true,
      },
    });
  });

  it("emits synthesis, quality, and report metadata for JSON modes", async () => {
    const synthLogs = captureLogs();
    const synthProgram = new Command();
    registerResearchCommand(synthProgram, makeResearchEngine() as never);

    await synthProgram.parseAsync(["research", "synthesize", "--json"], { from: "user" });

    expect(synthLogs).toHaveLength(1);
    const synthPayload = JSON.parse(lastLog(synthLogs));
    expect(synthPayload).toMatchObject({
      action: "synthesize",
      status: "completed",
      synthesis: {
        summary: "Synthesized 2 themes",
        themes: 2,
        topTheme: "Navigation",
        personas: 1,
        opportunities: 2,
        topOpportunity: "Invest in Navigation",
        risks: 1,
        topRisk: "Navigation is a product risk",
        contradictions: 1,
        quantitativeMetrics: 2,
        qualityScore: 84,
        sampleSize: 42,
      },
    });

    vi.restoreAllMocks();

    const qualityLogs = captureLogs();
    const qualityProgram = new Command();
    registerResearchCommand(qualityProgram, makeResearchEngine() as never);

    await qualityProgram.parseAsync(["research", "quality", "--json"], { from: "user" });

    expect(qualityLogs).toHaveLength(1);
    const qualityPayload = JSON.parse(lastLog(qualityLogs));
    expect(qualityPayload).toMatchObject({
      action: "quality",
      status: "completed",
      quality: {
        overallScore: 84,
        sampleSize: 42,
        completenessScore: 92,
        sourceDiversityScore: 75,
        triangulationScore: 80,
        structureScore: 88,
      },
    });

    vi.restoreAllMocks();

    const reportLogs = captureLogs();
    const reportProgram = new Command();
    registerResearchCommand(reportProgram, makeResearchEngine() as never);

    await reportProgram.parseAsync(["research", "report", "--json"], { from: "user" });

    expect(reportLogs).toHaveLength(1);
    const reportPayload = JSON.parse(lastLog(reportLogs));
    expect(reportPayload).toMatchObject({
      action: "report",
      status: "completed",
      report: {
        markdownPath: join("/workspace", "research", "reports", "report.md"),
        jsonPath: join("/workspace", "research", "reports", "report.json"),
        markdownBytes: Buffer.byteLength("# Report\nOne finding\n", "utf-8"),
        markdownLines: 3,
      },
    });
  });

  it("emits a research-backed design package in JSON mode", async () => {
    const logs = captureLogs();
    const program = new Command();

    registerResearchCommand(program, makeResearchEngine() as never);
    await program.parseAsync([
      "research",
      "design",
      "--intent",
      "Design a research-backed planning surface",
      "--hypothesis",
      "Evidence links improve planning confidence",
      "--json",
    ], { from: "user" });

    expect(logs).toHaveLength(1);
    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      action: "design",
      status: "completed",
      package: {
        brief: { audience: expect.any(Array) },
        specs: {
          design: [expect.objectContaining({ name: "ResearchVibeDirection" })],
          ia: [expect.objectContaining({ name: "ResearchBackedIA" })],
          pages: [expect.objectContaining({ name: "ProductDecisionPage" })],
          components: expect.arrayContaining([expect.objectContaining({ name: "ResearchHero" })]),
        },
        mermaidArtifacts: expect.arrayContaining([expect.objectContaining({ kind: "journey-map", source: expect.stringContaining("journey") })]),
      },
    });
  });

  it("writes generated specs and Mermaid Jam artifacts from research design", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-research-design-command-"));
    try {
      const logs = captureLogs();
      const savedSpecs: unknown[] = [];
      const program = new Command();
      registerResearchCommand(program, makeResearchEngine({
        projectRoot: root,
        registry: { async saveSpec(spec: unknown) { savedSpecs.push(spec); } },
      }) as never);

      await program.parseAsync([
        "research",
        "design",
        "--write-specs",
        "--mermaid-jam",
        "--json",
      ], { from: "user" });

      const payload = JSON.parse(lastLog(logs));
      expect(savedSpecs.length).toBeGreaterThan(3);
      expect(payload.specWrite).toMatchObject({ written: expect.arrayContaining(["ResearchVibeDirection", "ProductDecisionPage"]) });
      expect(payload.mermaidJam.exports[0]).toMatchObject({
        outputPath: expect.stringContaining(join(".memoire", "mermaid-jam")),
      });
      const artifact = await readFile(payload.mermaidJam.exports[0].outputPath, "utf-8");
      expect(artifact).toContain("journey");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function makeResearchEngine(input?: { figmaConnected?: boolean; projectRoot?: string; registry?: unknown }) {
  return {
    config: { projectRoot: input?.projectRoot ?? "/workspace" },
    async init() {},
    async connectFigma() {},
    registry: input?.registry ?? { async saveSpec() {} },
    figma: {
      isConnected: input?.figmaConnected ?? true,
      async extractStickies() {
        return [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }, { text: "E" }];
      },
    },
    research: {
      async load() {},
      async fromFile() {},
      async fromStickies() {
        return {
          totalStickies: 5,
          clusters: [{}, {}],
          unclustered: [{}],
          summary: "Processed 5 sticky notes",
        };
      },
      async synthesize() {
        return {
          summary: "Synthesized 2 themes",
          themes: [{ name: "Navigation" }, { name: "Trust" }],
        };
      },
      async generateReport() {
        return "# Report\nOne finding\n";
      },
      assessQuality() {
        return {
          overallScore: 84,
          sampleSize: 42,
          completenessScore: 92,
          sourceDiversityScore: 75,
          triangulationScore: 80,
          structureScore: 88,
          notes: ["Coverage is strong."],
          generatedAt: "2026-04-17T00:00:00.000Z",
        };
      },
      getStore() {
        return {
          findings: [
            { id: "finding-nav", statement: "PMs need visible evidence while shaping design direction.", category: "planning", confidence: "high", themeIds: ["theme-nav"], evidenceObservationIds: [], evidenceSourceIds: [], sourceTypeCount: 2, method: "qualitative", caveats: [], tags: [], entities: [], signalTags: [], createdAt: "2026-05-07T00:00:00.000Z" },
            { id: "finding-risk", statement: "Ambiguous risks slow down product handoff.", category: "risk", confidence: "low", themeIds: ["theme-risk"], evidenceObservationIds: [], evidenceSourceIds: [], sourceTypeCount: 1, method: "qualitative", caveats: [], tags: [], entities: [], signalTags: [], createdAt: "2026-05-07T00:00:00.000Z" },
            { id: "finding-metric", statement: "Decision confidence should be tracked after design review.", category: "metric", confidence: "medium", themeIds: [], evidenceObservationIds: [], evidenceSourceIds: [], sourceTypeCount: 1, method: "mixed", caveats: [], tags: [], entities: [], signalTags: [], createdAt: "2026-05-07T00:00:00.000Z" },
          ],
          themes: [
            { id: "theme-nav", name: "Navigation", description: "Navigation evidence", findingIds: ["finding-nav"], frequency: 2, sourceCount: 2, sourceTypeCount: 2, confidence: "high", signalTags: [], positiveCount: 2, negativeCount: 0 },
            { id: "theme-risk", name: "Trust", description: "Risk clarity", findingIds: ["finding-risk"], frequency: 1, sourceCount: 1, sourceTypeCount: 1, confidence: "low", signalTags: [], positiveCount: 0, negativeCount: 1 },
          ],
          personas: [{ name: "PM", role: "Product manager", goals: ["Align decisions"], painPoints: ["Missing evidence"], behaviors: ["Reviews research"], source: "interview", evidenceFindingIds: ["finding-nav"] }],
          sources: [{ name: "CSV" }, { name: "FigJam" }],
          opportunities: [{ title: "Invest in Navigation" }, { title: "Invest in Trust" }],
          risks: [{ title: "Navigation is a product risk", summary: "Risk summary", theme: "Trust", severity: "high", evidenceFindingIds: ["finding-risk"], sourceCount: 1 }],
          contradictions: [{ topic: "Navigation", positiveFindingIds: ["finding-nav"], negativeFindingIds: ["finding-risk"], summary: "Teams need speed and confidence." }],
          quantitativeMetrics: [
            { id: "metric-csat", source: "survey", field: "CSAT", label: "CSAT", sampleSize: 12, missingCount: 0, missingRate: 0, min: 1, max: 5, mean: 4, median: 4, stdDev: 0.5, p25: 3, p75: 5, scaleType: "likert-1-5", buckets: [], outlierCount: 0, cohortComparisons: [] },
            { id: "metric-nps", source: "survey", field: "NPS", label: "NPS", sampleSize: 12, missingCount: 0, missingRate: 0, min: 0, max: 10, mean: 7, median: 8, stdDev: 1, p25: 6, p75: 9, scaleType: "nps-0-10", buckets: [], outlierCount: 0, cohortComparisons: [] },
          ],
          quality: {
            overallScore: 84,
            sampleSize: 42,
            completenessScore: 92,
            sourceDiversityScore: 75,
            triangulationScore: 80,
            structureScore: 88,
            notes: [],
            generatedAt: "2026-05-07T00:00:00.000Z",
          },
          observations: [{}, {}, {}, {}, {}, {}],
          highlights: [],
          codebook: [],
          evidenceLinks: [],
          reports: [],
          version: 2,
          methods: { analysisMode: "decision-grade", quantitativeApproach: "", qualitativeApproach: "", limitations: [] },
        };
      },
    },
  };
}
