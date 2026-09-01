#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertConsumerGraph } from "./lib/consumer-boundary.mjs";
import { PRODUCTION_SHRINKWRAP_PATH } from "./lib/package-stage.mjs";
import { buildProductionShrinkwrap } from "./lib/production-shrinkwrap.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const sourceLock = JSON.parse(
  await readFile(join(root, "npm-shrinkwrap.json"), "utf8"),
);
const lock = buildProductionShrinkwrap(sourceLock);
const rootPackage = lock.packages?.[""];
if (
  lock.name !== packageJson.name
  || lock.version !== packageJson.version
  || rootPackage?.name !== packageJson.name
  || rootPackage?.version !== packageJson.version
) {
  throw new Error("source npm-shrinkwrap.json identity does not match package.json");
}

const graph = assertConsumerGraph(lock);
const outputPath = join(root, PRODUCTION_SHRINKWRAP_PATH);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  package: packageJson.name,
  version: packageJson.version,
  productionPackages: graph.packages,
  source: "npm-shrinkwrap.json",
  output: PRODUCTION_SHRINKWRAP_PATH,
}, null, 2));
