#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildWebReleaseArtifact,
  loadReleaseManifest,
  resolveReleaseRecordPath,
  resolveManifestSourceCommit,
  serializeJson,
  stagePublishedEngineManifest,
  verifyCoreReleaseSurfaces,
  verifyPublishedEngineTransitionFromGit,
  verifyPublishedStagingPreconditionsFromGit,
} from "./lib/release-manifest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const stageIndex = process.argv.indexOf("--stage-published");
let manifest = await loadReleaseManifest(root);
const artifactPath = join(root, "release-artifacts", "memoire-web.release.json");

if (stageIndex >= 0) {
  const requestedPath = process.argv[stageIndex + 1];
  if (!requestedPath) throw new Error("--stage-published requires a release record path");
  const absoluteRecordPath = await resolveReleaseRecordPath(root, requestedPath);
  const recordPath = relative(root, absoluteRecordPath);
  const releaseRecordBytes = await readFile(absoluteRecordPath, "utf8");
  const releaseRecord = JSON.parse(releaseRecordBytes);
  const stagingFailures = verifyPublishedStagingPreconditionsFromGit(
    root,
    manifest,
    releaseRecord,
  );
  if (stagingFailures.length > 0) {
    throw new Error(`Cannot stage published release:\n- ${stagingFailures.join("\n- ")}`);
  }
  manifest = stagePublishedEngineManifest({
    manifest,
    releaseRecord,
    releaseRecordPath: recordPath,
    releaseRecordBytes,
    updatedAt: new Date().toISOString().slice(0, 10),
  });
  await writeFile(join(root, "release-manifest.json"), serializeJson(manifest), "utf8");
  console.log(
    `Staged published manifest bound to ${recordPath} (${createHash("sha256").update(releaseRecordBytes).digest("hex")}).`,
  );
  console.log("Commit release-manifest.json, then regenerate derived artifacts and run the live public gate.");
  process.exit(0);
}

if (!checkOnly) {
  const sourceCommit = resolveManifestSourceCommit(root, manifest);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(
    artifactPath,
    serializeJson(buildWebReleaseArtifact(manifest, sourceCommit)),
    "utf8",
  );
}

const failures = await verifyCoreReleaseSurfaces(root, manifest);
failures.push(...await verifyPublishedEngineTransitionFromGit(root, manifest));
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
