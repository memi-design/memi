import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  Sha256Schema,
  compareText,
  deepFreeze,
  hashText,
  hashValue,
} from "./foundation.js";

export const CONTEXT_CAPSULE_DEFAULT_BUDGETS = Object.freeze({
  taskRouteBytes: 1_024,
  skillBytes: 4_096,
  repositoryEvidenceBytes: 12_288,
  verificationBytes: 3_072,
  totalBytes: 20_480,
} as const);

const CapsuleBudgetsSchema = z.object({
  taskRouteBytes: z.literal(1_024),
  skillBytes: z.literal(4_096),
  repositoryEvidenceBytes: z.literal(12_288),
  verificationBytes: z.literal(3_072),
  totalBytes: z.literal(20_480),
}).strict();

const EvidenceSchema = z.object({
  id: z.string().trim().min(1).max(256),
  content: z.string().min(1),
  contentSha256: Sha256Schema,
  byteLength: z.number().int().positive(),
}).strict().superRefine((evidence, context) => {
  if (hashText(evidence.content) !== evidence.contentSha256) {
    context.addIssue({
      code: "custom",
      path: ["contentSha256"],
      message: "contentSha256 does not match evidence content",
    });
  }
  if (Buffer.byteLength(evidence.content, "utf8") !== evidence.byteLength) {
    context.addIssue({
      code: "custom",
      path: ["byteLength"],
      message: "byteLength does not match UTF-8 evidence content",
    });
  }
});

const SectionSchema = z.object({
  sha256: Sha256Schema,
  byteLength: z.number().int().nonnegative(),
  evidence: z.array(EvidenceSchema),
}).strict().superRefine((section, context) => {
  const expectedBytes = section.evidence.reduce((total, evidence) => total + evidence.byteLength, 0);
  if (expectedBytes !== section.byteLength) {
    context.addIssue({
      code: "custom",
      path: ["byteLength"],
      message: "byteLength does not match section evidence",
    });
  }
  if (hashValue(section.evidence) !== section.sha256) {
    context.addIssue({
      code: "custom",
      path: ["sha256"],
      message: "sha256 does not match section evidence",
    });
  }
  const ids = section.evidence.map((evidence) => evidence.id);
  const sortedIds = [...ids].sort(compareText);
  if (new Set(ids).size !== ids.length || JSON.stringify(ids) !== JSON.stringify(sortedIds)) {
    context.addIssue({
      code: "custom",
      path: ["evidence"],
      message: "evidence ids must be sorted and unique",
    });
  }
});

const ContextCapsuleContentSchema = z.object({
  schemaVersion: z.literal("context-capsule.v1"),
  budgets: CapsuleBudgetsSchema,
  contentByteLength: z.number().int().nonnegative().max(20_480),
  sections: z.object({
    taskRoute: SectionSchema,
    skills: SectionSchema,
    repositoryEvidence: SectionSchema,
    verification: SectionSchema,
  }).strict(),
}).strict();

export const ContextCapsuleV1Schema = ContextCapsuleContentSchema.extend({
  identitySha256: Sha256Schema,
}).strict().superRefine((capsule, context) => {
  const expectedTotal = Object.values(capsule.sections)
    .reduce((total, section) => total + section.byteLength, 0);
  if (capsule.contentByteLength !== expectedTotal) {
    context.addIssue({
      code: "custom",
      path: ["contentByteLength"],
      message: "contentByteLength does not match the capsule sections",
    });
  }
  const limits = {
    taskRoute: capsule.budgets.taskRouteBytes,
    skills: capsule.budgets.skillBytes,
    repositoryEvidence: capsule.budgets.repositoryEvidenceBytes,
    verification: capsule.budgets.verificationBytes,
  } as const;
  for (const sectionName of Object.keys(limits) as (keyof typeof limits)[]) {
    if (capsule.sections[sectionName].byteLength > limits[sectionName]) {
      context.addIssue({
        code: "custom",
        path: ["sections", sectionName, "byteLength"],
        message: `${sectionName} exceeds its ${limits[sectionName]} byte budget`,
      });
    }
  }
  const hashes = Object.values(capsule.sections)
    .flatMap((section) => section.evidence.map((evidence) => evidence.contentSha256));
  if (new Set(hashes).size !== hashes.length) {
    context.addIssue({
      code: "custom",
      path: ["sections"],
      message: "evidence content must be globally deduplicated",
    });
  }
  const { identitySha256, ...content } = capsule;
  if (hashValue(content) !== identitySha256) {
    context.addIssue({
      code: "custom",
      path: ["identitySha256"],
      message: "identitySha256 does not match the canonical capsule content",
    });
  }
});

export type ContextCapsuleV1 = z.infer<typeof ContextCapsuleV1Schema>;

export interface CapsuleEvidenceInput {
  readonly id: string;
  readonly content: string;
}

export interface ContextCapsuleV1Input {
  readonly taskRoute: readonly CapsuleEvidenceInput[];
  readonly skills: readonly CapsuleEvidenceInput[];
  readonly repositoryEvidence: readonly CapsuleEvidenceInput[];
  readonly verification: readonly CapsuleEvidenceInput[];
}

export function createContextCapsule(
  input: ContextCapsuleV1Input,
): Readonly<ContextCapsuleV1> {
  const seenContent = new Set<string>();
  const sections = {
    taskRoute: createSection(input.taskRoute, seenContent),
    skills: createSection(input.skills, seenContent),
    repositoryEvidence: createSection(input.repositoryEvidence, seenContent),
    verification: createSection(input.verification, seenContent),
  };
  const limits = {
    taskRoute: CONTEXT_CAPSULE_DEFAULT_BUDGETS.taskRouteBytes,
    skills: CONTEXT_CAPSULE_DEFAULT_BUDGETS.skillBytes,
    repositoryEvidence: CONTEXT_CAPSULE_DEFAULT_BUDGETS.repositoryEvidenceBytes,
    verification: CONTEXT_CAPSULE_DEFAULT_BUDGETS.verificationBytes,
  } as const;
  for (const sectionName of Object.keys(limits) as (keyof typeof limits)[]) {
    if (sections[sectionName].byteLength > limits[sectionName]) {
      throw new Error(
        `${sectionName} context is ${sections[sectionName].byteLength} bytes; maximum is ${limits[sectionName]} bytes`,
      );
    }
  }
  const content = ContextCapsuleContentSchema.parse({
    schemaVersion: "context-capsule.v1",
    budgets: CONTEXT_CAPSULE_DEFAULT_BUDGETS,
    contentByteLength: Object.values(sections)
      .reduce((total, section) => total + section.byteLength, 0),
    sections,
  });
  return deepFreeze(ContextCapsuleV1Schema.parse({
    ...content,
    identitySha256: hashValue(content),
  }));
}

type CapsuleSection = z.infer<typeof SectionSchema>;

function createSection(
  input: readonly CapsuleEvidenceInput[],
  seenContent: Set<string>,
): CapsuleSection {
  const byId = new Map<string, z.infer<typeof EvidenceSchema>>();
  for (const raw of [...input].sort((left, right) => compareText(left.id, right.id))) {
    const id = raw.id.trim();
    const evidence = EvidenceSchema.parse({
      id,
      content: raw.content,
      contentSha256: hashText(raw.content),
      byteLength: Buffer.byteLength(raw.content, "utf8"),
    });
    const existing = byId.get(id);
    if (existing && existing.contentSha256 !== evidence.contentSha256) {
      throw new Error(`Evidence id has conflicting content: ${id}`);
    }
    if (seenContent.has(evidence.contentSha256)) continue;
    byId.set(id, evidence);
    seenContent.add(evidence.contentSha256);
  }
  const evidence = [...byId.values()].sort((left, right) => compareText(left.id, right.id));
  return SectionSchema.parse({
    sha256: hashValue(evidence),
    byteLength: evidence.reduce((total, item) => total + item.byteLength, 0),
    evidence,
  });
}
