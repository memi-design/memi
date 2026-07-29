import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { scanSources, type ScannedSourceFile } from "../utils/source-scanner.js";

export type AppGraphFileKind = "route" | "component" | "style" | "config" | "markup" | "test" | "other";

export interface AppGraphFile {
  path: string;
  kind: AppGraphFileKind;
  imports: string[];
  importedBy: string[];
  shadcnImports: string[];
  hexColors: string[];
  cssVariables: string[];
  tailwindClasses: string[];
  componentRefs: string[];
}

export interface AppGraphRoute {
  path: string;
  routeId: string;
  components: string[];
}

export interface AppGraphComponent {
  name: string;
  path: string;
  atomicGuess: "atom" | "molecule" | "organism" | "template";
  importedBy: string[];
  shadcnImports: string[];
}

export interface AppGraphPackageMetadata {
  name?: string;
  version?: string;
  dependencies: string[];
  devDependencies: string[];
  hasShadcn: boolean;
  hasTailwind: boolean;
}

export interface AppGraph {
  version: 1;
  generatedAt: string;
  root: string;
  target: string;
  summary: {
    files: number;
    routes: number;
    components: number;
    styleFiles: number;
    imports: number;
    shadcnImports: number;
    cssVariables: number;
    tailwindClasses: number;
  };
  package: AppGraphPackageMetadata;
  files: AppGraphFile[];
  routes: AppGraphRoute[];
  components: AppGraphComponent[];
  tokens: {
    cssVariables: string[];
    tailwindUtilities: string[];
  };
  shadcn: {
    imports: string[];
    components: string[];
  };
}

export interface BuildAppGraphOptions {
  projectRoot: string;
  target?: string;
  maxFiles?: number;
  sources?: ScannedSourceFile[];
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".html", ".css", ".mdx", ".swift", ".metal"]);
const IGNORE_DIRS = new Set([
  ".git",
  ".memoire",
  ".next",
  ".turbo",
  ".vite",
  ".build",
  "Carthage",
  "coverage",
  "DerivedData",
  "dist",
  "build",
  "node_modules",
  "out",
  "Pods",
  "Preview Content",
]);

export async function buildAppGraph(options: BuildAppGraphOptions): Promise<AppGraph> {
  const target = options.target ?? options.projectRoot;
  const sources = options.sources ?? await scanSources({
    projectRoot: options.projectRoot,
    target,
    extensions: SOURCE_EXTENSIONS,
    ignoreDirs: IGNORE_DIRS,
    maxFiles: options.maxFiles ?? 700,
    maxBytesPerFile: 750_000,
    concurrency: 20,
    includeInlineStyles: true,
    includeLinkedStyles: false,
    userAgent: "Memoire-AppGraph/1.0",
  });

  const files = sources.map((source) => analyzeGraphFile(source.projectPath, source.content));
  const importIndex = new Map(files.map((file) => [file.path, file]));
  for (const file of files) {
    for (const imported of file.imports) {
      const resolved = resolveImportPath(file.path, imported, importIndex);
      if (resolved) resolved.importedBy.push(file.path);
    }
  }

  const packageMetadata = await readPackageMetadata(options.projectRoot);
  const routes = files.filter((file) => file.kind === "route").map((file) => ({
    path: file.path,
    routeId: routeIdFromPath(file.path),
    components: file.componentRefs,
  }));
  const components = files.filter((file) => file.kind === "component").map((file) => ({
    name: componentNameFromPath(file.path),
    path: file.path,
    atomicGuess: guessAtomicLevel(file),
    importedBy: file.importedBy,
    shadcnImports: file.shadcnImports,
  }));
  const cssVariables = unique(files.flatMap((file) => file.cssVariables)).sort();
  const tailwindUtilities = unique(files.flatMap((file) => file.tailwindClasses)).sort();
  const shadcnImports = files.flatMap((file) => file.shadcnImports);
  const shadcnComponents = unique(shadcnImports.map((value) => basename(value).replace(/\.(tsx?|jsx?)$/, ""))).sort();

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: options.projectRoot,
    target,
    summary: {
      files: files.length,
      routes: routes.length,
      components: components.length,
      styleFiles: files.filter((file) => file.kind === "style").length,
      imports: files.reduce((sum, file) => sum + file.imports.length, 0),
      shadcnImports: shadcnImports.length,
      cssVariables: cssVariables.length,
      tailwindClasses: tailwindUtilities.length,
    },
    package: packageMetadata,
    files,
    routes,
    components,
    tokens: {
      cssVariables,
      tailwindUtilities,
    },
    shadcn: {
      imports: unique(shadcnImports).sort(),
      components: shadcnComponents,
    },
  };
}

function analyzeGraphFile(path: string, content: string): AppGraphFile {
  return {
    path,
    kind: classifyAppGraphFile(path, content),
    imports: extractImports(content),
    importedBy: [],
    shadcnImports: extractShadcnImports(content),
    hexColors: unique([...content.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0])),
    cssVariables: unique([...content.matchAll(/--[a-zA-Z0-9-_]+/g)].map((match) => match[0])),
    tailwindClasses: extractClassTokens(content),
    componentRefs: unique([...content.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map((match) => match[1])),
  };
}

export function classifyAppGraphFile(path: string, content: string): AppGraphFileKind {
  if (/\.(test|spec)\.(tsx?|jsx?)$/.test(path)) return "test";
  if (/\.swift$/.test(path)) {
    if (/(^|\/)(Tests?|UITests?)\//.test(path) || /Tests?\.swift$/.test(path)) return "test";
    if (/\bstruct\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*App\b/.test(content)) return "route";
    if (/\b(?:struct|extension)\s+[A-Za-z_][A-Za-z0-9_]*[\s\S]{0,120}:\s*(?:View|ViewModifier)\b/.test(content)) return "component";
    return "config";
  }
  if (/(\.css|tailwind\.config|components\.json)$/.test(path)) return "style";
  if (/\.html$/.test(path)) return "markup";
  if (
    /(^|\/)(pages|routes)\//.test(path)
    || /(^|\/)(page|layout)\.(tsx|jsx|ts|js|mdx)$/.test(path)
  ) return "route";
  if (declaresReactComponent(path, content)) return "component";
  if (/(^|\/)components\//.test(path)) return "component";
  if ([".ts", ".tsx", ".js", ".jsx", ".mdx"].includes(extname(path))) return "config";
  return "other";
}

function declaresReactComponent(path: string, content: string): boolean {
  if (![".tsx", ".jsx", ".mdx"].includes(extname(path))) return false;
  const declaration = /\b(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+[A-Z][A-Za-z0-9_]*\b/
    .test(content)
    || /\b(?:export\s+)?(?:const|let)\s+[A-Z][A-Za-z0-9_]*\s*(?::[^=]+)?=\s*(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>/
      .test(content)
    || /\bclass\s+[A-Z][A-Za-z0-9_]*\s+extends\s+(?:React\.)?(?:Component|PureComponent)\b/
      .test(content);
  return declaration && /<[A-Za-z][A-Za-z0-9]*(?:\s|>|\/)/.test(content);
}

function extractImports(content: string): string[] {
  const imports = new Set<string>();
  for (const match of content.matchAll(/import\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']/g)) {
    imports.add(match[1]);
  }
  for (const match of content.matchAll(/require\(["']([^"']+)["']\)/g)) {
    imports.add(match[1]);
  }
  for (const match of content.matchAll(/^\s*import\s+([A-Za-z_][A-Za-z0-9_.]*)\s*$/gm)) {
    imports.add(match[1]);
  }
  return [...imports].sort();
}

function extractShadcnImports(content: string): string[] {
  return extractImports(content).filter((item) => /components\/ui|@\/components\/ui|shadcn/.test(item));
}

function extractClassTokens(content: string): string[] {
  const chunks = [
    ...content.matchAll(/className\s*=\s*["']([^"']+)["']/g),
    ...content.matchAll(/class\s*=\s*["']([^"']+)["']/g),
    ...content.matchAll(/className\s*=\s*\{`([^`]+)`\}/g),
  ].map((match) => match[1]);
  return unique(chunks.flatMap((chunk) => chunk.split(/\s+/)).map((token) => token.trim()).filter(Boolean));
}

function resolveImportPath(fromPath: string, imported: string, index: Map<string, AppGraphFile>): AppGraphFile | null {
  if (!imported.startsWith(".")) return null;
  const fromParts = fromPath.split("/");
  fromParts.pop();
  const base = fromParts.join("/");
  const normalized = join(base, imported).replace(/\\/g, "/").replace(/^\.\//, "");
  const candidates = [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    `${normalized}/index.ts`,
    `${normalized}/index.tsx`,
  ];
  for (const candidate of candidates) {
    const match = index.get(candidate);
    if (match) return match;
  }
  return null;
}

async function readPackageMetadata(projectRoot: string): Promise<AppGraphPackageMetadata> {
  try {
    const pkg = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as {
      name?: string;
      version?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = Object.keys(pkg.dependencies ?? {}).sort();
    const devDependencies = Object.keys(pkg.devDependencies ?? {}).sort();
    const all = new Set([...dependencies, ...devDependencies]);
    return {
      name: pkg.name,
      version: pkg.version,
      dependencies,
      devDependencies,
      hasShadcn: all.has("shadcn") || all.has("shadcn-ui") || all.has("@shadcn/ui"),
      hasTailwind: all.has("tailwindcss"),
    };
  } catch {
    return { dependencies: [], devDependencies: [], hasShadcn: false, hasTailwind: false };
  }
}

function routeIdFromPath(path: string): string {
  return path
    .replace(/^src\//, "")
    .replace(/^app\//, "/")
    .replace(/\/(page|layout)\.(tsx|jsx|ts|js|mdx)$/, "")
    .replace(/\.(tsx|jsx|ts|js|html|mdx)$/, "")
    .replace(/\/index$/, "/")
    .replace(/\/+/g, "/");
}

function componentNameFromPath(path: string): string {
  return basename(path).replace(/\.(tsx|jsx|ts|js|mdx)$/, "").replace(/(^\w|-\w)/g, (part) => part.replace("-", "").toUpperCase());
}

function guessAtomicLevel(file: AppGraphFile): AppGraphComponent["atomicGuess"] {
  if (/templates?\//.test(file.path)) return "template";
  if (/organisms?\//.test(file.path)) return "organism";
  if (/molecules?\//.test(file.path)) return "molecule";
  if (/ui\//.test(file.path) || file.shadcnImports.length === 0) return "atom";
  return file.componentRefs.length > 4 ? "organism" : "molecule";
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
