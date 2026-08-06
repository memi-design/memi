import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import type {
  StudioEvent,
  StudioEventType,
  StudioKnowledgeIndex,
  StudioKnowledgeItem,
  StudioKnowledgeKind,
  StudioRunAction,
  StudioHarnessId,
} from "./types.js";

const KNOWLEDGE_KIND_ORDER: StudioKnowledgeKind[] = [
  "markdown",
  "yaml",
  "json",
  "spec",
  "note",
  "research",
  "design-reference",
  "agent-capture",
  "artifact",
];
const KNOWLEDGE_EXTENSIONS = new Set([".md", ".mdx", ".yaml", ".yml", ".json"]);
const MAX_INDEXED_FILES = 600;
const MAX_FILE_BYTES = 320_000;
const STALE_KNOWLEDGE_PATTERN = /\b(dibs|aicp|bidding|bids?|bid)\b/i;
const CAPTURE_EVENT_TYPES = new Set<StudioEventType>([
  "research_note",
  "design_decision",
  "artifact",
  "file_change",
]);
const SKIPPED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  "vendor",
]);
const SKIPPED_FILES = new Set([
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "tsconfig.tsbuildinfo",
]);

export interface KnowledgeStoreOptions {
  includeGenerated?: boolean;
}

export function knowledgeStoreDir(projectRoot: string): string {
  return join(resolve(projectRoot), ".memoire", "studio");
}

export function knowledgeStorePath(projectRoot: string): string {
  return join(knowledgeStoreDir(projectRoot), "knowledge-db.json");
}

export async function listKnowledgeStore(projectRoot: string, options: KnowledgeStoreOptions = {}): Promise<StudioKnowledgeIndex> {
  const stored = await readKnowledgeStore(projectRoot);
  return stored ?? refreshKnowledgeStore(projectRoot, options);
}

export async function refreshKnowledgeStore(projectRoot: string, options: KnowledgeStoreOptions = {}): Promise<StudioKnowledgeIndex> {
  const root = resolve(projectRoot);
  const existing = await readKnowledgeStore(root);
  const captures = (existing?.items ?? []).filter((item) => item.kind === "agent-capture" || item.kind === "artifact");
  const scanned = await scanKnowledgeSources(root, options);
  const items = dedupeKnowledgeItems([...scanned, ...captures]);
  const index = createKnowledgeIndex(root, items);
  await persistKnowledgeStore(root, index);
  return index;
}

export function compactKnowledgeIndex(index: StudioKnowledgeIndex): StudioKnowledgeIndex {
  return {
    ...index,
    items: index.items
      .filter((item) => !isGeneratedKnowledgeSource(item.sourcePath))
      .map((item) => ({
        ...item,
        content: "",
        data: compactKnowledgeData(item.data),
      })),
  };
}

export async function getKnowledgeItem(projectRoot: string, id: string): Promise<StudioKnowledgeItem | null> {
  const index = await listKnowledgeStore(projectRoot);
  return index.items.find((item) => item.id === id) ?? null;
}

export async function captureKnowledgeEvent(
  projectRoot: string,
  event: StudioEvent,
  session?: { harness?: StudioHarnessId; action?: StudioRunAction } | null,
  itemPatch?: Partial<StudioKnowledgeItem>,
): Promise<StudioKnowledgeItem> {
  if (!shouldCaptureKnowledgeEvent(event)) {
    throw Object.assign(new Error(`Event type cannot be captured as knowledge: ${event.type}`), { statusCode: 400 });
  }
  const root = resolve(projectRoot);
  const index = await listKnowledgeStore(root);
  const captured = knowledgeItemFromEvent(root, event, session, itemPatch);
  const next = createKnowledgeIndex(root, dedupeKnowledgeItems([
    captured,
    ...index.items.filter((item) => item.id !== captured.id),
  ]));
  await persistKnowledgeStore(root, next);
  return captured;
}

export function shouldCaptureKnowledgeEvent(event: Pick<StudioEvent, "type" | "message" | "data">): boolean {
  if (CAPTURE_EVENT_TYPES.has(event.type)) return true;
  if (event.type !== "session_result") return false;
  const data = isRecord(event.data) ? event.data : {};
  return ["research", "researchNotes", "designDecisions", "artifacts", "knowledge"].some((key) => key in data);
}

async function scanKnowledgeSources(root: string, options: KnowledgeStoreOptions): Promise<StudioKnowledgeItem[]> {
  const files = await walkKnowledgeFiles(root, options);
  const items: StudioKnowledgeItem[] = [];
  for (const file of files) {
    const content = await readText(file);
    if (!content.trim()) continue;
    const rel = relative(root, file);
    if (isStaleKnowledgeSource(rel, content)) continue;
    const item = await knowledgeItemFromFile(root, file, content);
    if (item) items.push(item);
  }
  return items;
}

async function walkKnowledgeFiles(root: string, options: KnowledgeStoreOptions): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (files.length >= MAX_INDEXED_FILES) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_INDEXED_FILES) return;
      const path = join(dir, entry.name);
      const rel = relative(root, path).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name, rel)) continue;
        await walk(path);
        continue;
      }
      if (!entry.isFile() || shouldSkipFile(entry.name, rel, options)) continue;
      const extension = extname(entry.name).toLowerCase();
      if (!KNOWLEDGE_EXTENSIONS.has(extension)) continue;
      try {
        const info = await stat(path);
        if (info.size > MAX_FILE_BYTES) continue;
      } catch {
        continue;
      }
      files.push(path);
    }
  }
  await walk(root);
  return files;
}

function shouldSkipDirectory(name: string, relativePath: string): boolean {
  if (SKIPPED_DIRS.has(name)) return true;
  if (relativePath === ".memoire/studio" || relativePath.startsWith(".memoire/studio/")) return true;
  if (relativePath === ".memoire/project-memory" || relativePath.startsWith(".memoire/project-memory/")) return true;
  if (name.startsWith(".") && name !== ".github" && name !== ".memoire") return true;
  return false;
}

function shouldSkipFile(name: string, relativePath: string, options: KnowledgeStoreOptions): boolean {
  if (SKIPPED_FILES.has(name)) return true;
  if (!options.includeGenerated && isGeneratedKnowledgeSource(relativePath)) return true;
  if (relativePath.endsWith(".map")) return true;
  return false;
}

function isGeneratedKnowledgeSource(relativePath: string): boolean {
  return relativePath.startsWith("apps/studio/src-tauri/gen/schemas/");
}

function compactKnowledgeData(data: Record<string, unknown>): Record<string, unknown> {
  const { document: _document, ...rest } = data;
  return rest;
}

async function knowledgeItemFromFile(root: string, file: string, content: string): Promise<StudioKnowledgeItem | null> {
  const sourcePath = relative(root, file).replaceAll("\\", "/");
  const extension = extname(file).toLowerCase();
  const parsedJSON = extension === ".json" ? parseJSON(content) : null;
  if (extension === ".json" && !isIndexableJSON(sourcePath, parsedJSON)) return null;
  const parsedYAML = extension === ".yaml" || extension === ".yml" ? parseSimpleYAML(content) : {};
  const title = pickString(parsedJSON, ["title", "name", "id"])
    ?? pickString(parsedYAML, ["title", "name", "id"])
    ?? markdownTitle(content)
    ?? titleFromFile(file);
  const summary = pickString(parsedJSON, ["summary", "description", "purpose"])
    ?? pickString(parsedYAML, ["summary", "description", "purpose"])
    ?? firstText(content)
    ?? "Repository knowledge source.";
  const kind = kindForSource(sourcePath, extension, parsedJSON, parsedYAML);
  const info = await stat(file).catch(() => null);
  const timestamp = info?.mtime.toISOString() ?? new Date().toISOString();
  return {
    id: `source:${slug(sourcePath)}`,
    kind,
    title,
    summary,
    status: "indexed",
    tags: tagsForSource(sourcePath, extension, parsedJSON, parsedYAML, kind),
    sourcePath,
    sourceRoot: root,
    contentType: contentTypeFor(extension),
    content: clampContent(content),
    excerpt: excerpt(content),
    createdAt: timestamp,
    updatedAt: timestamp,
    links: [{ label: "Source", href: sourcePath }],
    data: {
      byteLength: info?.size ?? content.length,
      modifiedAt: timestamp,
      ...(parsedJSON ? { document: parsedJSON } : {}),
      ...(Object.keys(parsedYAML).length > 0 ? { frontmatter: parsedYAML } : {}),
    },
  };
}

function knowledgeItemFromEvent(
  root: string,
  event: StudioEvent,
  session?: { harness?: StudioHarnessId; action?: StudioRunAction } | null,
  itemPatch?: Partial<StudioKnowledgeItem>,
): StudioKnowledgeItem {
  const data = isRecord(event.data) ? event.data : {};
  const title = itemPatch?.title
    ?? pickString(data, ["title", "name"])
    ?? eventLabel(event.type);
  const summary = itemPatch?.summary
    ?? pickString(data, ["summary", "description", "result"])
    ?? event.message;
  const tags = normalizeTags(itemPatch?.tags ?? data.tags, [
    event.type,
    session?.harness,
    session?.action,
  ]);
  const content = [
    `# ${title}`,
    "",
    summary,
    "",
    `- Event: ${event.type}`,
    `- Session: ${event.sessionId}`,
    session?.harness ? `- Harness: ${session.harness}` : null,
    session?.action ? `- Action: ${session.action}` : null,
    "",
    "```json",
    JSON.stringify({ message: event.message, data: event.data ?? null }, null, 2),
    "```",
  ].filter((line): line is string => line !== null).join("\n");
  return {
    id: itemPatch?.id ?? `capture:${slug(event.sessionId)}:${slug(event.id)}`,
    kind: itemPatch?.kind ?? (event.type === "artifact" || event.type === "file_change" ? "artifact" : "agent-capture"),
    title,
    summary,
    status: itemPatch?.status ?? "captured",
    tags,
    sourcePath: itemPatch?.sourcePath ?? `.memoire/studio/knowledge/${event.sessionId}/${event.id}.md`,
    sourceRoot: root,
    contentType: "text/markdown",
    content,
    excerpt: excerpt(content),
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
    links: itemPatch?.links ?? [{ label: "Session event", href: `.memoire/studio/sessions/${event.sessionId}.jsonl` }],
    data: {
      event,
      session: session ?? null,
      ...(itemPatch?.data ?? {}),
    },
    sessionId: event.sessionId,
    eventId: event.id,
    eventType: event.type,
  };
}

function createKnowledgeIndex(root: string, items: StudioKnowledgeItem[]): StudioKnowledgeIndex {
  const sorted = [...items].sort((a, b) => {
    const kindDelta = KNOWLEDGE_KIND_ORDER.indexOf(a.kind) - KNOWLEDGE_KIND_ORDER.indexOf(b.kind);
    if (kindDelta !== 0) return kindDelta;
    return `${a.title}:${a.sourcePath}`.localeCompare(`${b.title}:${b.sourcePath}`);
  });
  const counts = KNOWLEDGE_KIND_ORDER.reduce((acc, kind) => {
    acc[kind] = sorted.filter((item) => item.kind === kind).length;
    return acc;
  }, {} as Record<StudioKnowledgeKind, number>);
  counts.markdown = sorted.filter((item) => item.contentType === "text/markdown").length;
  counts.yaml = sorted.filter((item) => item.contentType === "application/x-yaml").length;
  counts.json = sorted.filter((item) => item.contentType === "application/json").length;
  return {
    schemaVersion: 1,
    projectRoot: root,
    generatedAt: new Date().toISOString(),
    counts,
    items: sorted,
  };
}

function dedupeKnowledgeItems(items: StudioKnowledgeItem[]): StudioKnowledgeItem[] {
  const byId = new Map<string, StudioKnowledgeItem>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

async function readKnowledgeStore(projectRoot: string): Promise<StudioKnowledgeIndex | null> {
  try {
    const parsed = JSON.parse(await readFile(knowledgeStorePath(projectRoot), "utf-8")) as StudioKnowledgeIndex;
    return parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

async function persistKnowledgeStore(projectRoot: string, index: StudioKnowledgeIndex): Promise<void> {
  await mkdir(knowledgeStoreDir(projectRoot), { recursive: true });
  await writeFile(knowledgeStorePath(projectRoot), `${JSON.stringify(index, null, 2)}\n`, "utf-8");
}

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf-8");
  } catch {
    return "";
  }
}

function kindForSource(
  sourcePath: string,
  extension: string,
  parsedJSON: Record<string, unknown> | null,
  parsedYAML: Record<string, string>,
): StudioKnowledgeKind {
  const haystack = `${sourcePath} ${pickString(parsedJSON, ["type", "kind"]) ?? ""} ${parsedYAML.kind ?? ""}`.toLowerCase();
  if (haystack.includes("reference")) return "design-reference";
  if (haystack.includes("research")) return "research";
  if (haystack.includes("note.json") || haystack.includes("/notes/") || haystack.includes("skills/")) return "note";
  if (haystack.includes("spec") || haystack.includes("component") || haystack.includes("page")) return "spec";
  if (extension === ".yaml" || extension === ".yml") return "yaml";
  if (extension === ".json") return "json";
  return "markdown";
}

function tagsForSource(
  sourcePath: string,
  extension: string,
  parsedJSON: Record<string, unknown> | null,
  parsedYAML: Record<string, string>,
  kind: StudioKnowledgeKind,
): string[] {
  const folderTags = sourcePath.split("/").slice(0, -1).filter((part) => part && !part.startsWith(".")).slice(0, 3);
  const typeTag = extension === ".yaml" || extension === ".yml" ? "yaml" : extension.replace(".", "") || kind;
  return normalizeTags(parsedJSON?.tags ?? parsedYAML.tags?.split(","), [
    kind,
    typeTag,
    parsedYAML.kind,
    pickString(parsedJSON, ["type", "kind"]),
    ...folderTags,
  ]);
}

function isIndexableJSON(sourcePath: string, parsed: Record<string, unknown> | null): boolean {
  if (!parsed) return false;
  if (/\/(?:specs|notes|skills|references)\//i.test(`/${sourcePath}`)) return true;
  return ["title", "name", "summary", "description", "purpose", "type", "kind"].some((key) => typeof parsed[key] === "string");
}

function parseJSON(content: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(content);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function parseSimpleYAML(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.+)$/);
    if (!match) continue;
    parsed[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return parsed;
}

function isStaleKnowledgeSource(sourcePath: string, content: string): boolean {
  return STALE_KNOWLEDGE_PATTERN.test(`${sourcePath}\n${content}`);
}

function contentTypeFor(extension: string): string {
  if (extension === ".md" || extension === ".mdx") return "text/markdown";
  if (extension === ".yaml" || extension === ".yml") return "application/x-yaml";
  if (extension === ".json") return "application/json";
  return "text/plain";
}

function markdownTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function firstText(content: string): string | null {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line.length > 0 && !line.startsWith("---") && !line.match(/^[A-Za-z][\w-]*\s*:/)) ?? null;
}

function titleFromFile(file: string): string {
  return basename(file, extname(file))
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function pickString(value: Record<string, unknown> | null, keys: string[]): string | null {
  if (!value) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function normalizeTags(value: unknown, fallback: Array<string | null | undefined> = []): string[] {
  const tags = Array.isArray(value) ? value : fallback;
  return [...new Set(tags
    .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    .map((tag) => tag.trim()))];
}

function clampContent(content: string): string {
  return content.length <= MAX_FILE_BYTES ? content : content.slice(0, MAX_FILE_BYTES);
}

function excerpt(content: string): string {
  return clampContent(content).replace(/\s+/g, " ").trim().slice(0, 480);
}

function eventLabel(type: string): string {
  return type.replace(/_/g, " ");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "item";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
