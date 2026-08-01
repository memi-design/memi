import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("prospective runner CLI separation", () => {
  it("uses a hash-pinned current harness for admission while preserving the candidate runtime", async () => {
    const source = await readFile(
      path.resolve("scripts/run-empirical-40.ts"),
      "utf8",
    );

    expect(source).toContain("const candidateCliEntry = path.join(");
    expect(source).toContain("const harnessCliEntry = path.resolve(options.harnessCli);");
    expect(source).toContain(
      "await hashFile(harnessCliEntry) !== options.harnessCliSha256",
    );
    expect(source).toContain('"harness-cli"');
    expect(source).toContain('"harness-cli-sha256"');
    expect(source).toContain("args: [\n      harnessCliEntry,\n      \"benchmark\",\n      \"prospective-evaluate\"");
  });
});
