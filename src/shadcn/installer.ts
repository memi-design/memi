import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { MemoireEngine } from "../engine/core.js";
import type { ComponentSpec } from "../specs/types.js";
import { ComponentSpecSchema } from "../specs/types.js";
import { resolveMarketplaceAlias } from "../marketplace/catalog-loader.js";
import { fetchNpmPackageToCache } from "../registry/npm-fetch.js";
import { packagePath } from "../utils/asset-path.js";
import { isPrivateOrLocalHostname } from "../security/network-address.js";
import { fetchPublicText } from "../security/safe-fetch.js";
import {
  type ShadcnRegistry,
  type ShadcnRegistryFile,
  type ShadcnRegistryItem,
  parseShadcnRegistry,
  parseShadcnRegistryItem,
  toShadcnItemName,
} from "./schema.js";

const FETCH_TIMEOUT_MS = 15000;
const MAX_REGISTRY_TEXT_BYTES = 2_000_000;

export interface InstallShadcnItemOptions {
  from: string;
  name: string;
  targetDir?: string;
  refresh?: boolean;
}

export interface InstallShadcnItemResult {
  spec: ComponentSpec;
  specPath: string;
  codePath?: string;
  generatedFiles: string[];
  source: string;
  item: ShadcnRegistryItem;
}

interface ResolvedShadcnItem {
  item: ShadcnRegistryItem;
  source: string;
  readFileContent(file: ShadcnRegistryFile): Promise<string>;
}

interface ComponentsJson {
  aliases?: Record<string, string>;
}

export async function installShadcnRegistryItem(
  engine: MemoireEngine,
  options: InstallShadcnItemOptions,
): Promise<InstallShadcnItemResult> {
  const resolved = await resolveShadcnRegistryItem(options.from, options.name, engine.config.projectRoot, {
    refresh: options.refresh,
  });
  const componentsJson = await readComponentsJson(engine.config.projectRoot);
  const generatedFiles: string[] = [];
  let codePath: string | undefined;

  for (const file of resolved.item.files) {
    const content = file.content ?? await resolved.readFileContent(file);
    const targetPath = resolveShadcnTarget(engine.config.projectRoot, file, componentsJson, options.targetDir);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
    generatedFiles.push(targetPath);
    if (!codePath && /\.(tsx|jsx|ts|js|vue|svelte)$/.test(targetPath)) {
      codePath = targetPath;
    }
  }

  const spec = itemToSyntheticSpec(resolved.item);
  await engine.registry.saveSpec(spec);
  const specPath = join(engine.config.projectRoot, ".memoire", "specs", "components", `${spec.name}.json`);

  return {
    spec,
    specPath,
    codePath,
    generatedFiles,
    source: resolved.source,
    item: resolved.item,
  };
}

export async function resolveShadcnRegistryItem(
  from: string,
  name: string,
  cwd: string,
  options: { refresh?: boolean } = {},
): Promise<ResolvedShadcnItem> {
  if (/^https?:\/\//.test(from)) {
    return resolveHttpShadcnItem(from, name);
  }
  if (from.startsWith("./") || from.startsWith("../") || isAbsolute(from)) {
    return resolveLocalShadcnItem(from, name, cwd);
  }

  const catalogEntry = await resolveMarketplaceAlias(from).catch(() => undefined);
  const packageName = catalogEntry?.packageName ?? from;
  if (catalogEntry) {
    const localSource = resolve(cwd, catalogEntry.sourcePath);
    if (await exists(localSource)) {
      return resolveLocalShadcnItem(localSource, name, cwd, `catalog:${catalogEntry.slug}`);
    }
  }

  try {
    const cached = await fetchNpmPackageToCache(packageName, cwd, "latest", { refresh: options.refresh });
    return resolveLocalShadcnItem(cached.packageDir, name, cwd, `npm:${packageName}@${cached.version}`);
  } catch (error) {
    if (catalogEntry) {
      const packagedSource = packagePath(catalogEntry.sourcePath);
      if (await exists(packagedSource)) {
        return resolveLocalShadcnItem(packagedSource, name, cwd, `catalog:${catalogEntry.slug}`);
      }
    }
    throw error;
  }
}

function itemToSyntheticSpec(item: ShadcnRegistryItem): ComponentSpec {
  const title = item.title ?? pascalCase(item.name);
  return ComponentSpecSchema.parse({
    name: title.replace(/[^a-zA-Z0-9_-]/g, "") || pascalCase(item.name),
    type: "component",
    level: item.type === "registry:block" ? "organism" : item.type === "registry:ui" ? "atom" : "molecule",
    purpose: item.description ?? `Installed from shadcn registry item ${item.name}.`,
    shadcnBase: item.registryDependencies?.filter((dependency) => !dependency.startsWith("http")) ?? [],
    props: {},
    variants: ["default"],
    tags: item.categories ?? [],
    __memoireSource: {
      registry: item.meta?.memoire && typeof item.meta.memoire === "object" && "sourcePackage" in item.meta.memoire
        ? String((item.meta.memoire as { sourcePackage?: unknown }).sourcePackage ?? "shadcn")
        : "shadcn",
      installedAt: new Date().toISOString(),
    },
  });
}

async function resolveLocalShadcnItem(ref: string, name: string, cwd: string, sourceOverride?: string): Promise<ResolvedShadcnItem> {
  const base = isAbsolute(ref) ? ref : resolve(cwd, ref);
  const itemName = toShadcnItemName(name);
  const directFile = base.endsWith(".json") ? base : "";

  if (directFile) {
    const item = parseShadcnRegistryItem(JSON.parse(await readFile(directFile, "utf8")));
    return {
      item,
      source: sourceOverride ?? `local:${directFile}`,
      readFileContent: (file) => readContainedShadcnFile(dirname(directFile), file.path),
    };
  }

  const itemCandidates = [
    join(base, "r", `${itemName}.json`),
    join(base, "public", "r", `${itemName}.json`),
    join(base, `${itemName}.json`),
  ];
  for (const candidate of itemCandidates) {
    if (await exists(candidate)) {
      const item = parseShadcnRegistryItem(JSON.parse(await readFile(candidate, "utf8")));
      return {
        item,
        source: sourceOverride ?? `local:${candidate}`,
        readFileContent: (file) => readContainedShadcnFile(dirname(candidate), file.path),
      };
    }
  }

  const registryCandidates = [
    join(base, "r", "registry.json"),
    join(base, "public", "r", "registry.json"),
    join(base, "registry.json"),
  ];
  for (const candidate of registryCandidates) {
    if (!await exists(candidate)) continue;
    const registry = parseShadcnRegistry(JSON.parse(await readFile(candidate, "utf8")));
    const item = await readItemFromRegistry(registry, itemName, dirname(candidate));
    return {
      item,
      source: sourceOverride ?? `local:${candidate}`,
      readFileContent: (file) => readContainedShadcnFile(dirname(candidate), file.path),
    };
  }

  throw new Error(`No shadcn registry item "${name}" found in ${base}`);
}

async function resolveHttpShadcnItem(url: string, name: string): Promise<ResolvedShadcnItem> {
  assertSafePublicUrl(url);
  const itemName = toShadcnItemName(name);
  const raw = await fetchText(url);
  const baseUrl = url.replace(/\/[^/]+$/, "");

  try {
    const item = parseShadcnRegistryItem(JSON.parse(raw));
    return {
      item,
      source: url,
      readFileContent: (file) => fetchText(resolveContainedShadcnUrl(baseUrl, file.path)),
    };
  } catch {
    const registry = parseShadcnRegistry(JSON.parse(raw)) as ShadcnRegistry;
    const itemRef = registry.items.find((item) => toShadcnItemName(item.name) === itemName);
    if (!itemRef) throw new Error(`No shadcn registry item "${name}" found at ${url}`);
    const route = itemRoute(itemRef);
    const itemUrl = new URL(route, route.startsWith("/") ? new URL(url).origin : `${baseUrl}/`).toString();
    const item = parseShadcnRegistryItem(JSON.parse(await fetchText(itemUrl)));
    return {
      item,
      source: itemUrl,
      readFileContent: (file) => fetchText(resolveContainedShadcnUrl(itemUrl.replace(/\/[^/]+$/, ""), file.path)),
    };
  }
}

async function readItemFromRegistry(registry: ShadcnRegistry, itemName: string, baseDir: string): Promise<ShadcnRegistryItem> {
  const itemRef = registry.items.find((item) => toShadcnItemName(item.name) === itemName);
  if (!itemRef) throw new Error(`No shadcn registry item "${itemName}" found in registry ${registry.name}`);
  const route = itemRoute(itemRef).replace(/^\/r\//, "");
  return parseShadcnRegistryItem(JSON.parse(await readContainedShadcnFile(baseDir, route)));
}

function itemRoute(item: ShadcnRegistryItem): string {
  const meta = item.meta?.memoire as { itemRoute?: unknown } | undefined;
  return typeof meta?.itemRoute === "string" ? meta.itemRoute : `/r/${toShadcnItemName(item.name)}.json`;
}

function resolveShadcnTarget(
  projectRoot: string,
  file: ShadcnRegistryFile,
  componentsJson: ComponentsJson,
  targetDir?: string,
): string {
  const target = file.target ?? (targetDir ? join(targetDir, basename(file.path)) : join("src", "components", "memoire", basename(file.path)));
  const projectRelative = normalizeAliasTarget(target, componentsJson);
  const resolved = resolve(projectRoot, projectRelative);
  const root = resolve(projectRoot);
  if (!resolved.startsWith(`${root}/`) && resolved !== root) {
    throw new Error(`Refusing to write shadcn file outside project root: ${target}`);
  }
  return resolved;
}

function normalizeAliasTarget(target: string, componentsJson: ComponentsJson): string {
  const normalized = target.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.startsWith("@/")) return normalized.slice(2);

  for (const alias of Object.values(componentsJson.aliases ?? {})) {
    if (!alias || !normalized.startsWith(alias)) continue;
    const aliasPath = alias.startsWith("@/") ? alias.slice(2) : alias;
    return `${aliasPath}${normalized.slice(alias.length)}`;
  }

  return normalized;
}

async function readComponentsJson(projectRoot: string): Promise<ComponentsJson> {
  try {
    return JSON.parse(await readFile(join(projectRoot, "components.json"), "utf8")) as ComponentsJson;
  } catch {
    return {};
  }
}

async function fetchText(url: string): Promise<string> {
  assertSafePublicUrl(url);
  const response = await fetchPublicText(url, {
    maxBytes: MAX_REGISTRY_TEXT_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (!response.ok) throw new Error(`Failed to fetch shadcn registry item: ${response.status}`);
  return response.text;
}

function assertSafePublicUrl(url: string): void {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || isPrivateOrLocalHostname(parsed.hostname)) {
    throw new Error(`Unsafe shadcn registry URL: ${url}`);
  }
}

async function readContainedShadcnFile(root: string, filePath: string): Promise<string> {
  if (!filePath || filePath.includes("\\")) {
    throw new Error(`Shadcn file reference is invalid: ${filePath}`);
  }
  const resolvedRoot = await realpath(resolve(root));
  const candidate = resolve(resolvedRoot, filePath);
  assertContainedShadcnPath(resolvedRoot, candidate, filePath);
  const resolvedCandidate = await realpath(candidate);
  assertContainedShadcnPath(resolvedRoot, resolvedCandidate, filePath);
  return readFile(resolvedCandidate, "utf8");
}

function assertContainedShadcnPath(root: string, candidate: string, source: string): void {
  const relativePath = relative(root, candidate);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Shadcn file reference escapes the shadcn registry root: ${source}`);
  }
}

function resolveContainedShadcnUrl(baseUrl: string, filePath: string): string {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const candidate = new URL(filePath, base);
  assertSafePublicUrl(candidate.href);
  if (candidate.origin !== base.origin || !candidate.pathname.startsWith(base.pathname)) {
    throw new Error(`Shadcn file reference escapes the shadcn registry root: ${filePath}`);
  }
  return candidate.href;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function pascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
