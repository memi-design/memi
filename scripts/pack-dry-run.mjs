#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { evaluatePackageSizeBudget } from "./lib/package-size-budget.mjs";
import { stagePackage } from "./lib/package-stage.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Security and evidence-contract code is intentionally shipped in the CLI.
// Keep at least 10% operational headroom below the hard public-package budget.
const maxSizeBytes = Number.parseInt(process.env.MEMOIRE_PACK_MAX_BYTES || "1500000", 10);
const maxUnpackedBytes = Number.parseInt(process.env.MEMOIRE_PACK_MAX_UNPACKED_BYTES || "3000000", 10);
const maxFiles = Number.parseInt(process.env.MEMOIRE_PACK_MAX_FILES || "100", 10);
const maxUtilization = Number.parseFloat(process.env.MEMOIRE_PACK_MAX_UTILIZATION || "0.9");
const npmCommand = "npm";

export const PACK_DRY_RUN_REQUIRED_INPUTS = Object.freeze({
  build: ["dist/bin.js", "dist/index.js", "dist/index.d.ts"],
  shrinkwrap: ["release/npm-shrinkwrap.production.json"],
});

export async function ensurePackDryRunInputs(
  packageRoot,
  runScript = (script) => runNpmScript(packageRoot, script),
) {
  const absoluteRoot = resolve(packageRoot);
  const missingBuildInputs = await collectMissingInputs(
    absoluteRoot,
    PACK_DRY_RUN_REQUIRED_INPUTS.build,
  );
  if (missingBuildInputs.length > 0) {
    await runScript("build");
  }

  const missingShrinkwrapInputs = await collectMissingInputs(
    absoluteRoot,
    PACK_DRY_RUN_REQUIRED_INPUTS.shrinkwrap,
  );
  if (missingShrinkwrapInputs.length > 0) {
    await runScript("build:production-shrinkwrap");
  }

  const remaining = [
    ...await collectMissingInputs(absoluteRoot, PACK_DRY_RUN_REQUIRED_INPUTS.build),
    ...await collectMissingInputs(absoluteRoot, PACK_DRY_RUN_REQUIRED_INPUTS.shrinkwrap),
  ];
  if (remaining.length > 0) {
    throw new Error(`pack dry-run is missing required staged inputs: ${remaining.join(", ")}`);
  }
}

export async function runPackDryRun(packageRoot = root) {
  await ensurePackDryRunInputs(packageRoot);
  const tempRoot = await mkdtemp(join(tmpdir(), "memoire-pack-"));

  try {
    const stage = await stagePackage({
      packageRoot,
      stageRoot: join(tempRoot, "package"),
    });
    const { packageJson } = stage;

    const pack = await run(npmCommand, ["pack", "--dry-run", "--ignore-scripts", "--json"], stage.stageRoot);
    const payload = JSON.parse(pack.stdout);
    const summary = Array.isArray(payload) ? payload[0] : payload;
    const size = Number(summary?.size ?? 0);
    const unpackedSize = Number(summary?.unpackedSize ?? 0);
    const files = Array.isArray(summary?.files) ? summary.files.length : 0;
    const packedPaths = new Set((summary?.files ?? []).map((file) => file.path));
    for (const requiredPath of ["dist/bin.js", "dist/index.js", "dist/index.d.ts", "npm-shrinkwrap.json"]) {
      if (!packedPaths.has(requiredPath)) {
        throw new Error(`packed artifact is missing required file: ${requiredPath}`);
      }
    }

    const budget = evaluatePackageSizeBudget(
      { size, unpackedSize, files },
      { maxSizeBytes, maxUnpackedBytes, maxFiles, maxUtilization },
    );

    return {
      name: summary?.name ?? packageJson.name,
      version: summary?.version ?? packageJson.version,
      filename: summary?.filename ?? null,
      size,
      unpackedSize,
      files,
      ...budget,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function collectMissingInputs(packageRoot, requiredPaths) {
  const missing = [];
  for (const requiredPath of requiredPaths) {
    try {
      await access(join(packageRoot, requiredPath));
    } catch {
      missing.push(requiredPath);
    }
  }
  return missing;
}

async function runNpmScript(packageRoot, script) {
  await run(npmCommand, ["run", script], packageRoot);
}

async function run(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      npm_config_ignore_scripts: "true",
    },
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const code = await new Promise((resolve) => {
    child.on("close", resolve);
  });

  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${code}\n${stderr || stdout}`);
  }

  return { stdout, stderr };
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  const result = await runPackDryRun(root);
  console.log(JSON.stringify(result, null, 2));

  if (!result.passed) {
    console.error(result.reason);
    process.exitCode = 1;
  }
}
