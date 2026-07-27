import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isPrivateOrLocalHostname } from "../security/network-address.js";
import { fetchPublicText } from "../security/safe-fetch.js";

export interface ScannedSourceFile {
  id: string;
  path: string;
  projectPath: string;
  absolutePath: string;
  content: string;
  extension: string;
  sizeBytes?: number;
  url?: string;
}

export interface SourceScanOptions {
  projectRoot: string;
  target?: string;
  extensions: Iterable<string>;
  ignoreDirs?: Iterable<string>;
  maxFiles?: number;
  maxBytesPerFile?: number;
  concurrency?: number;
  fetchTimeoutMs?: number;
  includeInlineStyles?: boolean;
  includeLinkedStyles?: boolean;
  maxLinkedStyles?: number;
  userAgent?: string;
  /** Excludes project-relative paths before they consume the max-files budget. */
  excludePath?: (projectPath: string) => boolean;
}

const DEFAULT_IGNORE_DIRS = [
  ".git",
  ".memoire",
  ".next",
  ".turbo",
  ".vite",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "out",
];

const DEFAULT_MAX_FILES = 500;
const DEFAULT_CONCURRENCY = 16;
const DEFAULT_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESPONSE_BYTES = 750_000;

export async function scanSources(options: SourceScanOptions): Promise<ScannedSourceFile[]> {
  const target = options.target ?? options.projectRoot;
  const maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES);
  if (isHttpUrl(target)) {
    assertSafePublicHttpUrl(target);
    return scanUrl(target, options, maxFiles);
  }

  const root = resolve(options.projectRoot);
  const resolvedTarget = resolve(isAbsolute(target) ? target : resolve(root, target));
  assertPathWithinRoot(root, resolvedTarget);
  const targetStat = await stat(resolvedTarget);
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(resolvedTarget)]);
  assertPathWithinRoot(realRoot, realTarget);
  const extensions = normalizeExtensions(options.extensions);

  if (targetStat.isFile()) {
    const source = await readLocalFile(root, resolvedTarget, resolvedTarget, options.maxBytesPerFile);
    return source ? [source] : [];
  }
  if (!targetStat.isDirectory()) {
    throw new Error(`Unsupported source target: ${target}`);
  }

  const ignoreDirs = new Set([...DEFAULT_IGNORE_DIRS, ...(options.ignoreDirs ?? [])]);
  const candidates = await collectCandidates(
    root,
    resolvedTarget,
    extensions,
    ignoreDirs,
    maxFiles,
    options.excludePath,
  );
  const sortedCandidates = candidates.sort((a, b) => normalizePath(a).localeCompare(normalizePath(b))).slice(0, maxFiles);
  const sources = await mapWithConcurrency(sortedCandidates, options.concurrency ?? DEFAULT_CONCURRENCY, (filePath) => {
    return readLocalFile(root, filePath, resolvedTarget, options.maxBytesPerFile).catch(() => null);
  });
  return sources.filter((source): source is ScannedSourceFile => source !== null);
}

async function collectCandidates(
  projectRoot: string,
  dir: string,
  extensions: Set<string>,
  ignoreDirs: Set<string>,
  maxFiles: number,
  excludePath?: (projectPath: string) => boolean,
): Promise<string[]> {
  const files: string[] = [];
  await walk(projectRoot, dir, files, extensions, ignoreDirs, maxFiles, excludePath);
  return files;
}

async function walk(
  projectRoot: string,
  dir: string,
  files: string[],
  extensions: Set<string>,
  ignoreDirs: Set<string>,
  maxFiles: number,
  excludePath?: (projectPath: string) => boolean,
): Promise<void> {
  if (files.length >= maxFiles) return;
  const entries = (await readdir(dir, { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (files.length >= maxFiles) return;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoreDirs.has(entry.name)) {
        const projectPath = normalizePath(relative(projectRoot, fullPath));
        if (!excludePath?.(projectPath)) {
          await walk(projectRoot, fullPath, files, extensions, ignoreDirs, maxFiles, excludePath);
        }
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    const projectPath = normalizePath(relative(projectRoot, fullPath));
    if (extensions.has(extension) && !excludePath?.(projectPath)) files.push(fullPath);
  }
}

async function readLocalFile(
  projectRoot: string,
  filePath: string,
  sourceRoot: string,
  maxBytesPerFile?: number,
): Promise<ScannedSourceFile | null> {
  const fileStat = await stat(filePath);
  if (maxBytesPerFile !== undefined && fileStat.size > maxBytesPerFile) {
    return null;
  }
  const content = await readFile(filePath, "utf-8");
  const path = normalizePath(relative(sourceRoot, filePath)) || normalizePath(relative(projectRoot, filePath)) || filePath;
  const projectPath = normalizePath(relative(projectRoot, filePath)) || path;
  return {
    id: path,
    path,
    projectPath,
    absolutePath: filePath,
    content,
    extension: extname(filePath).toLowerCase(),
    sizeBytes: fileStat.size,
  };
}

async function scanUrl(
  url: string,
  options: SourceScanOptions,
  maxFiles: number,
): Promise<ScannedSourceFile[]> {
  const timeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const extensions = normalizeExtensions(options.extensions);
  const html = await fetchText(url, timeoutMs, options.userAgent ?? "Memoire-SourceScanner/1.0");
  const sources: ScannedSourceFile[] = extensions.has(".html") ? [{
    id: url,
    path: url,
    projectPath: url,
    absolutePath: url,
    content: html,
    extension: ".html",
    url,
  }] : [];

  if (extensions.has(".css") && options.includeInlineStyles !== false) {
    let inlineIndex = 0;
    for (const block of extractInlineStyles(html)) {
      inlineIndex += 1;
      sources.push(urlSource(`${url}#inline-${inlineIndex}`, block, ".css"));
      if (sources.length >= maxFiles) return sources;
    }
  }

  if (extensions.has(".css") && options.includeLinkedStyles) {
    const sheetUrls = extractStylesheetUrls(html, url).slice(0, options.maxLinkedStyles ?? 12);
    const sheets = await mapWithConcurrency(sheetUrls, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, 6), async (sheetUrl, index) => {
      const content = await fetchText(sheetUrl, timeoutMs, options.userAgent ?? "Memoire-SourceScanner/1.0").catch(() => "");
      return content ? urlSource(`${sheetUrl}#sheet-${index + 1}`, content, ".css") : null;
    });
    for (const sheet of sheets) {
      if (!sheet) continue;
      sources.push(sheet);
      if (sources.length >= maxFiles) return sources;
    }
  }

  return sources.filter((source) => source.content.trim().length > 0).slice(0, maxFiles);
}

function urlSource(id: string, content: string, extension: string): ScannedSourceFile {
  return {
    id,
    path: id,
    projectPath: id,
    absolutePath: id,
    content,
    extension,
    sizeBytes: Buffer.byteLength(content),
    url: id,
  };
}

async function fetchText(url: string, timeoutMs: number, userAgent: string): Promise<string> {
  assertSafePublicHttpUrl(url);
  const response = await fetchPublicText(url, {
    maxBytes: DEFAULT_MAX_RESPONSE_BYTES,
    timeoutMs,
    headers: {
      "Accept": "text/html,text/css,*/*",
      "User-Agent": userAgent,
    },
  });
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  return response.text;
}

function extractInlineStyles(html: string): string[] {
  const blocks: string[] = [];
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch: RegExpExecArray | null;
  while ((styleMatch = styleRegex.exec(html)) !== null) {
    const content = styleMatch[1]?.trim();
    if (content) blocks.push(content);
  }
  return blocks;
}

function extractStylesheetUrls(html: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const relFirst = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  const hrefFirst = /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*>/gi;
  for (const regex of [relFirst, hrefFirst]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      const href = match[1];
      if (!href) continue;
      try {
        const resolved = new URL(href, baseUrl).href;
        assertSafePublicHttpUrl(resolved);
        urls.add(resolved);
      } catch {
        continue;
      }
    }
  }
  return Array.from(urls).sort((a, b) => a.localeCompare(b));
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(values.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]!, index);
    }
  }

  const workerCount = Math.min(limit, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function normalizeExtensions(extensions: Iterable<string>): Set<string> {
  return new Set(Array.from(extensions, (extension) => {
    const normalized = extension.trim().toLowerCase();
    return normalized.startsWith(".") ? normalized : `.${normalized}`;
  }));
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function assertPathWithinRoot(root: string, candidate: string): void {
  const relativePath = relative(resolve(root), resolve(candidate));
  if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))) {
    return;
  }
  throw new Error(`Source target is outside the project root: ${candidate}`);
}

function assertSafePublicHttpUrl(value: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Source URL must use a public http(s) address: ${value}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Source URL must use a public http(s) address without credentials: ${value}`);
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new Error(`Source URL must use a public http(s) address: ${value}`);
  }
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}
