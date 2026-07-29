import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRegradeAmendment,
  gradeCaseStudyResponse,
  parseCodexJsonl,
} from "../codex-evidence.js";
import { benchmarkRunRecordSchema } from "../contracts.js";

describe("Codex benchmark evidence", () => {
  it("extracts the final response, usage, and completed tool outcomes from JSONL", () => {
    const trace = [
      JSON.stringify({ type: "item.completed", item: {
        type: "command_execution",
        command: "rg --files",
        exit_code: 0,
        status: "completed",
      } }),
      JSON.stringify({ type: "item.completed", item: {
        type: "command_execution",
        command: "npm test",
        exit_code: 1,
        status: "failed",
      } }),
      JSON.stringify({ type: "item.completed", item: {
        type: "agent_message",
        text: "Interim",
      } }),
      JSON.stringify({ type: "item.completed", item: {
        type: "agent_message",
        text: "Final evidence",
      } }),
      JSON.stringify({ type: "turn.completed", usage: {
        input_tokens: 1_000,
        cached_input_tokens: 800,
        output_tokens: 120,
        reasoning_output_tokens: 30,
      } }),
    ].join("\n");

    expect(parseCodexJsonl(trace)).toEqual({
      finalResponse: "Final evidence",
      usage: {
        inputTokens: 1_000,
        cachedInputTokens: 800,
        outputTokens: 120,
        reasoningTokens: 30,
      },
      tools: {
        calls: 2,
        errors: 1,
        retries: 0,
      },
    });
  });

  it("grades only repository-valid line citations and required handoff sections", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memi-case-grader-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "theme.css"),
      ":root {\n  --surface: white;\n  --ink: black;\n}\n",
    );
    await writeFile(
      path.join(root, "src", "Button.tsx"),
      "export function Button() {\n  return <button />;\n}\n",
    );
    const response = [
      "Color and typography are defined in",
      `[theme](<${path.join(root, "src", "theme.css")}:1>).`,
      "The reusable component source is",
      `[Button](<${path.join(root, "src", "Button.tsx")}:1>).`,
      "Spacing, radius, and elevation are unresolved gaps.",
      "Verification commands:",
      "```sh",
      "rg -n -- '--surface' src",
      "```",
    ].join("\n");

    const grade = await gradeCaseStudyResponse({
      repositoryRoot: root,
      response,
      minimumValidCitations: 2,
      requiredTerms: [
        "color",
        "typography",
        "spacing",
        "radius",
        "elevation",
        "component",
      ],
    });

    expect(grade.accepted).toBe(true);
    expect(grade.invalidCitations).toEqual([]);
    expect(grade.validCitations).toHaveLength(2);
    expect(grade.missingTerms).toEqual([]);
    expect(grade.defects).toBe(0);
    expect(grade.qualityScore).toBe(100);
  });

  it("accepts repository-relative GitHub line anchors and ranges", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memi-anchor-grader-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "theme.css"),
      ":root {\n  --surface: white;\n  --ink: black;\n}\n",
    );
    const response = [
      "Color, typography, spacing, radius, elevation, and component gaps:",
      "[theme](src/theme.css#L1-L3)",
      "Unresolved gaps remain.",
      "Verification commands:",
      "```sh",
      "nl -ba src/theme.css",
      "```",
    ].join("\n");

    const grade = await gradeCaseStudyResponse({
      repositoryRoot: root,
      response,
      minimumValidCitations: 1,
      requiredTerms: [
        "color",
        "typography",
        "spacing",
        "radius",
        "elevation",
        "component",
      ],
    });

    expect(grade.accepted).toBe(true);
    expect(grade.validCitations).toEqual([
      { path: "src/theme.css", line: 1 },
    ]);
  });

  it("rejects missing files, out-of-range lines, and incomplete task coverage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memi-case-grader-"));
    await writeFile(path.join(root, "real.ts"), "export const value = 1;\n");
    const response = [
      `[bad-line](<${path.join(root, "real.ts")}:5>)`,
      `[missing](<${path.join(root, "missing.ts")}:1>)`,
      "Color only.",
    ].join("\n");

    const grade = await gradeCaseStudyResponse({
      repositoryRoot: root,
      response,
      minimumValidCitations: 2,
      requiredTerms: ["color", "typography"],
    });

    expect(grade.accepted).toBe(false);
    expect(grade.invalidCitations).toHaveLength(2);
    expect(grade.missingTerms).toEqual(["typography"]);
    expect(grade.hasGapDisclosure).toBe(false);
    expect(grade.hasVerificationCommands).toBe(false);
    expect(grade.defects).toBeGreaterThanOrEqual(5);
  });

  it("creates an immutable run amendment with explicit grader lineage", () => {
    const original = benchmarkRunRecordSchema.parse({
      schemaVersion: 1,
      runId: "run-baseline-1",
      experimentId: "exp",
      suiteId: "suite",
      taskId: "task",
      repeat: 1,
      condition: "baseline",
      repository: { pathHash: "sha256:repo", revision: "abc", dirty: false },
      harness: { id: "codex", modelId: "gpt", reasoningEffort: "medium" },
      timing: {
        startedAt: "2026-07-29T12:00:00.000Z",
        completedAt: "2026-07-29T12:01:00.000Z",
        wallTimeMs: 60_000,
        toolTimeMs: 0,
      },
      usage: {
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        reasoningTokens: 0,
        estimatedCostUsd: 0,
      },
      tools: { calls: 1, errors: 0, retries: 0 },
      outcome: {
        accepted: false,
        testsPassed: false,
        qualityScore: 70,
        defects: 6,
        humanInterventions: 0,
      },
      evidenceRefs: ["sha256:trace"],
    });

    const amended = createRegradeAmendment({
      original,
      graderVersion: "source-citations-v2",
      receiptRef: "sha256:receipt",
      grade: {
        accepted: true,
        qualityScore: 100,
        defects: 0,
        validCitations: [],
        invalidCitations: [],
        missingTerms: [],
        hasGapDisclosure: true,
        hasVerificationCommands: true,
      },
    });

    expect(amended).toMatchObject({
      runId: "run-baseline-1-regrade-source-citations-v2",
      graderVersion: "source-citations-v2",
      amendsRunId: "run-baseline-1",
      outcome: {
        accepted: true,
        testsPassed: true,
        qualityScore: 100,
        defects: 0,
      },
    });
    expect(original.outcome.accepted).toBe(false);
    expect(amended.evidenceRefs).toContain("sha256:receipt");
  });
});
