import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const OPTIONAL_INTEGRATIONS = [
  "@anthropic-ai/sdk",
  "@napi-rs/canvas",
  "playwright",
] as const;

const FORBIDDEN_SHRINKWRAP_PACKAGES = [
  ...OPTIONAL_INTEGRATIONS,
  "@rollup/rollup-darwin-arm64",
  "@rollup/rollup-linux-x64-gnu",
  "esbuild",
  "typescript",
  "vite",
  "vitest",
] as const;

async function readPackageJson(): Promise<Record<string, any>> {
  return JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
}

describe("published package boundary", () => {
  it("keeps heavyweight integrations as opt-in peers", async () => {
    const pkg = await readPackageJson();

    for (const name of OPTIONAL_INTEGRATIONS) {
      expect(pkg.dependencies?.[name]).toBeUndefined();
      expect(pkg.optionalDependencies?.[name]).toBeUndefined();
      expect(pkg.peerDependencies?.[name]).toMatch(/^\d+\.\d+\.\d+$/);
      expect(pkg.peerDependenciesMeta?.[name]).toEqual({ optional: true });
    }
  });

  it("uses an additive, explicit files allowlist", async () => {
    const pkg = await readPackageJson();

    expect(pkg.files).toContain("dist/index.js");
    expect(pkg.files).toContain("dist/index.d.ts");
    expect(pkg.files).toContain("npm-shrinkwrap.json");
    expect(pkg.files).not.toContain("dist");
    expect(pkg.files).not.toContain("skills");
    expect(pkg.files.every((entry: string) => !entry.startsWith("!"))).toBe(true);
  });

  it("pins release helper versions and never invokes latest", async () => {
    const pkg = await readPackageJson();
    const scripts = Object.values(pkg.scripts ?? {}).join("\n");

    expect(scripts).not.toContain("@latest");
    expect(pkg.scripts["build:mcpb"]).toContain("@anthropic-ai/mcpb@2.1.2");
    expect(pkg.scripts["publish:smithery"]).toContain("smithery@1.2.0");
  });

  it("ships a production-only shrinkwrap", async () => {
    const lock = JSON.parse(
      await readFile(join(process.cwd(), "npm-shrinkwrap.json"), "utf8"),
    );

    expect(lock.packages[""]?.devDependencies).toBeUndefined();
    expect(lock.packages[""]?.optionalDependencies).toBeUndefined();
    for (const name of FORBIDDEN_SHRINKWRAP_PACKAGES) {
      expect(lock.packages[`node_modules/${name}`], name).toBeUndefined();
    }
  });
});
