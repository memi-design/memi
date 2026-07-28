import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("runtime schema release surface", () => {
  it("regenerates the cross-language contract during builds and checks drift before release", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../../package.json", import.meta.url), "utf-8"),
    );
    const build = await readFile(new URL("../../../scripts/build.mjs", import.meta.url), "utf-8");
    const release = await readFile(new URL("../../../scripts/check-release.mjs", import.meta.url), "utf-8");

    expect(packageJson.scripts["build:runtime-schema"]).toBeDefined();
    expect(packageJson.scripts["check:runtime-schema"]).toBeDefined();
    expect(packageJson.files).toContain("schemas/memi-runtime-trace-v1.schema.json");
    expect(build).toContain("build-runtime-schema.ts");
    expect(release).toContain("check:runtime-schema");
  });
});
