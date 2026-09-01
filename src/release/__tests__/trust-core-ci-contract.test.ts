import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Trust Core verification configuration", () => {
  it("defines a dedicated coverage gate at 80 percent for every metric", async () => {
    const config = await readFile(join(root, "vitest.trust-core.config.ts"), "utf8");
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

    expect(config).toContain('provider: "v8"');
    expect(config).toContain("Vitest 4 includes every file matching `include`");
    for (const metric of ["lines", "branches", "functions", "statements"]) {
      expect(config).toMatch(new RegExp(`${metric}:\\s*80`));
    }
    expect(config).toContain('"src/security/execution-policy.ts"');
    expect(config).toContain('"src/security/metadata-receipt.ts"');
    expect(config).toContain('"src/security/command-preflight.ts"');
    expect(config).toContain('"scripts/lib/trust-core-e2e.mjs"');
    expect(config).toContain('"**/__tests__/**"');
    expect(config).toContain('"**/*.d.ts"');
    expect(packageJson.scripts["test:trust-core"]).toBe(
      "vitest run --config vitest.trust-core.config.ts",
    );
    expect(packageJson.scripts["test:trust-core:coverage"]).toBe(
      "vitest run --config vitest.trust-core.config.ts --coverage",
    );
  });

  it("exposes the packed-artifact suite as a package script", async () => {
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(packageJson.scripts["smoke:trust-core"]).toBe("node scripts/trust-core-e2e.mjs");
    expect(packageJson.scripts.prepublishOnly).toContain("npm run test:trust-core:coverage");
    expect(packageJson.scripts.prepublishOnly).toContain("npm run smoke:trust-core -- --portable");
  });

  it("runs the portable packed-artifact suite on Node 20, 22, and 24 across all supported hosts", async () => {
    const workflow = await readFile(join(root, ".github", "workflows", "clean-install.yml"), "utf8");

    expect(workflow).toContain("os: [ubuntu-latest, macos-latest, windows-latest]");
    expect(workflow).toContain("node-version: [20, 22, 24]");
    expect(workflow).toContain("npm run test:trust-core:coverage");
    expect(workflow).toContain("npm run smoke:trust-core -- --portable");
  });

  it("defines fail-closed Linux amd64 and arm64 read-only, non-root, networkless contracts", async () => {
    const workflow = await readFile(join(root, ".github", "workflows", "trust-core.yml"), "utf8");

    expect(workflow).toContain("platform: [linux/amd64, linux/arm64]");
    expect(workflow).toContain("--network none");
    expect(workflow).toContain("--read-only");
    expect(workflow).toContain("--user 65532:65532");
    expect(workflow).toContain("npm run test:trust-core:coverage");
    const dockerfile = await readFile(join(root, ".github", "trust-core", "Dockerfile"), "utf8");
    expect(dockerfile).toContain("scripts/trust-core-e2e.mjs");
    expect(dockerfile).toContain('"--container"');
  });

  it("pins every third-party action in the Trust Core workflow", async () => {
    const workflow = await readFile(join(root, ".github", "workflows", "trust-core.yml"), "utf8");
    const refs = [...workflow.matchAll(/^\s+- uses: ([^\s#]+)(?:\s+#.*)?$/gm)]
      .map(([, ref]) => ref)
      .filter((ref) => !ref.startsWith("./"));

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref).toMatch(/^[^@]+@[0-9a-f]{40}$/);
    }
  });
});
