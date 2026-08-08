import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { benchmarkRepositoryRevision } from "../efficiency/codex-runner.js";
import {
  CONTEXT_CAPSULE_DEFAULT_BUDGETS,
  createContextCapsule,
  type CapsuleEvidenceInput,
  type ContextCapsuleV1,
} from "../frontend/context-capsule.js";
import {
  buildRepositoryDesignIndexForTask,
  isExcludedRepositoryPath,
} from "../frontend/repository-design-index.js";
import type { FrontendTaskContractV1 } from "../frontend/task-contract.js";
import type { SkillRouteResult } from "../notes/skill-router.js";

export async function buildExecutionContextCapsule(input: {
  readonly projectRoot: string;
  readonly contract: FrontendTaskContractV1;
  readonly budgetProfile: "strict" | "balanced" | "deep";
  readonly routingPolicy: "repository-only" | "v3";
  readonly route: SkillRouteResult | null;
}): Promise<Readonly<ContextCapsuleV1>> {
  const repositoryRevision = await benchmarkRepositoryRevision(input.projectRoot);
  const designIndex = await buildRepositoryDesignIndexForTask({
    root: input.projectRoot,
    repositoryRevision,
    contract: input.contract,
  });
  const skills = await Promise.all((input.route?.selected ?? []).map(async (selected) => ({
    id: `skill:${selected.id}`,
    content: await readFile(selected.file, "utf8"),
  })));
  const repositoryIndexEvidence: CapsuleEvidenceInput = {
    id: "repository:index",
    content: JSON.stringify(designIndex),
  };
  const repositoryEvidence = await selectRepositoryEvidence(
    input.projectRoot,
    input.contract.targetFiles,
    repositoryIndexEvidence,
  );
  return createContextCapsule({
    taskRoute: [{
      id: `task:${input.contract.taskId}`,
      content: JSON.stringify({
        taskId: input.contract.taskId,
        taskClass: input.contract.taskClass,
        platform: input.contract.platform,
        budgetProfile: input.budgetProfile,
        routingPolicy: input.routingPolicy,
        routeDecision: input.route?.decision ?? "repository-only",
      }),
    }],
    skills,
    repositoryEvidence,
    verification: [{
      id: "verification:contract",
      content: JSON.stringify({
        requiredStates: input.contract.requiredStates,
        constraints: input.contract.constraints,
        commands: input.contract.verificationCommands,
        resourceCeilings: input.contract.resourceCeilings,
        contextExpansion: input.contract.contextExpansion,
      }),
    }],
  });
}

export function formatExecutionContextCapsule(capsule: ContextCapsuleV1): string {
  const sections = Object.entries(capsule.sections).flatMap(([name, section]) => [
    `## ${name}`,
    ...section.evidence.flatMap((evidence) => [
      `### ${evidence.id}`,
      evidence.content,
    ]),
  ]);
  return [
    "# Memi bounded execution capsule",
    "",
    `Identity: ${capsule.identitySha256}`,
    `Content bytes: ${capsule.contentByteLength}/${capsule.budgets.totalBytes}`,
    "Use only this capsule and direct evidence required by its verification contract.",
    "One reason-coded expansion is permitted only when the contract records an evidence miss.",
    "",
    ...sections,
  ].join("\n");
}

async function selectRepositoryEvidence(
  projectRoot: string,
  targetFiles: readonly string[],
  indexEvidence: CapsuleEvidenceInput,
): Promise<readonly CapsuleEvidenceInput[]> {
  const evidence: CapsuleEvidenceInput[] = [indexEvidence];
  let usedBytes = Buffer.byteLength(indexEvidence.content, "utf8");
  for (const relativePath of [...targetFiles].sort()) {
    if (isExcludedRepositoryPath(relativePath)) {
      throw new Error(`Repository evidence path is excluded: ${relativePath}`);
    }
    const content = await readFile(path.resolve(projectRoot, relativePath), "utf8");
    const byteLength = Buffer.byteLength(content, "utf8");
    if (usedBytes + byteLength > CONTEXT_CAPSULE_DEFAULT_BUDGETS.repositoryEvidenceBytes) {
      continue;
    }
    evidence.push({ id: `source:${relativePath}`, content });
    usedBytes += byteLength;
  }
  return evidence;
}
