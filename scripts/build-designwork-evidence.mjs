#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateDesignWorkEvidence,
} from "./lib/designwork-evidence.mjs";
import {
  runArtifactValidatorProbe,
  runBrowserPlaywrightProbe,
  runMotionRenderProbe,
} from "./lib/designwork-runner-probes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkPath = path.join(root, "benchmarks", "designworkbench-v2", "benchmark.json");
const evidenceRoot = path.join(root, "benchmarks", "designworkbench-v2", "evidence");
const bundlePath = path.join(evidenceRoot, "evidence.json");
const check = process.argv.includes("--check");
const manifest = JSON.parse(await readFile(benchmarkPath, "utf8"));

if (!check) {
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const existing = await loadBundle();
  const receipts = await Promise.all([
    runArtifactValidatorProbe({ manifest, evidenceRoot, projectRoot: root }),
    runBrowserPlaywrightProbe({ manifest, evidenceRoot }),
    runMotionRenderProbe({ manifest, evidenceRoot }),
  ]);
  const bundle = {
    schemaVersion: 1,
    benchmarkId: manifest.benchmarkId,
    receipts,
    calibrationArtifacts: existing?.calibrationArtifacts ?? [],
    results: existing?.results ?? null,
  };
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

const bundle = await loadBundle();
if (!bundle) {
  console.error("DesignWorkBench evidence is missing. Run npm run build:designwork-evidence.");
  process.exitCode = 1;
} else {
  const result = await validateDesignWorkEvidence(manifest, bundle, {
    root: evidenceRoot,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

async function loadBundle() {
  try {
    return JSON.parse(await readFile(bundlePath, "utf8"));
  } catch {
    return null;
  }
}
