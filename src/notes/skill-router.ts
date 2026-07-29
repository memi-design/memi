import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  InstalledNote,
  NoteManifest,
  ResolvedSkill,
} from "./types.js";

export const SKILL_ROUTER_VERSION = "skill-router-v1";

const TOKEN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  a11y: "accessibility",
  accessible: "accessibility",
  animations: "animation",
  colours: "color",
  ios: "swiftui",
  type: "typography",
  typescale: "typography",
  voiceover: "accessibility",
  wcag: "accessibility",
});
const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "into",
  "is", "it", "of", "on", "or", "the", "this", "to", "use", "with",
]);

export interface RouteInstalledSkillsInput {
  readonly intent: string;
  readonly notes: readonly InstalledNote[];
  readonly capabilities: readonly string[];
  readonly platforms?: readonly string[];
  readonly maximumSkills?: number;
  readonly maximumContextBytes?: number;
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
  readonly schemaVersion: 1;
  readonly routerVersion: typeof SKILL_ROUTER_VERSION;
  readonly decision: "single" | "stack" | "abstain";
  readonly intentHash: string;
  readonly selected: readonly {
    readonly id: string;
    readonly skillName: string;
    readonly file: string;
    readonly score: number;
    readonly matchedTerms: readonly string[];
    readonly contentHash: string;
    readonly contextBytes: number;
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
}

export async function routeInstalledSkills(
  input: RouteInstalledSkillsInput,
): Promise<Readonly<SkillRouteResult>> {
  const maximumSkills = boundedInteger(input.maximumSkills ?? 2, 1, 4, "maximumSkills");
  const maximumContextBytes = boundedInteger(
    input.maximumContextBytes ?? 8_000,
    1,
    1_000_000,
    "maximumContextBytes",
  );
  const queryTokens = tokenize(input.intent);
  const capabilities = new Set(input.capabilities.map(normalizeToken));
  const platforms = new Set((input.platforms ?? []).map(normalizeToken));
  const excluded: Array<{ id: string; reason: string }> = [];
  const ranked = input.notes
    .filter((note) => note.enabled)
    .flatMap((note) => routeCandidates(note, queryTokens, capabilities, platforms, excluded))
    .filter((candidate) => candidate.score >= 8)
    .sort(compareRouteCandidates);
  const selected: SkillRouteResult["selected"][number][] = [];
  let contextBytes = 0;

  for (const candidate of ranked) {
    if (selected.length >= maximumSkills) break;
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
    });
    contextBytes += bytes;
  }

  const decision = selected.length === 0
    ? "abstain"
    : selected.length === 1 ? "single" : "stack";
  return deepFreeze({
    schemaVersion: 1,
    routerVersion: SKILL_ROUTER_VERSION,
    decision,
    intentHash: `sha256:${createHash("sha256").update(input.intent).digest("hex")}`,
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
  return deepFreeze({ route, skills });
}

export function formatRoutedSkillContext(
  routed: ResolvedSkillRoute,
): string {
  const receipt = JSON.stringify(routed.route, null, 2);
  const skills = routed.skills.map((skill) =>
    `## ${skill.skillName} (${skill.noteId})\n\n${skill.content}`).join("\n\n---\n\n");
  return [
    "# Memi deterministic routing receipt",
    "",
    "```json",
    receipt,
    "```",
    "",
    "# Routed skill stack",
    "",
    skills || "No skill was selected. Follow repository evidence only.",
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
}

function routeCandidates(
  note: InstalledNote,
  queryTokens: ReadonlySet<string>,
  capabilities: ReadonlySet<string>,
  platforms: ReadonlySet<string>,
  excluded: Array<{ id: string; reason: string }>,
): RankedRouteCandidate[] {
  const routing = note.manifest.memoire?.routing;
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
  const excludedTerms = new Set((routing?.excludes ?? []).flatMap((value) => [...tokenize(value)]));
  if ([...queryTokens].some((token) => excludedTerms.has(token))) {
    excluded.push({ id: note.manifest.name, reason: "routing-exclusion" });
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
    return {
      id: note.manifest.name,
      skillName: skill.name,
      file: path.resolve(note.path, skill.file),
      score: evidence.score + (routing?.priority ?? 0),
      priority: routing?.priority ?? 0,
      matchedTerms: evidence.matchedTerms,
    };
  });
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
    .filter((token) => !STOP_WORDS.has(token))
    .map(normalizeToken));
}

function normalizeToken(token: string): string {
  const normalized = token.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return TOKEN_ALIASES[normalized] ?? normalized.replace(/(?:ing|ed|s)$/, "");
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
