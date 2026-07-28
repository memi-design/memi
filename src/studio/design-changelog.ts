import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { collectDesignSystemTrace } from "./design-system-trace.js";
import { projectMemoryDir } from "./project-memory.js";
import type {
  DesignChangelogCaptureRequest,
  DesignChangelogEntry,
  DesignChangelogFileRef,
  StudioDesignSystemTrace,
  StudioEvent,
  StudioEventType,
} from "./types.js";

export type DesignChangelogCreateInput = Partial<Omit<DesignChangelogEntry, "schemaVersion" | "id" | "createdAt" | "updatedAt" | "status">> & {
  id?: string;
  status?: DesignChangelogEntry["status"];
  createdAt?: string;
  updatedAt?: string;
};
export type DesignChangelogPatchInput = Partial<Omit<DesignChangelogEntry, "schemaVersion" | "id" | "createdAt">>;
export interface DesignChangelogCaptureResult {
  entry: DesignChangelogEntry | null;
  captured: boolean;
  warnings: string[];
}

const DESIGN_EVENT_TYPES = new Set<StudioEventType>([
  "design_decision",
  "design_system_artifact",
  "design_artifact",
  "design_preview",
  "figma_candidate",
  "spec_reference",
  "artifact",
]);

const DESIGN_ACTIONS = new Set(["compose", "design-doc", "audit", "self-design", "research", "app-build", "browser-audit", "handoff"]);
const GENERATED_BY_RUNTIME_TAG = "agent-captured";

export function designChangelogDir(projectRoot: string): string {
  return join(projectMemoryDir(projectRoot), "changelog");
}

export async function listDesignChangelogEntries(projectRoot: string): Promise<DesignChangelogEntry[]> {
  const dir = designChangelogDir(projectRoot);
  try {
    const files = await readdir(dir, { withFileTypes: true });
    const entries = await Promise.all(files
      .filter((file) => file.isFile() && file.name.endsWith(".json"))
      .map((file) => readDesignChangelogEntry(join(dir, file.name))));
    return entries
      .filter((entry): entry is DesignChangelogEntry => Boolean(entry))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title));
  } catch {
    return [];
  }
}

export async function getDesignChangelogEntry(projectRoot: string, id: string): Promise<DesignChangelogEntry | null> {
  return readDesignChangelogEntry(entryPath(projectRoot, id));
}

export async function createDesignChangelogEntry(projectRoot: string, input: DesignChangelogCreateInput): Promise<DesignChangelogEntry> {
  const now = new Date().toISOString();
  const title = normalizeText(input.title) || "Untitled design change";
  const id = normalizeEntryId(input.id ?? `${slug(title)}-${randomUUID().slice(0, 8)}`);
  const entry: DesignChangelogEntry = {
    schemaVersion: 1,
    id,
    title,
    summary: normalizeText(input.summary) || "Design changelog entry.",
    bodyMarkdown: normalizeText(input.bodyMarkdown) || "## Notes\n\nAdd design rationale and evidence.",
    status: input.status ?? "active",
    tags: normalizeTags(input.tags),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    authoredBy: input.authoredBy ?? "human",
    harness: input.harness ?? null,
    action: input.action ?? null,
    sessionId: input.sessionId ?? null,
    eventIds: normalizeStringArray(input.eventIds),
    fileRefs: normalizeFileRefs(input.fileRefs),
    captureWarnings: normalizeStringArray(input.captureWarnings),
  };
  await writeDesignChangelogEntry(projectRoot, entry);
  return entry;
}

export async function updateDesignChangelogEntry(projectRoot: string, id: string, patch: DesignChangelogPatchInput): Promise<DesignChangelogEntry> {
  const existing = await getRequiredEntry(projectRoot, id);
  const updated: DesignChangelogEntry = {
    ...existing,
    ...patch,
    id: existing.id,
    schemaVersion: 1,
    title: patch.title === undefined ? existing.title : normalizeText(patch.title) || existing.title,
    summary: patch.summary === undefined ? existing.summary : normalizeText(patch.summary),
    bodyMarkdown: patch.bodyMarkdown === undefined ? existing.bodyMarkdown : normalizeText(patch.bodyMarkdown),
    tags: patch.tags === undefined ? existing.tags : normalizeTags(patch.tags),
    eventIds: patch.eventIds === undefined ? existing.eventIds : normalizeStringArray(patch.eventIds),
    fileRefs: patch.fileRefs === undefined ? existing.fileRefs : normalizeFileRefs(patch.fileRefs),
    captureWarnings: patch.captureWarnings === undefined ? existing.captureWarnings : normalizeStringArray(patch.captureWarnings),
    updatedAt: new Date().toISOString(),
  };
  await writeDesignChangelogEntry(projectRoot, updated);
  return updated;
}

export async function archiveDesignChangelogEntry(projectRoot: string, id: string): Promise<DesignChangelogEntry> {
  return updateDesignChangelogEntry(projectRoot, id, { status: "archived" });
}

export async function restoreDesignChangelogEntry(projectRoot: string, id: string): Promise<DesignChangelogEntry> {
  return updateDesignChangelogEntry(projectRoot, id, { status: "active" });
}

export async function captureDesignChangelogEntry(projectRoot: string, input: DesignChangelogCaptureRequest): Promise<DesignChangelogCaptureResult> {
  const events = normalizeCaptureEvents(input);
  const session = input.session ?? null;
  const trace = input.trace ?? await collectDesignSystemTrace(projectRoot);
  const fileRefs = normalizeFileRefs((trace?.designSystemFiles ?? []).map((file) => ({
    path: file.path,
    status: file.status,
    insertions: file.insertions,
    deletions: file.deletions,
    kind: file.kind,
    designSystem: file.designSystem,
  })));
  const designEvents = events.filter((event) => isDesignEvent(event));
  const hasDesignAction = Boolean(session?.action && DESIGN_ACTIONS.has(String(session.action)));
  const hasDesignEvidence = designEvents.length > 0 || fileRefs.length > 0;
  if (!hasDesignEvidence && !hasDesignAction) {
    return { entry: null, captured: false, warnings: [] };
  }
  if (!hasDesignEvidence) {
    return { entry: null, captured: false, warnings: ["No design event or design-system file evidence was available for changelog capture."] };
  }

  const warnings = captureWarnings({ designEvents, fileRefs, trace });
  const eventIds = normalizeStringArray(events.map((event) => event.id));
  const sessionId = normalizeText(session?.id) || null;
  const existing = sessionId ? await findCapturedEntryBySession(projectRoot, sessionId) : null;
  const generated = buildCapturedEntry(projectRoot, {
    session,
    events,
    designEvents,
    fileRefs,
    warnings,
    eventIds,
    existing,
  });
  await writeDesignChangelogEntry(projectRoot, generated);
  return { entry: generated, captured: true, warnings };
}

export async function exportDesignChangelogMarkdown(projectRoot: string): Promise<string> {
  const entries = await listDesignChangelogEntries(projectRoot);
  const lines = ["# Mémoire Studio Design Changelog", ""];
  for (const entry of entries) {
    lines.push(`## ${entry.title}`, "");
    lines.push(`- Status: ${entry.status}`);
    lines.push(`- Source: ${entry.authoredBy}${entry.sessionId ? ` / ${entry.sessionId}` : ""}`);
    if (entry.tags.length > 0) lines.push(`- Tags: ${entry.tags.join(", ")}`);
    if (entry.fileRefs.length > 0) lines.push(`- Files: ${entry.fileRefs.map((file) => file.path).join(", ")}`);
    if (entry.captureWarnings.length > 0) lines.push(`- Warnings: ${entry.captureWarnings.join("; ")}`);
    lines.push("", entry.summary, "", entry.bodyMarkdown.trim(), "");
  }
  return `${lines.join("\n").trim()}\n`;
}

async function readDesignChangelogEntry(path: string): Promise<DesignChangelogEntry | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8"));
    if (!parsed || parsed.schemaVersion !== 1 || typeof parsed.id !== "string" || typeof parsed.title !== "string") return null;
    return {
      schemaVersion: 1,
      id: normalizeEntryId(parsed.id),
      title: normalizeText(parsed.title) || "Untitled design change",
      summary: normalizeText(parsed.summary),
      bodyMarkdown: normalizeText(parsed.bodyMarkdown),
      status: parsed.status === "archived" ? "archived" : "active",
      tags: normalizeTags(parsed.tags),
      createdAt: normalizeText(parsed.createdAt) || new Date(0).toISOString(),
      updatedAt: normalizeText(parsed.updatedAt) || new Date(0).toISOString(),
      authoredBy: parsed.authoredBy === "human" || parsed.authoredBy === "runtime" ? parsed.authoredBy : "agent",
      harness: typeof parsed.harness === "string" ? parsed.harness : null,
      action: typeof parsed.action === "string" ? parsed.action : null,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      eventIds: normalizeStringArray(parsed.eventIds),
      fileRefs: normalizeFileRefs(parsed.fileRefs),
      captureWarnings: normalizeStringArray(parsed.captureWarnings),
    };
  } catch {
    return null;
  }
}

async function writeDesignChangelogEntry(projectRoot: string, entry: DesignChangelogEntry): Promise<void> {
  const dir = designChangelogDir(projectRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${normalizeEntryId(entry.id)}.json`), `${JSON.stringify(entry, null, 2)}\n`, "utf-8");
}

async function getRequiredEntry(projectRoot: string, id: string): Promise<DesignChangelogEntry> {
  const entry = await getDesignChangelogEntry(projectRoot, id);
  if (!entry) {
    const error = new Error(`Unknown design changelog entry: ${id}`) as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }
  return entry;
}

async function findCapturedEntryBySession(projectRoot: string, sessionId: string): Promise<DesignChangelogEntry | null> {
  const entries = await listDesignChangelogEntries(projectRoot);
  return entries.find((entry) => entry.sessionId === sessionId && entry.tags.includes(GENERATED_BY_RUNTIME_TAG)) ?? null;
}

function buildCapturedEntry(projectRoot: string, input: {
  session: DesignChangelogCaptureRequest["session"];
  events: StudioEvent[];
  designEvents: StudioEvent[];
  fileRefs: DesignChangelogFileRef[];
  warnings: string[];
  eventIds: string[];
  existing: DesignChangelogEntry | null;
}): DesignChangelogEntry {
  const now = new Date().toISOString();
  const sessionId = normalizeText(input.session?.id) || null;
  const title = titleFromCapture(input.session, input.designEvents);
  const summary = summaryFromCapture(input.designEvents, input.fileRefs);
  const bodyMarkdown = bodyFromCapture(input.events, input.fileRefs, input.warnings);
  const tags = normalizeTags([
    GENERATED_BY_RUNTIME_TAG,
    "design-memory",
    ...input.fileRefs.map((file) => file.kind),
    ...input.designEvents.map((event) => event.type.replace(/_/g, "-")),
  ]);
  const id = input.existing?.id ?? (sessionId ? `session-${slug(sessionId)}` : `${slug(title)}-${randomUUID().slice(0, 8)}`);
  return {
    schemaVersion: 1,
    id,
    title: input.existing?.authoredBy === "human" ? input.existing.title : title,
    summary: input.existing?.authoredBy === "human" ? input.existing.summary : summary,
    bodyMarkdown: input.existing?.authoredBy === "human" ? input.existing.bodyMarkdown : bodyMarkdown,
    status: input.existing?.status ?? "active",
    tags: normalizeTags([...(input.existing?.tags ?? []), ...tags]),
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
    authoredBy: input.existing?.authoredBy === "human" ? "human" : "agent",
    harness: normalizeText(input.session?.harness) || input.existing?.harness || null,
    action: normalizeText(input.session?.action) || input.existing?.action || null,
    sessionId,
    eventIds: normalizeStringArray([...(input.existing?.eventIds ?? []), ...input.eventIds]),
    fileRefs: mergeFileRefs([...(input.existing?.fileRefs ?? []), ...input.fileRefs]),
    captureWarnings: normalizeStringArray(input.warnings),
  };
}

function titleFromCapture(session: DesignChangelogCaptureRequest["session"], designEvents: StudioEvent[]): string {
  const sessionTitle = [normalizeText(session?.harness), normalizeText(session?.action), "design change"]
    .filter(Boolean)
    .join(" ");
  if (sessionTitle !== "design change") return sessionTitle;
  const firstTitle = normalizeText(designEvents[0]?.message);
  if (firstTitle) return firstTitle.length > 86 ? `${firstTitle.slice(0, 83)}...` : firstTitle;
  return "Captured design change";
}

function summaryFromCapture(designEvents: StudioEvent[], fileRefs: DesignChangelogFileRef[]): string {
  const decision = designEvents.find((event) => event.type === "design_decision") ?? designEvents[0];
  if (decision) return normalizeText(decision.message).slice(0, 240);
  if (fileRefs.length > 0) return `${fileRefs.length} design-system file${fileRefs.length === 1 ? "" : "s"} changed.`;
  return "Captured design-related work from Studio runtime evidence.";
}

function bodyFromCapture(events: StudioEvent[], fileRefs: DesignChangelogFileRef[], warnings: string[]): string {
  const lines = ["## Captured Evidence", ""];
  const visibleEvents = events.filter((event) => DESIGN_EVENT_TYPES.has(event.type) || event.type === "session_result").slice(0, 12);
  if (visibleEvents.length > 0) {
    lines.push("### Events", "");
    for (const event of visibleEvents) lines.push(`- ${event.type}: ${normalizeText(event.message)}`);
    lines.push("");
  }
  if (fileRefs.length > 0) {
    lines.push("### Files", "");
    for (const file of fileRefs.slice(0, 16)) {
      lines.push(`- ${file.path} (${file.kind}, ${file.status}, +${file.insertions} -${file.deletions})`);
    }
    lines.push("");
  }
  if (warnings.length > 0) {
    lines.push("### Capture Warnings", "");
    for (const warning of warnings) lines.push(`- ${warning}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function captureWarnings(input: {
  designEvents: StudioEvent[];
  fileRefs: DesignChangelogFileRef[];
  trace: StudioDesignSystemTrace | null;
}): string[] {
  const warnings: string[] = [];
  if (!input.designEvents.some((event) => event.type === "design_decision")) {
    warnings.push("Captured without a design_decision event; add rationale in the editor.");
  }
  if (input.fileRefs.length === 0) {
    warnings.push("No changed design-system files were detected for this capture.");
  }
  if (input.trace?.error) {
    warnings.push(`Design trace warning: ${input.trace.error}`);
  }
  return warnings;
}

function isDesignEvent(event: StudioEvent): boolean {
  if (event.type === "artifact") return /\b(design|figma|token|style|component|spec|research|changelog|studio|ui)\b/i.test(event.message);
  return DESIGN_EVENT_TYPES.has(event.type);
}

function normalizeCaptureEvents(input: DesignChangelogCaptureRequest): StudioEvent[] {
  return [...(input.events ?? []), ...(input.event ? [input.event] : [])]
    .filter((event): event is StudioEvent => Boolean(event?.id && event?.type))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function normalizeFileRefs(value: unknown): DesignChangelogFileRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Map<string, DesignChangelogFileRef>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const path = normalizeText(record.path);
    if (!path) continue;
    seen.set(path, {
      path,
      status: normalizeText(record.status) || "modified",
      insertions: Number.isFinite(Number(record.insertions)) ? Number(record.insertions) : 0,
      deletions: Number.isFinite(Number(record.deletions)) ? Number(record.deletions) : 0,
      kind: normalizeFileKind(record.kind),
      designSystem: record.designSystem !== false,
    });
  }
  return [...seen.values()].sort((left, right) => Number(right.designSystem) - Number(left.designSystem) || left.path.localeCompare(right.path));
}

function mergeFileRefs(files: DesignChangelogFileRef[]): DesignChangelogFileRef[] {
  return normalizeFileRefs(files);
}

function normalizeFileKind(value: unknown): DesignChangelogFileRef["kind"] {
  if (value === "component" || value === "style" || value === "token" || value === "spec" || value === "figma" || value === "config" || value === "research") return value;
  return "other";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeText(item)).filter(Boolean))];
}

function normalizeTags(value: unknown): string[] {
  return normalizeStringArray(value).map((tag) => tag.toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEntryId(id: string): string {
  return slug(id || randomUUID());
}

function entryPath(projectRoot: string, id: string): string {
  const normalized = normalizeEntryId(id);
  return join(designChangelogDir(projectRoot), `${normalized}.json`);
}

function slug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
  return normalized || "entry";
}
