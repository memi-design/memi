#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDesignWorkBenchmark,
  validateDesignWorkBenchmark,
} from "./lib/designwork-benchmark.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "benchmarks", "designworkbench-v2", "benchmark.json");
const check = process.argv.includes("--check");
const manifest = buildDesignWorkBenchmark();
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

if (check) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== serialized) {
    console.error("DesignWorkBench v2 manifest is stale. Run npm run build:designwork-bench.");
    process.exitCode = 1;
  }
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
}

const result = await validateDesignWorkBenchmark(manifest, { root });
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
