import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

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
        cwd: absolutePackageRoot,
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
        "--no-package-lock",
        "--save-exact",
        artifact,
      ],
      {
        cwd: consumerRoot,
        env: scriptsDisabledEnv,
        shell: npm.shell,
      },
    );

    const installedPackageJsonPath = join(
      consumerRoot,
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    );
    const installedPackageJson = JSON.parse(
      await readFile(installedPackageJsonPath, "utf8"),
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
      passed: true,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
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
