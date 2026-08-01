import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendSkillFitnessEvent,
  buildSkillFitnessEvent,
  loadSkillFitnessEvents,
  projectSkillFitness,
  type SkillFitnessEvent,
} from "../skill-fitness.js";
import type { BenchmarkRunRecord } from "../../efficiency/contracts.js";
import type { SkillRouteResult } from "../skill-router.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("append-only skill fitness evidence", () => {
  it("loads legacy v1 evidence without allowing automation-only promotion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-skill-fitness-"));
    tempDirs.push(root);
    const store = path.join(root, "fitness.jsonl");
    await appendSkillFitnessEvent(store, event("event-1", 0.2, 0.1));
    await appendSkillFitnessEvent(store, event("event-2", 0.4, 0.3));
    await appendSkillFitnessEvent(store, event("event-3", 0.3, 0.2));

    const events = await loadSkillFitnessEvents(store);
    const projection = projectSkillFitness(events);

    expect(events).toHaveLength(3);
    expect(projection.skills[0]).toMatchObject({
      skillId: "expo-router-navigation",
      contentHash: `sha256:${"a".repeat(64)}`,
      samples: 3,
      qualityParityRate: 1,
      medianTokenSavingsRatio: 0.3,
      medianLatencySavingsRatio: 0.2,
      recommendation: "observe",
    });
    expect((await readFile(store, "utf8")).trim().split("\n")).toHaveLength(3);
  });

  it("rejects duplicate event identities instead of rewriting history", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-skill-fitness-"));
    tempDirs.push(root);
    const store = path.join(root, "fitness.jsonl");
    await appendSkillFitnessEvent(store, event("event-1", 0.2, 0.1));

    await expect(
      appendSkillFitnessEvent(store, event("event-1", 0.4, 0.3)),
    ).rejects.toThrow(/already exists/);
  });

  it("fails deterministically on corrupt and duplicate persisted evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-skill-fitness-"));
    tempDirs.push(root);
    const store = path.join(root, "fitness.jsonl");
    await writeFile(store, "not-json\n");
    await expect(loadSkillFitnessEvents(store)).rejects.toThrow(/line 1/);

    const duplicate = event("duplicate", 0.2, 0.1);
    await writeFile(store, `${JSON.stringify(duplicate)}\n${JSON.stringify(duplicate)}\n`);
    await expect(loadSkillFitnessEvents(store)).rejects.toThrow(
      /Duplicate skill fitness event duplicate/,
    );
  });

  it("rejects symlinked and oversized fitness stores", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-skill-fitness-"));
    tempDirs.push(root);
    const target = path.join(root, "target.jsonl");
    const linked = path.join(root, "linked.jsonl");
    await writeFile(target, `${JSON.stringify(event("linked", 0.2, 0.1))}\n`);
    await symlink(target, linked);
    await expect(loadSkillFitnessEvents(linked)).rejects.toThrow(/non-symlink/);
    await expect(loadSkillFitnessEvents(target, { maxBytes: 8 })).rejects.toThrow(
      /byte safety limit/,
    );
  });

  it("quarantines immediately when legacy evidence records a quality regression", () => {
    const regressions = Array.from({ length: 6 }, (_, index) => ({
      ...event(`event-${index}`, -0.2, -0.1),
      qualityParity: index !== 5,
    }));
    const early = projectSkillFitness(regressions.slice(0, 5));
    const mature = projectSkillFitness(regressions);

    expect(early.skills[0].recommendation).toBe("observe");
    expect(mature.skills[0].recommendation).toBe("quarantine");
    expect(mature.skills[0].samples).toBe(6);
  });

  it("derives a fitness event only from an environment-matched immutable pair", () => {
    const baseline = run("baseline", 2_000, 120_000, 20);
    const memi = run("memi", 1_000, 90_000, 15);

    const result = buildSkillFitnessEvent({
      baseline,
      memi,
      route: skillRoute(),
      taskClass: "expo-bottom-tab-badge",
    });

    expect(result).toMatchObject({
      repositoryFingerprintHash: `sha256:${"b".repeat(64)}`,
      qualityParity: true,
      tokenSavingsRatio: 0.5,
      latencySavingsRatio: 0.25,
      toolCallSavingsRatio: 0.25,
      skills: [{
        skillId: "expo-router-navigation",
        contentHash: `sha256:${"a".repeat(64)}`,
      }],
    });
    expect(result.eventId).toMatch(/^fitness:[a-f0-9]{64}$/);

    expect(() => buildSkillFitnessEvent({
      baseline,
      memi: {
        ...memi,
        repository: { ...memi.repository, revision: "different" },
      },
      route: skillRoute(),
      taskClass: "expo-bottom-tab-badge",
    })).toThrow(/repository revision mismatch/);
  });
});

function event(
  eventId: string,
  tokenSavingsRatio: number,
  latencySavingsRatio: number,
): SkillFitnessEvent {
  return {
    schemaVersion: 1,
    eventId,
    createdAt: "2026-07-29T00:00:00.000Z",
    routerVersion: "skill-router-v2",
    repositoryFingerprintHash: `sha256:${"b".repeat(64)}`,
    taskClass: "expo-bottom-tab-badge",
    harness: {
      provider: "codex",
      modelId: "gpt-5.6-sol",
      reasoningEffort: "medium",
    },
    pair: {
      baselineRunId: `baseline-${eventId}`,
      memiRunId: `memi-${eventId}`,
    },
    skills: [{
      skillId: "expo-router-navigation",
      contentHash: `sha256:${"a".repeat(64)}`,
    }],
    qualityParity: true,
    tokenSavingsRatio,
    latencySavingsRatio,
    toolCallSavingsRatio: 0.1,
  };
}

function run(
  condition: "baseline" | "memi",
  totalTokens: number,
  wallTimeMs: number,
  calls: number,
): BenchmarkRunRecord {
  return {
    schemaVersion: 1,
    runId: `run-${condition}`,
    experimentId: "buzzr-router-v2",
    suiteId: "product-flow-v1",
    taskId: "buzzr-tab-unread-badge",
    repeat: 1,
    condition,
    repository: {
      pathHash: `sha256:${"c".repeat(64)}`,
      revision: "7583ab4",
      dirty: false,
    },
    harness: {
      id: "codex",
      modelId: "gpt-5.6-sol",
      reasoningEffort: "medium",
    },
    timing: {
      startedAt: "2026-07-29T00:00:00.000Z",
      completedAt: "2026-07-29T00:05:00.000Z",
      wallTimeMs,
      toolTimeMs: 10_000,
    },
    usage: {
      inputTokens: totalTokens - 200,
      cachedInputTokens: 0,
      outputTokens: 150,
      reasoningTokens: 50,
      estimatedCostUsd: null,
    },
    tools: { calls, errors: 0, retries: 0 },
    outcome: {
      accepted: true,
      testsPassed: true,
      qualityScore: 100,
      defects: 0,
      humanInterventions: 0,
    },
    evidenceRefs: [],
  };
}

function skillRoute(): SkillRouteResult {
  return {
    schemaVersion: 2,
    routerVersion: "skill-router-v2",
    decision: "single",
    intentHash: `sha256:${"d".repeat(64)}`,
    repositoryFingerprintHash: `sha256:${"b".repeat(64)}`,
    selected: [{
      id: "expo-router-navigation",
      skillName: "expo-router-navigation",
      file: "/skills/expo-router-navigation/SKILL.md",
      score: 120,
      matchedTerms: ["bottom-tab-badge"],
      contentHash: `sha256:${"a".repeat(64)}`,
      contextBytes: 1_920,
      explanation: {
        intentEvidence: ["bottom-tab-badge"],
        repositoryEvidence: ["dependency:expo-router"],
      },
    }],
    excluded: [],
    candidates: [{
      id: "expo-router-navigation",
      score: 120,
      matchedTerms: ["bottom-tab-badge"],
    }],
    contextBytes: 1_920,
    maximumContextBytes: 8_000,
  };
}
