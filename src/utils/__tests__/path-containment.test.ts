import { describe, expect, it } from "vitest";

import { isPathWithin, resolvePathWithin } from "../path-containment.js";

describe("path containment", () => {
  it("accepts a child of a Windows 8.3 temporary path", () => {
    const root = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\memoire\\specs\\components";
    const child = `${root}\\StatusBadge.json`;

    expect(isPathWithin(child, root)).toBe(true);
    expect(resolvePathWithin(root, "StatusBadge.json")).toBe(child);
  });

  it("uses Windows case-insensitive path semantics", () => {
    const root = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\Memoire";
    const child = "c:\\users\\runner~1\\appdata\\local\\temp\\memoire\\app\\page.tsx";

    expect(isPathWithin(child, root)).toBe(true);
  });

  it("rejects a Windows path on another drive", () => {
    const root = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\memoire";
    const child = "D:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\memoire\\app\\page.tsx";

    expect(isPathWithin(child, root)).toBe(false);
    expect(() => resolvePathWithin(root, child)).toThrow(/outside allowed root/);
  });

  it("rejects Windows sibling-prefix and parent traversal paths", () => {
    const root = "C:\\work\\memoire";

    expect(isPathWithin("C:\\work\\memoire-copy\\file.ts", root)).toBe(false);
    expect(() => resolvePathWithin(root, "..\\outside\\file.ts")).toThrow(/outside allowed root/);
  });

  it("accepts POSIX children while rejecting sibling-prefix and traversal paths", () => {
    const root = "/tmp/memoire";

    expect(isPathWithin("/tmp/memoire/app/page.tsx", root)).toBe(true);
    expect(isPathWithin("/tmp/memoire-copy/page.tsx", root)).toBe(false);
    expect(() => resolvePathWithin(root, "../outside/page.tsx")).toThrow(/outside allowed root/);
  });
});
