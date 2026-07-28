#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const communityRoot = resolve(
  root,
  process.env.MEMOIRE_COMMUNITY_NOTES_ROOT
    ?? "../design-skills",
);
const notesRoot = join(communityRoot, "skills");
if (!existsSync(notesRoot)) {
  console.error(`Design Skills checkout is required at ${notesRoot}. Set MEMOIRE_COMMUNITY_NOTES_ROOT to its repository root.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  join(root, "scripts", "build-notes-catalog.mjs"),
  "--notes-root", notesRoot,
  "--out-root", join(root, "examples", "site-bundle", "notes", "community"),
  "--base-url", process.env.MEMOIRE_COMMUNITY_NOTES_BASE_URL ?? "https://www.memoire.cv/notes/community",
  "--source-kind", "community",
  "--source-repo", "https://github.com/memi-design/design-skills",
  "--contribution-base-url", "https://github.com/memi-design/design-skills/tree/main/skills",
  "--review-status", "approved",
  "--page-base-path", "/notes/community",
], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
