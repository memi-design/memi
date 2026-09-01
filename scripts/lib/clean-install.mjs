import { spawn } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { assertConsumerGraph } from "./consumer-boundary.mjs";
import { stagePackage } from "./package-stage.mjs";

export { assertConsumerGraph } from "./consumer-boundary.mjs";

export const MAX_INSTALL_BYTES = 60_000_000;

export function npmExecutable(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function parsePackResult(stdout) {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error("npm pack returned invalid JSON");
  }

  const result = Array.isArray(payload) ? payload[0] : payload;
  if (!result?.filename || typeof result.filename !== "string") {
    throw new Error("npm pack did not report an artifact");
  }
  return result;
}

export function assertExpectedVersion(stdout, expectedVersion) {
  const installedVersion = stdout.trim();
  if (installedVersion !== expectedVersion) {
    throw new Error(
      `installed memi reported ${installedVersion || "<empty>"}; expected ${expectedVersion}`,
    );
  }
  return installedVersion;
}

export function assertProductionAudit(stdout) {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error("npm audit returned invalid JSON for the packed consumer graph");
  }
  const vulnerabilities = payload?.metadata?.vulnerabilities ?? {};
  const severities = ["info", "low", "moderate", "high", "critical"];
  const counts = Object.fromEntries(
    severities.map((severity) => [severity, Number(vulnerabilities[severity] ?? 0)]),
  );
  if (Object.values(counts).some((count) => !Number.isInteger(count) || count < 0)) {
    throw new Error("npm audit omitted packed consumer vulnerability counts");
  }
  const { high, critical } = counts;
  const total = severities.reduce((sum, severity) => sum + counts[severity], 0);
  if (high > 0 || critical > 0) {
    throw new Error(`packed consumer graph has ${high} high and ${critical} critical advisories`);
  }
  if (total > 0) {
    throw new Error(
      `packed consumer graph has ${total} known production ${total === 1 ? "advisory" : "advisories"}`,
    );
  }
  return { high, critical };
}

export function assertInstallFootprint(bytes, maxBytes = MAX_INSTALL_BYTES) {
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw new Error("clean install footprint bytes must be a non-negative integer");
  }
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("clean install footprint maxBytes must be a positive integer");
  }
  if (bytes > maxBytes) {
    throw new Error(`clean install footprint ${bytes} bytes exceeds ${maxBytes} bytes`);
  }
  return { bytes, maxBytes, passed: true };
}

export function packageInstallPaths(consumerRoot, packageName, binaryTarget) {
  if (
    !/^(@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(packageName)
    || isAbsolute(binaryTarget)
    || normalize(binaryTarget).split(sep).includes("..")
  ) {
    throw new Error("package name and binary target must be safe relative paths");
  }

  const packageRoot = join(consumerRoot, "node_modules", ...packageName.split("/"));
  const binaryEntry = join(packageRoot, binaryTarget);
  if (relative(packageRoot, binaryEntry).startsWith("..")) {
    throw new Error("installed binary target escapes the package root");
  }
  return { packageRoot, binaryEntry };
}

export async function runCleanInstallSmoke({
  packageRoot = process.cwd(),
  platform = process.platform,
  nodeExecutable = process.execPath,
  npmExecPath = process.env.npm_execpath,
  run = runCommand,
} = {}) {
  const absolutePackageRoot = resolve(packageRoot);
  const packageJson = JSON.parse(
    await readFile(join(absolutePackageRoot, "package.json"), "utf8"),
  );
  const expectedVersion = String(packageJson.version ?? "");
  const packageName = String(packageJson.name ?? "");
  if (!expectedVersion || !packageName) {
    throw new Error("package.json must declare name and version");
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "memi-clean-install-"));
  const consumerRoot = join(tempRoot, "consumer");
  const npm = npmExecPath
    ? { command: nodeExecutable, prefixArgs: [npmExecPath], shell: false }
    : {
        command: npmExecutable(platform),
        prefixArgs: [],
        shell: platform === "win32",
      };
  const scriptsDisabledEnv = {
    ...process.env,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_ignore_scripts: "true",
    npm_config_update_notifier: "false",
  };

  try {
    const packageStage = join(tempRoot, "package");
    await stagePackage({
      packageRoot: absolutePackageRoot,
      stageRoot: packageStage,
    });
    await mkdir(consumerRoot, { recursive: true });
    await writeFile(
      join(consumerRoot, "package.json"),
      `${JSON.stringify({ name: "memi-clean-install-consumer", private: true }, null, 2)}\n`,
      "utf8",
    );

    const pack = await run(
      npm.command,
      [
        ...npm.prefixArgs,
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        tempRoot,
      ],
      {
        cwd: packageStage,
        env: scriptsDisabledEnv,
        shell: npm.shell,
      },
    );
    const packed = parsePackResult(pack.stdout);
    const artifact = join(tempRoot, packed.filename);
    await access(artifact);

    await run(
      npm.command,
      [
        ...npm.prefixArgs,
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--save-exact",
        artifact,
      ],
      {
        cwd: consumerRoot,
        env: scriptsDisabledEnv,
        shell: npm.shell,
      },
    );

    const auditResult = await run(
      npm.command,
      [
        ...npm.prefixArgs,
        "audit",
        "--omit=dev",
        "--omit=optional",
        "--audit-level=low",
        "--json",
      ],
      {
        cwd: consumerRoot,
        env: scriptsDisabledEnv,
        shell: npm.shell,
      },
    );
    const productionAudit = assertProductionAudit(auditResult.stdout);

    const installedPackageJsonPath = join(
      consumerRoot,
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    );
    const installedPackageJson = JSON.parse(
      await readFile(installedPackageJsonPath, "utf8"),
    );
    const consumerLock = JSON.parse(
      await readFile(join(consumerRoot, "package-lock.json"), "utf8"),
    );
    const consumerGraph = assertConsumerGraph(consumerLock);
    const installFootprint = assertInstallFootprint(
      await directorySize(join(consumerRoot, "node_modules")),
    );
    const binaryTarget =
      typeof installedPackageJson.bin === "string"
        ? installedPackageJson.bin
        : installedPackageJson.bin?.memi;
    if (typeof binaryTarget !== "string") {
      throw new Error("installed package does not declare the memi binary");
    }

    const paths = packageInstallPaths(consumerRoot, packageName, binaryTarget);
    await access(paths.binaryEntry);
    const versionResult = await run(
      nodeExecutable,
      [paths.binaryEntry, "--version"],
      {
        cwd: consumerRoot,
        env: scriptsDisabledEnv,
        shell: false,
      },
    );
    const installedVersion = assertExpectedVersion(
      versionResult.stdout,
      expectedVersion,
    );

    return {
      package: packageName,
      expectedVersion,
      installedVersion,
      artifact: packed.filename,
      nodeVersion: process.version,
      platform,
      scriptsDisabled: true,
      productionAudit,
      consumerGraph,
      installFootprint,
      passed: true,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function directorySize(path) {
  const entries = await readdir(path, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      bytes += await directorySize(entryPath);
      continue;
    }
    const stats = await lstat(entryPath);
    bytes += stats.size;
  }
  return bytes;
}

async function runCommand(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    shell: options.shell,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const result = await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      rejectPromise(
        new Error(
          `${command} ${args.join(" ")} failed with ${code ?? signal}\n${stderr || stdout}`,
        ),
      );
    });
  });
  return result;
}
