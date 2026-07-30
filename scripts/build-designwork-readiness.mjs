#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDesignWorkReadiness,
  validateDesignWorkBenchmark,
} from "./lib/designwork-benchmark.mjs";
import {
  validateDesignWorkEvidence,
} from "./lib/designwork-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkPath = path.join(root, "benchmarks", "designworkbench-v2", "benchmark.json");
const jsonPath = path.join(root, "docs", "audits", "memi-designworkbench-v2-readiness.json");
const markdownPath = path.join(root, "docs", "audits", "memi-designworkbench-v2-readiness.md");
const check = process.argv.includes("--check");
const requireReady = process.argv.includes("--require-ready");
const manifest = JSON.parse(await readFile(benchmarkPath, "utf8"));
const validation = await validateDesignWorkBenchmark(manifest, { root });
const evidence = await loadEvidence(root, manifest);
const readiness = buildDesignWorkReadiness(manifest, evidence);
const report = {
  schemaVersion: 1,
  generatedAt: process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
    : new Date().toISOString(),
  validation,
  evidence: {
    passed: evidence.passed ?? false,
    failures: evidence.failures ?? ["DesignWorkBench evidence bundle is missing"],
    verifiedFixtureIds: evidence.verifiedFixtureIds ?? [],
    verifiedRunnerIds: evidence.verifiedRunnerIds ?? [],
  },
  readiness,
};
const json = `${JSON.stringify(report, null, 2)}\n`;
const markdown = renderMarkdown(report);

if (check) {
  const existingJson = await readFile(jsonPath, "utf8").catch(() => "");
  const existingMarkdown = await readFile(markdownPath, "utf8").catch(() => "");
  const stableExisting = existingJson
    ? `${JSON.stringify({ ...JSON.parse(existingJson), generatedAt: report.generatedAt }, null, 2)}\n`
    : "";
  if (stableExisting !== json || normalizeGeneratedAt(existingMarkdown) !== normalizeGeneratedAt(markdown)) {
    console.error("DesignWorkBench readiness artifacts are stale. Run npm run build:designwork-readiness.");
    process.exitCode = 1;
  }
} else {
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, json, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
}

console.log(JSON.stringify(report, null, 2));
if (!validation.passed
  || evidence.passed !== true
  || (requireReady && !readiness.releaseReady)) {
  process.exitCode = 1;
}

async function loadEvidence(projectRoot, benchmark) {
  const evidenceRoot = path.join(
    projectRoot,
    "benchmarks",
    "designworkbench-v2",
    "evidence",
  );
  const bundlePath = path.join(evidenceRoot, "evidence.json");
  try {
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    return await validateDesignWorkEvidence(benchmark, bundle, {
      root: evidenceRoot,
    });
  } catch {
    return {
      verifiedFixtureIds: [],
      verifiedRunnerIds: [],
      calibrationArtifacts: [],
      results: null,
    };
  }
}

function renderMarkdown(report) {
  const { readiness } = report;
  const status = readiness.releaseReady ? "READY" : "BLOCKED";
  const blockers = readiness.blockers.length > 0
    ? readiness.blockers.map((blocker) => `- ${blocker}`).join("\n")
    : "- None";
  return `# Memi DesignWorkBench v2 readiness

Generated: ${report.generatedAt}

Release status: **${status}**

## Frozen candidate

- Version: ${readiness.frozenCandidate?.version ?? "unknown"}
- Commit: \`${readiness.frozenCandidate?.commit ?? "unknown"}\`
- Claim: ${readiness.frozenCandidate?.claim ?? "missing"}

## Completed foundation

- Professional tracks: ${readiness.completed.tracks}/15
- Task contracts: ${readiness.completed.taskContracts}/300
- Public development tasks: ${readiness.completed.publicTasks}/60
- Private test tasks: ${readiness.completed.privateTasks}/180
- Rolling holdout tasks: ${readiness.completed.holdoutTasks}/60
- Runner contracts: ${readiness.completed.runnerContracts}/8

## Independently verified

- Real task fixtures: ${readiness.verified.fixtures}/300
- Runtime runners: ${readiness.verified.runners}/8
- Qualified practitioners: ${readiness.verified.practitioners}
- Calibrated tracks: ${readiness.verified.calibratedTracks}/15

## Release blockers

${blockers}

This report intentionally distinguishes generated contracts from reproduced professional evidence. Prompt-only, synthetic, or self-authored practitioner ratings cannot clear the calibration gate.
`;
}

function normalizeGeneratedAt(value) {
  return value.replace(/^Generated: .+$/m, "Generated: normalized");
}
