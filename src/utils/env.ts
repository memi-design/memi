/**
 * Env Utilities — Shared helpers for reading and merging .env files.
 *
 * Consolidates the three scattered env-loading implementations:
 *   - MemoireEngine._loadEnvFile()
 *   - connect.ts findExistingEnvValue()
 *   - setup.ts readEnvValue()
 *
 * All functions are pure and safe to call from any command.
 */

import { readFile, access } from "fs/promises";
import { join } from "path";

/** The env files we scan in priority order. */
const ENV_FILES = [".env.local", ".env"] as const;
const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function assertEnvKey(key: string): void {
  if (!ENVIRONMENT_KEY.test(key)) {
    throw new Error(`Invalid environment key: ${key}`);
  }
}

export function upsertEnvValue(content: string, key: string, value: string): string {
  assertEnvKey(key);
  if (/[\r\n]/u.test(value)) {
    throw new Error("Environment values must be single line");
  }
  const line = `${key}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  const normalized = content.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const existing = lines.findIndex((candidate) => parseEnvAssignment(candidate)?.key === key);
  if (existing >= 0) {
    lines[existing] = line;
    return lines.join("\n");
  }
  return `${normalized}${normalized.length > 0 && !normalized.endsWith("\n") ? "\n" : ""}${line}\n`;
}

/**
 * Read a single `.env`-style file and merge KEY=VALUE pairs into `process.env`.
 * Existing keys are never overwritten. Absent files are silently skipped.
 */
export async function loadEnvFile(root: string, filename: string): Promise<void> {
  const envPath = join(root, filename);
  try {
    await access(envPath);
    const raw = await readFile(envPath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch {
    // File doesn't exist — skip silently
  }
}

/**
 * Load `.env.local` then `.env` from `root` into `process.env`.
 * Existing keys are never overwritten.
 */
export async function loadEnvFiles(root: string): Promise<void> {
  for (const file of ENV_FILES) {
    await loadEnvFile(root, file);
  }
}

export type EnvSource = "process" | ".env.local" | ".env" | "missing";

export interface EnvValue {
  value: string | null;
  source: EnvSource;
}

/**
 * Find a config value by checking process.env first, then `.env.local` and `.env`
 * in the given project root. Returns the value and the source it was found in.
 */
export async function readEnvValue(root: string, key: string): Promise<EnvValue> {
  assertEnvKey(key);
  if (process.env[key]?.trim()) {
    return { value: process.env[key]!.trim(), source: "process" };
  }

  for (const file of ENV_FILES) {
    try {
      const content = await readFile(join(root, file), "utf-8");
      const assignment = content.split(/\r?\n/u)
        .map(parseEnvAssignment)
        .find((candidate) => candidate?.key === key);
      if (assignment) {
        return { value: assignment.value, source: file };
      }
    } catch {
      // File doesn't exist — try next
    }
  }

  return { value: null, source: "missing" };
}

/**
 * Shorthand that returns only the value string (or null).
 * Use when you don't need the source metadata.
 */
export async function readEnvValueRaw(root: string, key: string): Promise<string | null> {
  return (await readEnvValue(root, key)).value;
}

function parseEnvAssignment(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const equals = trimmed.indexOf("=");
  if (equals <= 0) return null;
  const key = trimmed.slice(0, equals).trim();
  if (!ENVIRONMENT_KEY.test(key)) return null;
  const rawValue = trimmed.slice(equals + 1).trim();
  const quoted = rawValue.length >= 2 && rawValue.startsWith('"') && rawValue.endsWith('"');
  const value = quoted
    ? rawValue.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\")
    : rawValue;
  return { key, value };
}
