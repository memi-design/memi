import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile, cp, lstat, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, posix, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { extract as extractTar, Parser, type ReadEntry } from "tar";
import { z } from "zod";
import { NoteCategorySchema, NoteManifestSchema, type NoteManifest } from "./types.js";

export const DEFAULT_NOTES_CATALOG_URL = "https://www.memoire.cv/notes/catalog.v1.json";
export const DEFAULT_COMMUNITY_NOTES_CATALOG_URL = "https://www.memoire.cv/notes/community/catalog.v1.json";

const HttpsUrlSchema = z.string().url().refine((value) => new URL(value).protocol === "https:", "URL must use HTTPS");
const DownloadUrlSchema = z.string().url().refine((value) => ["https:", "file:"].includes(new URL(value).protocol), "Download URL must use HTTPS or file");
const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_ARCHIVE_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;

export const NoteCatalogArchiveSchema = z.object({
  url: DownloadUrlSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  size: z.number().int().nonnegative().max(MAX_ARCHIVE_BYTES),
});

export const NoteCatalogEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  category: NoteCategorySchema,
  tags: z.array(z.string()).default([]),
  sourceUrls: z.array(HttpsUrlSchema).default([]),
  lastResearchedAt: z.string().datetime().optional(),
  freshnessDays: z.number().int().positive().optional(),
  sourceKind: z.enum(["official", "community"]).optional(),
  sourceRepo: HttpsUrlSchema.optional(),
  sourcePath: z.string().optional(),
  reviewStatus: z.enum(["draft", "submitted", "approved", "rejected"]).optional(),
  contributionUrl: HttpsUrlSchema.optional(),
  archive: NoteCatalogArchiveSchema,
  manifest: NoteManifestSchema.optional(),
});
export type NoteCatalogEntry = z.infer<typeof NoteCatalogEntrySchema>;

export const NoteCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  baseUrl: DownloadUrlSchema,
  notes: z.array(NoteCatalogEntrySchema),
});
export type NoteCatalog = z.infer<typeof NoteCatalogSchema>;

export interface LoadNotesCatalogOptions {
  catalogUrl?: string | null;
  timeoutMs?: number;
}

export interface InstallCatalogNoteOptions extends LoadNotesCatalogOptions {
  onProgress?: (event: { type: "progress" | "completed"; message: string; bytes?: number }) => void;
}

export async function loadNotesCatalog(options: LoadNotesCatalogOptions = {}): Promise<NoteCatalog> {
  const catalogUrl = options.catalogUrl || process.env.MEMOIRE_NOTES_CATALOG_URL || DEFAULT_NOTES_CATALOG_URL;
  const bytes = await readBytesFromUrl(catalogUrl, options.timeoutMs ?? 2_500, { maxBytes: MAX_CATALOG_BYTES });
  return NoteCatalogSchema.parse(JSON.parse(bytes.toString("utf-8")));
}

export function findCatalogNote(catalog: NoteCatalog, name: string, version?: string | null): NoteCatalogEntry | null {
  const candidates = catalog.notes.filter((entry) => entry.name === name || entry.id === name);
  if (version) return candidates.find((entry) => entry.version === version) ?? null;
  return candidates.sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }))[0] ?? null;
}

export function isSafeNoteName(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value) && !value.includes("..") && !value.includes("/") && !value.includes("\\");
}

export function assertSafeArchiveEntries(entries: string[]): void {
  if (entries.length === 0) throw new Error("Note archive is empty");
  for (const entry of entries) {
    const normalized = entry.trim();
    if (!normalized) throw new Error("Note archive contains an empty entry");
    if (normalized.startsWith("/") || /^[A-Za-z]:[\\/]/.test(normalized)) {
      throw new Error(`Note archive contains absolute path: ${entry}`);
    }
    if (normalized.includes("\\")) {
      throw new Error(`Note archive contains unsupported path separator: ${entry}`);
    }
    const safe = posix.normalize(normalized);
    if (safe === ".." || safe.startsWith("../") || safe.includes("/../")) {
      throw new Error(`Note archive contains path traversal entry: ${entry}`);
    }
  }
}

export async function installCatalogNote(
  projectRoot: string,
  entry: NoteCatalogEntry,
  options: InstallCatalogNoteOptions = {},
): Promise<NoteManifest> {
  if (!isSafeNoteName(entry.name)) throw new Error(`Invalid note name in catalog: ${entry.name}`);
  const downloadsDir = join(projectRoot, ".memoire", "downloads", "notes");
  const notesRoot = join(projectRoot, ".memoire", "notes");
  await mkdir(downloadsDir, { recursive: true });
  await mkdir(notesRoot, { recursive: true });

  options.onProgress?.({ type: "progress", message: `Downloading ${entry.name}` });
  const archiveBytes = await readBytesFromUrl(entry.archive.url, options.timeoutMs ?? 30_000, {
    maxBytes: MAX_ARCHIVE_BYTES,
    expectedBytes: entry.archive.size,
  });
  const sha256 = createHash("sha256").update(archiveBytes).digest("hex");
  if (sha256 !== entry.archive.sha256.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${entry.name}: expected ${entry.archive.sha256}, got ${sha256}`);
  }

  const archivePath = join(downloadsDir, `${entry.name}-${entry.version}.tgz`);
  await writeFile(archivePath, archiveBytes);
  await validateArchiveContents(archivePath);

  options.onProgress?.({ type: "progress", message: `Extracting ${entry.name}`, bytes: archiveBytes.byteLength });
  const extractDir = await mkdtemp(join(tmpdir(), `memoire-note-${entry.name}-`));
  const stagingDir = join(notesRoot, `.install-${entry.name}-${Date.now()}-${randomUUID().slice(0, 8)}`);
  try {
    await extractTar({
      cwd: extractDir,
      file: archivePath,
      strict: true,
      preserveOwner: false,
      noMtime: true,
    });
    await assertSafeExtractedTree(extractDir);
    const sourceDir = await findExtractedNoteDir(extractDir, entry.name);
    const raw = await readFile(join(sourceDir, "note.json"), "utf-8");
    const manifest = NoteManifestSchema.parse(JSON.parse(raw));
    if (manifest.name !== entry.name) {
      throw new Error(`Downloaded note manifest name "${manifest.name}" does not match catalog entry "${entry.name}"`);
    }

    await rm(stagingDir, { recursive: true, force: true });
    await cp(sourceDir, stagingDir, { recursive: true });
    await rm(join(notesRoot, manifest.name), { recursive: true, force: true });
    await rename(stagingDir, join(notesRoot, manifest.name));
    options.onProgress?.({ type: "completed", message: `Installed ${manifest.name}@${manifest.version}` });
    return manifest;
  } finally {
    await rm(extractDir, { recursive: true, force: true }).catch(() => {});
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function assertSafeExtractedTree(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    const fileStat = await lstat(fullPath);
    if (fileStat.isSymbolicLink()) {
      throw new Error(`Note archive contains a symbolic link: ${entry.name}`);
    }
    if (fileStat.isDirectory()) {
      await assertSafeExtractedTree(fullPath);
      continue;
    }
    if (!fileStat.isFile()) {
      throw new Error(`Note archive contains a non-regular file: ${entry.name}`);
    }
    if (fileStat.nlink > 1) {
      throw new Error(`Note archive contains a hard-linked file: ${entry.name}`);
    }
    if ((fileStat.mode & 0o111) !== 0) {
      throw new Error(`Note archive contains an executable file: ${entry.name}`);
    }
  }
}

async function findExtractedNoteDir(root: string, expectedName: string): Promise<string> {
  const direct = join(root, expectedName);
  if (await isDirectory(direct)) return direct;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(root, entry.name);
    if (await isFile(join(candidate, "note.json"))) return candidate;
  }
  if (await isFile(join(root, "note.json"))) return root;
  throw new Error(`Downloaded note ${expectedName} does not contain note.json`);
}

interface ReadBytesLimits {
  maxBytes: number;
  expectedBytes?: number;
}

async function readBytesFromUrl(url: string, timeoutMs: number, limits: ReadBytesLimits): Promise<Buffer> {
  if (url.startsWith("file:")) {
    const path = fileURLToPath(url);
    const fileSize = (await stat(path)).size;
    assertDownloadSize(fileSize, limits);
    return readFile(path);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) assertDownloadSize(Number(declaredLength), limits);
    if (!response.body) throw new Error("Download response did not include a body");
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const bytes = Buffer.from(value);
        total += bytes.byteLength;
        if (total > limits.maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error(`Download exceeds size limit of ${limits.maxBytes} bytes`);
        }
        chunks.push(bytes);
      }
    } finally {
      reader.releaseLock();
    }
    assertDownloadSize(total, limits);
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timeout);
  }
}

function assertDownloadSize(actualBytes: number, limits: ReadBytesLimits): void {
  if (!Number.isSafeInteger(actualBytes) || actualBytes < 0) throw new Error("Download reported an invalid size");
  if (actualBytes > limits.maxBytes) throw new Error(`Download exceeds size limit of ${limits.maxBytes} bytes`);
  if (limits.expectedBytes !== undefined && actualBytes !== limits.expectedBytes) {
    throw new Error(`Download size mismatch: expected ${limits.expectedBytes} bytes, got ${actualBytes}`);
  }
}

async function validateArchiveContents(archivePath: string): Promise<void> {
  const entries: string[] = [];
  let totalBytes = 0;
  const parser = new Parser({
    strict: true,
    maxDecompressionRatio: 100,
    onReadEntry: (entry: ReadEntry) => {
      entries.push(entry.path);
      let violation: string | null = null;
      if (entries.length > MAX_ARCHIVE_ENTRIES) {
        violation = `Note archive exceeds entry limit of ${MAX_ARCHIVE_ENTRIES}`;
      }
      if (entry.type === "SymbolicLink") violation = `Note archive contains a symbolic link: ${entry.path}`;
      if (entry.type === "Link") violation = `Note archive contains a hard link: ${entry.path}`;
      if (!violation && entry.type !== "File" && entry.type !== "Directory") {
        violation = `Note archive contains unsupported entry type ${entry.type}: ${entry.path}`;
      }
      const size = entry.type === "File" ? entry.size : 0;
      if (size > MAX_ARCHIVE_FILE_BYTES) {
        violation = `Note archive file exceeds size limit of ${MAX_ARCHIVE_FILE_BYTES} bytes: ${entry.path}`;
      }
      totalBytes += size;
      if (totalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
        violation = `Note archive exceeds uncompressed size limit of ${MAX_ARCHIVE_UNCOMPRESSED_BYTES} bytes`;
      }
      if (entry.type === "File" && ((entry.mode ?? 0) & 0o111) !== 0) {
        violation = `Note archive contains an executable file: ${entry.path}`;
      }
      if (violation) parser.abort(new Error(violation));
      entry.resume();
    },
  });
  await pipeline(createReadStream(archivePath), parser);
  assertSafeArchiveEntries(entries);
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isDirectory()).catch(() => false);
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isFile()).catch(() => false);
}

export function catalogEntryToManifest(entry: NoteCatalogEntry): NoteManifest {
  return entry.manifest ?? {
    name: entry.name,
    version: entry.version,
    description: entry.description,
    category: entry.category,
    tags: entry.tags,
    sourceUrls: entry.sourceUrls,
    lastResearchedAt: entry.lastResearchedAt,
    freshnessDays: entry.freshnessDays,
    skills: [{
      file: `${entry.name}.md`,
      name: entry.title,
      activateOn: entry.category === "generate" ? "component-creation" : "always",
      freedomLevel: "reference",
    }],
    dependencies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function noteArchiveName(entry: NoteCatalogEntry): string {
  return `${entry.name}-${entry.version}.tgz`;
}

export function localArchiveUrl(path: string): string {
  return `file://${resolve(path)}`;
}

export function noteTitleFromName(name: string): string {
  return basename(name).split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
