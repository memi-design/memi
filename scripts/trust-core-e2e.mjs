#!/usr/bin/env node

import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCapabilityDenied,
  assertMetadataOnlyReceipt,
  createPackedInstallation,
  runProcess,
} from "./lib/trust-core-e2e.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));

try {
  const result = await runTrustCoreArtifactSuite(args);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function runTrustCoreArtifactSuite(options) {
  const installation = options.installedBinary
    ? { binary: resolve(options.installedBinary), version: options.version ?? "installed", cleanup: async () => {} }
    : await createPackedInstallation({
      artifact: options.artifact,
      packageRoot: options.packageRoot ?? repositoryRoot,
    });

  const fixtureRoot = await mkdtemp(join(tmpdir(), "memi-trust-runtime-"));
  const projectRoot = join(fixtureRoot, "project");
  const homeRoot = join(fixtureRoot, "home");
  const outsideRoot = join(fixtureRoot, "outside");
  const memiRoot = join(projectRoot, ".memi");
  const secret = "dualentry-trust-core-secret-canary";
  const prompt = "audit the unreleased private ledger canary";
  const sourceSnippet = `export const privateLedgerCanary = "${secret}";`;

  try {
    await Promise.all([
      mkdir(join(projectRoot, "src"), { recursive: true }),
      mkdir(homeRoot, { recursive: true }),
      mkdir(outsideRoot, { recursive: true }),
      mkdir(memiRoot, { recursive: true }),
    ]);
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({
      name: "trust-core-hostile-fixture",
      private: true,
    }), "utf8");
    await writeFile(join(projectRoot, "src", "private ledger 雪.tsx"), `${sourceSnippet}\n`, "utf8");
    await writeFile(join(homeRoot, ".private-canary"), secret, "utf8");
    await symlink(outsideRoot, join(memiRoot, "escape"), "dir");

    const baseEnv = lockedEnvironment(homeRoot, secret);
    const version = await timedInvocation(installation.binary, ["--version"], {
      cwd: projectRoot,
      env: baseEnv,
      budgetMs: 1_000,
      label: "memi --version cold start",
    });
    requireSuccess(version, "memi --version");

    await makeReadOnly(projectRoot);
    await makeReadOnly(homeRoot);
    const diagnosis = await timedInvocation(installation.binary, [
      "--profile", "locked",
      "diagnose", ".",
      "--json",
      "--no-write",
      "--fail-on", "none",
    ], {
      cwd: projectRoot,
      env: baseEnv,
      budgetMs: 5_000,
      label: "locked diagnose",
    });
    requireSuccess(diagnosis, "locked diagnose");

    const doctor = await runProcess(process.execPath, [
      installation.binary,
      "--profile", "locked",
      "doctor",
      "--json",
    ], {
      cwd: projectRoot,
      env: baseEnv,
      timeoutMs: 10_000,
    });
    requireSuccess(doctor, "locked doctor");
    const doctorPayload = JSON.parse(doctor.stdout);
    if (
      doctorPayload?.policy?.offlineInternalUse?.suitable !== true
      || doctorPayload?.policy?.offlineInternalUse?.requiresEmployerApproval !== true
      || !doctorPayload?.receipt
    ) {
      throw new Error("locked doctor did not report suitability, employer approval, and a receipt");
    }
    assertMetadataOnlyReceipt(JSON.stringify(doctorPayload.receipt), {
      secrets: [secret],
      privatePaths: [fixtureRoot, projectRoot, homeRoot],
      sourceSnippets: [sourceSnippet, "privateLedgerCanary"],
      prompts: [prompt],
    });

    const denials = [];
    for (const scenario of lockedDenialScenarios(prompt)) {
      const denied = await runProcess(process.execPath, [installation.binary, ...scenario.args], {
        cwd: projectRoot,
        env: baseEnv,
        timeoutMs: 5_000,
      });
      denials.push(assertCapabilityDenied(denied, scenario.expected));
    }

    await makeWritable(projectRoot);
    await makeWritable(homeRoot);
    const containment = await verifyLocalReceiptContainment({
      binary: installation.binary,
      env: baseEnv,
      memiRoot,
      projectRoot,
      outsideRoot,
    });

    const upgrade = options.container
      ? { checked: false, reason: "registry-free runtime container" }
      : await verifyExplicitUpgradePreservesConfig({
        artifact: installation.artifact,
        currentVersion: installation.version,
        homeRoot,
      });

    return {
      passed: true,
      artifactVersion: installation.version,
      mode: options.container ? "container" : "portable",
      performance: {
        versionMs: version.durationMs,
        lockedDiagnoseMs: diagnosis.durationMs,
      },
      denials: denials.map(({ operation, capability }) => ({ operation, capability })),
      containment,
      upgrade,
      environment: {
        networkExpected: "denied-by-policy",
        repository: "read-only-during-locked-diagnose",
        home: "read-only-during-locked-diagnose",
        subprocessPath: "empty",
      },
    };
  } finally {
    await makeWritable(projectRoot).catch(() => {});
    await makeWritable(homeRoot).catch(() => {});
    await rm(fixtureRoot, { recursive: true, force: true });
    await installation.cleanup();
  }
}

function lockedDenialScenarios(prompt) {
  return [
    {
      args: ["--profile", "locked", "setup", "--json"],
      expected: { operation: "validate setup credentials", capability: "network" },
    },
    {
      args: ["--profile", "locked", "self-update", "--json"],
      expected: { operation: "check npm for updates", capability: "network" },
    },
    {
      args: ["--profile", "locked", "notes", "install", "github:memi-design/example", "--json"],
      expected: { operation: "install a Memoire Note", capability: "project-write" },
    },
    {
      args: ["--profile", "locked", "compose", prompt, "--json"],
      expected: { operation: "run model composition", capability: "network" },
    },
    {
      args: ["--profile", "locked", "view", "Button", "--from", "@example/design"],
      expected: { operation: "open a registry URL", capability: "browser" },
    },
    {
      args: ["--profile", "locked", "connect", "--json"],
      expected: { operation: "connect to Figma", capability: "figma" },
    },
    {
      args: ["--profile", "locked", "agent", "install", "codex", "--json"],
      expected: { operation: "install agent integration files", capability: "dynamic-install" },
    },
  ];
}

async function verifyLocalReceiptContainment({ binary, env, memiRoot, projectRoot, outsideRoot }) {
  const receiptPath = join(memiRoot, "trust-receipt.json");
  const allowed = await runProcess(process.execPath, [
    binary,
    "--profile", "local",
    "--allow", "project-write",
    "--receipt", receiptPath,
    "diagnose", ".",
    "--json",
    "--no-write",
    "--fail-on", "none",
  ], { cwd: projectRoot, env, timeoutMs: 5_000 });
  requireSuccess(allowed, "local receipt write inside .memi");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  if (!receipt || typeof receipt !== "object") {
    throw new Error("local receipt output was not structured JSON");
  }

  const traversal = await runProcess(process.execPath, [
    binary,
    "--profile", "local",
    "--allow", "project-write",
    "--receipt", join(memiRoot, "..", "escaped.json"),
    "diagnose", ".",
    "--json",
    "--no-write",
    "--fail-on", "none",
  ], { cwd: projectRoot, env, timeoutMs: 5_000 });
  assertCapabilityDenied(traversal, { operation: "persist metadata receipt", capability: "project-write" });

  const symlinkEscape = await runProcess(process.execPath, [
    binary,
    "--profile", "local",
    "--allow", "project-write",
    "--receipt", join(memiRoot, "escape", "escaped.json"),
    "diagnose", ".",
    "--json",
    "--no-write",
    "--fail-on", "none",
  ], { cwd: projectRoot, env, timeoutMs: 5_000 });
  assertCapabilityDenied(symlinkEscape, { operation: "persist metadata receipt", capability: "project-write" });

  try {
    await readFile(join(outsideRoot, "escaped.json"), "utf8");
    throw new Error("local receipt followed a symlink outside .memi");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  return { insideMemoire: true, traversalDenied: true, symlinkDenied: true };
}

async function verifyExplicitUpgradePreservesConfig({ artifact, currentVersion, homeRoot }) {
  if (!artifact) {
    return { checked: false, reason: "preinstalled artifact did not expose its tarball" };
  }
  if (currentVersion === "2.7.9") {
    return { checked: false, reason: "candidate version still equals the 2.7.9 baseline" };
  }

  const consumer = await mkdtemp(join(tmpdir(), "memi-trust-upgrade-"));
  const configDir = join(homeRoot, ".memoire");
  const configPath = join(configDir, "config.json");
  const config = '{"company":"DualEntry","preserve":true}\n';
  const npm = process.env.npm_execpath
    ? { command: process.execPath, prefix: [process.env.npm_execpath] }
    : { command: process.platform === "win32" ? "npm.cmd" : "npm", prefix: [] };

  try {
    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, config, "utf8");
    await writeFile(join(consumer, "package.json"), '{"name":"memi-upgrade-contract","private":true}\n', "utf8");
    const env = { ...lockedEnvironment(homeRoot, ""), PATH: process.env.PATH ?? "" };
    for (const source of ["@memi-design/cli@2.7.9", artifact]) {
      const installed = await runProcess(npm.command, [
        ...npm.prefix,
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--save-exact",
        source,
      ], { cwd: consumer, env, timeoutMs: 180_000 });
      requireSuccess(installed, `explicit install ${source}`);
    }
    if (await readFile(configPath, "utf8") !== config) {
      throw new Error("explicit 2.7.9 upgrade overwrote the existing user configuration");
    }
    return { checked: true, from: "2.7.9", to: currentVersion, configPreserved: true };
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}

async function timedInvocation(binary, cliArgs, options) {
  const started = process.hrtime.bigint();
  const result = await runProcess(process.execPath, [binary, ...cliArgs], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: Math.max(options.budgetMs * 2, 2_000),
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  if (durationMs > options.budgetMs) {
    throw new Error(`${options.label} took ${durationMs.toFixed(1)}ms; budget is ${options.budgetMs}ms`);
  }
  return { ...result, durationMs: Number(durationMs.toFixed(1)) };
}

function lockedEnvironment(home, secret) {
  const temp = tmpdir();
  return {
    CI: "1",
    HOME: home,
    USERPROFILE: home,
    PATH: "",
    TMPDIR: temp,
    TEMP: temp,
    TMP: temp,
    MEMI_TELEMETRY_DISABLED: "1",
    MEMI_TRUST_SECRET_CANARY: secret,
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "",
    npm_config_update_notifier: "false",
  };
}

async function makeReadOnly(path) {
  if (process.platform !== "win32") await setTreeMode(path, 0o555, 0o444);
}

async function makeWritable(path) {
  if (process.platform !== "win32") await setTreeMode(path, 0o755, 0o644);
}

async function setTreeMode(path, directoryMode, fileMode) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) return;
  if (!metadata.isDirectory()) {
    await chmod(path, fileMode);
    return;
  }

  // Make the directory traversable before recursing during cleanup, then
  // apply the requested final mode after its children have been updated.
  await chmod(path, 0o755);
  for (const name of await readdir(path)) {
    await setTreeMode(join(path, name), directoryMode, fileMode);
  }
  await chmod(path, directoryMode);
}

function requireSuccess(result, label) {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit ${result.exitCode}: ${result.stderr || result.stdout}`);
  }
}

function parseArgs(argv) {
  const options = { portable: false, container: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--portable") options.portable = true;
    else if (arg === "--container") options.container = true;
    else if (arg === "--artifact") options.artifact = requiredValue(argv, ++index, arg);
    else if (arg === "--installed-binary") options.installedBinary = requiredValue(argv, ++index, arg);
    else if (arg === "--package-root") options.packageRoot = requiredValue(argv, ++index, arg);
    else if (arg === "--version") options.version = requiredValue(argv, ++index, arg);
    else throw new Error(`Unknown Trust Core E2E option: ${arg}`);
  }
  if (options.portable && options.container) {
    throw new Error("Choose exactly one of --portable or --container");
  }
  if (!options.portable && !options.container) options.portable = true;
  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}
