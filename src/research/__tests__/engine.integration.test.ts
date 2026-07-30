import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StickyNote } from "../../figma/bridge.js";
import { ResearchEngine } from "../engine.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("ResearchEngine integration", () => {
  it("ingests stickies and transcripts, synthesizes them, and restores the persisted store", async () => {
    const outputDir = await makeTemporaryDirectory();
    const events: string[] = [];
    const engine = new ResearchEngine({
      outputDir,
      onEvent: (event) => events.push(`${event.type}:${event.message}`),
    });

    await engine.load();
    expect(engine.getStore().sources).toEqual([]);

    const stickies: StickyNote[] = [
      makeSticky("sticky-1", "Navigation is confusing and users cannot find account settings.", 0),
      makeSticky("sticky-2", "Navigation labels are unclear and the settings route feels hidden.", 50),
      makeSticky("sticky-3", "Users need clearer navigation before they can manage their profile.", 100),
    ];
    const parsed = await engine.fromStickies(stickies);

    expect(parsed).toMatchObject({ totalStickies: 3 });
    expect(parsed.clusters).toHaveLength(1);
    expect(engine.getStore().observations).toHaveLength(3);
    expect(engine.getFindings().length).toBeGreaterThan(0);

    await engine.fromStickies(stickies.slice(0, 2));
    const snapshots = await readdir(join(outputDir, "snapshots"));
    expect(snapshots.length).toBeGreaterThan(0);
    expect(engine.getStore().observations.filter((item) => item.kind === "sticky")).toHaveLength(2);

    const transcriptPath = join(outputDir, "interview.txt");
    await writeFile(transcriptPath, [
      "[00:01] Interviewer: What makes the current navigation difficult for your team?",
      "[00:04] Participant: I always struggle to find account settings, and the hidden route is frustrating and slow.",
      "[00:12] Interviewer: What would make the workflow feel clearer?",
      "[00:16] Participant: I want persistent labels and a direct profile link because that would be simple and helpful.",
    ].join("\n"));

    const transcript = await engine.fromTranscript(transcriptPath, "navigation-interview");
    expect(transcript.speakers.map((speaker) => speaker.name)).toEqual(
      expect.arrayContaining(["Interviewer", "Participant"]),
    );
    expect(engine.getStore().sources.map((source) => source.type)).toEqual(
      expect.arrayContaining(["figjam-stickies", "transcript"]),
    );

    const synthesis = await engine.synthesize();
    expect(synthesis.summary.length).toBeGreaterThan(0);
    expect(engine.assessQuality().overallScore).toBeGreaterThan(0);

    const report = await engine.generateReport();
    expect(report).toContain("Research");
    await expect(readFile(join(outputDir, "reports", "report.json"), "utf-8")).resolves.toContain(
      "\"quality\"",
    );

    const restored = new ResearchEngine({ outputDir });
    await restored.load();
    expect(restored.getStore().sources).toHaveLength(engine.getStore().sources.length);
    expect(restored.getInsights()).toHaveLength(engine.getInsights().length);
    expect(events.some((event) => event.startsWith("success:"))).toBe(true);
  });

  it("turns a mixed CSV survey into observations, metrics, findings, and markdown notes", async () => {
    const outputDir = await makeTemporaryDirectory();
    const csvPath = join(outputDir, "navigation-survey.csv");
    const rows = Array.from({ length: 12 }, (_, index) => {
      const role = index < 6 ? "Designer" : "Engineer";
      const score = index < 6 ? 2 + (index % 2) : 4 + (index % 2);
      const response = index % 2 === 0
        ? "The navigation is confusing and I cannot find settings without searching."
        : "The navigation is slow and unclear, so our team needs persistent labels.";
      return `"Participant ${index + 1}","${role}","${response}",${score}`;
    });
    await writeFile(csvPath, [
      "Participant,Role,Response,Satisfaction",
      ...rows,
    ].join("\n"));

    const engine = new ResearchEngine({ outputDir });
    await engine.load();
    await engine.fromFile(csvPath);

    const store = engine.getStore();
    expect(store.sources).toEqual([
      expect.objectContaining({
        name: csvPath,
        type: "csv",
        sourceKind: "mixed",
        sampleSize: 12,
      }),
    ]);
    expect(store.observations).toHaveLength(12);
    expect(store.quantitativeMetrics.length).toBeGreaterThan(0);
    expect(store.findings.some((finding) => finding.method === "quantitative")).toBe(true);
    expect(store.findings.some((finding) => finding.method === "qualitative")).toBe(true);

    const noteFiles = await readdir(join(outputDir, "notes"));
    expect(noteFiles.some((name) => name.startsWith("metric-"))).toBe(true);
    expect(noteFiles.filter((name) => name.startsWith("obs-"))).toHaveLength(12);
  });

  it("migrates legacy insights, sources, personas, and themes into the v2 store", async () => {
    const outputDir = await makeTemporaryDirectory();
    await writeFile(join(outputDir, "insights.json"), JSON.stringify({
      sources: [{
        name: "customer-interviews",
        type: "transcript",
        processedAt: "2026-07-29T00:00:00.000Z",
        sampleSize: 4,
        notes: ["Moderated interviews"],
      }],
      insights: [{
        id: "legacy-insight-1",
        finding: "Users need persistent navigation labels to find account settings.",
        source: "customer-interviews",
        sourceType: "transcript",
        confidence: "high",
        category: "navigation",
        evidence: ["I cannot find settings when the labels disappear."],
        tags: ["navigation", "settings"],
        entities: ["Settings"],
        sentiment: "negative",
        signalTags: ["navigation"],
        createdAt: "2026-07-29T00:00:00.000Z",
      }],
      personas: [{
        name: "Product designer",
        role: "Designer",
        goals: ["Move quickly"],
        painPoints: ["Hidden settings"],
        behaviors: ["Searches navigation"],
        source: "customer-interviews",
        evidenceInsightIds: ["legacy-insight-1"],
      }],
      themes: [{
        name: "Navigation clarity",
        description: "Labels should remain visible.",
        insights: ["legacy-insight-1"],
        frequency: 4,
        sourceCount: 1,
        confidence: "high",
        signalTags: ["navigation"],
        positiveCount: 0,
        negativeCount: 4,
      }],
    }, null, 2));

    const engine = new ResearchEngine({ outputDir });
    await engine.load();

    const store = engine.getStore();
    expect(store.version).toBe(2);
    expect(store.sources[0]).toMatchObject({
      name: "customer-interviews",
      sourceKind: "qualitative",
    });
    expect(store.observations[0]).toMatchObject({
      kind: "transcript-segment",
      sentiment: "negative",
    });
    expect(store.findings[0]).toMatchObject({
      statement: "Users need persistent navigation labels to find account settings.",
      method: "qualitative",
      evidenceObservationIds: ["obs-1"],
    });
    expect(store.personas[0].evidenceFindingIds).toEqual(["legacy-insight-1"]);
    expect(store.themes[0].findingIds).toEqual(["finding-1"]);
    await expect(readFile(join(outputDir, "store.v2.json"), "utf-8")).resolves.toContain(
      "\"version\": 2",
    );
  });
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "memi-research-engine-"));
  temporaryDirectories.push(directory);
  return directory;
}

function makeSticky(id: string, text: string, x: number): StickyNote {
  return {
    id,
    text,
    color: "#ff5470",
    position: { x, y: 0 },
    size: { width: 220, height: 140 },
  };
}
