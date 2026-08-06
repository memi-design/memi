import { describe, expect, it } from "vitest";
import {
  WorkflowReceiptV3Schema,
  assertCandidateIndependentReceiptFields,
  assertExactRouteReceiptFields,
  createWorkflowReceiptV3,
  verifyWorkflowReceiptV3,
  type WorkflowReceiptV3Input,
} from "../workflow-receipt-v3.js";

const sha = (character: string) => `sha256:${character.repeat(64)}`;

function receiptInput(
  overrides: Partial<WorkflowReceiptV3Input> = {},
): WorkflowReceiptV3Input {
  return {
    receiptId: "receipt-web-001",
    recordedAt: "2026-08-06T16:00:05.000Z",
    sequence: 1,
    stable: {
      protocolSha256: sha("1"),
      suiteId: "memi-2.8-aa",
      experimentId: "frontend-aa-1",
      pairId: "pair-web-1",
      taskId: "responsive-dashboard",
      repeat: 1,
      taskClass: "frontend-modification",
      taskContractSha256: sha("2"),
      repository: {
        fingerprintSha256: sha("3"),
        revision: "a".repeat(40),
        fixtureSha256: sha("4"),
      },
      runtime: {
        provider: "openai",
        model: "gpt-5.6",
        effort: "high",
      },
    },
    candidate: {
      condition: "memi",
      candidateId: "memi-2.8.0-rc.1",
      artifactSha256: sha("5"),
    },
    route: {
      decision: "selected",
      routerVersion: "frontend-router.v3",
      taskClass: "frontend-modification",
      repositoryFingerprintSha256: sha("3"),
      provider: "openai",
      model: "gpt-5.6",
      effort: "high",
      skill: {
        id: "implement-adaptive-interface",
        file: "skills/implement-adaptive-interface/SKILL.md",
        contentSha256: sha("6"),
      },
    },
    contextCapsules: {
      initial: {
        identitySha256: sha("7"),
        taskRouteSha256: sha("8"),
        skillsSha256: sha("9"),
        repositoryEvidenceSha256: sha("a"),
        verificationSha256: sha("b"),
      },
      expansions: [{
        expansionId: "expansion-1",
        requestedAt: "2026-08-06T16:00:01.000Z",
        reason: "missing-repository-evidence",
        evidenceMissSha256: sha("c"),
        fromCapsuleSha256: sha("7"),
        toCapsuleSha256: sha("d"),
      }],
    },
    execution: {
      startedAt: "2026-08-06T16:00:00.000Z",
      completedAt: "2026-08-06T16:00:04.000Z",
      stopReason: "verification-passed",
      attempts: [
        {
          attemptId: "attempt-1",
          startedAt: "2026-08-06T16:00:00.000Z",
          completedAt: "2026-08-06T16:00:01.000Z",
          outcome: "retryable-failure",
          usage: {
            inputTokens: 100,
            cachedInputTokens: 25,
            outputTokens: 20,
            reasoningTokens: 10,
            toolCalls: 2,
            toolErrors: 1,
            toolOutputBytes: 500,
            agentWallTimeMs: 1_000,
            toolWallTimeMs: 400,
          },
        },
        {
          attemptId: "attempt-2",
          startedAt: "2026-08-06T16:00:02.000Z",
          completedAt: "2026-08-06T16:00:04.000Z",
          outcome: "completed",
          usage: {
            inputTokens: 80,
            cachedInputTokens: 10,
            outputTokens: 30,
            reasoningTokens: 15,
            toolCalls: 3,
            toolErrors: 0,
            toolOutputBytes: 700,
            agentWallTimeMs: 2_000,
            toolWallTimeMs: 600,
          },
        },
      ],
      retries: [{
        retryId: "retry-1",
        afterAttemptId: "attempt-1",
        requestedAt: "2026-08-06T16:00:01.500Z",
        reason: "provider-transient",
        evidenceSha256: sha("e"),
      }],
      usage: {
        inputTokens: 180,
        cachedInputTokens: 35,
        outputTokens: 50,
        reasoningTokens: 25,
        toolCalls: 5,
        toolErrors: 1,
        toolOutputBytes: 1_200,
        agentWallTimeMs: 3_000,
        toolWallTimeMs: 1_000,
      },
      billing: {
        status: "measured",
        currency: "USD",
        amount: 0.42,
        usageArtifactSha256: sha("f"),
        priceCardSha256: sha("0"),
      },
    },
    nativeEvidence: {
      status: "admitted",
      platform: "web",
      artifacts: [{
        evidenceId: "desktop-render",
        kind: "screenshot",
        file: "evidence/desktop.png",
        sha256: sha("a"),
        capturedAt: "2026-08-06T16:00:03.000Z",
        verifiedAt: "2026-08-06T16:00:04.000Z",
        freshUntil: "2026-08-06T16:05:04.000Z",
        freshnessWindowMs: 300_000,
      }],
    },
    verification: [{
      verificationId: "verify-render",
      kind: "rendered-flow",
      commandSha256: sha("b"),
      status: "passed",
      exitCode: 0,
      startedAt: "2026-08-06T16:00:03.000Z",
      completedAt: "2026-08-06T16:00:04.000Z",
      durationMs: 1_000,
      outputSha256: sha("c"),
    }],
    ...overrides,
  };
}

describe("WorkflowReceiptV3", () => {
  it("seals a repository-only abstention without inventing a skill", () => {
    const input = receiptInput();
    const receipt = createWorkflowReceiptV3({
      ...input,
      route: {
        decision: "repository-only",
        routerVersion: "frontend-router.v3",
        taskClass: input.stable.taskClass,
        repositoryFingerprintSha256: input.stable.repository.fingerprintSha256,
        provider: input.stable.runtime.provider,
        model: input.stable.runtime.model,
        effort: input.stable.runtime.effort,
        skill: null,
        abstentionReason: "incomplete-evidence",
      },
    });

    expect(receipt.route).toMatchObject({
      decision: "repository-only",
      skill: null,
      abstentionReason: "incomplete-evidence",
    });
  });

  it("records native exclusion without fabricating artifacts", () => {
    const input = receiptInput();
    const receipt = createWorkflowReceiptV3({
      ...input,
      execution: {
        ...input.execution,
        stopReason: "preflight-failed",
        attempts: [],
        retries: [],
        usage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          toolCalls: 0,
          toolErrors: 0,
          toolOutputBytes: 0,
          agentWallTimeMs: 0,
          toolWallTimeMs: 0,
        },
      },
      nativeEvidence: {
        status: "excluded",
        platform: "expo",
        artifacts: [],
        reason: "preflight-failed",
      },
      verification: [{
        ...input.verification[0],
        status: "skipped",
        exitCode: null,
      }],
    });

    expect(receipt.nativeEvidence).toEqual({
      status: "excluded",
      platform: "expo",
      artifacts: [],
      reason: "preflight-failed",
    });
  });

  it("records contracted budget enforcement and measurement limitations", () => {
    const input = receiptInput();
    const receipt = createWorkflowReceiptV3({
      ...input,
      execution: {
        ...input.execution,
        stopReason: "tool-budget-exhausted",
        attempts: [{
          ...input.execution.attempts[0],
          outcome: "fatal-failure",
          usage: {
            ...input.execution.usage,
            reasoningTokens: 0,
            toolCalls: 3,
          },
        }],
        retries: [],
        usage: {
          ...input.execution.usage,
          reasoningTokens: 0,
          toolCalls: 3,
        },
        budgetEnforcement: {
          ceilings: {
            inputTokens: 1_000,
            outputTokens: 200,
            reasoningTokens: 100,
            wallTimeMs: 60_000,
            toolCalls: 2,
            implementationAttempts: 1,
          },
          observed: {
            inputTokens: input.execution.usage.inputTokens,
            outputTokens: input.execution.usage.outputTokens,
            reasoningTokens: 0,
            toolCalls: 3,
            wallTimeMs: input.execution.usage.agentWallTimeMs,
          },
          measurement: {
            inputTokens: "measured",
            outputTokens: "measured",
            reasoningTokens: "unavailable",
            toolCalls: "measured",
          },
          implementationAttempts: 1,
          exceededDimensions: ["tool-calls"],
          stopReason: "tool-budget-exhausted",
          limitations: [
            "provider-request-cancellation-unavailable",
            "reasoning-token-usage-unavailable",
          ],
        },
      },
    });

    expect(receipt.execution.stopReason).toBe("tool-budget-exhausted");
    expect(receipt.execution.budgetEnforcement?.measurement.reasoningTokens).toBe("unavailable");
    expect(receipt.execution.budgetEnforcement?.exceededDimensions).toEqual(["tool-calls"]);
  });

  it("rejects budget evidence that disagrees with measured usage", () => {
    const input = receiptInput();
    expect(() => createWorkflowReceiptV3({
      ...input,
      execution: {
        ...input.execution,
        stopReason: "token-budget-exhausted",
        budgetEnforcement: {
          ceilings: {
            inputTokens: 1_000,
            outputTokens: 200,
            reasoningTokens: 100,
            wallTimeMs: 60_000,
            toolCalls: 10,
            implementationAttempts: 1,
          },
          observed: {
            inputTokens: input.execution.usage.inputTokens,
            outputTokens: input.execution.usage.outputTokens,
            reasoningTokens: input.execution.usage.reasoningTokens,
            toolCalls: input.execution.usage.toolCalls,
            wallTimeMs: input.execution.usage.agentWallTimeMs,
          },
          measurement: {
            inputTokens: "measured",
            outputTokens: "measured",
            reasoningTokens: "measured",
            toolCalls: "measured",
          },
          implementationAttempts: 1,
          exceededDimensions: ["input-tokens"],
          stopReason: "token-budget-exhausted",
          limitations: [
            "provider-request-cancellation-unavailable",
          ],
        },
      },
    })).toThrow(/budget/i);
  });

  it("rejects a receipt that drops a contracted implementation attempt", () => {
    const input = receiptInput();
    expect(() => createWorkflowReceiptV3({
      ...input,
      execution: {
        ...input.execution,
        attempts: [input.execution.attempts[1]],
        retries: [],
        usage: input.execution.attempts[1].usage,
        budgetEnforcement: {
          ceilings: {
            inputTokens: 1_000,
            outputTokens: 200,
            reasoningTokens: 100,
            wallTimeMs: 60_000,
            toolCalls: 10,
            implementationAttempts: 2,
          },
          observed: {
            inputTokens: input.execution.attempts[1].usage.inputTokens,
            outputTokens: input.execution.attempts[1].usage.outputTokens,
            reasoningTokens: input.execution.attempts[1].usage.reasoningTokens,
            toolCalls: input.execution.attempts[1].usage.toolCalls,
            wallTimeMs: input.execution.attempts[1].usage.agentWallTimeMs,
          },
          measurement: {
            inputTokens: "measured",
            outputTokens: "measured",
            reasoningTokens: "measured",
            toolCalls: "measured",
          },
          implementationAttempts: 2,
          exceededDimensions: [],
          stopReason: null,
          limitations: ["provider-request-cancellation-unavailable"],
          attempts: [],
          retries: [],
        },
      },
    })).toThrow(/attempt/i);
  });

  it("binds exact task classes shared with the public task contract", () => {
    const input = receiptInput();
    const receipt = createWorkflowReceiptV3({
      ...input,
      stable: { ...input.stable, taskClass: "responsive-layout" },
      route: { ...input.route, taskClass: "responsive-layout" },
    });

    expect(receipt.stable.taskClass).toBe("responsive-layout");
    expect(receipt.route.taskClass).toBe("responsive-layout");
  });

  it("binds stable, route, capsule, execution, native, and verification evidence deterministically", () => {
    const first = createWorkflowReceiptV3(receiptInput());
    const second = createWorkflowReceiptV3(receiptInput());

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: "workflow-receipt.v3",
      stableFieldsSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      route: {
        skill: {
          id: "implement-adaptive-interface",
          file: "skills/implement-adaptive-interface/SKILL.md",
          contentSha256: sha("6"),
        },
        identitySha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
      receiptSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(WorkflowReceiptV3Schema.parse(first)).toEqual(first);
    expect(verifyWorkflowReceiptV3(first)).toEqual({ valid: true, reasons: [] });
  });

  it("deep-freezes every returned object and array", () => {
    const receipt = createWorkflowReceiptV3(receiptInput());

    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.stable.repository)).toBe(true);
    expect(Object.isFrozen(receipt.contextCapsules.expansions)).toBe(true);
    expect(Object.isFrozen(receipt.execution.attempts[0]?.usage)).toBe(true);
    expect(Object.isFrozen(receipt.nativeEvidence.artifacts[0])).toBe(true);
    expect(Object.isFrozen(receipt.verification)).toBe(true);
  });

  it("rejects unknown fields, malformed hashes, unsafe skill paths, and non-finite numbers", () => {
    expect(() => createWorkflowReceiptV3({ ...receiptInput(), extra: true })).toThrow();
    expect(() => createWorkflowReceiptV3({
      ...receiptInput(),
      stable: { ...receiptInput().stable, protocolSha256: "not-a-hash" },
    })).toThrow();
    expect(() => createWorkflowReceiptV3({
      ...receiptInput(),
      route: {
        ...receiptInput().route,
        skill: { ...receiptInput().route.skill, file: "../SKILL.md" },
      },
    })).toThrow();
    expect(() => createWorkflowReceiptV3({
      ...receiptInput(),
      execution: {
        ...receiptInput().execution,
        billing: { ...receiptInput().execution.billing, amount: Number.POSITIVE_INFINITY },
      },
    })).toThrow();
  });

  it("rejects route identity that is rebound away from the stable task, repository, or runtime", () => {
    for (const route of [
      { ...receiptInput().route, taskClass: "frontend-audit" as const },
      { ...receiptInput().route, repositoryFingerprintSha256: sha("f") },
      { ...receiptInput().route, model: "different-model" },
      { ...receiptInput().route, effort: "low" },
    ]) {
      expect(() => createWorkflowReceiptV3({ ...receiptInput(), route })).toThrow(/route/i);
    }
  });

  it("rejects more than two attempts or one retry, and requires one retry per later attempt", () => {
    const base = receiptInput();
    const thirdAttempt = {
      ...base.execution.attempts[1]!,
      attemptId: "attempt-3",
      startedAt: "2026-08-06T16:00:04.100Z",
      completedAt: "2026-08-06T16:00:04.500Z",
    };
    expect(() => createWorkflowReceiptV3({
      ...base,
      execution: { ...base.execution, attempts: [...base.execution.attempts, thirdAttempt] },
    })).toThrow();
    expect(() => createWorkflowReceiptV3({
      ...base,
      execution: { ...base.execution, retries: [] },
    })).toThrow(/retry/i);
    expect(() => createWorkflowReceiptV3({
      ...base,
      execution: {
        ...base.execution,
        retries: [...base.execution.retries, {
          ...base.execution.retries[0]!,
          retryId: "retry-2",
        }],
      },
    })).toThrow();
  });

  it("permits at most one reasoned context expansion bound to the initial capsule", () => {
    const base = receiptInput();
    expect(() => createWorkflowReceiptV3({
      ...base,
      contextCapsules: {
        ...base.contextCapsules,
        expansions: [...base.contextCapsules.expansions, {
          ...base.contextCapsules.expansions[0]!,
          expansionId: "expansion-2",
        }],
      },
    })).toThrow();
    expect(() => createWorkflowReceiptV3({
      ...base,
      contextCapsules: {
        ...base.contextCapsules,
        expansions: [{
          ...base.contextCapsules.expansions[0]!,
          fromCapsuleSha256: sha("f"),
        }],
      },
    })).toThrow(/capsule/i);
  });

  it("rejects duplicate IDs across attempts, retries, native evidence, and verification", () => {
    const base = receiptInput();
    expect(() => createWorkflowReceiptV3({
      ...base,
      execution: {
        ...base.execution,
        attempts: [base.execution.attempts[0]!, {
          ...base.execution.attempts[1]!,
          attemptId: "attempt-1",
        }],
      },
    })).toThrow(/duplicate/i);
    expect(() => createWorkflowReceiptV3({
      ...base,
      nativeEvidence: {
        ...base.nativeEvidence,
        artifacts: [base.nativeEvidence.artifacts[0]!, base.nativeEvidence.artifacts[0]!],
      },
    })).toThrow(/duplicate/i);
    expect(() => createWorkflowReceiptV3({
      ...base,
      verification: [base.verification[0]!, base.verification[0]!],
    })).toThrow(/duplicate/i);
  });

  it("recomputes aggregate usage and rejects incomplete accounting", () => {
    const base = receiptInput();
    expect(() => createWorkflowReceiptV3({
      ...base,
      execution: {
        ...base.execution,
        usage: { ...base.execution.usage, inputTokens: 179 },
      },
    })).toThrow(/usage/i);
  });

  it("rejects stale or time-inconsistent native evidence", () => {
    const base = receiptInput();
    expect(() => createWorkflowReceiptV3({
      ...base,
      nativeEvidence: {
        ...base.nativeEvidence,
        artifacts: [{
          ...base.nativeEvidence.artifacts[0]!,
          freshUntil: "2026-08-06T16:00:04.500Z",
          freshnessWindowMs: 1_500,
        }],
      },
    })).toThrow(/fresh/i);
    expect(() => createWorkflowReceiptV3({
      ...base,
      nativeEvidence: {
        ...base.nativeEvidence,
        artifacts: [{
          ...base.nativeEvidence.artifacts[0]!,
          verifiedAt: "2026-08-06T15:59:59.000Z",
        }],
      },
    })).toThrow(/captur|chronolog/i);
    expect(() => createWorkflowReceiptV3({
      ...base,
      nativeEvidence: {
        ...base.nativeEvidence,
        artifacts: [{
          ...base.nativeEvidence.artifacts[0]!,
          capturedAt: "2026-08-06T15:59:59.000Z",
          verifiedAt: "2026-08-06T16:00:00.000Z",
          freshUntil: "2026-08-06T16:05:00.000Z",
        }],
      },
    })).toThrow(/execution/i);
  });

  it("requires verification-passed receipts to contain only passed checks", () => {
    const base = receiptInput();
    expect(() => createWorkflowReceiptV3({
      ...base,
      verification: [{
        ...base.verification[0]!,
        status: "failed",
        exitCode: 1,
      }],
    })).toThrow(/verification/i);
  });

  it("rejects any post-seal tampering, including nested usage and skill hashes", () => {
    const receipt = createWorkflowReceiptV3(receiptInput());
    const usageTamper = structuredClone(receipt);
    usageTamper.execution.usage.inputTokens += 1;
    const skillTamper = structuredClone(receipt);
    skillTamper.route.skill.contentSha256 = sha("f");

    expect(verifyWorkflowReceiptV3(usageTamper)).toMatchObject({ valid: false });
    expect(verifyWorkflowReceiptV3(skillTamper)).toMatchObject({ valid: false });
    expect(() => WorkflowReceiptV3Schema.parse(usageTamper)).toThrow();
    expect(() => WorkflowReceiptV3Schema.parse(skillTamper)).toThrow();
  });

  it("asserts candidate-independent fields across a matched pair and rejects drift", () => {
    const memi = createWorkflowReceiptV3(receiptInput());
    const baseline = createWorkflowReceiptV3(receiptInput({
      receiptId: "receipt-web-002",
      sequence: 2,
      candidate: {
        condition: "baseline",
        candidateId: "repository-only",
        artifactSha256: sha("d"),
      },
    }));
    const result = assertCandidateIndependentReceiptFields([memi, baseline]);

    expect(result).toEqual({
      stableFieldsSha256: memi.stableFieldsSha256,
      receiptIds: ["receipt-web-001", "receipt-web-002"],
    });
    expect(Object.isFrozen(result.receiptIds)).toBe(true);

    const drifted = createWorkflowReceiptV3(receiptInput({
      receiptId: "receipt-web-003",
      stable: { ...receiptInput().stable, taskContractSha256: sha("f") },
    }));
    expect(() => assertCandidateIndependentReceiptFields([memi, drifted]))
      .toThrow(/candidate-independent/i);
    expect(() => assertCandidateIndependentReceiptFields([memi, memi]))
      .toThrow(/duplicate/i);
  });

  it("requires identical route identity for exact-route recovery evidence", () => {
    const first = createWorkflowReceiptV3(receiptInput());
    const second = createWorkflowReceiptV3(receiptInput({
      receiptId: "receipt-web-002",
      sequence: 2,
    }));
    expect(assertExactRouteReceiptFields([first, second])).toEqual({
      routeIdentitySha256: first.route.identitySha256,
      receiptIds: ["receipt-web-001", "receipt-web-002"],
    });

    const route = receiptInput().route;
    if (route.decision !== "selected") throw new Error("test fixture must select a route");
    const changed = createWorkflowReceiptV3(receiptInput({
      receiptId: "receipt-web-003",
      sequence: 3,
      route: {
        ...route,
        skill: { ...route.skill, contentSha256: sha("f") },
      },
    }));
    expect(() => assertExactRouteReceiptFields([first, changed])).toThrow(/exact route/i);
  });

  it("binds a distinct second skill into stacked exact-route identity", () => {
    const route = receiptInput().route;
    if (route.decision !== "selected") throw new Error("test fixture must select a route");
    const first = createWorkflowReceiptV3(receiptInput({
      route: {
        ...route,
        additionalSkills: [{
          id: "verify-interface-accessibility",
          file: "skills/verify-interface-accessibility/SKILL.md",
          contentSha256: sha("e"),
        }],
      },
    }));
    const changed = createWorkflowReceiptV3(receiptInput({
      receiptId: "receipt-web-002",
      sequence: 2,
      route: {
        ...route,
        additionalSkills: [{
          id: "verify-interface-accessibility",
          file: "skills/verify-interface-accessibility/SKILL.md",
          contentSha256: sha("f"),
        }],
      },
    }));

    expect(first.route.decision).toBe("selected");
    if (first.route.decision !== "selected") throw new Error("route must be selected");
    expect(first.route.additionalSkills).toHaveLength(1);
    expect(first.route.identitySha256).not.toBe(changed.route.identitySha256);
    expect(() => assertExactRouteReceiptFields([first, changed])).toThrow(/exact route/i);
  });
});
