import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  CONTEXT_CAPSULE_DEFAULT_BUDGETS,
  ContextCapsuleV1Schema,
  createContextCapsule,
} from "../context-capsule.js";

function validCapsuleInput() {
  return {
    taskRoute: [
      { id: "route", content: "platform=web; action=modify" },
      { id: "task", content: "Make settings responsive" },
    ],
    skills: [
      { id: "responsive", content: "Use content-driven breakpoints." },
      { id: "duplicate", content: "Make settings responsive" },
    ],
    repositoryEvidence: [
      { id: "component", content: "SettingsPanel lives in src/settings.tsx" },
      { id: "tokens", content: "Use var(--space-4)" },
    ],
    verification: [
      { id: "checks", content: "Run typecheck and responsive Playwright checks" },
    ],
  };
}

describe("ContextCapsuleV1", () => {
  it("uses the fixed 20 KB section budget and rejects section overflow", () => {
    expect(CONTEXT_CAPSULE_DEFAULT_BUDGETS).toEqual({
      taskRouteBytes: 1_024,
      skillBytes: 4_096,
      repositoryEvidenceBytes: 12_288,
      verificationBytes: 3_072,
      totalBytes: 20_480,
    });

    expect(() => createContextCapsule({
      ...validCapsuleInput(),
      taskRoute: [{ id: "too-large", content: "é".repeat(513) }],
    })).toThrow(/taskRoute.*1024 bytes/i);
  });

  it("deduplicates evidence globally, orders deterministically, and content-addresses sections", () => {
    const capsule = createContextCapsule(validCapsuleInput());
    const reordered = createContextCapsule({
      ...validCapsuleInput(),
      repositoryEvidence: [...validCapsuleInput().repositoryEvidence].reverse(),
      taskRoute: [...validCapsuleInput().taskRoute].reverse(),
    });

    expect(capsule.identitySha256).toBe(reordered.identitySha256);
    expect(capsule.identitySha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(capsule.sections.taskRoute.evidence.map((item) => item.id)).toEqual([
      "route",
      "task",
    ]);
    expect(capsule.sections.skills.evidence.map((item) => item.id)).toEqual([
      "responsive",
    ]);
    expect(capsule.sections.taskRoute.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(capsule.sections.taskRoute.byteLength).toBe(
      Buffer.byteLength("platform=web; action=modify")
      + Buffer.byteLength("Make settings responsive"),
    );
  });

  it("does not mutate inputs and returns a deeply immutable capsule", () => {
    const input = validCapsuleInput();
    const before = structuredClone(input);
    const capsule = createContextCapsule(input);

    expect(input).toEqual(before);
    expect(Object.isFrozen(capsule)).toBe(true);
    expect(Object.isFrozen(capsule.sections)).toBe(true);
    expect(Object.isFrozen(capsule.sections.skills.evidence)).toBe(true);
    expect(() => {
      (capsule.sections.skills.evidence as unknown[]).push({});
    }).toThrow();
  });

  it("rejects tampered byte counts, hashes, budgets, and unknown fields", () => {
    const capsule = createContextCapsule(validCapsuleInput());

    expect(() => ContextCapsuleV1Schema.parse({
      ...capsule,
      budgets: { ...capsule.budgets, totalBytes: 20_481 },
    })).toThrow();
    expect(() => ContextCapsuleV1Schema.parse({
      ...capsule,
      sections: {
        ...capsule.sections,
        skills: { ...capsule.sections.skills, byteLength: 1 },
      },
    })).toThrow(/byteLength/i);
    expect(() => ContextCapsuleV1Schema.parse({
      ...capsule,
      identitySha256: `sha256:${"0".repeat(64)}`,
    })).toThrow(/identitySha256/i);
    expect(() => ContextCapsuleV1Schema.parse({ ...capsule, surprise: true })).toThrow();
  });
});
