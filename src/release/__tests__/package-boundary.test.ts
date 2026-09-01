import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const OPTIONAL_INTEGRATIONS = [
  "@anthropic-ai/sdk",
  "@napi-rs/canvas",
  "pino-pretty",
  "playwright",
  "ssf",
  "xlsx-populate",
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

    expect(pkg.bin).toEqual({ memi: "dist/bin.js" });
    expect(pkg.main).toBe("dist/index.js");
    expect(pkg.exports?.["."]?.import).toBe("./dist/index.js");
    expect(pkg.files).toContain("dist/bin.js");
    expect(pkg.files).toContain("dist/index.js");
    expect(pkg.files).toContain("dist/index.d.ts");
    expect(pkg.files).toContain("npm-shrinkwrap.json");
    expect(pkg.files).not.toContain("dist");
    expect(pkg.files).not.toContain("skills");
    expect(pkg.files.every((entry: string) => !entry.startsWith("!"))).toBe(true);
  });

  it("ships a tiny version launcher before loading the full CLI", async () => {
    const launcher = await readFile(join(process.cwd(), "src", "bin.ts"), "utf8");
    const fullCliImport = 'import("./index.js")';

    expect(launcher).toContain('args[0] === "--version"');
    expect(launcher).toContain('args[0] === "-V"');
    expect(launcher).toContain('args[0] === "version"');
    expect(launcher).toContain("__MEMI_PACKAGE_VERSION__");
    expect(launcher).toContain(fullCliImport);
    expect(launcher.indexOf("__MEMI_PACKAGE_VERSION__")).toBeLessThan(
      launcher.indexOf(fullCliImport),
    );
  });

  it("pins release helper versions and never invokes latest", async () => {
    const pkg = await readPackageJson();
    const scripts = Object.values(pkg.scripts ?? {}).join("\n");

    expect(scripts).not.toContain("@latest");
    expect(pkg.scripts["build:mcpb"]).toContain("@anthropic-ai/mcpb@2.1.2");
    expect(pkg.scripts["publish:smithery"]).toContain("smithery@1.2.0");
  });

  it("loads optional integrations only on demand with exact install guidance", async () => {
    const [anthropic, browser, canvas, excel] = await Promise.all([
      readFile(join(process.cwd(), "src", "ai", "client.ts"), "utf8"),
      readFile(join(process.cwd(), "src", "studio", "browser-adapter.ts"), "utf8"),
      readFile(join(process.cwd(), "src", "engine", "text-measurer.ts"), "utf8"),
      readFile(join(process.cwd(), "src", "research", "excel-parser.ts"), "utf8"),
    ]);

    expect(anthropic).not.toContain('import Anthropic from "@anthropic-ai/sdk"');
    expect(anthropic).toContain('import("@anthropic-ai/sdk")');
    expect(anthropic).toContain('"host-integration-code"');
    expect(anthropic).toContain("npm install --save-exact @anthropic-ai/sdk@0.112.3");
    expect(browser).toContain('"host-integration-code"');
    expect(browser).toContain("npm install --save-exact playwright@1.59.1");
    expect(canvas).toContain('"host-integration-code"');
    expect(canvas).toContain("npm install --save-exact @napi-rs/canvas@0.1.97");
    expect(excel).toContain('"host-integration-code"');
    expect(excel).toContain(
      "npm install --save-exact xlsx-populate@1.21.0 ssf@0.11.2",
    );
  });

  it("keeps source npm ci reproducible while staging a production-only shrinkwrap", async () => {
    const [pkg, sourceLock, productionLock, publishWorkflow] = await Promise.all([
      readPackageJson(),
      readFile(join(process.cwd(), "npm-shrinkwrap.json"), "utf8").then(JSON.parse),
      readFile(
        join(process.cwd(), "release", "npm-shrinkwrap.production.json"),
        "utf8",
      ).then(JSON.parse),
      readFile(join(process.cwd(), ".github", "workflows", "publish.yml"), "utf8"),
    ]);

    expect(sourceLock.packages[""]?.devDependencies).toEqual(pkg.devDependencies);
    expect(sourceLock.packages["node_modules/typescript"]).toBeDefined();
    expect(sourceLock.packages["node_modules/vitest"]).toBeDefined();
    expect(sourceLock.packages["node_modules/vite"]).toBeDefined();
    expect(pkg.scripts["stage:package"]).toBe("node scripts/stage-package.mjs");
    expect(publishWorkflow).toContain("run: npm ci --ignore-scripts");
    expect(publishWorkflow).toContain("run: npm run stage:package");
    expect(publishWorkflow).toContain("working-directory: .dist/npm-package");

    expect(productionLock.packages[""]?.devDependencies).toBeUndefined();
    expect(productionLock.packages[""]?.optionalDependencies).toBeUndefined();
    for (const [lockPath, packageEntry] of Object.entries(
      productionLock.packages,
    ) as Array<[string, Record<string, unknown>]>) {
      expect(sourceLock.packages[lockPath], lockPath).toBeDefined();
      expect(packageEntry.dev, lockPath).not.toBe(true);
      expect(packageEntry.optional, lockPath).not.toBe(true);
      expect(packageEntry.devOptional, lockPath).not.toBe(true);
      if (lockPath !== "") {
        expect(packageEntry, lockPath).toEqual(sourceLock.packages[lockPath]);
      }
    }
    for (const name of FORBIDDEN_SHRINKWRAP_PACKAGES) {
      expect(productionLock.packages[`node_modules/${name}`], name).toBeUndefined();
    }
  });
});
