import type { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";
import crossSpawn from "cross-spawn";

/**
 * Spawn without shell interpolation while retaining Windows .cmd/.bat support.
 *
 * Node 24 rejects batch-file execution through the raw spawn API when arguments
 * are supplied. cross-spawn resolves the platform shim and escapes every
 * argument before invoking cmd.exe, so untrusted prompts remain arguments rather
 * than becoming an interpolated shell command.
 */
export const spawnPortable: typeof nodeSpawn = crossSpawn.spawn;
export const spawnPortableSync: typeof nodeSpawnSync = crossSpawn.sync;
