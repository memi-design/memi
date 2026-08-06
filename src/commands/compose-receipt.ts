import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentPlan } from "../agents/plan-builder.js";
import type { AgentExecutionResult } from "../agents/sub-agents.js";
import type { TokenTracker } from "../ai/token-tracker.js";
import { benchmarkRepositoryRevision } from "../efficiency/codex-runner.js";
import { hashValue } from "../frontend/foundation.js";
import {
  WorkflowReceiptV3Schema,
  createWorkflowReceiptV3,
} from "../frontend/receipts/workflow-receipt-v3.js";
import type { FrontendTaskContractV1 } from "../frontend/task-contract.js";
import { buildRepositoryFingerprint } from "../notes/repository-fingerprint.js";
import { packageRoot } from "../utils/asset-path.js";
import { getMemoirePackageVersion } from "../utils/package-version.js";
import { hashPackedPackageSurface } from "../utils/package-artifact.js";

export interface ComposeReceiptSummary {
  readonly status: "written";
  readonly schemaVersion: "workflow-receipt.v3";
  readonly receiptSha256: string;
  readonly file: string;
}

export async function writeComposeReceiptV3(input: {
  readonly projectRoot: string;
  readonly receiptRoot: string;
  readonly contract: FrontendTaskContractV1;
  readonly budgetProfile: "strict" | "balanced" | "deep";
  readonly routingPolicy: "repository-only" | "v3";
  readonly plan: {
    readonly id: AgentPlan["id"];
    readonly skillRoute?: AgentPlan["skillRoute"] | null;
    readonly contextCapsule?: AgentPlan["contextCapsule"];
  };
  readonly result: AgentExecutionResult;
  readonly dryRun: boolean;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly tracker: TokenTracker | null;
}): Promise<Readonly<ComposeReceiptSummary>> {
  const repositoryFingerprint = await buildRepositoryFingerprint(input.projectRoot);
  const repositoryFingerprintSha256 = hashValue(repositoryFingerprint);
  const repositoryRevision = await benchmarkRepositoryRevision(input.projectRoot);
  const selected = input.routingPolicy === "v3"
    ? input.plan.skillRoute?.selected[0]
    : undefined;
  const capsule = input.plan.contextCapsule;
  if (!capsule) {
    throw new Error("WorkflowReceiptV3 requires the pre-execution context capsule");
  }
  const receiptRoot = resolve(input.receiptRoot);
  await mkdir(receiptRoot, { recursive: true });
  const sequence = await nextReceiptSequence(receiptRoot);
  const completedAtMs = Math.max(input.startedAtMs, input.completedAtMs);
  const startedAt = new Date(input.startedAtMs).toISOString();
  const completedAt = new Date(completedAtMs).toISOString();
  const usage = {
    inputTokens: input.tracker?.totalInput ?? 0,
    cachedInputTokens: 0,
    outputTokens: input.tracker?.totalOutput ?? 0,
    reasoningTokens: 0,
    toolCalls: 0,
    toolErrors: 0,
    toolOutputBytes: 0,
    agentWallTimeMs: completedAtMs - input.startedAtMs,
    toolWallTimeMs: 0,
  };
  const packageVersion = getMemoirePackageVersion();
  const candidateArtifactSha256 = await hashPackedPackageSurface(packageRoot());
  const route = selected ? {
    decision: "selected" as const,
    routerVersion: input.plan.skillRoute!.routerVersion,
    taskClass: input.contract.taskClass,
    repositoryFingerprintSha256,
    provider: "memi",
    model: "agent-cli",
    effort: input.budgetProfile,
    skill: {
      id: selected.id,
      file: portableSkillPath(selected.file, input.projectRoot),
      contentSha256: selected.contentHash,
    },
  } : {
    decision: "repository-only" as const,
    routerVersion: input.plan.skillRoute?.routerVersion ?? "skill-router-v3",
    taskClass: input.contract.taskClass,
    repositoryFingerprintSha256,
    provider: "memi",
    model: "agent-cli",
    effort: input.budgetProfile,
    skill: null,
    abstentionReason: input.routingPolicy === "repository-only"
      ? "unsupported-route" as const
      : "incomplete-evidence" as const,
  };
  const verificationAt = completedAt;
  const receipt = createWorkflowReceiptV3({
    receiptId: `compose:${input.contract.taskId}:${sequence}`,
    recordedAt: completedAt,
    sequence,
    stable: {
      protocolSha256: hashValue({ protocol: "memi-compose-v3", budgetProfile: input.budgetProfile }),
      suiteId: "compose-v3",
      experimentId: "interactive-compose",
      pairId: `compose:${input.contract.taskId}`,
      taskId: input.contract.taskId,
      repeat: 1,
      taskClass: input.contract.taskClass,
      taskContractSha256: hashValue(input.contract),
      repository: {
        fingerprintSha256: repositoryFingerprintSha256,
        revision: repositoryRevision,
        fixtureSha256: hashValue({ repositoryRevision, repositoryFingerprintSha256 }),
      },
      runtime: { provider: "memi", model: "agent-cli", effort: input.budgetProfile },
    },
    candidate: {
      condition: "memi",
      candidateId: `memi-${packageVersion}`,
      artifactSha256: candidateArtifactSha256,
    },
    route,
    contextCapsules: {
      initial: {
        identitySha256: capsule.identitySha256,
        taskRouteSha256: capsule.sections.taskRoute.sha256,
        skillsSha256: capsule.sections.skills.sha256,
        repositoryEvidenceSha256: capsule.sections.repositoryEvidence.sha256,
        verificationSha256: capsule.sections.verification.sha256,
      },
      expansions: [],
    },
    execution: {
      startedAt,
      completedAt,
      stopReason: deriveComposeStopReason(input.dryRun, input.result.status),
      attempts: input.dryRun ? [] : [{
        attemptId: "attempt-1",
        startedAt,
        completedAt,
        outcome: input.result.status === "completed" ? "completed" : "fatal-failure",
        usage,
      }],
      retries: [],
      usage: input.dryRun ? zeroUsage() : usage,
      billing: {
        status: "unavailable",
        currency: "USD",
        amount: null,
        usageArtifactSha256: null,
        priceCardSha256: null,
        reason: "provider-unsupported",
      },
    },
    nativeEvidence: {
      status: "excluded",
      platform: input.contract.platform,
      artifacts: [],
      reason: input.dryRun ? "preflight-failed" : "missing-native-artifact",
    },
    verification: [{
      verificationId: "native-verification",
      kind: input.contract.platform === "web" ? "rendered-flow" : "ios-simulator",
      commandSha256: hashValue(input.contract.verificationCommands),
      status: "skipped",
      exitCode: null,
      startedAt: verificationAt,
      completedAt: verificationAt,
      durationMs: 0,
      outputSha256: hashValue({ reason: "native-evidence-not-captured" }),
    }],
  });
  const file = `${receipt.receiptSha256.slice("sha256:".length)}.json`;
  await writeFile(resolve(receiptRoot, file), `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return Object.freeze({
    status: "written",
    schemaVersion: receipt.schemaVersion,
    receiptSha256: receipt.receiptSha256,
    file,
  });
}

export function deriveComposeStopReason(
  dryRun: boolean,
  status: AgentExecutionResult["status"],
): "preflight-failed" | "attempt-limit-reached" | "verification-failed" {
  if (dryRun) return "preflight-failed";
  return status === "completed" ? "verification-failed" : "attempt-limit-reached";
}

async function nextReceiptSequence(root: string): Promise<number> {
  const sequences = await Promise.all((await readdir(root))
    .filter((file) => file.endsWith(".json"))
    .map(async (file) => {
      const parsed = WorkflowReceiptV3Schema.safeParse(
        JSON.parse(await readFile(resolve(root, file), "utf8")),
      );
      return parsed.success ? parsed.data.sequence : -1;
    }));
  return Math.max(-1, ...sequences) + 1;
}

export function portableSkillPath(file: string, projectRoot: string): string {
  for (const root of [resolve(packageRoot()), resolve(projectRoot)]) {
    const candidate = relative(root, resolve(file)).split(sep).join("/");
    if (!candidate.startsWith("../") && candidate !== ".." && !isAbsolute(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Routed skill is outside the package and repository roots: ${basename(file)}`);
}

function zeroUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    toolCalls: 0,
    toolErrors: 0,
    toolOutputBytes: 0,
    agentWallTimeMs: 0,
    toolWallTimeMs: 0,
  };
}
