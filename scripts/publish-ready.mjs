#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stagePackage } from "./lib/package-stage.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = process.env.NPM_CONFIG_REGISTRY || "https://registry.npmjs.org/";
const skipAuth = process.env.MEMOIRE_PUBLISH_READY_SKIP_AUTH === "1";
const skipGit = process.env.MEMOIRE_PUBLISH_READY_SKIP_GIT === "1";
const expectedNpmUser = process.env.MEMOIRE_EXPECTED_NPM_USER || "sarveshsea";
const failures = [];
const notes = [];

const packageJson = await readJson("package.json");
const serverJson = await readJson("server.json");

check(packageJson.name === "@memi-design/cli", `package name is ${packageJson.name}`);
check(packageJson.version === serverJson.version, `server.json version ${serverJson.version} does not match package.json ${packageJson.version}`);
check(packageJson.mcpName === "io.github.memi-design/memi", `package.json mcpName is ${packageJson.mcpName}`);
check(serverJson.name === packageJson.mcpName, `server.json name ${serverJson.name} does not match package.json mcpName ${packageJson.mcpName}`);
for (const lifecycle of ["preinstall", "install", "postinstall", "prepare"]) {
  check(!packageJson.scripts?.[lifecycle], `package.json must not define npm lifecycle script "${lifecycle}" for the public package`);
}
for (const unsafeFile of ["scripts/postinstall.mjs", "scripts/prepare.mjs"]) {
  check(!packageJson.files?.includes(unsafeFile), `package.json files must not ship lifecycle helper ${unsafeFile}`);
}

const npmPackage = serverJson.packages?.find((entry) => entry.registryType === "npm");
check(!!npmPackage, "server.json is missing npm package entry");
if (npmPackage) {
  check(npmPackage.identifier === packageJson.name, `server.json npm identifier is ${npmPackage.identifier}`);
  check(npmPackage.version === packageJson.version, `server.json npm version ${npmPackage.version} does not match package.json ${packageJson.version}`);
  check(npmPackage.transport?.type === "stdio", "server.json npm transport must be stdio");
  const packageArgs = (npmPackage.packageArguments ?? [])
    .filter((arg) => arg.type === "positional")
    .map((arg) => arg.value);
  const expectedArgs = ["mcp", "start", "--no-figma"];
  check(JSON.stringify(packageArgs) === JSON.stringify(expectedArgs), `server.json npm package must use registry-safe MCP args ${expectedArgs.join(" ")}; got ${packageArgs.join(" ")}`);
}

if (!skipGit && await hasGitRepository()) {
  const status = run("git", ["status", "--short"]);
  check(status.ok, status.stderr || "git status failed");
  if (status.ok) {
    const dirtyLines = status.stdout.trim().split("\n").filter(Boolean);
    check(dirtyLines.length === 0, `git worktree is dirty:\n${dirtyLines.join("\n")}`);
  }
}

if (!skipAuth) {
  const whoami = run("npm", ["whoami", `--registry=${registry}`]);
  if (!whoami.ok) {
    check(false, [
      "npm is not logged in as the package owner.",
      "Run `npm logout --registry=https://registry.npmjs.org/` then `npm login --auth-type=web --registry=https://registry.npmjs.org/`.",
      "If `npm publish` returns E404 on PUT for @memi-design/cli, you are logged into the wrong npm account or using an invalid token for the @sarveshsea scope.",
    ].join(" "));
  } else {
    const user = whoami.stdout.trim();
    check(user === expectedNpmUser, `npm user is ${user}, expected ${expectedNpmUser}; publishing as another account can produce E404 on PUT for @memi-design/cli.`);
    notes.push(`npm user: ${user}`);
  }
}

const latest = run("npm", ["view", packageJson.name, "version", "mcpName", "--json", `--registry=${registry}`]);
if (latest.ok) {
  const metadata = parseNpmView(latest.stdout);
  if (metadata.version) {
    check(compareVersions(packageJson.version, metadata.version) > 0, `package.json version ${packageJson.version} is not newer than npm latest ${metadata.version}`);
    notes.push(`npm latest: ${metadata.version}`);
  }
  if (metadata.mcpName) {
    notes.push(`npm mcpName: ${metadata.mcpName}`);
  }
} else if (!/E404|404/.test(latest.stderr)) {
  check(false, latest.stderr || "npm view failed");
}

const packageStage = await stagePackage({
  packageRoot: root,
  stageRoot: join(root, ".dist", "npm-package"),
});
const pack = run(
  "npm",
  ["pack", "--dry-run", "--ignore-scripts", "--json"],
  packageStage.stageRoot,
);
check(pack.ok, pack.stderr || "npm pack dry-run failed");
if (pack.ok) {
  const payload = JSON.parse(pack.stdout);
  const summary = Array.isArray(payload) ? payload[0] : payload;
  const files = Array.isArray(summary.files) ? summary.files.map((file) => file.path) : [];
  check(summary.version === packageJson.version, `pack version ${summary.version} does not match package.json ${packageJson.version}`);
  check(files.includes("server.json"), "npm pack is missing server.json");
  check(files.includes("package.json"), "npm pack is missing package.json");
  check(files.includes("dist/bin.js"), "npm pack is missing dist/bin.js; run `npm run build`");
  check(files.includes("dist/index.js"), "npm pack is missing dist/index.js; run `npm run build`");
  notes.push(`pack: ${summary.filename} (${summary.size} bytes, ${files.length} files)`);
}

const audit = run("npm", ["audit", "--omit=dev", "--omit=optional", "--audit-level=low", "--json"]);
check(audit.ok, audit.stderr.trim() || audit.stdout.trim() || "production npm audit failed");
if (audit.ok) notes.push("prod audit: zero known vulnerabilities");

const smoke = run(process.execPath, [join(root, "scripts", "smoke-mcp-stdio.mjs")]);
check(smoke.ok, smoke.stderr.trim() || smoke.stdout.trim() || "MCP stdio smoke check failed");
if (smoke.ok) notes.push(smoke.stdout.trim());

if (failures.length > 0) {
  console.error("\nMemoire publish readiness failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("");
  process.exit(1);
}

console.log(`Memoire ${packageJson.version} is ready to publish.`);
for (const note of notes) console.log(`- ${note}`);
console.log("\nNext:");
console.log("  npm publish --access public --auth-type=web");
console.log("  npm view @memi-design/cli version dist-tags.latest mcpName --json");
console.log("  mcp-publisher publish server.json");

async function readJson(path) {
  return JSON.parse(await readFile(join(root, path), "utf-8"));
}

async function hasGitRepository() {
  const result = run("git", ["rev-parse", "--is-inside-work-tree"]);
  return result.ok && result.stdout.trim() === "true";
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      npm_config_ignore_scripts: "true",
    },
    maxBuffer: 1024 * 1024 * 5,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseNpmView(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (typeof parsed === "string") return { version: parsed };
  return parsed && typeof parsed === "object" ? parsed : {};
}

function compareVersions(a, b) {
  const left = a.split(".").map((part) => Number.parseInt(part, 10));
  const right = b.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}
