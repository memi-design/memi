import { spawn } from "node:child_process";
import { access, cp, readdir, rm, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildPluginBundle } from "./build-plugin.mjs";
import { syncChangelogPreview } from "./build-changelog-preview.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist");
const tscBin = resolve(root, "node_modules", "typescript", "bin", "tsc");
const buildInfo = resolve(root, "tsconfig.build.tsbuildinfo");
const tsxBin = resolve(root, "node_modules", "tsx", "dist", "cli.mjs");
const runtimeSchemaScript = resolve(root, "scripts", "build-runtime-schema.ts");

const distExists = await pathExists(distDir);
if (!distExists) {
  await rm(buildInfo, { force: true });
} else {
  await removeMapFiles(distDir);
}

const exitCode = await new Promise((resolveExit, reject) => {
  const child = spawn(
    process.execPath,
    [tscBin, "-p", resolve(root, "tsconfig.build.json"), "--pretty", "false"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );

  child.on("error", reject);
  child.on("exit", (code) => resolveExit(code ?? 1));
});

if (exitCode !== 0) process.exit(exitCode);

const runtimeSchemaExitCode = await new Promise((resolveExit, reject) => {
  const child = spawn(process.execPath, [tsxBin, runtimeSchemaScript], {
    cwd: root,
    stdio: "inherit",
  });
  child.on("error", reject);
  child.on("exit", (code) => resolveExit(code ?? 1));
});
if (runtimeSchemaExitCode !== 0) process.exit(runtimeSchemaExitCode);

// The Studio React frontend lives at github.com/memi-design/memi-studio
// and is built independently. It is no longer built or packaged from here.

// Copy non-TS assets that tsc doesn't handle (CSS, client JS, HTML, shared manifests)
const templateSrc = resolve(root, "src", "preview", "templates");
const templateDist = resolve(distDir, "preview", "templates");
await mkdir(templateDist, { recursive: true });

const assetExtensions = [".css", ".js", ".html"];
const templateFiles = await readdir(templateSrc);
await Promise.all(
  templateFiles
    .filter((f) => assetExtensions.some((ext) => f.endsWith(ext)))
    .map((f) => copyFile(join(templateSrc, f), join(templateDist, f))),
);

await mkdir(resolve(distDir, "studio"), { recursive: true });
await copyFile(
  resolve(root, "src", "studio", "harness-manifest.json"),
  resolve(distDir, "studio", "harness-manifest.json"),
);

await buildPluginBundle({ rootDir: root, outDir: resolve(root, "plugin") });
await syncChangelogPreview({
  changelogPath: resolve(root, "CHANGELOG.md"),
  outputPath: resolve(root, "preview", "changelog.html"),
});
await bundlePublishedRuntime(distDir);

process.exit(0);

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}


async function removeMapFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeMapFiles(fullPath);
      return;
    }

    if (entry.name.endsWith(".map")) {
      await rm(fullPath, { force: true });
    }
  }));
}

async function bundlePublishedRuntime(dir) {
  const stage = resolve(root, ".dist", "npm-runtime");
  const bundlePath = join(stage, "index.js");
  const launcherPath = join(stage, "bin.js");
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const packageVersion = String(packageJson.version ?? "");
  if (!packageVersion) {
    throw new Error("package.json version is required to build the CLI launcher");
  }
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await copyFile(join(dir, "index.d.ts"), join(stage, "index.d.ts"));
  const previewAssets = (await readdir(templateSrc))
    .filter((file) => file.endsWith(".css") || file.endsWith(".client.js"));
  await mkdir(join(stage, "preview", "templates"), { recursive: true });
  await Promise.all(previewAssets.map((file) => copyFile(
    join(templateSrc, file),
    join(stage, "preview", "templates", file),
  )));
  await mkdir(join(stage, "studio"), { recursive: true });
  await copyFile(
    join(dir, "studio", "harness-manifest.json"),
    join(stage, "studio", "harness-manifest.json"),
  );
  await build({
    entryPoints: [resolve(root, "src", "index.ts")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    packages: "external",
    format: "esm",
    target: "node20",
    minify: true,
  });
  await build({
    entryPoints: [resolve(root, "src", "bin.ts")],
    outfile: launcherPath,
    bundle: false,
    platform: "node",
    format: "esm",
    target: "node20",
    minify: true,
    define: {
      __MEMI_PACKAGE_VERSION__: JSON.stringify(packageVersion),
    },
  });
  await rm(dir, { recursive: true, force: true });
  await cp(stage, dir, { recursive: true });
}
