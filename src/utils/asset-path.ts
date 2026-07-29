import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | undefined;

/**
 * Resolve the Mémoire package root — the directory that contains
 * `skills/`, `notes/`, `plugin/`, and `package.json`.
 *
 * Works in three modes:
 *   1. tsx/dev:        walks up from src/utils/asset-path.ts → repo root.
 *   2. npm install:    walks up from dist/utils/asset-path.js → package root.
 *   3. Compiled bin:   assets are sidecar next to the executable (bun compile
 *                      virtualizes `import.meta.url`, so fall back to
 *                      `dirname(process.execPath)`).
 *
 * Honors the `MEMOIRE_PACKAGE_ROOT` env var as an override for tests and
 * edge-case deployments.
 */
export function packageRoot(): string {
  if (cached) return cached;

  const override = process.env.MEMOIRE_PACKAGE_ROOT;
  if (override) return (cached = resolve(override));

  const url = import.meta.url;
  const virtual = url.includes("$bunfs") || url.startsWith("embedded:") || url.startsWith("compiled:");
  if (virtual) return (cached = dirname(process.execPath));

  const moduleDir = dirname(fileURLToPath(url));
  return (cached = basename(moduleDir) === "dist"
    ? join(moduleDir, "..")
    : join(moduleDir, "..", ".."));
}

/** Resolve a path relative to the package root. */
export function packagePath(...segments: string[]): string {
  return join(packageRoot(), ...segments);
}

/** Reset the cached root — test-only. */
export function __resetPackageRootCache(): void {
  cached = undefined;
}
