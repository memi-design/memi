#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const command = "codex plugin marketplace add memi-design/memi --ref main --sparse .agents/plugins --sparse plugins/memoire";
const sparsePaths = [".agents/plugins", "plugins/memoire"];
const failures = [];

for (const sparsePath of sparsePaths) {
  try {
    await access(join(root, sparsePath));
  } catch {
    failures.push(`Missing sparse path: ${sparsePath}`);
  }
}

const marketplacePath = join(root, ".agents", "plugins", "marketplace.json");
const pluginManifestPath = join(root, "plugins", "memoire", ".codex-plugin", "plugin.json");

let marketplace;
let manifest;
try {
  marketplace = JSON.parse(await readFile(marketplacePath, "utf-8"));
} catch (error) {
  failures.push(`Invalid marketplace JSON: ${error instanceof Error ? error.message : String(error)}`);
}
try {
  manifest = JSON.parse(await readFile(pluginManifestPath, "utf-8"));
} catch (error) {
  failures.push(`Invalid plugin manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const entry = marketplace?.plugins?.find?.((plugin) => plugin?.name === "memoire");
if (!entry) {
  failures.push("Marketplace is missing the memoire plugin entry.");
} else {
  if (entry.source?.source !== "local") failures.push("Marketplace memoire entry must use local source.");
  if (entry.source?.path !== "./plugins/memoire") failures.push("Marketplace memoire entry must point to ./plugins/memoire.");
  if (entry.policy?.installation !== "AVAILABLE") failures.push("Marketplace memoire entry must be installable.");
  if (entry.policy?.authentication !== "ON_INSTALL") failures.push("Marketplace memoire entry must authenticate on install.");
}

if (manifest?.name !== "memoire") failures.push("Plugin manifest name must be memoire.");
if (manifest?.mcpServers !== "./.mcp.json") failures.push("Plugin manifest must reference ./.mcp.json.");
if (manifest?.skills !== "./skills/") failures.push("Plugin manifest must reference ./skills/.");

const result = {
  passed: failures.length === 0,
  command,
  sparsePaths,
  marketplace: ".agents/plugins/marketplace.json",
  plugin: "plugins/memoire",
  failures,
};

console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
