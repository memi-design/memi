// @ts-nocheck
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProductionShrinkwrap } from "../../../scripts/lib/production-shrinkwrap.mjs";

function sourceLockFixture() {
  return {
    name: "@memi-test/fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "@memi-test/fixture",
        version: "1.0.0",
        dependencies: { runtime: "^1.0.0" },
        devDependencies: { tool: "^9.0.0" },
        optionalDependencies: { "optional-root": "^4.0.0" },
        peerDependencies: {
          "required-peer": "^3.0.0",
          "optional-peer": "^5.0.0",
        },
        peerDependenciesMeta: { "optional-peer": { optional: true } },
      },
      "node_modules/runtime": {
        version: "1.2.3",
        resolved: "https://registry.npmjs.org/runtime/-/runtime-1.2.3.tgz",
        integrity: "sha512-runtime",
        dependencies: { nested: "~2.0.0" },
        optionalDependencies: { "optional-child": "^6.0.0" },
      },
      "node_modules/nested": {
        version: "2.4.6",
        resolved: "https://registry.npmjs.org/nested/-/nested-2.4.6.tgz",
        integrity: "sha512-nested",
      },
      "node_modules/required-peer": {
        version: "3.8.1",
        resolved: "https://registry.npmjs.org/required-peer/-/required-peer-3.8.1.tgz",
        integrity: "sha512-peer",
      },
      "node_modules/optional-root": { version: "4.0.1", optional: true },
      "node_modules/optional-peer": { version: "5.1.0", optional: true },
      "node_modules/optional-child": { version: "6.2.0", optional: true },
      "node_modules/tool": { version: "9.9.9", dev: true },
    },
  };
}

describe("production shrinkwrap builder", () => {
  it("derives the release lock directly from the checked-in source lock", async () => {
    const script = await readFile(
      join(process.cwd(), "scripts", "build-production-shrinkwrap.mjs"),
      "utf8",
    );

    expect(script).toContain("buildProductionShrinkwrap(sourceLock)");
    expect(script).not.toContain('from "node:child_process"');
    expect(script).not.toContain('"install"');
    expect(script).not.toContain("--package-lock-only");
  });

  it("prunes a deterministic production closure without resolving dependency ranges", () => {
    const source = sourceLockFixture();
    const snapshot = structuredClone(source);

    const production = buildProductionShrinkwrap(source);

    expect(Object.keys(production.packages)).toEqual([
      "",
      "node_modules/nested",
      "node_modules/required-peer",
      "node_modules/runtime",
    ]);
    expect(production.packages["node_modules/runtime"]).toEqual(
      source.packages["node_modules/runtime"],
    );
    expect(production.packages["node_modules/nested"]?.version).toBe("2.4.6");
    expect(production.packages["node_modules/required-peer"]?.version).toBe("3.8.1");
    expect(production.packages[""]?.devDependencies).toBeUndefined();
    expect(production.packages[""]?.optionalDependencies).toBeUndefined();
    expect(source).toEqual(snapshot);
  });

  it("fails closed when the checked-in source lock lacks a required package", () => {
    const source = sourceLockFixture();
    delete source.packages["node_modules/nested"];

    expect(() => buildProductionShrinkwrap(source)).toThrow(
      "cannot resolve nested from node_modules/runtime",
    );
  });
});
