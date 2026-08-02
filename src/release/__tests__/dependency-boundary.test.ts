import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const dependencyLedgerPath = join(root, "docs", "DEPENDENCY_TRUST.md");

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

describe("runtime dependency boundary", () => {
  it("states the adoption-ready design-CI workflow in package metadata", async () => {
    const packageJson = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as { description?: string; keywords?: string[] };

    expect(packageJson.description).toBe(
      "Design CI for coding agents: read-only, file-anchored UI audits before merge.",
    );
    expect(packageJson.keywords).toEqual(expect.arrayContaining([
      "design-ci",
      "ui-audit",
      "tailwindcss",
      "shadcn",
      "mcp-server",
      "agent-skills",
      "github-actions",
    ]));
  });

  it("does not ship React when it only emits React source for consumer projects", async () => {
    const packageJson = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies).not.toHaveProperty("react");
  });

  it("ships an inspectable dependency trust ledger with the package", async () => {
    const ledger = await readFile(dependencyLedgerPath, "utf8");
    expect(ledger).toContain("# Dependency trust ledger");
    expect(ledger).toContain("npm audit");
    expect(ledger).toContain("Socket");

    expect(dryRunPackageFiles()).toContain("docs/DEPENDENCY_TRUST.md");
  });

  it("keeps installed-package README references inside the packed boundary", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    const packagedFiles = new Set(dryRunPackageFiles());
    const relativeDocs = [...readme.matchAll(/\]\((docs\/[^)#]+(?:\.md|\/))\)/g)]
      .map((match) => match[1]);

    expect(relativeDocs).not.toEqual([]);
    for (const path of relativeDocs) {
      expect(packagedFiles).toContain(path);
    }
  });
});
