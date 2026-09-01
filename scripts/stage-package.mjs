#!/usr/bin/env node

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stagePackage } from "./lib/package-stage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = await stagePackage({
  packageRoot: root,
  stageRoot: join(root, ".dist", "npm-package"),
});

console.log(JSON.stringify({
  package: result.packageJson.name,
  version: result.packageJson.version,
  productionPackages: result.productionPackages,
  stageRoot: result.stageRoot,
}, null, 2));
