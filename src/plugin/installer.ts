import { cp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ensureBridgeCapability,
  injectBridgeCapability,
} from "../security/bridge-capability.js";
import { getExecutionPolicy, type MemiExecutionPolicy } from "../security/execution-policy.js";

export interface PluginInstallResult {
  status: "installed";
  source: string;
  destination: string;
  manifestPath: string;
  sourcePackageVersion: string | null;
  widgetVersion: string | null;
  bundleHash: string | null;
}

export async function installPluginToHome(
  projectRoot: string,
  homeDir = defaultHomeDir(),
  policy: MemiExecutionPolicy = getExecutionPolicy(),
): Promise<PluginInstallResult> {
  if (!homeDir) {
    throw new Error("Cannot install the Figma plugin because HOME/USERPROFILE is not set.");
  }

  const pluginSrc = resolve(projectRoot, "plugin");
  const pluginDest = join(homeDir, ".memoire", "plugin");
  const resolvedPluginSrc = await realpath(pluginSrc);

  await policy.runHomeWrite(pluginDest, "install the Figma plugin", async (safePluginDest) => {
    await rm(safePluginDest, { recursive: true, force: true });
    await cp(resolvedPluginSrc, safePluginDest, {
      recursive: true,
      dereference: true,
      force: true,
    });
  });

  const capability = await ensureBridgeCapability(homeDir, policy);
  const installedUiPath = join(pluginDest, "ui.html");
  const installedUi = await readFile(installedUiPath, "utf-8");
  await policy.runHomeWrite(installedUiPath, "inject the Figma bridge capability", async (safeInstalledUiPath) => {
    await writeFile(
      safeInstalledUiPath,
      injectBridgeCapability(installedUi, capability),
      { encoding: "utf-8", mode: 0o600 },
    );
  });

  const widgetMeta = await readWidgetMeta(join(pluginDest, "widget-meta.json"));
  const installMetaPath = join(pluginDest, "install-meta.json");
  await policy.runHomeWrite(installMetaPath, "persist Figma plugin install metadata", async (safeInstallMetaPath) => {
    await writeFile(
      safeInstallMetaPath,
      JSON.stringify({
        installedAt: new Date().toISOString(),
        sourcePackageVersion: widgetMeta?.packageVersion ?? null,
        widgetVersion: widgetMeta?.widgetVersion ?? null,
        bundleHash: widgetMeta?.bundleHash ?? null,
        sourcePath: resolvedPluginSrc,
      }, null, 2) + "\n",
      "utf-8",
    );
  });

  return {
    status: "installed",
    source: resolvedPluginSrc,
    destination: pluginDest,
    manifestPath: join(pluginDest, "manifest.json"),
    sourcePackageVersion: widgetMeta?.packageVersion ?? null,
    widgetVersion: widgetMeta?.widgetVersion ?? null,
    bundleHash: widgetMeta?.bundleHash ?? null,
  };
}

async function readWidgetMeta(path: string): Promise<Record<string, string> | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as Record<string, string>;
  } catch {
    return null;
  }
}

function defaultHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "";
}
