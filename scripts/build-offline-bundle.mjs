#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OFFLINE_TARGETS,
  buildOfflineBundle,
  resolveOfflineTarget,
} from "./lib/offline-bundle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));

try {
  const target = resolveOfflineTarget(args.target);
  const result = await buildOfflineBundle({
    root,
    target: target.id,
    binaryStageDir: args.binaryStage
      ? resolve(root, args.binaryStage)
      : join(root, "dist-bin", `memi-${target.binaryStageTarget}`),
    outputDir: args.output ? resolve(root, args.output) : join(root, "dist-bin"),
    sourceDateEpoch: args.sourceDateEpoch ?? process.env.SOURCE_DATE_EPOCH ?? 0,
  });
  console.log(JSON.stringify({
    archive: result.archivePath,
    checksum: result.checksumPath,
    sha256: result.archiveSha256,
    target: result.target.id,
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseArguments(argv) {
  const result = {};
  for (const argument of argv) {
    const [name, value] = argument.split("=", 2);
    if (name === "--target" && value) result.target = value;
    else if (name === "--binary-stage" && value) result.binaryStage = value;
    else if (name === "--output" && value) result.output = value;
    else if (name === "--source-date-epoch" && value) result.sourceDateEpoch = value;
    else throw new Error(
      `Usage: build-offline-bundle.mjs --target=<${Object.keys(OFFLINE_TARGETS).join("|")}>`,
    );
  }
  if (!result.target) {
    throw new Error(
      `Usage: build-offline-bundle.mjs --target=<${Object.keys(OFFLINE_TARGETS).join("|")}>`,
    );
  }
  return result;
}
