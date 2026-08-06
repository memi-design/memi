import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  RepositoryRelativePathSchema,
  Sha256Schema,
  compareText,
  deepFreeze,
  hashText,
  hashValue,
  normalizeRepositoryPath,
  sortedUnique,
} from "./foundation.js";

const ContentIdentitySchema = z.object({
  path: RepositoryRelativePathSchema,
  sha256: Sha256Schema,
  byteLength: z.number().int().nonnegative(),
}).strict();

const ComponentSchema = z.object({
  id: z.string().trim().min(1).max(256),
  atomicLevel: z.enum(["atom", "molecule", "organism", "template", "page"]),
  sourcePath: RepositoryRelativePathSchema,
  dependencies: z.array(z.string().trim().min(1).max(256)),
}).strict();

const DesignTokenSchema = z.object({
  name: z.string().trim().min(1).max(256),
  value: z.string().trim().min(1).max(2_048),
  sourcePath: RepositoryRelativePathSchema.optional(),
}).strict();

const DependencySchema = z.object({
  name: z.string().trim().min(1).max(256),
  version: z.string().trim().min(1).max(256),
}).strict();

const TestCommandSchema = z.object({
  name: z.string().trim().min(1).max(128),
  command: z.string().trim().min(1).max(2_048),
}).strict();

const RepositoryDesignIndexContentSchema = z.object({
  schemaVersion: z.literal("repository-design-index.v1"),
  repositoryRevision: z.string().regex(/^[a-f0-9]{40}$/u),
  lockfile: ContentIdentitySchema,
  relevantSources: z.array(ContentIdentitySchema),
  components: z.array(ComponentSchema),
  designTokens: z.array(DesignTokenSchema),
  frameworkConventions: z.array(z.string().trim().min(1).max(256)),
  directDependencies: z.array(DependencySchema),
  testCommands: z.array(TestCommandSchema),
}).strict();

export const RepositoryDesignIndexV1Schema = RepositoryDesignIndexContentSchema.extend({
  identitySha256: Sha256Schema,
}).strict().superRefine((index, context) => {
  const { identitySha256, ...content } = index;
  if (hashValue(content) !== identitySha256) {
    context.addIssue({
      code: "custom",
      path: ["identitySha256"],
      message: "identitySha256 does not match the canonical index content",
    });
  }
  verifySortedUnique(index.relevantSources.map((source) => source.path), ["relevantSources"], context);
  verifySortedUnique(index.components.map((component) => component.id), ["components"], context);
  verifySortedUnique(index.designTokens.map((token) => token.name), ["designTokens"], context);
  verifySortedUnique(index.frameworkConventions, ["frameworkConventions"], context);
  verifySortedUnique(index.directDependencies.map((dependency) => dependency.name), ["directDependencies"], context);
  verifySortedUnique(index.testCommands.map((command) => command.name), ["testCommands"], context);
});

export type RepositoryDesignIndexV1 = z.infer<typeof RepositoryDesignIndexV1Schema>;

interface SourceContentInput {
  readonly path: string;
  readonly content: string;
}

interface ComponentInput {
  readonly id: string;
  readonly atomicLevel: z.infer<typeof ComponentSchema>["atomicLevel"];
  readonly sourcePath: string;
  readonly dependencies: readonly string[];
}

interface DesignTokenInput {
  readonly name: string;
  readonly value: string;
  readonly sourcePath?: string;
}

interface NamedValueInput {
  readonly name: string;
  readonly version: string;
}

interface TestCommandInput {
  readonly name: string;
  readonly command: string;
}

export interface RepositoryDesignIndexV1Input {
  readonly repositoryRevision: string;
  readonly lockfile: SourceContentInput;
  readonly relevantSources: readonly SourceContentInput[];
  readonly components: readonly ComponentInput[];
  readonly designTokens: readonly DesignTokenInput[];
  readonly frameworkConventions: readonly string[];
  readonly directDependencies: readonly NamedValueInput[];
  readonly testCommands: readonly TestCommandInput[];
}

export function createRepositoryDesignIndex(
  input: RepositoryDesignIndexV1Input,
): Readonly<RepositoryDesignIndexV1> {
  const lockfilePath = normalizeRepositoryPath(input.lockfile.path);
  if (isExcludedRepositoryPath(lockfilePath)) {
    throw new Error(`Lockfile path is excluded from repository evidence: ${lockfilePath}`);
  }

  const relevantSources = normalizeSources(input.relevantSources);
  const content = RepositoryDesignIndexContentSchema.parse({
    schemaVersion: "repository-design-index.v1",
    repositoryRevision: input.repositoryRevision,
    lockfile: contentIdentity(lockfilePath, input.lockfile.content),
    relevantSources,
    components: normalizeUniqueByKey(input.components.map((component) => ({
      id: component.id.trim(),
      atomicLevel: component.atomicLevel,
      sourcePath: normalizeIncludedPath(component.sourcePath, "component"),
      dependencies: sortedUnique(component.dependencies.map((value) => value.trim())),
    })), (component) => component.id, "component id"),
    designTokens: normalizeUniqueByKey(input.designTokens.map((token) => ({
      name: token.name.trim(),
      value: token.value.trim(),
      ...(token.sourcePath
        ? { sourcePath: normalizeIncludedPath(token.sourcePath, "design token") }
        : {}),
    })), (token) => token.name, "design token name"),
    frameworkConventions: sortedUnique(
      input.frameworkConventions.map((value) => value.trim()),
    ),
    directDependencies: normalizeUniqueByKey(input.directDependencies.map((dependency) => ({
      name: dependency.name.trim(),
      version: dependency.version.trim(),
    })), (dependency) => dependency.name, "dependency name"),
    testCommands: normalizeUniqueByKey(input.testCommands.map((command) => ({
      name: command.name.trim(),
      command: command.command.trim(),
    })), (command) => command.name, "test command name"),
  });

  return deepFreeze(RepositoryDesignIndexV1Schema.parse({
    ...content,
    identitySha256: hashValue(content),
  }));
}

export function isExcludedRepositoryPath(value: string): boolean {
  let normalized: string;
  try {
    normalized = normalizeRepositoryPath(value);
  } catch {
    return true;
  }
  const lower = normalized.toLowerCase();
  const segments = lower.split("/");
  const basename = segments.at(-1) ?? "";
  const excludedDirectories = new Set([
    ".git",
    ".next",
    ".nuxt",
    ".output",
    ".swiftpm",
    ".turbo",
    ".venv",
    "build",
    "coverage",
    "deriveddata",
    "dist",
    "generated",
    "node_modules",
    "pods",
    "vendor",
  ]);
  if (segments.some((segment) => excludedDirectories.has(segment))) return true;
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  if ([".npmrc", ".pypirc", "credentials.json", "id_rsa", "id_ed25519"].includes(basename)) {
    return true;
  }
  if (/\.(?:pem|key|p12|pfx|jks|keystore)$/u.test(basename)) return true;
  return /\.(?:7z|bz2|gz|jar|rar|tar|tgz|war|xz|zip)$/u.test(basename);
}

function normalizeSources(sources: readonly SourceContentInput[]): ContentIdentity[] {
  const byPath = new Map<string, ContentIdentity>();
  for (const source of sources) {
    const path = normalizeRepositoryPath(source.path);
    if (isExcludedRepositoryPath(path)) continue;
    const identity = contentIdentity(path, source.content);
    const existing = byPath.get(path);
    if (existing && existing.sha256 !== identity.sha256) {
      throw new Error(`Relevant source path has conflicting content: ${path}`);
    }
    byPath.set(path, identity);
  }
  return [...byPath.values()].sort((left, right) => compareText(left.path, right.path));
}

type ContentIdentity = z.infer<typeof ContentIdentitySchema>;

function contentIdentity(path: string, content: string): ContentIdentity {
  return {
    path,
    sha256: hashText(content),
    byteLength: Buffer.byteLength(content, "utf8"),
  };
}

function normalizeIncludedPath(value: string, label: string): string {
  const normalized = normalizeRepositoryPath(value);
  if (isExcludedRepositoryPath(normalized)) {
    throw new Error(`${label} source path is excluded from repository evidence: ${normalized}`);
  }
  return normalized;
}

function normalizeUniqueByKey<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  label: string,
): T[] {
  const byKey = new Map<string, T>();
  for (const value of values) {
    const key = keyOf(value);
    const existing = byKey.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new Error(`Duplicate ${label} has conflicting values: ${key}`);
    }
    byKey.set(key, value);
  }
  return [...byKey.values()].sort((left, right) => compareText(keyOf(left), keyOf(right)));
}

function verifySortedUnique(
  values: readonly string[],
  path: (string | number)[],
  context: z.RefinementCtx,
): void {
  if (JSON.stringify(values) !== JSON.stringify(sortedUnique(values))) {
    context.addIssue({ code: "custom", path, message: "must be sorted and unique" });
  }
}
