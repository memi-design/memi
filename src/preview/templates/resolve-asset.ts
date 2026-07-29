/**
 * Resolve static asset files (CSS, JS) relative to this directory.
 * Used by gallery-page.ts and research-page.ts to load extracted static content.
 */

import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { packageRoot } from "../../utils/asset-path.js";

const __dir = dirname(fileURLToPath(import.meta.url));

export function resolveAsset(relativePath: string): string {
  const sibling = join(__dir, relativePath);
  if (existsSync(sibling)) return readFileSync(sibling, "utf-8");
  const packaged = join(packageRoot(), "dist", "preview", "templates", relativePath);
  if (existsSync(packaged)) return readFileSync(packaged, "utf-8");
  // Compiled binary: import.meta.url is virtual; fall back to sidecar assets.
  return readFileSync(join(packageRoot(), "preview", "templates", relativePath), "utf-8");
}
