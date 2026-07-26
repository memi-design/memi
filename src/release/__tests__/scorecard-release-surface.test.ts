import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("audit scorecard release surfaces", () => {
  it("never skips the scorecard gate in tagged binary release jobs", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8",
    );

    expect(workflow).not.toContain("SKIP_AUDIT_GATE");
    expect(workflow.match(/npm run check:release/g)).toHaveLength(2);
  });
});
