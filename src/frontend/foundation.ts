import { createHash } from "node:crypto";
import { z } from "zod";

export const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/, {
  message: "must be a sha256: prefixed lowercase SHA-256 digest",
});

export const RepositoryRelativePathSchema = z.string().min(1).superRefine((value, context) => {
  if (
    value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:\//u.test(value)
    || value.split("/").some((segment) => segment === ".." || segment === "." || segment === "")
  ) {
    context.addIssue({
      code: "custom",
      message: "must be a normalized repository-relative path",
    });
  }
});

export function normalizeRepositoryPath(value: string): string {
  const normalized = value.replace(/\\/gu, "/").replace(/^\.\//u, "");
  return RepositoryRelativePathSchema.parse(normalized);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record).sort(compareText).map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Cannot canonically serialize undefined");
  return serialized;
}

export function hashValue(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function hashText(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
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
