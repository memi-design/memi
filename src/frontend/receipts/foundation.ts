import { createHash } from "node:crypto";
import { z } from "zod";

export const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u, {
  message: "must be a sha256: prefixed lowercase SHA-256 digest",
});

export const TimestampSchema = z.string().datetime({
  offset: true,
  message: "must be an ISO-8601 timestamp",
});

export const IdentifierSchema = z.string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, {
    message: "must be a bounded portable identifier",
  });

export const RepositoryRelativePathSchema = z.string()
  .min(1)
  .max(2_048)
  .superRefine((value, context) => {
    if (
      value.includes("\\")
      || value.startsWith("/")
      || /^[A-Za-z]:\//u.test(value)
      || value.split("/").some((segment) =>
        segment === "" || segment === "." || segment === "..")
    ) {
      context.addIssue({
        code: "custom",
        message: "must be a normalized repository-relative path",
      });
    }
  });

export function canonicalJson(value: unknown): string {
  return canonicalJsonValue(value, new Set<object>());
}

export function hashValue(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function cloneSerializable<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Readonly<Record<string, unknown>>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function timestampMillis(value: string): number {
  return new Date(value).getTime();
}

function canonicalJsonValue(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Value is not deterministically serializable: non-finite number");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new Error(`Value is not deterministically serializable: ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new Error("Value is not deterministically serializable: circular reference");
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error("Value is not deterministically serializable: non-plain object");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalJsonValue(entry, ancestors)).join(",")}]`;
    }
    const record = value as Readonly<Record<string, unknown>>;
    const entries = Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJsonValue(record[key], ancestors)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
