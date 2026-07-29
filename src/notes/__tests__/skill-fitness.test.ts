import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendSkillFitnessEvent,
  loadSkillFitnessEvents,
  projectSkillFitness,
  type SkillFitnessEvent,
} from "../skill-fitness.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("append-only skill fitness evidence", () => {
  it("persists immutable paired-run evidence and projects deterministic medians", async () => {
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
      recommendation: "promote",
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

  it("requires six quality-parity regressions before recommending quarantine", () => {
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
