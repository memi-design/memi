#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertConsumerGraph } from "./lib/consumer-boundary.mjs";
import { PRODUCTION_SHRINKWRAP_PATH } from "./lib/package-stage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const tempRoot = await mkdtemp(join(tmpdir(), "memi-production-shrinkwrap-"));

try {
  const productionManifest = {
    ...packageJson,
    devDependencies: undefined,
    optionalDependencies: undefined,
    peerDependencies: undefined,
    peerDependenciesMeta: undefined,
  };
  await writeFile(
    join(tempRoot, "package.json"),
    `${JSON.stringify(productionManifest, null, 2)}\n`,
    "utf8",
  );

  await runNpm([
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--omit=dev",
    "--omit=optional",
    "--no-audit",
    "--no-fund",
  ], tempRoot);

  const lock = JSON.parse(await readFile(join(tempRoot, "package-lock.json"), "utf8"));
  const rootPackage = lock.packages?.[""];
  if (!rootPackage) throw new Error("generated production lockfile is missing its root package");
  rootPackage.peerDependencies = packageJson.peerDependencies;
  rootPackage.peerDependenciesMeta = packageJson.peerDependenciesMeta;
  delete rootPackage.devDependencies;
  delete rootPackage.optionalDependencies;
  const graph = assertConsumerGraph(lock);

  const outputPath = join(root, PRODUCTION_SHRINKWRAP_PATH);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(lock, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({
    package: packageJson.name,
    version: packageJson.version,
    productionPackages: graph.packages,
    output: PRODUCTION_SHRINKWRAP_PATH,
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function runNpm(args, cwd) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, args, {
    cwd,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_ignore_scripts: "true",
      npm_config_update_notifier: "false",
    },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const code = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", resolveExit);
  });
  if (code !== 0) {
    throw new Error(`npm ${args.join(" ")} failed with ${code}\n${output}`);
  }
}
