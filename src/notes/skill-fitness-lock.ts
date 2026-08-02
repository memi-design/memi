import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const lockOwnerSchema = z.object({
  schemaVersion: z.literal(1),
  token: z.string().min(1).max(128).regex(/^[a-zA-Z0-9-]+$/),
  pid: z.number().int().positive(),
  createdAt: z.string().datetime(),
}).strict();

export interface SkillFitnessLockOptions {
  readonly lockWaitMs?: number;
  readonly lockRetryMs?: number;
  readonly staleLockMs?: number;
}

interface NormalizedLockOptions {
  readonly lockWaitMs: number;
  readonly lockRetryMs: number;
  readonly staleLockMs: number;
}

interface HeldLock {
  readonly path: string;
  readonly ownerPath: string;
  readonly token: string;
}

interface LockOwnerState {
  readonly owner: z.infer<typeof lockOwnerSchema> | null;
  readonly ownerPresent: boolean;
  readonly createdAtMs: number;
}

export async function withSkillFitnessFileLock<T>(
  file: string,
  options: SkillFitnessLockOptions,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = await acquire(file, normalizeOptions(options));
  try {
    return await operation();
  } finally {
    await release(lock);
  }
}

export async function appendPrivateLine(file: string, line: string): Promise<void> {
  const handle = await open(
    file,
    privateAppendFlags(),
    0o600,
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("skill fitness store must be a regular file");
    const pathMetadata = await lstat(file);
    if (
      pathMetadata.isSymbolicLink()
      || !pathMetadata.isFile()
      || (
        metadata.ino !== 0
        && pathMetadata.ino !== 0
        && (metadata.dev !== pathMetadata.dev || metadata.ino !== pathMetadata.ino)
      )
    ) {
      throw new Error("skill fitness store changed during secure append");
    }
    await handle.chmod(0o600);
    await handle.write(line, null, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function privateAppendFlags(platform = process.platform): number {
  const noFollow = platform === "win32" || typeof constants.O_NOFOLLOW !== "number"
    ? 0
    : constants.O_NOFOLLOW;
  return constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | noFollow;
}

function normalizeOptions(input: SkillFitnessLockOptions): NormalizedLockOptions {
  return {
    lockWaitMs: boundedPositiveInteger(input.lockWaitMs ?? 5_000, "lockWaitMs", 60_000),
    lockRetryMs: boundedPositiveInteger(input.lockRetryMs ?? 25, "lockRetryMs", 1_000),
    staleLockMs: boundedPositiveInteger(
      input.staleLockMs ?? 30_000,
      "staleLockMs",
      3_600_000,
    ),
  };
}

async function acquire(file: string, options: NormalizedLockOptions): Promise<HeldLock> {
  const lockPath = `${file}.lock`;
  const ownerPath = path.join(lockPath, "owner.json");
  const deadline = Date.now() + options.lockWaitMs;
  for (;;) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      const token = randomUUID();
      try {
        await writeFile(ownerPath, `${JSON.stringify({
          schemaVersion: 1,
          token,
          pid: process.pid,
          createdAt: new Date().toISOString(),
        })}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      } catch (error) {
        await rmdir(lockPath).catch(() => undefined);
        throw error;
      }
      return { path: lockPath, ownerPath, token };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    if (await recoverStale(lockPath, options.staleLockMs)) continue;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timed out waiting for skill fitness lock ${lockPath}`);
    }
    await delay(Math.min(options.lockRetryMs, remaining));
  }
}

async function recoverStale(lockPath: string, staleLockMs: number): Promise<boolean> {
  const lockMetadata = await lstat(lockPath).catch((error: unknown) => {
    if (isMissingFile(error)) return null;
    throw error;
  });
  if (!lockMetadata) return true;
  if (lockMetadata.isSymbolicLink() || !lockMetadata.isDirectory()) {
    throw new Error("skill fitness lock must be a regular non-symlink directory");
  }
  const ownerPath = path.join(lockPath, "owner.json");
  const initial = await readOwner(ownerPath, lockMetadata.mtimeMs);
  if (!isStale(initial, staleLockMs)) return false;
  const reaperPath = path.join(lockPath, ".reaper");
  try {
    await writeFile(reaperPath, "reaping\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (isAlreadyExists(error)) return false;
    throw error;
  }
  let recovered = false;
  try {
    const refreshed = await readOwner(ownerPath, lockMetadata.mtimeMs);
    if (!isStale(refreshed, staleLockMs)) return false;
    const quarantinePath = `${lockPath}.stale-${randomUUID()}`;
    try {
      await rename(lockPath, quarantinePath);
    } catch (error) {
      if (isMissingFile(error)) return true;
      throw new Error(
        `Cannot safely recover skill fitness lock: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
    if (refreshed.ownerPresent) await unlink(path.join(quarantinePath, "owner.json"));
    await unlink(path.join(quarantinePath, ".reaper"));
    await rmdir(quarantinePath).catch(() => undefined);
    recovered = true;
    return true;
  } finally {
    if (!recovered) await unlink(reaperPath).catch(() => undefined);
  }
}

async function readOwner(ownerPath: string, fallbackCreatedAtMs: number): Promise<LockOwnerState> {
  const metadata = await lstat(ownerPath).catch((error: unknown) => {
    if (isMissingFile(error)) return null;
    throw error;
  });
  if (!metadata) {
    return { owner: null, ownerPresent: false, createdAtMs: fallbackCreatedAtMs };
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("skill fitness lock owner must be a regular non-symlink file");
  }
  if (metadata.size > 4_096) {
    throw new Error("skill fitness lock owner exceeds the 4096-byte safety limit");
  }
  const rawOwner = await readFile(ownerPath, "utf8");
  try {
    const owner = lockOwnerSchema.parse(JSON.parse(rawOwner));
    return { owner, ownerPresent: true, createdAtMs: new Date(owner.createdAt).getTime() };
  } catch {
    return { owner: null, ownerPresent: true, createdAtMs: metadata.mtimeMs };
  }
}

function isStale(input: LockOwnerState, staleLockMs: number): boolean {
  if (Date.now() - input.createdAtMs < staleLockMs) return false;
  return input.owner === null || !processIsAlive(input.owner.pid);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "EPERM",
    );
  }
}

async function release(lock: HeldLock): Promise<void> {
  const current = await readOwner(lock.ownerPath, Date.now());
  if (!current.owner || current.owner.token !== lock.token) {
    throw new Error("skill fitness lock ownership changed before release");
  }
  await unlink(lock.ownerPath);
  await rmdir(lock.path);
}

function boundedPositiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "EEXIST",
  );
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT",
  );
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
