// @ts-nocheck
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateInterfaceBenchmark,
} from "../../../scripts/lib/interface-benchmark.mjs";

const root = process.cwd();
const manifestPath = path.join(root, "benchmarks", "interfacebench-v1.json");

describe("Memi InterfaceBench", () => {
  it("defines a valid, unsaturated professional interface-work benchmark", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const result = await validateInterfaceBenchmark(manifest, { root });

    expect(result).toMatchObject({
      passed: true,
      benchmarkId: "memi-interfacebench-v1",
      targetTasks: 100,
      seedTasks: 5,
    });
    expect(result.failures).toEqual([]);
    expect(manifest.status).toBe("specification");
    expect(manifest.results).toBeNull();
    expect(manifest.protocol.conditions).toEqual(["baseline", "memi"]);
    expect(manifest.protocol.minimumIndependentRuns).toBe(3);
  });

  it("keeps work-product quality, source trust, and efficiency as separate scores", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(sumWeights(manifest.scorecards.workProduct.dimensions)).toBe(100);
    expect(sumWeights(manifest.scorecards.sourceTrust.dimensions)).toBe(100);
    expect(sumWeights(manifest.taskFamilies)).toBe(100);
    expect(manifest.scorecards.efficiency.role).toBe("pareto_metric");
    expect(manifest.scorecards.efficiency.toolCallRole).toBe("diagnostic_only");
    expect(manifest.releaseGates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "quality-non-inferiority" }),
      expect.objectContaining({ id: "positive-cost-evidence" }),
      expect.objectContaining({ id: "positive-latency" }),
      expect.objectContaining({ id: "repeat-stability" }),
    ]));
  });

  it("grounds every seed in a pinned executable workflow and authoritative methodology", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(manifest.seedTasks).toHaveLength(5);
    expect(manifest.seedTasks.every((task) =>
      /^[a-f0-9]{40}$/.test(task.repository.revision))).toBe(true);
    expect(manifest.seedTasks.every((task) =>
      task.workflowFile.startsWith("docs/case-studies/memi-2.7-workflows/"))).toBe(true);
    expect(manifest.references.map((reference) => reference.id)).toEqual(
      expect.arrayContaining([
        "harvey-biglaw-bench",
        "swe-bench-verified",
        "design2code",
        "webarena",
        "webdev-arena",
        "wcag-22",
        "core-web-vitals",
      ]),
    );
  });

  it("fails closed on inflated weights, missing workflows, or published claims without results", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const invalid = {
      ...manifest,
      status: "published",
      taskFamilies: manifest.taskFamilies.map((family, index) =>
        index === 0 ? { ...family, weight: family.weight + 1 } : family),
      seedTasks: manifest.seedTasks.map((task, index) =>
        index === 0 ? { ...task, workflowFile: "missing/workflow.json" } : task),
    };

    const result = await validateInterfaceBenchmark(invalid, { root });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      "task family weights must sum to 100, received 101",
      "published benchmark requires measured results",
      "seed task buzzr-unread-navigation references missing workflow missing/workflow.json",
    ]));
  });

  it("publishes the benchmark shape and measured candidate statistics honestly", async () => {
    const readme = await readFile(path.join(root, "README.md"), "utf8");

    expect(readme).toContain("Memi InterfaceBench");
    expect(readme).toContain("100 target tasks");
    expect(readme).toContain("5 pinned seed tasks");
    expect(readme).toContain("2,152/2,152 tests");
    expect(readme).toContain("70.57% statements");
    expect(readme).toContain("The greater-than-25% claim remains **not verified**");
    expect(readme).toContain("benchmarks/interfacebench-v1.json");
    expect(readme).toContain("docs/case-studies/memi-2.7-workflow-proof/results.json");
  });
});

function sumWeights(entries: readonly { weight: number }[]): number {
  return entries.reduce((total, entry) => total + entry.weight, 0);
}
