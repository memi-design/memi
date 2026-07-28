import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import { NoteManifestSchema, type NoteManifest } from "./types.js";

export const DEFAULT_COMMUNITY_NOTES_REPO = "https://github.com/memi-design/design-skills";

export interface CommunityNoteIssue {
  level: "error" | "warning";
  message: string;
  path?: string;
}

export interface CommunityNoteValidation {
  ok: boolean;
  noteName: string | null;
  notePath: string;
  issues: CommunityNoteIssue[];
  warnings: CommunityNoteIssue[];
}

export interface NoteForkSummary {
  name: string;
  path: string;
  reviewStatus: "draft" | "submitted" | "approved" | "rejected";
  forkOf: NonNullable<NoteManifest["forkOf"]>;
  updatedAt: string;
}

export interface NoteForkFile {
  path: string;
  content: string;
  size: number;
  updatedAt: string;
}

export interface NoteForkDiffFile {
  path: string;
  status: "added" | "modified" | "removed" | "unchanged";
  original: string | null;
  modified: string | null;
}

export interface NoteForkDiff {
  forkName: string;
  files: NoteForkDiffFile[];
}

export interface NoteForkPrHandoff {
  forkName: string;
  sourceRepo: string;
  targetPath: string;
  branchName: string;
  commitMessage: string;
  files: string[];
  commands: string[];
}

interface ForkMetadata {
  schemaVersion: 1;
  upstreamLocalPath: string;
  sourceRepo: string;
  sourcePath: string;
  createdAt: string;
}

export async function validateCommunityNoteDir(
  noteDir: string,
  options: { strictCommunity?: boolean } = {},
): Promise<CommunityNoteValidation> {
  const issues: CommunityNoteIssue[] = [];
  const warnings: CommunityNoteIssue[] = [];
  let manifest: NoteManifest | null = null;
  try {
    const raw = await readFile(join(noteDir, "note.json"), "utf-8");
    manifest = NoteManifestSchema.parse(JSON.parse(raw));
  } catch (error) {
    issues.push({ level: "error", path: "note.json", message: error instanceof Error ? error.message : String(error) });
  }

  if (manifest) {
    if (options.strictCommunity) {
      if ((manifest.sourceUrls ?? []).length === 0) {
        issues.push({ level: "error", path: "note.json", message: "sourceUrls metadata is required for community review" });
      }
      if (!manifest.lastResearchedAt) {
        issues.push({ level: "error", path: "note.json", message: "lastResearchedAt metadata is required for community review" });
      }
      if (!manifest.freshnessDays) {
        issues.push({ level: "error", path: "note.json", message: "freshnessDays metadata is required for community review" });
      }
    } else {
      if ((manifest.sourceUrls ?? []).length === 0) warnings.push({ level: "warning", path: "note.json", message: "sourceUrls metadata is missing" });
      if (!manifest.lastResearchedAt) warnings.push({ level: "warning", path: "note.json", message: "lastResearchedAt metadata is missing" });
    }

    for (const skill of manifest.skills) {
      if (!isSafeRelativePath(skill.file)) {
        issues.push({ level: "error", path: skill.file, message: `Skill file contains path traversal or an unsafe path: ${skill.file}` });
        continue;
      }
      if (!skill.file.endsWith(".md")) {
        issues.push({ level: "error", path: skill.file, message: `Skill file must be markdown: ${skill.file}` });
        continue;
      }
      try {
        const info = await stat(join(noteDir, skill.file));
        if (!info.isFile()) issues.push({ level: "error", path: skill.file, message: `Skill path is not a file: ${skill.file}` });
      } catch {
        issues.push({ level: "error", path: skill.file, message: `Skill file is missing: ${skill.file}` });
      }
    }
  }

  for (const file of await listRelativeFiles(noteDir).catch(() => [])) {
    if (!isSafeRelativePath(file)) {
      issues.push({ level: "error", path: file, message: `Note file contains path traversal or an unsafe path: ${file}` });
    }
    if (basename(file) === "package.json") {
      warnings.push({ level: "warning", path: file, message: "package.json scripts are ignored during Note install and must be reviewed manually" });
    }
  }

  return {
    ok: issues.length === 0,
    noteName: manifest?.name ?? null,
    notePath: noteDir,
    issues,
    warnings,
  };
}

export async function forkNoteDirectory(
  projectRoot: string,
  input: {
    sourcePath: string;
    sourceRepo?: string | null;
    sourcePathInRepo?: string | null;
  },
): Promise<NoteForkSummary> {
  const sourceRaw = await readFile(join(input.sourcePath, "note.json"), "utf-8");
  const sourceManifest = NoteManifestSchema.parse(JSON.parse(sourceRaw));
  const forkName = `${sourceManifest.name}-fork`;
  const forkPath = join(projectRoot, ".memoire", "notes", forkName);
  await rm(forkPath, { recursive: true, force: true });
  await mkdir(join(projectRoot, ".memoire", "notes"), { recursive: true });
  await cp(input.sourcePath, forkPath, { recursive: true });

  const now = new Date().toISOString();
  const forkManifest: NoteManifest = {
    ...sourceManifest,
    name: forkName,
    sourceUrls: (sourceManifest.sourceUrls ?? []).length > 0
      ? sourceManifest.sourceUrls
      : [input.sourceRepo ?? DEFAULT_COMMUNITY_NOTES_REPO],
    lastResearchedAt: sourceManifest.lastResearchedAt ?? now,
    freshnessDays: sourceManifest.freshnessDays ?? 90,
    reviewStatus: "draft",
    forkOf: {
      name: sourceManifest.name,
      version: sourceManifest.version,
      sourceRepo: input.sourceRepo ?? undefined,
      sourcePath: input.sourcePathInRepo ?? `notes/${sourceManifest.name}`,
    },
    updatedAt: now,
  };
  await writeFile(join(forkPath, "note.json"), `${JSON.stringify(forkManifest, null, 2)}\n`, "utf-8");
  await writeForkMetadata(forkPath, {
    schemaVersion: 1,
    upstreamLocalPath: input.sourcePath,
    sourceRepo: input.sourceRepo ?? DEFAULT_COMMUNITY_NOTES_REPO,
    sourcePath: input.sourcePathInRepo ?? `notes/${sourceManifest.name}`,
    createdAt: now,
  });

  return serializeFork(forkManifest, forkPath);
}

export async function listNoteForks(projectRoot: string): Promise<NoteForkSummary[]> {
  const notesRoot = join(projectRoot, ".memoire", "notes");
  const entries = await readdir(notesRoot, { withFileTypes: true }).catch(() => []);
  const forks: NoteForkSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const noteDir = join(notesRoot, entry.name);
    try {
      const manifest = NoteManifestSchema.parse(JSON.parse(await readFile(join(noteDir, "note.json"), "utf-8")));
      if (manifest.forkOf) forks.push(serializeFork(manifest, noteDir));
    } catch {
      continue;
    }
  }
  return forks.sort((left, right) => left.name.localeCompare(right.name));
}

export async function getNoteForkFiles(projectRoot: string, name: string): Promise<NoteForkFile[]> {
  const forkPath = await requireForkPath(projectRoot, name);
  const files = await listRelativeFiles(forkPath);
  const editable = files.filter((file) => file === "note.json" || file.endsWith(".md"));
  const result: NoteForkFile[] = [];
  for (const file of editable) {
    const fullPath = join(forkPath, file);
    const info = await stat(fullPath);
    result.push({
      path: file,
      content: await readFile(fullPath, "utf-8"),
      size: info.size,
      updatedAt: info.mtime.toISOString(),
    });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

export async function updateNoteForkFile(
  projectRoot: string,
  name: string,
  input: { path: string; content: string },
): Promise<NoteForkFile> {
  const forkPath = await requireForkPath(projectRoot, name);
  if (!isSafeRelativePath(input.path)) throw Object.assign(new Error(`Unsafe fork file path: ${input.path}`), { statusCode: 400 });
  if (input.path !== "note.json" && !input.path.endsWith(".md")) {
    throw Object.assign(new Error("Only note.json and markdown files are editable in Studio"), { statusCode: 400 });
  }
  if (input.path === "note.json") NoteManifestSchema.parse(JSON.parse(input.content));
  const fullPath = join(forkPath, input.path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, input.content, "utf-8");
  const info = await stat(fullPath);
  return {
    path: input.path,
    content: input.content,
    size: info.size,
    updatedAt: info.mtime.toISOString(),
  };
}

export async function diffNoteFork(projectRoot: string, name: string): Promise<NoteForkDiff> {
  const forkPath = await requireForkPath(projectRoot, name);
  const metadata = await readForkMetadata(forkPath);
  const forkFiles = new Set(await listRelativeFiles(forkPath));
  forkFiles.delete(".memoire-fork.json");
  const upstreamFiles = new Set(await listRelativeFiles(metadata.upstreamLocalPath).catch(() => []));
  const paths = Array.from(new Set([...forkFiles, ...upstreamFiles]))
    .filter((file) => file === "note.json" || file.endsWith(".md"))
    .sort();
  const files: NoteForkDiffFile[] = [];
  for (const file of paths) {
    const original = upstreamFiles.has(file) ? await readFile(join(metadata.upstreamLocalPath, file), "utf-8").catch(() => null) : null;
    const modified = forkFiles.has(file) ? await readFile(join(forkPath, file), "utf-8").catch(() => null) : null;
    const status: NoteForkDiffFile["status"] = original === null ? "added"
      : modified === null ? "removed"
      : original === modified ? "unchanged"
      : "modified";
    if (status !== "unchanged") files.push({ path: file, status, original, modified });
  }
  return { forkName: name, files };
}

export async function buildNoteForkPrHandoff(projectRoot: string, name: string): Promise<NoteForkPrHandoff> {
  const forkPath = await requireForkPath(projectRoot, name);
  const manifest = NoteManifestSchema.parse(JSON.parse(await readFile(join(forkPath, "note.json"), "utf-8")));
  const sourceRepo = DEFAULT_COMMUNITY_NOTES_REPO;
  const targetPath = `skills/${manifest.name}`;
  const branchName = `notes/${manifest.name}-${new Date().toISOString().slice(0, 10)}`;
  const commitMessage = `Update ${manifest.name} Note`;
  const files = (await getNoteForkFiles(projectRoot, name)).map((file) => file.path);
  return {
    forkName: manifest.name,
    sourceRepo,
    targetPath,
    branchName,
    commitMessage,
    files,
    commands: [
      `git clone ${sourceRepo}.git`,
      "cd design-skills",
      `git checkout -b ${branchName}`,
      `mkdir -p ${targetPath}`,
      `cp -R "${forkPath}/." "${targetPath}/"`,
      `git add ${targetPath}`,
      `git commit -m "${commitMessage}"`,
      `git push -u origin ${branchName}`,
      "Open a pull request for review.",
    ],
  };
}

async function requireForkPath(projectRoot: string, name: string): Promise<string> {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw Object.assign(new Error(`Invalid fork name: ${name}`), { statusCode: 400 });
  const forkPath = join(projectRoot, ".memoire", "notes", name);
  const manifest = NoteManifestSchema.parse(JSON.parse(await readFile(join(forkPath, "note.json"), "utf-8")));
  if (!manifest.forkOf) throw Object.assign(new Error(`Note is not a fork: ${name}`), { statusCode: 400 });
  return forkPath;
}

function serializeFork(manifest: NoteManifest, path: string): NoteForkSummary {
  if (!manifest.forkOf) throw new Error(`Note ${manifest.name} is missing forkOf metadata`);
  return {
    name: manifest.name,
    path,
    reviewStatus: manifest.reviewStatus ?? "draft",
    forkOf: manifest.forkOf,
    updatedAt: manifest.updatedAt,
  };
}

async function listRelativeFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  await walk(root, "");
  return result;

  async function walk(currentRoot: string, prefix: string): Promise<void> {
    const entries = await readdir(currentRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!isSafeRelativePath(rel)) {
        result.push(rel);
        continue;
      }
      const fullPath = join(currentRoot, entry.name);
      if (entry.isDirectory()) await walk(fullPath, rel);
      else if (entry.isFile()) result.push(rel);
      else throw new Error(`Note contains unsupported link or special file: ${rel}`);
    }
  }
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\")) return false;
  const normalized = posix.normalize(path);
  return normalized !== ".." && !normalized.startsWith("../") && !normalized.includes("/../");
}

async function writeForkMetadata(forkPath: string, metadata: ForkMetadata): Promise<void> {
  await writeFile(join(forkPath, ".memoire-fork.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
}

async function readForkMetadata(forkPath: string): Promise<ForkMetadata> {
  try {
    return JSON.parse(await readFile(join(forkPath, ".memoire-fork.json"), "utf-8")) as ForkMetadata;
  } catch {
    const manifest = NoteManifestSchema.parse(JSON.parse(await readFile(join(forkPath, "note.json"), "utf-8")));
    return {
      schemaVersion: 1,
      upstreamLocalPath: manifest.forkOf?.sourcePath ?? forkPath,
      sourceRepo: manifest.forkOf?.sourceRepo ?? DEFAULT_COMMUNITY_NOTES_REPO,
      sourcePath: manifest.forkOf?.sourcePath ?? `notes/${manifest.forkOf?.name ?? manifest.name}`,
      createdAt: manifest.createdAt,
    };
  }
}

export function forkSourceFilter(source: string, builtIn: boolean, installed: boolean): "official" | "community" | "installed" | "forks" | "updates" {
  if (source === "local-fork") return "forks";
  if (source === "community-catalog") return "community";
  if (installed) return "installed";
  if (builtIn) return "official";
  return "updates";
}
