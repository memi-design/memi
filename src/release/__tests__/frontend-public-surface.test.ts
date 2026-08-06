import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("frontend reliability public surface", () => {
  it("ships versioned contracts through a dedicated package subpath", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    const barrel = await readFile(resolve(root, "src/frontend/index.ts"), "utf8");

    expect(packageJson.exports["./frontend"]).toEqual({
      import: "./dist/frontend/index.js",
      types: "./dist/frontend/index.d.ts",
    });
    expect(barrel).toContain("./task-contract.js");
    expect(barrel).toContain("./repository-design-index.js");
    expect(barrel).toContain("./context-capsule.js");
  });
});
