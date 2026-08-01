import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function dryRunPackageFiles(): string[] {
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--ignore-scripts", "--json"],
    {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  expect(result.status, result.stderr || result.stdout).toBe(0);
  const payload = JSON.parse(result.stdout) as Array<{
    files?: Array<{ path?: string }>;
  }>;
  return (payload[0]?.files ?? [])
    .map((entry) => entry.path)
    .filter((path): path is string => Boolean(path));
}

describe("immutable package documentation boundary", () => {
  it("excludes candidate-state release truth from the dry-run package manifest", () => {
    const files = dryRunPackageFiles();

    expect(files).toContain("README.md");
    expect(files).not.toContain("docs/CURRENT_RELEASE.md");
    expect(files).not.toContain("docs/RELEASE_GATES.md");
  });

  it("keeps the packed README Quickstart evergreen", async () => {
    const manifest = JSON.parse(
      await readFile(join(root, "release-manifest.json"), "utf8"),
    ) as {
      releaseGroups: {
        engine: { previousPublicRelease?: { version: string } };
      };
    };
    const readme = await readFile(join(root, "README.md"), "utf8");
    const quickstart = readme
      .slice(readme.indexOf("## Quickstart"))
      .split("\n## ", 1)[0];

    expect(quickstart).toContain("@memi-design/cli@latest diagnose");
    expect(quickstart).not.toContain(
      `@memi-design/cli@${manifest.releaseGroups.engine.previousPublicRelease?.version}`,
    );
  });
});
