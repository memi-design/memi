#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateInterfaceBenchmark } from "./lib/interface-benchmark.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = path.resolve(
  process.argv[2] ?? path.join(root, "benchmarks", "interfacebench-v1.json"),
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const result = await validateInterfaceBenchmark(manifest, { root });
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
