import { randomBytes } from "node:crypto";
import { chmod, lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRIDGE_CAPABILITY_PLACEHOLDER } from "../plugin/shared/bridge-auth.js";
import { getExecutionPolicy, type MemiExecutionPolicy } from "./execution-policy.js";

export {
  BRIDGE_AUTH_SCHEME,
  BRIDGE_CAPABILITY_PLACEHOLDER,
  BRIDGE_PROTOCOL_VERSION,
} from "../plugin/shared/bridge-auth.js";

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function resolveBridgeCapabilityPath(homeDir = defaultHomeDir()): string {
  if (!homeDir) {
    throw new Error("Cannot resolve the bridge capability because HOME/USERPROFILE is not set.");
  }
  return join(homeDir, ".memoire", "bridge-capability");
}

export function isValidBridgeCapability(value: unknown): value is string {
  return typeof value === "string" && CAPABILITY_PATTERN.test(value);
}

export async function readBridgeCapability(homeDir = defaultHomeDir()): Promise<string> {
  const capabilityPath = resolveBridgeCapabilityPath(homeDir);
  const metadata = await lstat(capabilityPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Bridge capability must be a regular, non-symlink file: ${capabilityPath}`);
  }

  const capability = (await readFile(capabilityPath, "utf-8")).trim();
  if (!isValidBridgeCapability(capability)) {
    throw new Error(`Bridge capability is invalid: ${capabilityPath}`);
  }
  return capability;
}

export async function ensureBridgeCapability(
  homeDir = defaultHomeDir(),
  policy: MemiExecutionPolicy = getExecutionPolicy(),
): Promise<string> {
  const capabilityPath = resolveBridgeCapabilityPath(homeDir);
  await policy.assertHomeWrite(capabilityPath, "persist the Figma bridge capability");

  try {
    const existing = await readBridgeCapability(homeDir);
    await policy.runHomeWrite(
      capabilityPath,
      "restrict the Figma bridge capability",
      async (safeCapabilityPath) => restrictCapabilityPermissions(safeCapabilityPath),
    );
    return existing;
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }

  const capability = randomBytes(32).toString("base64url");
  try {
    await policy.runHomeWrite(capabilityPath, "persist the Figma bridge capability", async (safeCapabilityPath) => {
      await writeFile(safeCapabilityPath, `${capability}\n`, {
        encoding: "utf-8",
        flag: "wx",
        mode: 0o600,
      });
    });
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    return readBridgeCapability(homeDir);
  }
  await policy.runHomeWrite(
    capabilityPath,
    "restrict the Figma bridge capability",
    async (safeCapabilityPath) => restrictCapabilityPermissions(safeCapabilityPath),
  );
  return capability;
}

export function injectBridgeCapability(html: string, capability: string): string {
  if (!isValidBridgeCapability(capability)) {
    throw new Error("Refusing to inject an invalid bridge capability.");
  }
  if (!html.includes(BRIDGE_CAPABILITY_PLACEHOLDER)) {
    throw new Error("Figma plugin bundle does not contain the bridge capability placeholder. Rebuild the plugin.");
  }
  return html.replaceAll(BRIDGE_CAPABILITY_PLACEHOLDER, capability);
}

async function restrictCapabilityPermissions(path: string): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(path, 0o600);
  }
}

function isMissingFileError(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
  return isNodeError(error) && error.code === "EEXIST";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function defaultHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "";
}
