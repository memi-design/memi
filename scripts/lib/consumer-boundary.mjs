const FORBIDDEN_CONSUMER_PACKAGES = new Set([
  "@anthropic-ai/sdk",
  "@napi-rs/canvas",
  "esbuild",
  "pino-pretty",
  "playwright",
  "playwright-core",
  "ssf",
  "tsx",
  "typescript",
  "vite",
  "vitest",
  "xlsx-populate",
]);

export function assertConsumerGraph(lockfile) {
  const packagePaths = Object.keys(lockfile?.packages ?? {})
    .filter((path) => path.includes("node_modules/"));
  const packageNames = packagePaths.map(packageNameFromLockPath).filter(Boolean);
  const forbiddenPackages = [...new Set(packageNames.filter((name) =>
    FORBIDDEN_CONSUMER_PACKAGES.has(name)
    || name.startsWith("@napi-rs/canvas-")
    || name.startsWith("@rollup/rollup-"),
  ))].sort();
  if (forbiddenPackages.length > 0) {
    throw new Error(`consumer graph contains forbidden packages: ${forbiddenPackages.join(", ")}`);
  }
  return { packages: packagePaths.length, forbiddenPackages };
}

function packageNameFromLockPath(path) {
  const marker = "node_modules/";
  const offset = path.lastIndexOf(marker);
  if (offset < 0) return "";
  const remainder = path.slice(offset + marker.length);
  const parts = remainder.split("/");
  return parts[0]?.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] ?? "";
}
