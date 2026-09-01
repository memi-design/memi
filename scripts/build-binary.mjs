#!/usr/bin/env node
/**
 * Build a standalone Mémoire binary via `bun build --compile`, bundle it with
 * sidecar assets (skills, notes, plugin, preview templates, package.json),
 * and package as a tarball (or zip on Windows) for GitHub Releases.
 *
 * Usage:
 *   node scripts/build-binary.mjs --target=darwin-arm64
 *   node scripts/build-binary.mjs --target=darwin-x64
 *   node scripts/build-binary.mjs --target=linux-arm64
 *   node scripts/build-binary.mjs --target=linux-x64
 *   node scripts/build-binary.mjs --target=win-x64
 *
 * Requires: `bun` on PATH (https://bun.sh). CI installs via oven-sh/setup-bun@v2.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, rm, readFile, writeFile, access, appendFile } from "node:fs/promises";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = {
  "darwin-arm64": { bunTarget: "bun-darwin-arm64", ext: "", archive: "tar.gz" },
  "darwin-x64":   { bunTarget: "bun-darwin-x64",   ext: "", archive: "tar.gz" },
  "linux-arm64":  { bunTarget: "bun-linux-arm64",  ext: "", archive: "tar.gz" },
  "linux-x64":    { bunTarget: "bun-linux-x64",    ext: "", archive: "tar.gz" },
  "win-x64":      { bunTarget: "bun-windows-x64",  ext: ".exe", archive: "zip" },
};

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith("--"))
    .map(a => {
      const [k, v = "true"] = a.replace(/^--/, "").split("=");
      return [k, v];
    }),
);

const targetKey = args.target;
if (!targetKey || !TARGETS[targetKey]) {
  console.error(`Usage: build-binary.mjs --target=<${Object.keys(TARGETS).join("|")}>`);
  process.exit(1);
}

const { bunTarget, ext, archive } = TARGETS[targetKey];
const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf-8"));
const version = pkg.version;

const stageDir = join(ROOT, "dist-bin", `memi-${targetKey}`);
const binaryName = `memi${ext}`;
const binaryPath = join(stageDir, binaryName);

console.log(`▸ Building memi v${version} for ${targetKey} (${bunTarget})`);

await rm(stageDir, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });

// 1. Compile the CLI entry to a single executable.
const bunResult = spawnSync(
  "bun",
  [
    "build",
    "--compile",
    `--target=${bunTarget}`,
    "--minify",
    `--outfile=${binaryPath}`,
    "src/index.ts",
  ],
  { cwd: ROOT, stdio: "inherit" },
);

if (bunResult.status !== 0) {
  console.error("bun build --compile failed");
  process.exit(bunResult.status ?? 1);
}

// 2. Copy sidecar assets — required at runtime by packageRoot() in compiled mode.
const sidecars = [
  "skills",
  "notes",
  "plugin",
  "preview/templates",
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
];

for (const rel of sidecars) {
  const src = join(ROOT, rel);
  if (!(await exists(src))) {
    console.warn(`  (skip) ${rel} — not present`);
    continue;
  }
  const dst = join(stageDir, rel);
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst, { recursive: true });
  console.log(`  + ${rel}`);
}

// 3. Drop an install-info.txt so users know what they've got.
await writeFile(
  join(stageDir, "install-info.txt"),
  [
    `Mémoire ${version} — standalone binary`,
    `Target: ${targetKey}`,
    `Built: ${new Date().toISOString()}`,
    ``,
    `Usage:`,
    `  ./memi connect        Pair with Figma plugin`,
    `  ./memi --help         Show all commands`,
    ``,
    `The 'skills/', 'notes/', 'plugin/', 'preview/' directories must stay`,
    `next to this binary — memi reads them at runtime.`,
    ``,
  ].join("\n"),
);

// 4. Archive the staging directory.
const archiveName = `memi-${targetKey}.${archive}`;
const archivePath = join(ROOT, "dist-bin", archiveName);
await rm(archivePath, { force: true });

console.log(`▸ Packing ${archiveName}`);
const archiveSource = `memi-${targetKey}`;
const archiveCwd = join(ROOT, "dist-bin");
let archiveResult;

if (archive === "zip" && process.platform === "win32") {
  archiveResult = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      "Compress-Archive -Path $env:MEMOIRE_ARCHIVE_SOURCE -DestinationPath $env:MEMOIRE_ARCHIVE_DESTINATION -Force",
    ],
    {
      cwd: archiveCwd,
      stdio: "inherit",
      env: {
        ...process.env,
        MEMOIRE_ARCHIVE_SOURCE: archiveSource,
        MEMOIRE_ARCHIVE_DESTINATION: archivePath,
      },
    },
  );
} else {
  archiveResult = archive === "zip"
    ? spawnSync("zip", ["-r", archivePath, archiveSource], {
        cwd: archiveCwd,
        stdio: "inherit",
      })
    : spawnSync("tar", ["-czf", archivePath, archiveSource], {
        cwd: archiveCwd,
        stdio: "inherit",
      });
}

if (archiveResult.status !== 0) {
  if (archiveResult.error) {
    console.error(archiveResult.error.message);
  }
  console.error("archive step failed");
  process.exit(archiveResult.status ?? 1);
}

// 5. Emit SHA256 alongside the archive and append to SHA256SUMS.txt.
const archiveBuf = await readFile(archivePath);
const sha = createHash("sha256").update(archiveBuf).digest("hex");
const sumsLine = `${sha}  ${basename(archivePath)}\n`;
await writeFile(`${archivePath}.sha256`, sumsLine);
await appendFile(join(ROOT, "dist-bin", "SHA256SUMS.txt"), sumsLine);

console.log(`✓ ${archivePath}`);
console.log(`  sha256: ${sha}`);

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}
