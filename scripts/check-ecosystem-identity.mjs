#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAndValidateEcosystemIdentity } from "./lib/ecosystem-identity.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { identity, identityPath, packageJson } = await loadAndValidateEcosystemIdentity(root);

console.log(`Public ecosystem identity is current for ${packageJson.name}@${identity.release.version}.`);
if (packageJson.version !== identity.release.version) {
  console.log(`- candidate package metadata: ${packageJson.version}`);
}
console.log(`- receipt: ${identityPath}`);
