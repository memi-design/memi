/**
 * `memi ci` — the one-command design gate for CI:
 *
 *   full-tree scan (thresholds stay valid) → PR scope (changed files) →
 *   baseline filter (only NEW findings gate) → severity + score gates →
 *   SARIF for PR annotations + step summary + optional report artifact.
 *
 * Gate composition, honestly stated: file-anchored findings gate by severity
 * within the PR scope; aggregate whole-tree rules (type-scale drift etc.)
 * never blame a PR per-file — they gate through the policy's minScore /
 * regressionBudget. Baseline suppression is always surfaced, never silent.
 */

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";
import { diagnoseAppQuality, type AppQualityIssue, type AppQualitySeverity } from "../app-quality/engine.js";
import { loadPolicy } from "../app-quality/policy.js";
import { readBaseline, filterWithBaseline } from "../app-quality/baseline.js";
import { resolveGitScope } from "../app-quality/git-scope.js";
import { readHistory, checkRegression, entryFromDiagnosis, type RegressionCheck } from "../app-quality/history.js";
import { toSarif } from "../reporters/sarif.js";
import { renderStepSummary } from "../reporters/step-summary.js";
import { getMemoirePackageVersion } from "../utils/package-version.js";
import { ui } from "../tui/format.js";

const SEVERITY_RANK: Record<AppQualitySeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

interface CiOptions {
  json?: boolean;
  base?: string;
  scope?: boolean;
  failOn?: string;
  sarif?: string;
  report?: boolean;
  maxFiles?: string;
}

export function registerCiCommand(program: Command, engine: MemoireEngine): void {
  program
    .command("ci [target]")
    .description("Run the full design gate for CI: scan, PR-scope, baseline-filter, gate, and emit SARIF + step summary")
    .option("--base <ref>", "Base ref for PR scoping (defaults to origin/$GITHUB_BASE_REF, then origin/main)")
    .option("--no-scope", "Gate on ALL findings instead of only PR-changed files")
    .option("--fail-on <severity>", "Override the policy's gate severity: critical, high, medium, low, none")
    .option("--sarif <path>", "SARIF output path", join(".memoire", "app-quality", "memi-results.sarif"))
    .option("--report", "Also write the design-health HTML report + badge as artifacts")
    .option("--max-files <count>", "Maximum source files to scan", "500")
    .option("--json", "Output the CI result as JSON")
    .action(async (target: string | undefined, opts: CiOptions) => {
      try {
        const projectRoot = engine.config.projectRoot;
        const policy = await loadPolicy(projectRoot);
        const failOn = (opts.failOn ?? policy.gates.failOn).toLowerCase();
        if (!["critical", "high", "medium", "low", "none"].includes(failOn)) {
          throw new Error(`Invalid --fail-on value "${opts.failOn}". Use one of: critical, high, medium, low, none.`);
        }

        // 1. Full-tree scan — always. Thresholds and scores need the whole
        //    tree; the scope below only narrows what BLAMES the PR.
        const maxFiles = Number.parseInt(opts.maxFiles ?? "500", 10);
        const diagnosis = await diagnoseAppQuality({
          projectRoot,
          target,
          maxFiles: Number.isFinite(maxFiles) ? maxFiles : 500,
          write: true,
          policy,
        });

        // 2. PR scope (on by default; --no-scope gates everything).
        let scopeFiles: Set<string> | null = null;
        let scopeBase: string | undefined;
        if (opts.scope !== false) {
          const base = opts.base
            ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
          const gitScope = await resolveGitScope({ projectRoot, base });
          scopeFiles = new Set(gitScope.files);
          scopeBase = gitScope.base;
        }

        // 3. Gate set: file-anchored findings within scope. Aggregates gate
        //    via minScore/regressionBudget, never per-file blame.
        let gating: AppQualityIssue[] = scopeFiles
          ? diagnosis.issues.filter((issue) => issue.affectedFiles?.some((file) => scopeFiles.has(file)))
          : diagnosis.issues;

        // 4. Baseline filter — auto-applied when the committed baseline exists.
        let suppressedByBaseline = 0;
        const baseline = await readBaseline(projectRoot);
        if (baseline) {
          const filtered = filterWithBaseline(gating, baseline);
          gating = filtered.active;
          suppressedByBaseline = filtered.suppressed.length;
        }

        // 5. Gates.
        const severityFailed = failOn !== "none"
          && gating.some((issue) => SEVERITY_RANK[issue.severity] >= SEVERITY_RANK[failOn as AppQualitySeverity]);
        const minScore = policy.gates.minScore;
        const minScoreFailed = minScore !== undefined && diagnosis.summary.score < minScore;
        const coverageFailed = diagnosis.assessedDimensions.length === 0;
        let regression: RegressionCheck | undefined;
        let regressionFailed = false;
        if (policy.gates.regressionBudget !== undefined) {
          const history = await readHistory(projectRoot);
          regression = checkRegression(entryFromDiagnosis(diagnosis), history, policy.gates.regressionBudget);
          regressionFailed = regression.comparable === true && regression.regressed === true;
        }
        const failed = severityFailed || minScoreFailed || regressionFailed || coverageFailed;

        // 6. Outputs.
        const sarifPath = resolve(projectRoot, opts.sarif ?? join(".memoire", "app-quality", "memi-results.sarif"));
        await mkdir(dirname(sarifPath), { recursive: true });
        const sarif = toSarif(gating, {
          toolVersion: getMemoirePackageVersion(),
          failOn: failOn as AppQualitySeverity | "none",
        });
        await writeFile(sarifPath, `${JSON.stringify(sarif, null, 2)}\n`, "utf-8");

        const summaryMarkdown = renderStepSummary({
          score: diagnosis.summary.score,
          verdict: diagnosis.summary.verdict,
          policyHash: diagnosis.policy?.hash,
          failOn,
          failed,
          gatingIssues: gating,
          suppressedByBaseline,
          scopedFiles: scopeFiles ? scopeFiles.size : undefined,
          regression,
          unassessedDimensions: diagnosis.unassessedDimensions,
        });
        if (process.env.GITHUB_STEP_SUMMARY) {
          await appendFile(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown, "utf-8").catch(() => {});
        }

        let reportPaths: { htmlPath: string; badgePath?: string } | undefined;
        if (opts.report) {
          const { composeReport } = await import("../reporters/report-html.js");
          const { renderBadgeSvg } = await import("../reporters/badge.js");
          const composed = await composeReport({ projectRoot });
          const outDir = join(projectRoot, ".memoire", "app-quality");
          const htmlPath = join(outDir, "design-health.html");
          await writeFile(htmlPath, composed.html, "utf-8");
          await writeFile(join(outDir, "design-health.md"), composed.markdown, "utf-8");
          let badgePath: string | undefined;
          if (composed.score !== null) {
            badgePath = join(outDir, "design-health-badge.svg");
            await writeFile(badgePath, renderBadgeSvg({ score: composed.score }), "utf-8");
          }
          reportPaths = { htmlPath, badgePath };
        }

        const result = {
          status: failed ? "failed" : "passed",
          score: diagnosis.summary.score,
          policyHash: diagnosis.policy?.hash,
          failOn,
          gates: {
            severity: { failed: severityFailed, gatingIssues: gating.length },
            minScore: minScore !== undefined ? { threshold: minScore, failed: minScoreFailed } : undefined,
            coverage: {
              failed: coverageFailed,
              reason: coverageFailed ? "no design dimensions were assessed" : undefined,
            },
            regression,
          },
          scope: scopeFiles ? { base: scopeBase, changedFiles: scopeFiles.size } : undefined,
          suppressedByBaseline,
          sarifPath,
          report: reportPaths,
        };

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(ui.brand("memi design CI"));
          console.log(ui.dots("Score", `${diagnosis.summary.score}/100`));
          console.log(ui.dots("Policy", diagnosis.policy?.hash ?? "default"));
          if (scopeFiles) console.log(ui.dots("PR scope", `${scopeFiles.size} changed file(s) vs ${scopeBase}`));
          if (suppressedByBaseline > 0) console.log(ui.dots("Baseline", `${suppressedByBaseline} accepted finding(s) suppressed`));
          console.log(ui.dots("SARIF", sarifPath));
          for (const issue of gating.slice(0, 10)) {
            console.log(`  [${issue.severity.toUpperCase()}] ${issue.title}`);
          }
          if (gating.length > 10) console.log(ui.dim(`  …and ${gating.length - 10} more (see SARIF / step summary)`));
          if (minScoreFailed) console.log(ui.fail(`Score ${diagnosis.summary.score} is below the policy minimum ${minScore}`));
          if (coverageFailed) console.log(ui.fail("No design dimensions were assessed"));
          if (regressionFailed && regression?.previous) {
            console.log(ui.fail(`Regression: ${regression.delta} point(s) vs ${regression.previous.sha ?? regression.previous.at} (budget ${policy.gates.regressionBudget})`));
          }
          console.log(failed ? ui.fail(`Gate failed (fail-on: ${failOn})`) : ui.ok(`Gate passed (fail-on: ${failOn})`));
          console.log();
        }
        if (failed) process.exitCode = 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          console.log(JSON.stringify({ status: "error", error: message }));
        } else {
          console.log(ui.fail(message));
        }
        process.exitCode = 1;
      }
    });
}
