import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  InstalledNote,
  NoteManifest,
  ResolvedSkill,
} from "./types.js";

export const SKILL_ROUTER_VERSION = "skill-router-v3";
const MINIMUM_STACK_SCORE_RATIO = 0.65;
const ROUTING_PATTERN_MAX_LENGTH = 160;
const GENERIC_STACK_EVIDENCE = new Set([
  "analyze", "audit", "design", "interface", "review", "test", "validate", "verify",
]);
type RoutingPatternMode = "exact" | "prefix" | "suffix" | "contains" | "glob" | "oneOf";
const ROUTING_PATTERN_MODES = new Set<RoutingPatternMode>([
  "exact", "prefix", "suffix", "contains", "glob", "oneOf",
]);

const TOKEN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  a11y: "accessibility",
  accessible: "accessibility",
  animations: "animation",
  colours: "color",
  expo: "reactnative",
  ios: "swiftui",
  type: "typography",
  typescale: "typography",
  voiceover: "accessibility",
  wcag: "accessibility",
});
const STOP_WORDS = new Set([
  "a", "add", "adding", "after", "an", "and", "app", "apply", "as", "at", "be", "by", "current", "existing",
  "for", "from", "implement", "implementing", "in", "into", "is", "it", "of",
  "on", "only", "or", "production", "stable", "test", "tests", "the", "this", "to", "use", "verify", "when",
  "with",
]);

export const RepositoryFingerprintSchema = z.object({
  schemaVersion: z.literal(1),
  languages: z.array(z.string().min(1)).max(100),
  frameworks: z.array(z.string().min(1)).max(100),
  dependencies: z.array(z.string().min(1)).max(10_000),
  files: z.array(z.string().min(1)).max(100_000),
  imports: z.array(z.string().min(1)).max(100_000),
  scripts: z.array(z.string().min(1)).max(1_000),
}).strict();
export type RepositoryFingerprint = z.infer<typeof RepositoryFingerprintSchema>;

export interface RouteInstalledSkillsInput {
  readonly intent: string;
  readonly taskClass?: string;
  readonly notes: readonly InstalledNote[];
  readonly capabilities: readonly string[];
  readonly platforms?: readonly string[];
  readonly maximumSkills?: number;
  readonly maximumContextBytes?: number;
  readonly repositoryFingerprint?: RepositoryFingerprint;
}

export interface SkillSearchEntry {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly intents?: readonly string[];
}

export interface SkillSearchResult {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

export interface SkillRouteResult {
  readonly schemaVersion: 2;
  readonly routerVersion: typeof SKILL_ROUTER_VERSION;
  readonly decision: "single" | "stack" | "abstain";
  readonly intentHash: string;
  readonly repositoryFingerprintHash: string | null;
  readonly selected: readonly {
    readonly id: string;
    readonly skillName: string;
    readonly file: string;
    readonly score: number;
    readonly matchedTerms: readonly string[];
    readonly contentHash: string;
    readonly contextBytes: number;
    readonly explanation: {
      readonly intentEvidence: readonly string[];
      readonly repositoryEvidence: readonly string[];
    };
  }[];
  readonly excluded: readonly {
    readonly id: string;
    readonly reason: string;
  }[];
  readonly candidates: readonly {
    readonly id: string;
    readonly score: number;
    readonly matchedTerms: readonly string[];
  }[];
  readonly contextBytes: number;
  readonly maximumContextBytes: number;
}

export interface ResolvedSkillRoute {
  readonly route: Readonly<SkillRouteResult>;
  readonly skills: readonly ResolvedSkill[];
  readonly resources: readonly RoutedSkillResource[];
  readonly contextBytes: number;
}

export interface RoutedSkillResource {
  readonly noteId: string;
  readonly relativePath: string;
  readonly contentHash: string | null;
  readonly contextBytes: number;
  readonly status:
    | "embedded"
    | "context-budget-exceeded"
    | "unreadable"
    | "unsafe-path";
  readonly content?: string;
}

export async function routeInstalledSkills(
  input: RouteInstalledSkillsInput,
): Promise<Readonly<SkillRouteResult>> {
  const maximumSkills = boundedInteger(input.maximumSkills ?? 1, 1, 4, "maximumSkills");
  const maximumContextBytes = boundedInteger(
    input.maximumContextBytes ?? 8_000,
    1,
    1_000_000,
    "maximumContextBytes",
  );
  const queryTokens = tokenize(routableIntent(input.intent));
  const requestedAction = inferRequestedAction(input.intent);
  const taskClass = input.taskClass ? normalizeTaskClass(input.taskClass) : null;
  const capabilities = new Set(input.capabilities.map(normalizeToken));
  const platforms = new Set((input.platforms ?? []).map(normalizeToken));
  const repositoryFingerprint = input.repositoryFingerprint
    ? RepositoryFingerprintSchema.parse(input.repositoryFingerprint)
    : undefined;
  const excluded: Array<{ id: string; reason: string }> = [];
  const ranked = input.notes
    .filter((note) => note.enabled)
    .flatMap((note) => routeCandidates(
      note,
      queryTokens,
      taskClass,
      requestedAction,
      capabilities,
      platforms,
      repositoryFingerprint,
      excluded,
    ))
    .filter((candidate) => candidate.score >= 8)
    .sort(compareRouteCandidates);
  const selected: SkillRouteResult["selected"][number][] = [];
  const selectedCandidates: RankedRouteCandidate[] = [];
  const coveredEvidence = new Set<string>();
  let contextBytes = 0;

  for (const candidate of ranked) {
    if (selected.length >= maximumSkills) break;
    const exclusiveSelection = selectedCandidates.find(
      (existing) => existing.stackPolicy === "exclusive",
    );
    if (exclusiveSelection) {
      excluded.push({
        id: candidate.id,
        reason: `exclusive-selection:${exclusiveSelection.id}`,
      });
      continue;
    }
    if (candidate.stackPolicy === "exclusive" && selected.length > 0) {
      excluded.push({
        id: candidate.id,
        reason: "exclusive-route-ranked-below-selection",
      });
      continue;
    }
    const conflict = selectedCandidates.find((existing) =>
      existing.excludes.includes(candidate.id)
      || candidate.excludes.includes(existing.id));
    if (conflict) {
      excluded.push({
        id: candidate.id,
        reason: `mutually-exclusive:${conflict.id}`,
      });
      continue;
    }
    const candidateEvidence = new Set(candidate.matchedTerms
      .map(normalizeToken)
      .filter((term) => !GENERIC_STACK_EVIDENCE.has(term)));
    if (
      selected.length > 0
      && (
        candidateEvidence.size === 0
        || [...candidateEvidence].every((term) => coveredEvidence.has(term))
      )
    ) {
      excluded.push({
        id: candidate.id,
        reason: "redundant-evidence",
      });
      continue;
    }
    const leadingScore = selectedCandidates[0]?.score;
    if (
      leadingScore !== undefined
      && candidate.score / leadingScore < MINIMUM_STACK_SCORE_RATIO
    ) {
      excluded.push({
        id: candidate.id,
        reason: "insufficient-stack-confidence",
      });
      continue;
    }
    const content = await readFile(candidate.file, "utf8").catch(() => null);
    if (content === null) {
      excluded.push({ id: candidate.id, reason: "skill-file-unreadable" });
      continue;
    }
    const bytes = Buffer.byteLength(content, "utf8");
    if (contextBytes + bytes > maximumContextBytes) {
      excluded.push({ id: candidate.id, reason: "context-budget-exceeded" });
      continue;
    }
    selected.push({
      id: candidate.id,
      skillName: candidate.skillName,
      file: candidate.file,
      score: candidate.score,
      matchedTerms: candidate.matchedTerms,
      contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      contextBytes: bytes,
      explanation: {
        intentEvidence: candidate.matchedTerms,
        repositoryEvidence: candidate.repositoryEvidence,
      },
    });
    selectedCandidates.push(candidate);
    for (const term of candidateEvidence) coveredEvidence.add(term);
    contextBytes += bytes;
  }

  const decision = selected.length === 0
    ? "abstain"
    : selected.length === 1 ? "single" : "stack";
  return deepFreeze({
    schemaVersion: 2,
    routerVersion: SKILL_ROUTER_VERSION,
    decision,
    intentHash: `sha256:${createHash("sha256").update(input.intent).digest("hex")}`,
    repositoryFingerprintHash: repositoryFingerprint
      ? `sha256:${createHash("sha256")
        .update(JSON.stringify(canonicalRepositoryFingerprint(repositoryFingerprint)))
        .digest("hex")}`
      : null,
    selected,
    excluded: excluded.sort((left, right) =>
      left.id.localeCompare(right.id) || left.reason.localeCompare(right.reason)),
    candidates: ranked.map(({ id, score, matchedTerms }) => ({
      id,
      score,
      matchedTerms,
    })),
    contextBytes,
    maximumContextBytes,
  });
}

function canonicalRepositoryFingerprint(
  fingerprint: RepositoryFingerprint,
): RepositoryFingerprint {
  return {
    schemaVersion: 1,
    languages: [...fingerprint.languages].sort(),
    frameworks: [...fingerprint.frameworks].sort(),
    dependencies: [...fingerprint.dependencies].sort(),
    files: [...fingerprint.files].sort(),
    imports: [...fingerprint.imports].sort(),
    scripts: [...fingerprint.scripts].sort(),
  };
}

export async function resolveRoutedSkills(
  input: RouteInstalledSkillsInput,
): Promise<Readonly<ResolvedSkillRoute>> {
  const route = await routeInstalledSkills(input);
  const noteById = new Map(input.notes.map((note) => [note.manifest.name, note]));
  const skills = await Promise.all(route.selected.map(async (selected) => {
    const note = noteById.get(selected.id);
    const manifestSkill = note?.manifest.skills.find((skill) =>
      path.resolve(note.path, skill.file) === selected.file);
    if (!note || !manifestSkill) {
      throw new Error(`Routed skill ${selected.id}:${selected.skillName} is no longer installed`);
    }
    const content = await readFile(selected.file, "utf8");
    return deepFreeze({
      noteId: note.manifest.name,
      skillName: manifestSkill.name,
      file: selected.file,
      content,
      activateOn: manifestSkill.activateOn,
      freedomLevel: manifestSkill.freedomLevel,
    });
  }));
  const resources: RoutedSkillResource[] = [];
  const seenResources = new Set<string>();
  let contextBytes = route.contextBytes;
  for (const skill of skills) {
    const note = noteById.get(skill.noteId);
    if (!note) continue;
    for (const relativePath of markdownReferences(skill.content)) {
      const key = `${skill.noteId}:${relativePath}`;
      if (seenResources.has(key)) continue;
      seenResources.add(key);
      const resolvedPath = path.resolve(path.dirname(skill.file), relativePath);
      const noteRoot = path.resolve(note.path);
      if (resolvedPath !== noteRoot && !resolvedPath.startsWith(`${noteRoot}${path.sep}`)) {
        resources.push({
          noteId: skill.noteId,
          relativePath,
          contentHash: null,
          contextBytes: 0,
          status: "unsafe-path",
        });
        continue;
      }
      const content = await readFile(resolvedPath, "utf8").catch(() => null);
      if (content === null) {
        resources.push({
          noteId: skill.noteId,
          relativePath,
          contentHash: null,
          contextBytes: 0,
          status: "unreadable",
        });
        continue;
      }
      const bytes = Buffer.byteLength(content, "utf8");
      const contentHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
      if (contextBytes + bytes > route.maximumContextBytes) {
        resources.push({
          noteId: skill.noteId,
          relativePath,
          contentHash,
          contextBytes: bytes,
          status: "context-budget-exceeded",
        });
        continue;
      }
      resources.push({
        noteId: skill.noteId,
        relativePath,
        contentHash,
        contextBytes: bytes,
        status: "embedded",
        content,
      });
      contextBytes += bytes;
    }
  }
  return deepFreeze({ route, skills, resources, contextBytes });
}

export function formatRoutedSkillContext(
  routed: ResolvedSkillRoute,
): string {
  const portableReceipt = {
    schemaVersion: routed.route.schemaVersion,
    routerVersion: routed.route.routerVersion,
    decision: routed.route.decision,
    intentHash: routed.route.intentHash,
    selected: routed.route.selected.map(({ file: _file, ...selected }) => ({
      ...selected,
      skillPath: `${selected.id}/${path.basename(_file)}`,
    })),
    resources: routed.resources.map(({ content: _content, ...resource }) => resource),
    contextBytes: routed.contextBytes,
    maximumContextBytes: routed.route.maximumContextBytes,
    candidateCount: routed.route.candidates.length,
    excludedCount: routed.route.excluded.length,
    optimizationPolicy: {
      primaryObjectives: [
        "cost",
        "latency",
        "quality",
      ],
      toolCallRole: "diagnostic_only",
      costEvidencePreference: [
        "measured_usd",
        "token_proxy",
      ],
    },
  };
  const receipt = JSON.stringify(portableReceipt, null, 2);
  const skills = routed.skills.map((skill) =>
    `## ${skill.skillName} (${skill.noteId})\n\n${skill.content}`).join("\n\n---\n\n");
  const resources = routed.resources
    .filter((resource) => resource.status === "embedded")
    .map((resource) =>
      `## ${resource.noteId}/${resource.relativePath}\n\n${resource.content ?? ""}`)
    .join("\n\n---\n\n");
  return [
    "# Memi deterministic routing receipt",
    "",
    "```json",
    receipt,
    "```",
    "",
    "# Efficiency contract",
    "",
    "The task manifest and closest repository evidence are authoritative.",
    "Use the routed skill to narrow discovery and avoid known mistakes.",
    "Do not broaden scope, inventory the whole repository, or add adjacent improvements when direct task evidence is available.",
    "Start with paths, component names, and tests named by the task, then inspect only their direct dependencies.",
    "Run only the manifest verification commands and the narrow checks required to repair a failure. Do not add a full suite or extra platform journey unless the task requires it.",
    "Optimize total cost, elapsed time, and correctness rather than minimizing tool calls in isolation.",
    "Extra narrow tool calls are allowed when they reduce total cost, avoid loading broad context, or increase confidence without expanding task scope.",
    "Batch related reads when that is cheaper, but do not trade away accuracy or repository-specific evidence to hit an arbitrary call count.",
    "When skill prose conflicts with installed versions or nearby repository patterns, follow the repository and record the divergence.",
    "",
    "# Routed skill stack",
    "",
    skills || "No skill was selected. Follow repository evidence only.",
    "",
    "# Embedded routed resources",
    "",
    resources || "No referenced resources were embedded.",
    "",
    "Do not attempt to read omitted resources outside the disposable workspace.",
  ].join("\n");
}

export function searchCatalogSkills(input: {
  readonly query: string;
  readonly entries: readonly SkillSearchEntry[];
  readonly limit?: number;
}): readonly SkillSearchResult[] {
  const queryTokens = tokenize(input.query);
  const limit = boundedInteger(input.limit ?? 10, 1, 100, "limit");
  return input.entries
    .map((entry) => {
      const evidence = scoreMetadata({
        id: entry.id,
        name: entry.name,
        title: entry.title,
        description: entry.description,
        tags: entry.tags,
        intents: entry.intents ?? [],
      }, queryTokens);
      return {
        id: entry.id,
        name: entry.name,
        title: entry.title,
        description: entry.description,
        ...evidence,
      };
    })
    .filter((entry) => entry.score >= 4)
    .sort((left, right) =>
      right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map((entry) => deepFreeze(entry));
}

interface RankedRouteCandidate {
  readonly id: string;
  readonly skillName: string;
  readonly file: string;
  readonly score: number;
  readonly priority: number;
  readonly matchedTerms: readonly string[];
  readonly excludes: readonly string[];
  readonly repositoryEvidence: readonly string[];
  readonly stackPolicy: "compatible" | "exclusive";
}

function routeCandidates(
  note: InstalledNote,
  queryTokens: ReadonlySet<string>,
  taskClass: string | null,
  requestedAction: "create" | "validate" | null,
  capabilities: ReadonlySet<string>,
  platforms: ReadonlySet<string>,
  repositoryFingerprint: RepositoryFingerprint | undefined,
  excluded: Array<{ id: string; reason: string }>,
): RankedRouteCandidate[] {
  const routing = note.manifest.memoire?.routing;
  const taskClasses = routing?.taskClasses?.map(normalizeTaskClass) ?? [];
  if (taskClasses.length > 0 && !taskClass) {
    excluded.push({
      id: note.manifest.name,
      reason: "task-class-missing",
    });
    return [];
  }
  if (taskClass && taskClasses.length > 0 && !taskClasses.includes(taskClass)) {
    excluded.push({
      id: note.manifest.name,
      reason: `task-class-mismatch:${taskClass}`,
    });
    return [];
  }
  const missingCapability = routing?.capabilities
    .map(normalizeToken)
    .find((capability) => !capabilities.has(capability));
  if (missingCapability) {
    excluded.push({
      id: note.manifest.name,
      reason: `missing-capability:${missingCapability}`,
    });
    return [];
  }
  const requiredPlatforms = routing?.platforms.map(normalizeToken) ?? [];
  if (requiredPlatforms.length > 0 && !requiredPlatforms.some((platform) => platforms.has(platform))) {
    excluded.push({
      id: note.manifest.name,
      reason: `platform-mismatch:${requiredPlatforms.join(",")}`,
    });
    return [];
  }
  const actions = routing?.actions?.map(normalizeToken) ?? [];
  if (
    requestedAction
    && actions.length > 0
    && !actions.some((action) => compatibleActions(requestedAction).has(action))
  ) {
    excluded.push({
      id: note.manifest.name,
      reason: `action-mismatch:${requestedAction}`,
    });
    return [];
  }
  const repositoryMatch = matchRepositoryEligibility(
    note.manifest.name,
    routing?.repository,
    repositoryFingerprint,
  );
  if (!repositoryMatch.eligible) {
    excluded.push({
      id: note.manifest.name,
      reason: repositoryMatch.reason,
    });
    return [];
  }
  return note.manifest.skills.map((skill) => {
    const intents = routing?.intents.length
      ? routing.intents
      : skill.activateOn.split(",").map((value) => value.trim()).filter(Boolean);
    const evidence = scoreMetadata({
      id: note.manifest.name,
      name: note.manifest.name,
      title: skill.name,
      description: note.manifest.description,
      tags: note.manifest.tags,
      intents,
    }, queryTokens);
    const exactTaskClassEvidence = taskClass && taskClasses.includes(taskClass)
      ? [taskClass]
      : [];
    return {
      id: note.manifest.name,
      skillName: skill.name,
      file: path.resolve(note.path, skill.file),
      score: evidence.score + (exactTaskClassEvidence.length > 0 ? 100 : 0)
        + (routing?.priority ?? 0),
      priority: routing?.priority ?? 0,
      matchedTerms: [...new Set([...exactTaskClassEvidence, ...evidence.matchedTerms])],
      excludes: routing?.excludes ?? [],
      repositoryEvidence: repositoryMatch.evidence,
      stackPolicy: routing?.stackPolicy ?? "compatible",
    };
  });
}

type RepositoryRules = NonNullable<
  NonNullable<NoteManifest["memoire"]>["routing"]
>["repository"];

function matchRepositoryEligibility(
  noteId: string,
  rules: RepositoryRules,
  fingerprint: RepositoryFingerprint | undefined,
): { eligible: true; evidence: readonly string[] } | {
  eligible: false;
  reason: string;
  evidence: readonly string[];
} {
  if (!rules || Object.keys(rules).length === 0) {
    return { eligible: true, evidence: [] };
  }
  if (!fingerprint) {
    return {
      eligible: false,
      reason: "repository-fingerprint-missing",
      evidence: [],
    };
  }
  const fields = [
    ["dependenciesAny", "dependency", fingerprint.dependencies],
    ["filesAny", "file", fingerprint.files],
    ["importsAny", "import", fingerprint.imports],
    ["scriptsAny", "script", fingerprint.scripts],
    ["frameworksAny", "framework", fingerprint.frameworks],
    ["languagesAny", "language", fingerprint.languages],
  ] as const;
  const evidence: string[] = [];
  try {
    for (const [ruleName, evidenceName, values] of fields) {
      const patterns = rules[ruleName] ?? [];
      if (patterns.length === 0) continue;
      const match = firstPatternMatch(patterns, values);
      if (!match) {
        return {
          eligible: false,
          reason: `repository-mismatch:${ruleName}`,
          evidence: [],
        };
      }
      evidence.push(`${evidenceName}:${match}`);
    }
    const excludedFile = firstPatternMatch(rules.excludeFilesAny ?? [], fingerprint.files);
    if (excludedFile) {
      return {
        eligible: false,
        reason: `repository-excluded:file:${excludedFile}`,
        evidence: [],
      };
    }
  } catch (error) {
    return {
      eligible: false,
      reason: `invalid-routing-pattern:${noteId}:${error instanceof Error ? error.message : "unknown"}`,
      evidence: [],
    };
  }
  return { eligible: true, evidence };
}

function firstPatternMatch(
  patterns: readonly string[],
  values: readonly string[],
): string | null {
  for (const pattern of patterns) {
    const matcher = compileSafeRoutingPattern(pattern);
    const value = values.find((candidate) => matcher.test(candidate));
    if (value) return value;
  }
  return null;
}

export interface RoutingPatternValidation {
  readonly valid: boolean;
  readonly mode?: RoutingPatternMode;
  readonly value?: string;
  readonly canonical?: string;
  readonly reason?: string;
  readonly migration?: string;
}

export function validateRoutingPattern(pattern: string): RoutingPatternValidation {
  if (pattern.length === 0 || pattern.length > ROUTING_PATTERN_MAX_LENGTH) {
    return { valid: false, reason: "pattern length must be between 1 and 160 characters" };
  }

  const typed = /^([a-z]+):(.*)$/u.exec(pattern);
  if (typed) {
    const mode = typed[1]!;
    const value = typed[2]!;
    if (!isRoutingPatternMode(mode)) {
      return {
        valid: false,
        reason: `unsupported pattern mode: ${mode}`,
        migration: `contains:${value}`,
      };
    }
    if (value.length === 0 || (mode === "oneOf" && value.split(",").some((item) => item.length === 0))) {
      return { valid: false, reason: "pattern value must not be empty" };
    }
    return {
      valid: true,
      mode,
      value,
      canonical: `${mode}:${value}`,
    };
  }

  const anchoredStart = pattern.startsWith("^");
  const anchoredEnd = pattern.endsWith("$");
  const rawValue = pattern.slice(anchoredStart ? 1 : 0, anchoredEnd ? -1 : undefined);
  if (rawValue.length === 0) {
    return { valid: false, reason: "legacy pattern must contain a literal value" };
  }
  const legacyAlternation = anchoredStart && anchoredEnd
    ? /^\(\?:([^()]+)\)$/u.exec(rawValue)
    : null;
  if (legacyAlternation) {
    const alternatives = legacyAlternation[1]!.split("|").map(decodeLegacyRoutingLiteral);
    if (alternatives.every((alternative): alternative is string => alternative !== null && alternative.length > 0)) {
      const value = alternatives.join(",");
      return { valid: true, mode: "oneOf", value, canonical: `oneOf:${value}` };
    }
  }
  const value = decodeLegacyRoutingLiteral(rawValue);
  if (value === null) {
    return {
      valid: false,
      reason: "legacy executable regex syntax is not supported",
      migration: `contains:${rawValue.replace(/[\\^$()[\]{}+?|*]/gu, "")}`,
    };
  }
  const mode = anchoredStart && anchoredEnd
    ? "exact"
    : anchoredStart
      ? "prefix"
      : anchoredEnd
        ? "suffix"
        : "contains";
  return { valid: true, mode, value, canonical: `${mode}:${value}` };
}

export function compileSafeRoutingPattern(pattern: string, flags = "i"): RegExp {
  if (!/^(?:i|u|iu|ui)?$/.test(flags)) {
    throw new Error(`unsupported routing flags: ${flags}`);
  }
  const validation = validateRoutingPattern(pattern);
  if (!validation.valid || !validation.mode || validation.value === undefined) {
    throw new Error(
      `unsafe routing pattern syntax: ${validation.reason ?? "invalid pattern"}${
        validation.migration ? `; migrate to ${validation.migration}` : ""
      }`,
    );
  }
  const escaped = validation.mode === "glob"
    ? escapeGlobPattern(validation.value)
    : validation.mode === "oneOf"
      ? validation.value.split(",").map(escapeRoutingLiteral).join("|")
    : escapeRoutingLiteral(validation.value);
  const source = validation.mode === "exact"
    ? `^${escaped}$`
    : validation.mode === "oneOf"
      ? `^(?:${escaped})$`
    : validation.mode === "prefix"
      ? `^${escaped}`
      : validation.mode === "suffix"
        ? `${escaped}$`
        : escaped;
  return new RegExp(source, flags);
}

function isRoutingPatternMode(value: string): value is RoutingPatternMode {
  return ROUTING_PATTERN_MODES.has(value as RoutingPatternMode);
}

function decodeLegacyRoutingLiteral(value: string): string | null {
  let literal = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === "\\") {
      const escaped = value[index + 1];
      if (!escaped || !/^[\\^$()[\]{}+*?|.]$/u.test(escaped)) return null;
      literal += escaped;
      index += 1;
      continue;
    }
    if (/^[^$^()[\]{}+*?|]$/u.test(character)) {
      literal += character;
      continue;
    }
    return null;
  }
  return literal;
}

function escapeRoutingLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function escapeGlobPattern(value: string): string {
  return [...value].map((character) => {
    if (character === "*") return ".*";
    if (character === "?") return ".";
    return escapeRoutingLiteral(character);
  }).join("");
}

function scoreMetadata(
  entry: SkillSearchEntry,
  queryTokens: ReadonlySet<string>,
): { score: number; matchedTerms: readonly string[] } {
  const fields = [
    { values: [entry.id, entry.name, entry.title], weight: 5 },
    { values: entry.tags, weight: 4 },
    { values: [entry.description], weight: 2 },
  ];
  const matchedRaw = new Set<string>();
  const matchedNormalized = new Set<string>();
  let score = 0;
  for (const intent of entry.intents ?? []) {
    const tokens = [...tokenize(intent)];
    const matches = tokens.filter((token) => queryTokens.has(token));
    if (tokens.length === 0 || matches.length / tokens.length < 0.6) continue;
    for (const token of matches) {
      score += 7;
      matchedRaw.add(token);
    }
  }
  for (const field of fields) {
    for (const value of field.values) {
      for (const raw of rawTokens(value)) {
        const normalized = normalizeToken(raw);
        if (!queryTokens.has(normalized) || matchedNormalized.has(`${field.weight}:${normalized}`)) continue;
        score += field.weight;
        matchedRaw.add(raw);
        matchedNormalized.add(`${field.weight}:${normalized}`);
      }
    }
  }
  return {
    score,
    matchedTerms: [...matchedRaw].sort((left, right) => left.localeCompare(right)),
  };
}

function compareRouteCandidates(
  left: RankedRouteCandidate,
  right: RankedRouteCandidate,
): number {
  return right.score - left.score
    || right.priority - left.priority
    || left.id.localeCompare(right.id)
    || left.skillName.localeCompare(right.skillName);
}

function rawTokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function tokenize(value: string): ReadonlySet<string> {
  return new Set(rawTokens(value)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
    .map(normalizeToken)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)));
}

function routableIntent(value: string): string {
  return value.replace(
    /\b(?:preserve|preserving|retain|retaining)\s+(?:the\s+)?existing\s+[a-z0-9-]+(?:\s+[a-z0-9-]+){0,2}/gi,
    " ",
  );
}

function inferRequestedAction(value: string): "create" | "validate" | null {
  const tokens = new Set(rawTokens(value).map(normalizeToken));
  const createSignals = [
    "add", "build", "change", "create", "design", "fix", "generate",
    "implement", "integrate", "modify", "refactor", "repair", "update", "write",
  ];
  if (createSignals.some((signal) => tokens.has(normalizeToken(signal)))) {
    return "create";
  }
  const validateSignals = [
    "analyze", "audit", "inspect", "review", "test", "validate", "verify",
  ];
  return validateSignals.some((signal) => tokens.has(normalizeToken(signal)))
    ? "validate"
    : null;
}

function compatibleActions(action: "create" | "validate"): ReadonlySet<string> {
  return action === "create"
    ? new Set(["create", "generate", "implement", "integrate", "map", "modify"])
    : new Set(["analyze", "audit", "inspect", "reference", "review", "verify"]);
}

function markdownReferences(content: string): readonly string[] {
  const references = new Set<string>();
  const pattern = /\]\((?![a-z]+:|#)([^)\s]+\.md)(?:#[^)]*)?\)/gi;
  for (const match of content.matchAll(pattern)) {
    const value = match[1]?.replaceAll("\\", "/");
    if (value) references.add(value);
  }
  return [...references].sort((left, right) => left.localeCompare(right));
}

function normalizeToken(token: string): string {
  const normalized = token.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return TOKEN_ALIASES[normalized] ?? normalized.replace(/(?:ing|ed|s)$/, "");
}

function normalizeTaskClass(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
