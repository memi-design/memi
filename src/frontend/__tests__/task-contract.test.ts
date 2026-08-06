import { describe, expect, it } from "vitest";
import {
  FrontendTaskContractV1Schema,
  createFrontendTaskContract,
} from "../task-contract.js";

const HASH = `sha256:${"a".repeat(64)}`;

function validContractInput() {
  return {
    taskId: "responsive-settings-panel",
    taskClass: "frontend-modification" as const,
    platform: "web" as const,
    intent: "Make the settings panel responsive without changing its behavior.",
    targetFiles: ["src/z.tsx", "src/a.tsx", "src/a.tsx"],
    targetComponents: ["SettingsPanel", "Button", "Button"],
    requiredStates: ["error", "default", "default"],
    constraints: ["Preserve public props", "Use existing tokens", "Use existing tokens"],
    verificationCommands: ["npm run typecheck", "npm test -- settings"],
    resourceCeilings: {
      inputTokens: 40_000,
      outputTokens: 8_000,
      reasoningTokens: 12_000,
      wallTimeMs: 600_000,
      toolCalls: 40,
      implementationAttempts: 2 as const,
    },
    contextExpansion: {
      state: "requested" as const,
      reasonCode: "missing-repository-evidence" as const,
      evidenceMissSha256: HASH,
    },
  };
}

describe("FrontendTaskContractV1", () => {
  it("normalizes set-like fields deterministically and freezes the result", () => {
    const contract = createFrontendTaskContract(validContractInput());

    expect(contract).toMatchObject({
      schemaVersion: "frontend-task-contract.v1",
      targetFiles: ["src/a.tsx", "src/z.tsx"],
      targetComponents: ["Button", "SettingsPanel"],
      requiredStates: ["default", "error"],
      constraints: ["Preserve public props", "Use existing tokens"],
      verificationCommands: ["npm run typecheck", "npm test -- settings"],
    });
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.resourceCeilings)).toBe(true);
    expect(Object.isFrozen(contract.targetFiles)).toBe(true);
    expect(() => {
      (contract.targetFiles as string[]).push("src/late.tsx");
    }).toThrow();
  });

  it("models at most one reason-coded context expansion state", () => {
    expect(() => createFrontendTaskContract({
      ...validContractInput(),
      contextExpansion: {
        state: "requested",
        reasonCode: "missing-skill-evidence",
      },
    } as never)).toThrow(/evidenceMissSha256/i);

    const unused = createFrontendTaskContract({
      ...validContractInput(),
      contextExpansion: { state: "unused" },
    });
    expect(unused.contextExpansion).toEqual({ state: "unused" });
  });

  it("rejects unknown fields, unsafe paths, and more than two implementation attempts", () => {
    expect(() => FrontendTaskContractV1Schema.parse({
      ...createFrontendTaskContract(validContractInput()),
      surprise: true,
    })).toThrow();

    expect(() => createFrontendTaskContract({
      ...validContractInput(),
      targetFiles: ["../outside.tsx"],
    })).toThrow(/repository-relative/i);

    expect(() => createFrontendTaskContract({
      ...validContractInput(),
      resourceCeilings: {
        ...validContractInput().resourceCeilings,
        implementationAttempts: 3,
      },
    } as never)).toThrow();
  });
});
