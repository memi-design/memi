import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const dependencyLedgerPath = join(root, "docs", "DEPENDENCY_TRUST.md");
const v15SummaryPath = join(
  root,
  "docs",
  "research",
  "memi-2.7-prospective-study",
  "v15-2.7.3-confirmatory",
  "generated",
  "tables",
  "analysis_summary.json",
);

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
      "Read-only design engineering audit and skill layer for coding agents: file-anchored UI evidence before merge.",
    );
    expect(packageJson.keywords).toEqual(
      expect.arrayContaining([
        "design-ci",
        "ui-audit",
        "tailwindcss",
        "shadcn",
        "mcp-server",
        "agent-skills",
        "github-actions",
      ]),
    );
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
    const relativeDocs = [
      ...readme.matchAll(/\]\((docs\/[^)#]+(?:\.md|\/))\)/g),
    ].map((match) => match[1]);

    expect(relativeDocs).not.toEqual([]);
    for (const path of relativeDocs) {
      expect(packagedFiles).toContain(path);
    }
  });

  it("keeps measured evidence and copy-paste prompts claim-bounded", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");

    expect(readme).toContain("## Evidence at a glance");
    expect(readme).toContain("36 / 36");
    expect(readme).toContain("10 complete model-graded matched pairs");
    expect(readme).toContain("2,187 / 2,187");
    expect(readme).toContain("Separate historical release record");
    expect(readme).toContain("## Prompts that map to real workflows");
    expect(readme).toContain("Audit this frontend before editing it.");
    expect(readme).toContain("Turn the findings into a scoped UI change plan.");
    expect(readme).toContain(
      "Set up a deterministic design CI gate for this pull request.",
    );
    expect(readme).toContain(
      "No superiority, speed, or dollar-savings claim is made.",
    );

    const evidenceBlock = readme.match(
      /## Evidence at a glance([\s\S]*?)## Benchmarks and paper/,
    )?.[1];
    expect(evidenceBlock).toBeDefined();
    expect(evidenceBlock).not.toMatch(/Memi is (?:better|faster|cheaper)/i);
    expect(evidenceBlock).not.toMatch(/superior(?:ity)? (?:to|than|overall)/i);
  });

  it("ships a paper-backed benchmark preview instead of an unlinked metric list", async () => {
    const [readme, preview, summaryText] = await Promise.all([
      readFile(join(root, "README.md"), "utf8"),
      readFile(join(root, "assets", "readme-benchmark.svg"), "utf8"),
      readFile(v15SummaryPath, "utf8"),
    ]);
    const summary = JSON.parse(summaryText) as {
      nonInferiorityMargin: number;
      primarySummary: Array<{
        task_id: string;
        mean_delta: number;
        noninferiority_lower_95_one_sided: number;
        noninferior: boolean;
      }>;
      secondaryTests: Array<{ metric: string; reject_holm_0p05: boolean }>;
    };
    const buzzr = summary.primarySummary.find(
      (result) => result.task_id === "buzzr-tab-unread-badge",
    );
    const paraform = summary.primarySummary.find(
      (result) => result.task_id === "paraform-command-menu",
    );

    expect(readme).toContain("## Benchmarks and paper");
    expect(readme).toContain("assets/readme-benchmark.svg");
    expect(readme).toContain(
      "https://github.com/memi-design/memi/releases/download/v2.7.4/memi-2.7.3-confirmatory-audit.pdf",
    );
    expect(readme).toContain("Quality non-inferiority passed");
    expect(readme).toContain("0 / 21");
    expect(readme).toContain("InterfaceBench v1");
    expect(buzzr).toMatchObject({
      mean_delta: 1.4,
      noninferiority_lower_95_one_sided: 0.2,
      noninferior: true,
    });
    expect(paraform).toMatchObject({
      mean_delta: -0.4,
      noninferiority_lower_95_one_sided: -3.4,
      noninferior: true,
    });
    expect(summary.nonInferiorityMargin).toBe(-5);
    expect(summary.secondaryTests).toHaveLength(26);
    const resourceTests = summary.secondaryTests.filter(
      (result) =>
        !["functional_acceptance", "critical_defects"].includes(result.metric),
    );
    expect(resourceTests).toHaveLength(21);
    expect(resourceTests.some((result) => result.reject_holm_0p05)).toBe(false);
    expect(preview).toContain("mean +1.4");
    expect(preview).toContain("lower +0.2");
    expect(preview).toContain("mean −0.4");
    expect(preview).toContain("lower −3.4");
    expect(preview).toContain("0 / 21");
    expect(preview).toContain("Nate has no admitted");
    expect(preview).toContain("No speed, cost, or token-savings claim.");
    expect(dryRunPackageFiles()).toContain("assets/memi-brand-banner.webp");
    expect(dryRunPackageFiles()).toContain("assets/readme-benchmark.svg");
  });
});
