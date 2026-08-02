import { opendir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  RepositoryFingerprintSchema,
  type RepositoryFingerprint,
} from "./skill-router.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".memoire",
  ".swiftpm",
  "build",
  "coverage",
  "DerivedData",
  "dist",
  "node_modules",
  "Pods",
  "vendor",
]);
const MAX_FILES = 100_000;
const MAX_SOURCE_BYTES = 256_000;
const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cpp",
  ".css",
  ".dart",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".m",
  ".md",
  ".mm",
  ".py",
  ".rs",
  ".scss",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

export async function buildRepositoryFingerprint(
  root: string,
): Promise<Readonly<RepositoryFingerprint>> {
  const absoluteRoot = path.resolve(root);
  const files = await listRepositoryFiles(absoluteRoot);
  const packageManifest = await readJsonObject(path.join(absoluteRoot, "package.json"));
  const dependencies = sortedUnique([
    ...objectKeys(packageManifest?.dependencies),
    ...objectKeys(packageManifest?.devDependencies),
    ...objectKeys(packageManifest?.peerDependencies),
  ]);
  const scripts = sortedUnique(objectKeys(packageManifest?.scripts));
  const imports = new Set<string>();
  const languages = new Set<string>();

  for (const relativePath of files) {
    const extension = path.extname(relativePath).toLowerCase();
    const language = languageForExtension(extension);
    if (language) languages.add(language);
    if (!SOURCE_EXTENSIONS.has(extension)) continue;
    const absolutePath = path.join(absoluteRoot, relativePath);
    const fileStat = await stat(absolutePath).catch(() => null);
    if (!fileStat?.isFile() || fileStat.size > MAX_SOURCE_BYTES) continue;
    const content = await readFile(absolutePath, "utf8").catch(() => "");
    for (const specifier of extractImports(content, extension)) imports.add(specifier);
  }

  const frameworks = detectFrameworks(dependencies, files, imports);
  return Object.freeze(RepositoryFingerprintSchema.parse({
    schemaVersion: 1,
    languages: sortedUnique(languages),
    frameworks,
    dependencies,
    files,
    imports: sortedUnique(imports),
    scripts,
  }));
}

async function listRepositoryFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    if (files.length >= MAX_FILES) return;
    const handle = await opendir(directory);
    for await (const entry of handle) {
      if (files.length >= MAX_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(path.relative(root, absolutePath).split(path.sep).join("/"));
    }
  }
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function extractImports(content: string, extension: string): readonly string[] {
  const imports = new Set<string>();
  if (extension === ".swift") {
    for (const match of content.matchAll(/^\s*import\s+([A-Za-z][A-Za-z0-9_.]*)/gm)) {
      if (match[1]) imports.add(match[1]);
    }
    return [...imports];
  }
  const code = maskJavaScriptNonCode(content);
  for (const token of code.matchAll(/\b(?:import|require)\b/gu)) {
    if (token.index === undefined) continue;
    const source = content.slice(token.index);
    const match = /^(?:import\s*(?:\(\s*)?|require\s*\()\s*["']([^"']+)["']/u.exec(source)
      ?? /^import\s+(?:type\s+)?(?:[^;]*?\s+from\s+)?["']([^"']+)["']/u.exec(source);
    if (match?.[1]) imports.add(match[1]);
  }
  return [...imports];
}

function maskJavaScriptNonCode(content: string): string {
  return content.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/gu,
    (match) => match.replace(/[^\r\n]/gu, " "),
  );
}

function detectFrameworks(
  dependencies: readonly string[],
  files: readonly string[],
  imports: ReadonlySet<string>,
): string[] {
  const dependencySet = new Set(dependencies);
  const signals = [
    ["expo", dependencySet.has("expo")],
    ["expo-router", dependencySet.has("expo-router") || imports.has("expo-router")],
    ["react-native", dependencySet.has("react-native")],
    ["nextjs", dependencySet.has("next")],
    ["react", dependencySet.has("react")],
    ["vite", dependencySet.has("vite")],
    ["swiftui", imports.has("SwiftUI")],
    ["swift-package", files.includes("Package.swift")],
    ["xcode", files.some((file) => file.endsWith(".xcodeproj/project.pbxproj"))],
    ["maplibre", dependencies.some((dependency) => dependency.includes("maplibre"))],
    ["mapbox", dependencies.some((dependency) => dependency.includes("mapbox"))],
  ] as const;
  return signals.filter(([, present]) => present).map(([name]) => name).sort();
}

function languageForExtension(extension: string): string | null {
  const languageByExtension: Readonly<Record<string, string>> = {
    ".css": "css",
    ".dart": "dart",
    ".go": "go",
    ".html": "html",
    ".java": "java",
    ".js": "javascript",
    ".jsx": "javascript",
    ".kt": "kotlin",
    ".py": "python",
    ".rs": "rust",
    ".swift": "swift",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".vue": "vue",
  };
  return languageByExtension[extension] ?? null;
}

async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function objectKeys(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value)
    : [];
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
