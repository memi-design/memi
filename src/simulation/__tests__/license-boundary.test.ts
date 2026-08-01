import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { scanForkSourceLicenseBoundary } from "../license-boundary.js";

describe("fork source license boundary", () => {
  it("flags vendored third-party source markers but allows written references", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-license-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "docs"), { recursive: true });
      await writeFile(join(root, "README.md"), `${["Miro", "Fish"].join("")} is an optional AGPL fork adapter.\n`, "utf-8");
      await writeFile(join(root, "docs", "FORK_BRIDGE.md"), "Document the fork bridge.\n", "utf-8");
      await writeFile(join(root, "src", "copied.py"), "from camel_oasis import generate_reddit_agent_graph\n", "utf-8");

      const result = await scanForkSourceLicenseBoundary(root, {
        packageFiles: ["README.md", "docs/FORK_BRIDGE.md", "src/copied.py"],
      });

      expect(result.ok).toBe(false);
      expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: join("src", "copied.py"),
          marker: "generate_reddit_agent_graph",
        }),
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
