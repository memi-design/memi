import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const artifactPath = join(
  root,
  "docs",
  "audits",
  "memi-candidate-head-validation-2026-07-27.json",
);
const scorecardPath = join(root, "docs", "audits", "memi-100-scorecard.json");
const ciWorkflowPath = join(root, ".github", "workflows", "ci.yml");

describe("candidate head validation evidence", () => {
  it("checks out full history before validating commit ancestry", async () => {
    const workflow = await readFile(ciWorkflowPath, "utf8");
    const buildAndTest = workflow.slice(
      workflow.indexOf("  build-and-test:"),
      workflow.indexOf("  memi-ci:"),
    );

    expect(buildAndTest).toMatch(
      /actions\/checkout@[^\n]+\n\s+with:\n\s+fetch-depth: 0/,
    );
  });

  it("binds the audited subject to successful hosted and clean-install proof", async () => {
    const artifactBytes = await readFile(artifactPath);
    const artifact = JSON.parse(artifactBytes.toString("utf8")) as {
      commit: string;
      assessment: string;
      hostedRuns: Array<{
        workflow: string;
        conclusion: string;
        url: string;
        headSha: string;
        runAttempt: number;
        jobs: string[];
      }>;
      cleanInstallMatrix: Array<{ os: string; node: number; conclusion: string }>;
    };
    const scorecard = JSON.parse(await readFile(scorecardPath, "utf8")) as {
      subject: { commit: string };
      evidence: Array<{
        id: string;
        status: string;
        artifact: { sha256: string };
      }>;
      dimensions: Array<{
        id: string;
        criteria: Array<{ id: string; evidenceIds: string[] }>;
      }>;
    };
    const evidence = scorecard.evidence.find(
      (entry) => entry.id === "candidate-head-validation",
    );
    const testing = scorecard.dimensions.find(
      (dimension) => dimension.id === "testing-and-operations",
    );
    const criterion = testing?.criteria.find(
      (entry) => entry.id === "candidate-verification",
    );

    expect(artifact.assessment).toBe("passed");
    expect(artifact.commit).toBe(scorecard.subject.commit);
    expect(() =>
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", artifact.commit, "HEAD"],
        { cwd: root, stdio: "pipe" },
      ),
    ).not.toThrow();
    expect(artifact.hostedRuns.map((run) => run.workflow).sort()).toEqual([
      "CI",
      "Clean install compatibility",
      "HOL Plugin Scanner",
    ]);
    expect(
      artifact.hostedRuns.every(
        (run) =>
          run.conclusion === "success" &&
          run.headSha === artifact.commit &&
          run.runAttempt === 1 &&
          run.jobs.length > 0 &&
          /^https:\/\/github\.com\/sarveshsea\/memi\/actions\/runs\/\d+$/.test(
            run.url,
          ),
      ),
    ).toBe(true);
    expect(artifact.cleanInstallMatrix).toHaveLength(9);
    expect(
      new Set(
        artifact.cleanInstallMatrix.map((cell) => `${cell.os}:${cell.node}`),
      ).size,
    ).toBe(9);
    expect(
      artifact.cleanInstallMatrix.every(
        (cell) =>
          ["ubuntu-latest", "macos-latest", "windows-latest"].includes(
            cell.os,
          ) &&
          [20, 22, 24].includes(cell.node) &&
          cell.conclusion === "success",
      ),
    ).toBe(true);
    expect(evidence).toMatchObject({
      status: "passed",
      artifact: {
        sha256: createHash("sha256").update(artifactBytes).digest("hex"),
      },
    });
    expect(criterion?.evidenceIds).toContain("candidate-head-validation");
  });
});
