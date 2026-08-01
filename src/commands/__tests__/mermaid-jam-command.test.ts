import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Command } from "commander";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerMermaidJamCommand } from "../mermaid-jam.js";
import { captureLogs, lastLog } from "./test-helpers.js";

let projectRoot: string;
let mermaidJamRoot: string;
let originalMermaidJamRoot: string | undefined;

beforeEach(async () => {
  projectRoot = join(tmpdir(), `memoire-mermaid-jam-command-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mermaidJamRoot = join(projectRoot, "unicornjam");
  await mkdir(join(mermaidJamRoot, "plugin"), { recursive: true });
  await writeFile(join(mermaidJamRoot, "package.json"), JSON.stringify({
    name: "mermaid-jam",
    homepage: "https://www.figma.com/community/plugin/1631708567749401678",
    repository: { type: "git", url: "https://github.com/sarveshsea/mermaid-jam.git" },
  }), "utf-8");
  await writeFile(join(mermaidJamRoot, "plugin", "manifest.json"), JSON.stringify({
    name: "Mermaid Jam",
    id: "1631708567749401678",
    editorType: ["figjam"],
    main: "code.js",
    ui: "ui.html",
  }), "utf-8");
  await writeFile(join(mermaidJamRoot, "plugin", "code.js"), "figma.showUI(__html__);\n", "utf-8");
  await writeFile(join(mermaidJamRoot, "plugin", "ui.html"), "<div>Mermaid Jam</div>\n", "utf-8");
  originalMermaidJamRoot = process.env.MEMOIRE_MERMAID_JAM_ROOT;
  process.env.MEMOIRE_MERMAID_JAM_ROOT = mermaidJamRoot;
});

afterEach(async () => {
  if (originalMermaidJamRoot === undefined) delete process.env.MEMOIRE_MERMAID_JAM_ROOT;
  else process.env.MEMOIRE_MERMAID_JAM_ROOT = originalMermaidJamRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("mermaid-jam command", () => {
  it("prints the native FigJam bridge metadata in JSON mode", async () => {
    const logs = captureLogs();
    const program = new Command();

    registerMermaidJamCommand(program, makeEngine(projectRoot) as never);
    await program.parseAsync(["mermaid-jam", "status", "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload.status).toBe("ready");
    expect(payload.integration).toMatchObject({
      id: "mermaid-jam",
      kind: "figjam-plugin",
      local: {
        found: true,
        manifestPath: join(mermaidJamRoot, "plugin", "manifest.json"),
      },
    });
    expect(payload.integration.install.quickLinks[0]).toMatchObject({
      kind: "community",
      href: "https://www.figma.com/community/plugin/1631708567749401678",
    });
  });

  it("exports research-backed Mermaid Jam source artifacts in JSON mode", async () => {
    const logs = captureLogs();
    const program = new Command();

    registerMermaidJamCommand(program, makeEngine(projectRoot, {
      research: {
        async load() {},
        getStore() {
          return makeResearchStore();
        },
      },
    }) as never);
    await program.parseAsync([
      "mermaid-jam",
      "export",
      "--from",
      "research",
      "--intent",
      "Design an evidence-backed planning board",
      "--json",
    ], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      status: "exported",
      source: "research",
      exports: expect.arrayContaining([expect.objectContaining({
        kind: "journey-map",
        outputPath: expect.stringContaining(join(".memoire", "mermaid-jam")),
        source: expect.stringContaining("journey"),
      })]),
    });
    const written = await readFile(payload.exports[0].outputPath, "utf-8");
    expect(written).toContain("journey");
    expect(payload.exports[0].nextSteps.join(" ")).not.toMatch(/clipboard|paste automation/i);
  });
});

function makeEngine(root: string, extra: Record<string, unknown> = {}) {
  return {
    config: { projectRoot: root },
    async init() {},
    ...extra,
  };
}

function makeResearchStore() {
  return {
    version: 2,
    sources: [],
    observations: [],
    highlights: [],
    codebook: [],
    findings: [{
      id: "finding-evidence",
      statement: "Planning boards need visible evidence links.",
      category: "planning",
      confidence: "high",
      themeIds: ["theme-evidence"],
      evidenceObservationIds: [],
      evidenceSourceIds: [],
      sourceTypeCount: 1,
      method: "qualitative",
      caveats: [],
      tags: [],
      entities: [],
      signalTags: [],
      createdAt: "2026-05-07T00:00:00.000Z",
    }],
    themes: [{ id: "theme-evidence", name: "Evidence", description: "Visible proof", findingIds: ["finding-evidence"], frequency: 1, sourceCount: 1, sourceTypeCount: 1, confidence: "high", signalTags: [], positiveCount: 1, negativeCount: 0 }],
    evidenceLinks: [],
    personas: [{ name: "PM", role: "Product manager", goals: ["Ship a spec"], painPoints: ["Missing evidence"], behaviors: ["Reviews a planning board"], source: "manual", evidenceFindingIds: ["finding-evidence"] }],
    quantitativeMetrics: [],
    opportunities: [],
    risks: [],
    contradictions: [],
    reports: [],
    quality: { overallScore: 80, sampleSize: 3, completenessScore: 80, sourceDiversityScore: 60, triangulationScore: 70, structureScore: 80, notes: [], generatedAt: "2026-05-07T00:00:00.000Z" },
    methods: { analysisMode: "decision-grade", quantitativeApproach: "", qualitativeApproach: "", limitations: [] },
  };
}
