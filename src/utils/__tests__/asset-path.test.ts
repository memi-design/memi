import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { __resetPackageRootCache, packagePath, packageRoot } from "../asset-path.js";
import { getMemoirePackageVersion } from "../package-version.js";

describe("asset-path", () => {
  afterEach(() => {
    __resetPackageRootCache();
    delete process.env.MEMOIRE_PACKAGE_ROOT;
  });

  it("resolves to the repo root in dev (contains package.json)", () => {
    const root = packageRoot();
    expect(existsSync(join(root, "package.json"))).toBe(true);
  });

  it("resolves to the repo root in dev (contains skills/registry.json)", () => {
    expect(existsSync(packagePath("skills", "registry.json"))).toBe(true);
  });

  it("honors MEMOIRE_PACKAGE_ROOT override", () => {
    process.env.MEMOIRE_PACKAGE_ROOT = "/tmp/custom-memoire-root";
    __resetPackageRootCache();
    expect(packageRoot()).toBe(resolve("/tmp/custom-memoire-root"));
  });

  it("packagePath joins segments under the root", () => {
    const p = packagePath("a", "b", "c");
    expect(p.endsWith("a/b/c") || p.endsWith("a\\b\\c")).toBe(true);
  });

  it("reads package version from the resolved package root", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-package-root-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "9.9.9-test" }));
    process.env.MEMOIRE_PACKAGE_ROOT = root;
    __resetPackageRootCache();

    expect(getMemoirePackageVersion()).toBe("9.9.9-test");

    await rm(root, { recursive: true, force: true });
  });
});
