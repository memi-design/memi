import { z } from "zod";
import {
  RepositoryRelativePathSchema,
  Sha256Schema,
  deepFreeze,
  normalizeRepositoryPath,
  sortedUnique,
} from "./foundation.js";

export const FrontendTaskClassSchema = z.enum([
  "frontend-creation",
  "frontend-modification",
  "frontend-repair",
  "frontend-audit",
  "design-system-map",
  "component-map",
  "token-map",
  "responsive-layout",
  "adaptive-interaction",
  "interface-state-implementation",
  "accessibility-check",
  "keyboard-focus-verification",
  "semantic-interface-verification",
]);

export const FrontendPlatformSchema = z.enum(["web", "expo", "swiftui"]);

export const ContextExpansionReasonCodeSchema = z.enum([
  "missing-task-route-evidence",
  "missing-skill-evidence",
  "missing-repository-evidence",
  "missing-verification-evidence",
]);

const ContextExpansionStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unused") }).strict(),
  z.object({
    state: z.literal("requested"),
    reasonCode: ContextExpansionReasonCodeSchema,
    evidenceMissSha256: Sha256Schema,
  }).strict(),
  z.object({
    state: z.literal("consumed"),
    reasonCode: ContextExpansionReasonCodeSchema,
    evidenceMissSha256: Sha256Schema,
  }).strict(),
]);

const ResourceCeilingsSchema = z.object({
  inputTokens: z.number().int().positive(),
  outputTokens: z.number().int().positive(),
  reasoningTokens: z.number().int().nonnegative(),
  wallTimeMs: z.number().int().positive(),
  toolCalls: z.number().int().positive(),
  implementationAttempts: z.union([z.literal(1), z.literal(2)]),
}).strict();

export const FrontendTaskContractV1Schema = z.object({
  schemaVersion: z.literal("frontend-task-contract.v1"),
  taskId: z.string().regex(/^[a-z][a-z0-9-]*$/u),
  taskClass: FrontendTaskClassSchema,
  platform: FrontendPlatformSchema,
  intent: z.string().trim().min(1).max(4_096),
  targetFiles: z.array(RepositoryRelativePathSchema).min(1),
  targetComponents: z.array(z.string().trim().min(1).max(256)).min(1),
  requiredStates: z.array(z.string().trim().min(1).max(128)).min(1),
  constraints: z.array(z.string().trim().min(1).max(1_024)),
  verificationCommands: z.array(z.string().trim().min(1).max(2_048)).min(1),
  resourceCeilings: ResourceCeilingsSchema,
  contextExpansion: ContextExpansionStateSchema,
}).strict();

export type FrontendTaskContractV1 = z.infer<typeof FrontendTaskContractV1Schema>;
export type FrontendTaskContractV1Input = Omit<FrontendTaskContractV1, "schemaVersion">;

export function createFrontendTaskContract(
  input: FrontendTaskContractV1Input,
): Readonly<FrontendTaskContractV1> {
  const normalized = {
    ...input,
    schemaVersion: "frontend-task-contract.v1" as const,
    intent: input.intent.trim(),
    targetFiles: sortedUnique(input.targetFiles.map(normalizeRepositoryPath)),
    targetComponents: sortedUnique(input.targetComponents.map((value) => value.trim())),
    requiredStates: sortedUnique(input.requiredStates.map((value) => value.trim())),
    constraints: sortedUnique(input.constraints.map((value) => value.trim())),
    verificationCommands: deduplicateInOrder(
      input.verificationCommands.map((value) => value.trim()),
    ),
  };
  return deepFreeze(FrontendTaskContractV1Schema.parse(normalized));
}

function deduplicateInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}
