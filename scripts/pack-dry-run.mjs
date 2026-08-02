#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { evaluatePackageSizeBudget } from "./lib/package-size-budget.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Security and evidence-contract code is intentionally shipped in the CLI.
// Keep at least 10% operational headroom below the hard public-package budget.
const maxSizeBytes = Number.parseInt(process.env.MEMOIRE_PACK_MAX_BYTES || "750000", 10);
const maxUnpackedBytes = Number.parseInt(process.env.MEMOIRE_PACK_MAX_UNPACKED_BYTES || "2010000", 10);
const maxFiles = Number.parseInt(process.env.MEMOIRE_PACK_MAX_FILES || "250", 10);
const maxUtilization = Number.parseFloat(process.env.MEMOIRE_PACK_MAX_UTILIZATION || "0.9");
const npmCommand = "npm";
const tempRoot = await mkdtemp(join(tmpdir(), "memoire-pack-"));

try {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
  const includePaths = [
    "package.json",
    "package-lock.json",
    ...packageJson.files.filter((entry) => !entry.startsWith("!")),
  ];

  for (const entry of new Set(includePaths)) {
    await cp(resolve(root, entry), resolve(tempRoot, entry), {
      recursive: true,
      force: true,
      errorOnExist: false,
    }).catch((error) => {
      if (error?.code === "ENOENT") return;
      throw error;
    });
  }

  const pack = await run(npmCommand, ["pack", "--dry-run", "--ignore-scripts", "--json"], tempRoot);
  const payload = JSON.parse(pack.stdout);
  const summary = Array.isArray(payload) ? payload[0] : payload;
  const size = Number(summary?.size ?? 0);
  const unpackedSize = Number(summary?.unpackedSize ?? 0);
  const files = Array.isArray(summary?.files) ? summary.files.length : 0;
  const budget = evaluatePackageSizeBudget(
    { size, unpackedSize, files },
    { maxSizeBytes, maxUnpackedBytes, maxFiles, maxUtilization },
  );

  const result = {
    name: summary?.name ?? packageJson.name,
    version: summary?.version ?? packageJson.version,
    filename: summary?.filename ?? null,
    size,
    unpackedSize,
    files,
    ...budget,
  };

  console.log(JSON.stringify(result, null, 2));

  if (!result.passed) {
    console.error(result.reason);
    process.exitCode = 1;
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
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
