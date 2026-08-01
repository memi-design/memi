import { access, readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  StudioDesignSystemArtifact,
  StudioDesignSystemResolvedAsset,
  StudioDesignSystemResolvedToken,
} from "./types.js";
import { withAgenticDesignSystemContract } from "./agentic-design-system.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".scss", ".md", ".mdx"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "target", ".next", ".expo", "coverage"]);

export async function resolveDesignSystemArtifactEvidence(
  projectRoot: string,
  artifact: StudioDesignSystemArtifact,
): Promise<StudioDesignSystemArtifact> {
  const workspace = resolve(artifact.sourceWorkspace || projectRoot);
  const diagnostics: string[] = [];
  const sourcePaths = unique([
    ...artifact.sourceRefs.map((ref) => ref.sourcePath).filter(isString),
    ...artifact.sections.flatMap((section) => section.sourceRefs.map((ref) => ref.sourcePath).filter(isString)),
  ]).map((path) => stripLineSuffix(path));
  const files = await collectWorkspaceFiles(workspace, diagnostics);
  const assets = resolveAssets(files, workspace);
  const tokenFiles = unique([...sourcePaths, ...files.filter((file) => isTokenCandidate(file))]);
  const tokens = await resolveTokens(tokenFiles, workspace, diagnostics);
  diagnostics.push(`Resolved ${assets.length} assets and ${tokens.length} design tokens from ${workspace}`);
  return withAgenticDesignSystemContract({
    ...artifact,
    assets,
    tokens,
    resolvedAt: new Date().toISOString(),
    resolverDiagnostics: diagnostics,
  });
}

export async function readResolvedAsset(projectRoot: string, sourcePath: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const path = resolve(sourcePath);
  const allowedRoots = [resolve(projectRoot)];
  const parent = resolve(projectRoot, "..", "..", "..");
  allowedRoots.push(parent);
  if (!allowedRoots.some((root) => isPathWithin(path, root))) return null;
  try {
    await access(path);
    return { bytes: await readFile(path), mimeType: mimeTypeForPath(path) };
  } catch {
    return null;
  }
}

async function collectWorkspaceFiles(workspace: string, diagnostics: string[]): Promise<string[]> {
  const files: string[] = [];
  try {
    await walk(workspace, files, 0);
  } catch (error) {
    diagnostics.push(`Workspace scan skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
  return files;
}

async function walk(dir: string, files: string[], depth: number): Promise<void> {
  if (depth > 8 || files.length > 1600) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name), files, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const path = join(dir, entry.name);
    const extension = extname(path).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension) || CODE_EXTENSIONS.has(extension)) files.push(path);
  }
}

function resolveAssets(files: string[], workspace: string): StudioDesignSystemResolvedAsset[] {
  return files
    .filter((file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()))
    .map((file) => ({ file, score: scoreAsset(file, workspace) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, 12)
    .map(({ file }, index) => ({
      id: `asset:${index}:${basename(file)}`,
      kind: /logo|brand|mark|buzzr/i.test(file) ? "brand" : /icon/i.test(file) ? "icon" : "image",
      label: basename(file),
      sourcePath: file,
      previewUrl: `/api/design-system/assets?path=${encodeURIComponent(file)}`,
      mimeType: mimeTypeForPath(file),
      sectionId: "section:brand",
    }));
}

async function resolveTokens(paths: string[], workspace: string, diagnostics: string[]): Promise<StudioDesignSystemResolvedToken[]> {
  const tokens: StudioDesignSystemResolvedToken[] = [];
  for (const path of paths.slice(0, 60)) {
    if (!isPathWithin(resolve(path), workspace)) continue;
    try {
      const fileStat = await stat(path);
      if (!fileStat.isFile() || fileStat.size > 240_000) continue;
      const lines = (await readFile(path, "utf-8")).split(/\r?\n/);
      lines.forEach((line, index) => {
        tokens.push(...extractTokensFromLine(path, line, index + 1));
      });
    } catch (error) {
      diagnostics.push(`Token file skipped ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return dedupeTokens(tokens).slice(0, 96);
}

function extractTokensFromLine(sourcePath: string, line: string, lineNumber: number): StudioDesignSystemResolvedToken[] {
  const tokens: StudioDesignSystemResolvedToken[] = [];
  for (const match of line.matchAll(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/g)) {
    tokens.push(token("color", tokenName(line, match.index ?? 0), match[0], sourcePath, lineNumber));
  }
  if (/\b(fontFamily|fontWeight|fontSize|Montserrat|Silkscreen|Geist|Inter)\b/i.test(line)) {
    tokens.push(token("typography", tokenName(line, 0), cleanLine(line), sourcePath, lineNumber));
  }
  if (/\b(spacing|space|gap|padding|margin)\b/i.test(line)) tokens.push(token("spacing", tokenName(line, 0), cleanLine(line), sourcePath, lineNumber));
  if (/\b(radius|radii|rounded)\b/i.test(line)) tokens.push(token("radius", tokenName(line, 0), cleanLine(line), sourcePath, lineNumber));
  if (/\b(shadow|glow|elevation)\b/i.test(line)) tokens.push(token("shadow", tokenName(line, 0), cleanLine(line), sourcePath, lineNumber));
  return tokens;
}

function token(kind: StudioDesignSystemResolvedToken["kind"], name: string, value: string, sourcePath: string, line: number): StudioDesignSystemResolvedToken {
  return { id: `token:${kind}:${basename(sourcePath)}:${line}:${name}`, kind, name, value, sourcePath, line, sectionId: sectionForToken(kind) };
}

function sectionForToken(kind: StudioDesignSystemResolvedToken["kind"]): string {
  if (kind === "color") return "section:colors";
  if (kind === "typography") return "section:type";
  if (kind === "spacing" || kind === "radius" || kind === "shadow") return "section:spacing";
  return "section:components";
}

function scoreAsset(file: string, workspace: string): number {
  const relative = file.slice(workspace.length + 1).toLowerCase();
  let score = 0;
  if (/assets|branding|brand|images/.test(relative)) score += 2;
  if (/buzzr|logo|lockup|mark|brand|icon/.test(relative)) score += 4;
  if (/notification|transparent|light|dark/.test(relative)) score += 1;
  if (/appicon|node_modules|target/.test(relative)) score -= 3;
  return score;
}

function isTokenCandidate(path: string): boolean {
  return CODE_EXTENSIONS.has(extname(path).toLowerCase()) && /\b(theme|token|palette|color|typography|spacing|surface|layout|style|component|ui)\b/i.test(path);
}

function tokenName(line: string, index: number): string {
  const before = line.slice(0, index);
  const match = before.match(/([A-Za-z0-9_$-]+)\s*[:=]\s*$/) ?? line.match(/([A-Za-z0-9_$-]+)\s*[:=]/);
  return match?.[1] ?? "token";
}

function cleanLine(line: string): string {
  return line.trim().replace(/\s+/g, " ").slice(0, 180);
}

function dedupeTokens(tokens: StudioDesignSystemResolvedToken[]): StudioDesignSystemResolvedToken[] {
  const seen = new Set<string>();
  return tokens.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.name}:${candidate.value}:${candidate.sourcePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripLineSuffix(path: string): string {
  return path.replace(/:(\d+)$/, "");
}

function mimeTypeForPath(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function isPathWithin(path: string, root: string): boolean {
  const relation = relative(resolve(root), resolve(path));
  return relation === "" || (
    !isAbsolute(relation)
    && relation !== ".."
    && !relation.startsWith(`..${sep}`)
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
