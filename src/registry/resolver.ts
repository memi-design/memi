/**
 * Registry Resolver — fetch a remote Memoire registry by reference.
 *
 * Supported reference formats:
 *   - npm package name:       "@acme/design-system"
 *   - GitHub repo:            "github:user/repo"
 *   - GitHub repo + path:     "github:user/repo/subdir"
 *   - Raw HTTPS URL:          "https://example.com/path/to/registry.json"
 *   - Local path:             "./path/to/registry" or "/abs/path"
 */

import { access, readFile, realpath } from "fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "path";
import {
  parseRegistry,
  type Registry,
  type RegistryComponentRef,
  REGISTRY_FILENAME,
} from "./legacy.js";
import { resolveMarketplaceAlias } from "../marketplace/catalog-loader.js";
import { fetchNpmPackageToCache } from "./npm-fetch.js";
import { packagePath } from "../utils/asset-path.js";
import { isPrivateOrLocalHostname } from "../security/network-address.js";
import { fetchPublicText } from "../security/safe-fetch.js";

export interface ResolvedRegistry {
  /** The parsed registry document */
  registry: Registry;
  /** Base URL or path for fetching token/component files */
  baseUrl: string;
  /** Source reference (for logging) */
  source: string;
}

export interface ResolveRegistryOptions {
  refresh?: boolean;
  cacheTtlMs?: number;
}

const FETCH_TIMEOUT_MS = 15000;
const MAX_REGISTRY_RESPONSE_BYTES = 5 * 1024 * 1024;

// ── SSRF guard (same pattern as penpot-client) ───────────────

function assertSafePublicUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`URL must be http(s): ${url}`);
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new Error(`Registry URL cannot point to a private/loopback address: ${url}`);
  }
}

// ── Resolver ────────────────────────────────────────────────

/**
 * Resolve a registry reference to a parsed Registry + baseUrl.
 */
export async function resolveRegistry(ref: string, cwd: string = process.cwd(), options: ResolveRegistryOptions = {}): Promise<ResolvedRegistry> {
  if (ref.startsWith("github:")) {
    return resolveGitHub(ref);
  }
  if (/^https?:\/\//.test(ref)) {
    return resolveHttp(ref);
  }
  // Reject any other explicit URL scheme (ftp:, file:, javascript:, etc.)
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(ref)) {
    throw new Error(`Registry ref must use http(s), github:, local path, or npm package name — got: ${ref}`);
  }
  if (ref.startsWith("./") || ref.startsWith("../") || isAbsolute(ref)) {
    return resolveLocal(ref, cwd);
  }
  const marketplaceEntry = await resolveMarketplaceAlias(ref);
  if (marketplaceEntry && marketplaceEntry.packageName !== ref) {
    try {
      const localSource = resolve(cwd, marketplaceEntry.sourcePath);
      if (await fileExists(localSource)) {
        return await resolveLocal(localSource, cwd);
      }
      try {
        return await resolveNpm(marketplaceEntry.packageName, cwd, options);
      } catch {
        const packagedSource = packagePath(marketplaceEntry.sourcePath);
        if (await fileExists(packagedSource)) {
          return await resolveLocal(packagedSource, cwd);
        }
        throw new Error(`Install it first: npm install ${marketplaceEntry.packageName}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Featured registry "${ref}" maps to "${marketplaceEntry.packageName}". ${message}`,
      );
    }
  }
  // Default: treat as npm package name — look in node_modules
  return resolveNpm(ref, cwd, options);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveLocal(ref: string, cwd: string): Promise<ResolvedRegistry> {
  const baseDir = isAbsolute(ref) ? ref : resolve(cwd, ref);
  const registryPath = join(baseDir, REGISTRY_FILENAME);
  const raw = await readFile(registryPath, "utf-8").catch(() => {
    throw new Error(`Could not read registry at ${registryPath}`);
  });
  const registry = parseRegistry(JSON.parse(raw));
  return { registry, baseUrl: baseDir, source: `local:${baseDir}` };
}

async function resolveNpm(pkgName: string, cwd: string, options: ResolveRegistryOptions): Promise<ResolvedRegistry> {
  // Look in local node_modules
  const { packageName, version } = splitNpmPackageRef(pkgName);
  const baseDir = resolve(cwd, "node_modules", packageName);
  try {
    const local = await resolveLocal(baseDir, cwd);
    if (version !== "latest" && local.registry.version !== version) {
      throw new Error(
        `Local registry version ${local.registry.version} does not satisfy exact pin ${version}`,
      );
    }
    return local;
  } catch (localError) {
    try {
      const cached = await fetchNpmPackageToCache(packageName, cwd, version, {
        refresh: options.refresh,
        ttlMs: options.cacheTtlMs,
      });
      const resolved = await resolveLocal(cached.packageDir, cwd);
      return {
        ...resolved,
        source: `npm:${packageName}@${cached.version}`,
      };
    } catch (remoteError) {
      const localMessage = localError instanceof Error ? localError.message : String(localError);
      const remoteMessage = remoteError instanceof Error ? remoteError.message : String(remoteError);
      throw new Error(
        `Registry "${pkgName}" could not be resolved locally or from npm. local: ${localMessage}; npm: ${remoteMessage}`,
      );
    }
  }
}

function splitNpmPackageRef(ref: string): { packageName: string; version: string } {
  if (ref.startsWith("@")) {
    const secondAt = ref.indexOf("@", 1);
    if (secondAt === -1) return { packageName: ref, version: "latest" };
    return { packageName: ref.slice(0, secondAt), version: ref.slice(secondAt + 1) || "latest" };
  }

  const at = ref.lastIndexOf("@");
  if (at > 0) return { packageName: ref.slice(0, at), version: ref.slice(at + 1) || "latest" };
  return { packageName: ref, version: "latest" };
}

async function resolveGitHub(ref: string): Promise<ResolvedRegistry> {
  // github:user/repo or github:user/repo/subdir
  const body = ref.replace(/^github:/, "");
  const parts = body.split("/");
  if (parts.length < 2) throw new Error(`Invalid GitHub ref: ${ref}`);
  const [user, repo, ...pathParts] = parts;
  const subdir = pathParts.join("/");
  const baseUrl = subdir
    ? `https://raw.githubusercontent.com/${user}/${repo}/main/${subdir}`
    : `https://raw.githubusercontent.com/${user}/${repo}/main`;
  return resolveHttp(`${baseUrl}/${REGISTRY_FILENAME}`, baseUrl);
}

async function resolveHttp(registryUrl: string, explicitBase?: string): Promise<ResolvedRegistry> {
  assertSafePublicUrl(registryUrl);
  const baseUrl = explicitBase ?? registryUrl.replace(/\/[^/]+$/, "");
  const response = await fetchPublicText(registryUrl, {
    maxBytes: MAX_REGISTRY_RESPONSE_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
    headers: { "User-Agent": "memoire-registry-resolver" },
  });
  if (!response.ok) throw new Error(`Registry fetch failed (${response.status}): ${registryUrl}`);
  const registry = parseRegistry(JSON.parse(response.text));
  return { registry, baseUrl, source: registryUrl };
}

// ── Fetching referenced files ────────────────────────────────

/**
 * Read a referenced file (tokens or component spec) from a resolved registry.
 */
export async function readRegistryFile(resolved: ResolvedRegistry, href: string): Promise<string> {
  const { baseUrl } = resolved;
  // Strip leading ./
  const cleanHref = href.startsWith("./") ? href.slice(2) : href;
  if (!cleanHref || cleanHref.includes("\\")) {
    throw new Error(`Registry file reference is invalid: ${href}`);
  }

  if (/^https?:\/\//.test(baseUrl)) {
    const normalizedBase = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    const url = new URL(cleanHref, normalizedBase);
    assertSafePublicUrl(url.href);
    if (url.origin !== normalizedBase.origin || !url.pathname.startsWith(normalizedBase.pathname)) {
      throw new Error(`Registry file reference escapes the registry root: ${href}`);
    }
    const response = await fetchPublicText(url.href, {
      maxBytes: MAX_REGISTRY_RESPONSE_BYTES,
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { "User-Agent": "memoire-registry-resolver" },
    });
    if (!response.ok) throw new Error(`Failed to fetch ${href}: ${response.status}`);
    return response.text;
  }

  // Local path
  const root = resolve(baseUrl);
  const fullPath = resolve(root, cleanHref);
  assertRegistryPathContained(root, fullPath, href);
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(fullPath)]);
  assertRegistryPathContained(realRoot, realFile, href);
  return readFile(realFile, "utf-8");
}

function assertRegistryPathContained(root: string, candidate: string, href: string): void {
  const relativePath = relative(root, candidate);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Registry file reference escapes the registry root: ${href}`);
  }
}

/**
 * Find a component ref by name in a registry (case-sensitive).
 */
export function findComponentRef(registry: Registry, name: string): RegistryComponentRef {
  const ref = registry.components.find(c => c.name === name);
  if (!ref) {
    const available = registry.components.map(c => c.name).join(", ") || "(none)";
    throw new Error(`Component "${name}" not in registry "${registry.name}". Available: ${available}`);
  }
  return ref;
}
