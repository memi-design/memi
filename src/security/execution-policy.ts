import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const MEMI_EXECUTION_PROFILES = ["locked", "local", "connected"] as const;
export type MemiExecutionProfile = (typeof MEMI_EXECUTION_PROFILES)[number];

export const MEMI_CAPABILITIES = [
  "browser",
  "figma",
  "home-write",
  "host-integration-code",
  "dynamic-install",
  "network",
  "project-write",
  "shell",
  "source-content-persistence",
  "telemetry",
] as const;
export type MemiCapability = (typeof MEMI_CAPABILITIES)[number];
export type MemiDeniedCapability = MemiCapability | "command-mapping";

export interface MemiExecutionPolicyOptions {
  projectRoot: string;
  homeDir?: string;
  profile?: MemiExecutionProfile;
  allow?: readonly MemiCapability[];
}

export interface MemiExecutionPolicySnapshot {
  profile: MemiExecutionProfile;
  requestedCapabilities: readonly MemiCapability[];
  effectiveCapabilities: readonly MemiCapability[];
  dataLocations: {
    project: ".memi/";
    home: "~/.memoire/";
  };
}

interface CapabilityDeniedOptions {
  profile: MemiExecutionProfile;
  capability: MemiDeniedCapability;
  operation: string;
}

export class MemiCapabilityDeniedError extends Error {
  readonly code = "MEMI_CAPABILITY_DENIED" as const;
  readonly profile: MemiExecutionProfile;
  readonly capability: MemiDeniedCapability;
  readonly operation: string;

  constructor(options: CapabilityDeniedOptions) {
    const message = options.capability === "command-mapping"
      ? `Profile ${options.profile} denied ${options.operation}. This command path has no audited capability mapping and cannot be enabled with --allow.`
      : `Profile ${options.profile} denied ${options.capability} for ${options.operation}. Re-run with --profile connected --allow ${options.capability} after reviewing the operation.`;
    super(message);
    this.name = "MemiCapabilityDeniedError";
    this.profile = options.profile;
    this.capability = options.capability;
    this.operation = options.operation;
  }

  toJSON(): Readonly<Record<string, string>> {
    return Object.freeze({
      code: this.code,
      message: this.message,
      profile: this.profile,
      capability: this.capability,
      operation: this.operation,
    });
  }
}

export class MemiExecutionPolicy {
  readonly profile: MemiExecutionProfile;
  readonly requestedCapabilities: readonly MemiCapability[];
  readonly effectiveCapabilities: readonly MemiCapability[];
  readonly projectRoot: string;
  readonly homeDir: string | undefined;

  constructor(options: MemiExecutionPolicyOptions) {
    this.profile = options.profile ?? "locked";
    this.projectRoot = resolve(options.projectRoot);
    this.homeDir = options.homeDir ? resolve(options.homeDir) : undefined;
    this.requestedCapabilities = freezeCapabilities(options.allow ?? []);
    this.effectiveCapabilities = freezeCapabilities(
      this.profile === "connected"
        ? this.requestedCapabilities
        : this.profile === "local"
          ? ["project-write"]
          : [],
    );
    Object.freeze(this);
  }

  allows(capability: MemiCapability): boolean {
    return this.effectiveCapabilities.includes(capability);
  }

  assert(capability: MemiCapability, operation: string): void {
    if (!this.allows(capability)) {
      throw this.denial(capability, operation);
    }
  }

  async assertProjectWrite(targetPath: string, operation: string): Promise<void> {
    this.assert("project-write", operation);
    const allowedRoot = this.projectWriteRoot();
    await this.assertContainedWrite(targetPath, allowedRoot, "project-write", operation);
  }

  /**
   * Opens a new project file only after pathname validation is bound to the
   * returned file handle. Callers must write through and close this handle;
   * reopening the pathname would reintroduce the symlink race this prevents.
   */
  async openProjectWriteExclusive(targetPath: string, operation: string): Promise<FileHandle> {
    const target = resolveAbsolutePath(targetPath);
    const allowedRoot = this.projectWriteRoot();
    await this.assertProjectWrite(target, operation);
    await this.ensureProjectWriteRoot(allowedRoot, operation);

    // Creating only the policy root avoids following a swapped missing ancestor
    // during recursive mkdir. Nested receipt directories must already exist.
    await this.assertProjectWrite(target, operation);
    const parent = dirname(target);
    try {
      const parentMetadata = await lstat(parent);
      if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
        throw this.denial("project-write", operation);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw this.denial("project-write", operation);
      }
      throw error;
    }
    const noFollow = process.platform === "win32" || typeof constants.O_NOFOLLOW !== "number"
      ? 0
      : constants.O_NOFOLLOW;
    const handle = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    );

    try {
      // The exclusive open creates an empty file. Validate that exact inode
      // before any caller-controlled bytes are written through the handle.
      await this.assertProjectWrite(target, operation);
      const [opened, pathname] = await Promise.all([handle.stat(), lstat(target)]);
      if (
        !opened.isFile()
        || !pathname.isFile()
        || pathname.isSymbolicLink()
        || opened.dev !== pathname.dev
        || opened.ino !== pathname.ino
      ) {
        throw this.denial("project-write", operation);
      }
      return handle;
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  async assertHomeWrite(targetPath: string, operation: string): Promise<void> {
    this.assert("home-write", operation);
    if (!this.homeDir) {
      throw this.denial("home-write", operation);
    }
    await this.assertContainedWrite(targetPath, this.homeDir, "home-write", operation);
  }

  snapshot(): Readonly<MemiExecutionPolicySnapshot> {
    return Object.freeze({
      profile: this.profile,
      requestedCapabilities: this.requestedCapabilities,
      effectiveCapabilities: this.effectiveCapabilities,
      dataLocations: Object.freeze({
        project: ".memi/" as const,
        home: "~/.memoire/" as const,
      }),
    });
  }

  private denial(capability: MemiCapability, operation: string): MemiCapabilityDeniedError {
    return new MemiCapabilityDeniedError({
      profile: this.profile,
      capability,
      operation,
    });
  }

  private projectWriteRoot(): string {
    return this.profile === "local"
      ? join(this.projectRoot, ".memi")
      : this.projectRoot;
  }

  private async ensureProjectWriteRoot(root: string, operation: string): Promise<void> {
    try {
      await mkdir(root, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    const metadata = await lstat(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw this.denial("project-write", operation);
    }
  }

  private async assertContainedWrite(
    targetPath: string,
    allowedRoot: string,
    capability: MemiCapability,
    operation: string,
  ): Promise<void> {
    const target = resolveAbsolutePath(targetPath);
    const root = resolve(allowedRoot);
    if (!isWithin(target, root)) {
      throw this.denial(capability, operation);
    }

    const existingRoot = await nearestExistingPath(root);
    const existingTarget = await nearestExistingPath(target);
    if (!existingRoot || !existingTarget) {
      throw this.denial(capability, operation);
    }

    const [realExistingRoot, realExistingTarget] = await Promise.all([
      realpath(existingRoot),
      realpath(existingTarget),
    ]);

    const rootExists = existingRoot === root;
    if (rootExists) {
      const rootMetadata = await lstat(root);
      if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
        throw this.denial(capability, operation);
      }
      const realRoot = await realpath(root);
      if (!isWithin(realExistingTarget, realRoot)) {
        throw this.denial(capability, operation);
      }
      return;
    }

    // The policy root has not been created yet. Its nearest existing parent and
    // the target's nearest existing parent must be the same real directory.
    // Once the root exists, subsequent checks resolve it and reject symlinks.
    if (realExistingTarget !== realExistingRoot) {
      throw this.denial(capability, operation);
    }
  }
}

let activePolicy: MemiExecutionPolicy | undefined;

export function createExecutionPolicy(options: MemiExecutionPolicyOptions): MemiExecutionPolicy {
  return new MemiExecutionPolicy(options);
}

export function configureExecutionPolicy(options: MemiExecutionPolicyOptions): MemiExecutionPolicy {
  const policy = createExecutionPolicy(options);
  activePolicy = policy;
  return policy;
}

export function getExecutionPolicy(): MemiExecutionPolicy {
  return activePolicy ?? createExecutionPolicy({
    projectRoot: process.cwd(),
    homeDir: process.env.HOME || process.env.USERPROFILE,
  });
}

export function resetExecutionPolicyForTests(): void {
  activePolicy = undefined;
}

export function parseExecutionPolicyArgs(
  args: readonly string[],
  context: Pick<MemiExecutionPolicyOptions, "projectRoot" | "homeDir">,
): { policy: MemiExecutionPolicy; commandArgs: string[] } {
  let profile: MemiExecutionProfile | undefined;
  let offline = false;
  const allow: MemiCapability[] = [];
  const commandArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      commandArgs.push(...args.slice(index));
      break;
    }
    if (arg === "--offline") {
      offline = true;
      continue;
    }
    if (arg === "--profile" || arg.startsWith("--profile=")) {
      const value = arg === "--profile" ? args[++index] : arg.slice("--profile=".length);
      profile = parseProfile(value);
      continue;
    }
    if (arg === "--allow" || arg.startsWith("--allow=")) {
      const value = arg === "--allow" ? args[++index] : arg.slice("--allow=".length);
      allow.push(parseCapability(value));
      continue;
    }
    commandArgs.push(arg);
  }

  if (offline && profile && profile !== "locked") {
    throw new Error(`--offline cannot be combined with --profile ${profile}`);
  }

  return {
    policy: createExecutionPolicy({
      ...context,
      profile: offline ? "locked" : profile,
      allow,
    }),
    commandArgs,
  };
}

function parseProfile(value: string | undefined): MemiExecutionProfile {
  if (!value || !MEMI_EXECUTION_PROFILES.includes(value as MemiExecutionProfile)) {
    throw new Error(`Invalid profile "${value ?? ""}". Use one of: ${MEMI_EXECUTION_PROFILES.join(", ")}`);
  }
  return value as MemiExecutionProfile;
}

function parseCapability(value: string | undefined): MemiCapability {
  if (!value || !MEMI_CAPABILITIES.includes(value as MemiCapability)) {
    throw new Error(`Invalid capability "${value ?? ""}". Use one of: ${MEMI_CAPABILITIES.join(", ")}`);
  }
  return value as MemiCapability;
}

function freezeCapabilities(capabilities: readonly MemiCapability[]): readonly MemiCapability[] {
  return Object.freeze([...new Set(capabilities)].sort());
}

function resolveAbsolutePath(path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(process.cwd(), path);
}

function isWithin(candidate: string, parent: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function nearestExistingPath(path: string): Promise<string | null> {
  let candidate = resolve(path);
  while (true) {
    try {
      await lstat(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) return null;
      candidate = parent;
    }
  }
}
