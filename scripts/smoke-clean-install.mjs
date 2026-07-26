#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCleanInstallSmoke } from "./lib/clean-install.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const result = await runCleanInstallSmoke({ packageRoot });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
