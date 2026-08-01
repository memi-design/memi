import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("public release state gate wiring", () => {
  it("requires independent live evidence for every parity surface", async () => {
    const source = await readFile(
      join(process.cwd(), "scripts", "check-public-release-gate.mjs"),
      "utf8",
    );

    expect(source).toContain("canClearPublicParityCap");
    expect(source).toContain("verifyPublishedEngineTransitionFromGit");
    expect(source).toContain("registry.modelcontextprotocol.io");
    expect(source).toContain("/git/ref/tags/");
    expect(source).toContain("SHA256SUMS.txt");
    expect(source).toContain("releaseArtifactUrl");
    expect(source).toContain("parityEligible");
    expect(source).toContain("verifyWebsiteArtifactEvidence");
  });
});
