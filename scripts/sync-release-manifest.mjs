#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildWebReleaseArtifact,
  loadReleaseManifest,
  resolveManifestSourceCommit,
  serializeJson,
  verifyCoreReleaseSurfaces,
} from "./lib/release-manifest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const manifest = await loadReleaseManifest(root);
const sourceCommit = resolveManifestSourceCommit(root, manifest);
const artifactPath = join(root, "release-artifacts", "memoire-web.release.json");

if (!checkOnly) {
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(
    artifactPath,
    serializeJson(buildWebReleaseArtifact(manifest, sourceCommit)),
    "utf8",
  );
}

const failures = await verifyCoreReleaseSurfaces(root, manifest);
if (failures.length > 0) {
  console.error("Release manifest check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  checkOnly
    ? "Release manifest and derived surfaces are in sync."
    : "Generated website release artifact and verified all release surfaces.",
);
