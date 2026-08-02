#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAndValidateEcosystemIdentity } from "./lib/ecosystem-identity.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { identityPath, packageJson } = await loadAndValidateEcosystemIdentity(root);

console.log(`Ecosystem identity is current for ${packageJson.name}@${packageJson.version}.`);
console.log(`- receipt: ${identityPath}`);
