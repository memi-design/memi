// @ts-nocheck
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertConsumerGraph,
  assertInstallFootprint,
  assertProductionAudit,
  assertExpectedVersion,
  MAX_INSTALL_BYTES,
  npmExecutable,
  packageInstallPaths,
  parsePackResult,
} from "../../../scripts/lib/clean-install.mjs";

describe("clean install smoke helpers", () => {
  it("uses the platform-specific npm executable without a shell", () => {
    expect(npmExecutable("win32")).toBe("npm.cmd");
    expect(npmExecutable("linux")).toBe("npm");
    expect(npmExecutable("darwin")).toBe("npm");
  });

  it("parses npm pack JSON and rejects a missing artifact", () => {
    expect(parsePackResult('[{"filename":"memi-design-cli-2.6.2.tgz"}]')).toMatchObject({
      filename: "memi-design-cli-2.6.2.tgz",
    });
    expect(() => parsePackResult("[]")).toThrow("npm pack did not report an artifact");
    expect(() => parsePackResult("not-json")).toThrow("npm pack returned invalid JSON");
  });

  it("requires the installed binary to report the exact package version", () => {
    expect(assertExpectedVersion("2.6.2\n", "2.6.2")).toBe("2.6.2");
    expect(() => assertExpectedVersion("2.6.1\n", "2.6.2")).toThrow(
      "installed memi reported 2.6.1; expected 2.6.2",
    );
  });

  it("rejects high or critical advisories from the packed consumer graph", () => {
    expect(assertProductionAudit(JSON.stringify({
      metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } },
    }))).toEqual({ high: 0, critical: 0 });
    expect(() => assertProductionAudit(JSON.stringify({
      metadata: { vulnerabilities: { low: 0, moderate: 0, high: 1, critical: 0 } },
    }))).toThrow("packed consumer graph has 1 high and 0 critical advisories");
  });

  it("requires zero known production advisories at every severity", () => {
    expect(() => assertProductionAudit(JSON.stringify({
      metadata: {
        vulnerabilities: {
          info: 0,
          low: 0,
          moderate: 1,
          high: 0,
          critical: 0,
          total: 1,
        },
      },
    }))).toThrow("packed consumer graph has 1 known production advisory");
  });

  it("enforces the 60 MiB clean-install footprint", () => {
    expect(assertInstallFootprint(MAX_INSTALL_BYTES)).toEqual({
      bytes: MAX_INSTALL_BYTES,
      maxBytes: MAX_INSTALL_BYTES,
      passed: true,
    });
    expect(() => assertInstallFootprint(MAX_INSTALL_BYTES + 1)).toThrow(
      "clean install footprint",
    );
  });

  it("rejects development tools and optional integrations in a consumer graph", () => {
    expect(assertConsumerGraph({
      packages: {
        "": { dependencies: { chalk: "5.4.1" } },
        "node_modules/chalk": { version: "5.4.1" },
      },
    })).toMatchObject({ packages: 1, forbiddenPackages: [] });

    expect(() => assertConsumerGraph({
      packages: {
        "": { dependencies: { chalk: "5.4.1" } },
        "node_modules/chalk": { version: "5.4.1" },
        "node_modules/playwright": { version: "1.59.1" },
        "node_modules/typescript": { version: "5.6.3" },
      },
    })).toThrow("consumer graph contains forbidden packages: playwright, typescript");
  });

  it("resolves a scoped package and its installed binary target inside the consumer", () => {
    const paths = packageInstallPaths(
      join("tmp", "consumer"),
      "@memi-design/cli",
      "dist/index.js",
    );

    expect(paths.packageRoot).toBe(
      join("tmp", "consumer", "node_modules", "@memi-design", "cli"),
    );
    expect(paths.binaryEntry).toBe(
      join("tmp", "consumer", "node_modules", "@memi-design", "cli", "dist", "index.js"),
    );
  });
});

describe("clean install CI contract", () => {
  it("runs Node 20, 22, and 24 on Linux, macOS, and Windows", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "clean-install.yml"),
      "utf8",
    );

    expect(workflow).toContain("os: [ubuntu-latest, macos-latest, windows-latest]");
    expect(workflow).toContain("node-version: [20, 22, 24]");
    expect(workflow).toContain("runs-on: ${{ matrix.os }}");
    expect(workflow).toContain("npm ci --include=optional --ignore-scripts");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm test -- --run");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("npm run smoke:clean-install");
  });

  it("pins every third-party action to an immutable commit", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "clean-install.yml"),
      "utf8",
    );
    const actions = [...workflow.matchAll(/^\s+- uses: ([^\s#]+)(?:\s+#.*)?$/gm)].map(
      ([, action]) => action,
    );

    expect(actions).toHaveLength(2);
    for (const action of actions) {
      expect(action).toMatch(/^[^@]+@[0-9a-f]{40}$/);
    }
  });

  it("exposes the local smoke through package scripts", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.scripts["smoke:clean-install"]).toBe(
      "node scripts/smoke-clean-install.mjs",
    );
  });
});
