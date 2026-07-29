import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";
import { diagnoseAppQuality, type AppQualityDiagnosis, type AppQualitySeverity, type AppQualityIssue } from "../app-quality/engine.js";
import { loadPolicy } from "../app-quality/policy.js";
import { filterWithBaseline, readBaseline } from "../app-quality/baseline.js";
import { ui } from "../tui/format.js";
import { sanitizeDisplayText } from "../utils/output-sanitization.js";
import { buildRepositoryAgentAuditContext } from "../app-quality/agent-context.js";

interface DiagnoseOptions {
  json?: boolean;
  maxFiles?: string;
  write?: boolean;
  failOn?: string;
  baseline?: boolean;
  changed?: boolean;
  base?: string;
  files?: string[];
  expandImports?: boolean;
  trend?: boolean;
  failOnRegression?: string | boolean;
  agentContext?: boolean;
  contextFiles?: string;
  contextIssues?: string;
  contextRouting?: string;
}

const SEVERITY_RANK: Record<AppQualitySeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const FAIL_ON_VALUES = new Set(["critical", "high", "medium", "low", "none"]);

/**
 * Exit non-zero when any gating issue meets the threshold. Runs in BOTH output
 * modes — the previous gate only ran in human mode and only on "critical", a
 * severity the engine never emits, so `memi diagnose` shipped a CI gate that
 * could mathematically never fail.
 */
function shouldFail(gatingIssues: AppQualityIssue[], failOn: string): boolean {
  if (failOn === "none") return false;
  const threshold = SEVERITY_RANK[failOn as AppQualitySeverity];
  return gatingIssues.some((issue) => SEVERITY_RANK[issue.severity] >= threshold);
}

export function registerDiagnoseCommand(program: Command, engine: MemoireEngine): void {
  program
    .command("diagnose [target]")
    .description("Run a read-only design engineering audit on web or SwiftUI source, or a web URL")
    .option("--json", "Output the diagnosis as JSON")
    .option("--agent-context", "Emit bounded repository intelligence for a coding agent (implies JSON)")
    .option("--context-files <count>", "Maximum high-signal files in --agent-context", "40")
    .option("--context-issues <count>", "Maximum findings in --agent-context", "20")
    .option("--context-routing <mode>", "Agent-context routing: auto, full, index-only, or abstain", "auto")
    .option("--max-files <count>", "Maximum source files to scan", "500")
    .option("--no-write", "Do not write .memoire/app-quality reports")
    .option("--fail-on <severity>", "Exit non-zero when any issue is at or above this severity: critical, high, medium, low, or none. Defaults to the policy's gates.failOn (high without a policy).")
    .option("--baseline", "Gate only on findings NOT accepted in .memoire/baseline.json (suppressed counts always shown)")
    .option("--changed", "PR scope: emit only issues touching files changed vs --base (whole-tree stats still computed — this reduces noise, not runtime)")
    .option("--base <ref>", "Base ref for --changed (merge-base semantics)", "origin/main")
    .option("--files <paths...>", "Explicit file scope (repo-relative paths) instead of git diff")
    .option("--expand-imports", "Expand the scope with one hop of dependents via the import graph")
    .option("--trend", "Show the score trend from .memoire/app-quality/history.jsonl (comparable runs only: same policy hash, full scans)")
    .option("--fail-on-regression [points]", "Exit non-zero when the score drops more than [points] (default 0) vs the last comparable full-scan entry")
    .action(async (target: string | undefined, opts: DiagnoseOptions) => {
      try {
        const policy = await loadPolicy(engine.config.projectRoot);
        // Precedence: explicit CLI flag > committed policy > built-in default.
        const failOn = (opts.failOn ?? policy.gates.failOn).toLowerCase();
        if (!FAIL_ON_VALUES.has(failOn)) {
          throw new Error(`Invalid --fail-on value "${opts.failOn}". Use one of: critical, high, medium, low, none.`);
        }

        let scope: { files: string[]; base?: string; expandImports?: boolean } | undefined;
        if (opts.files && opts.files.length > 0) {
          scope = { files: opts.files, expandImports: opts.expandImports };
        } else if (opts.changed) {
          const { resolveGitScope } = await import("../app-quality/git-scope.js");
          const gitScope = await resolveGitScope({ projectRoot: engine.config.projectRoot, base: opts.base ?? "origin/main" });
          scope = { files: gitScope.files, base: gitScope.base, expandImports: opts.expandImports };
        }

        const maxFiles = Number.parseInt(opts.maxFiles ?? "500", 10);
        const diagnosis = await diagnoseAppQuality({
          projectRoot: engine.config.projectRoot,
          target,
          maxFiles: Number.isFinite(maxFiles) ? maxFiles : 500,
          write: opts.write !== false,
          policy,
          scope,
        });

        let gatingIssues = diagnosis.issues;
        let suppressedCount = 0;
        if (opts.baseline) {
          const baseline = await readBaseline(engine.config.projectRoot);
          if (!baseline) {
            throw new Error("--baseline was passed but .memoire/baseline.json does not exist. Run `memi baseline accept` first.");
          }
          const filtered = filterWithBaseline(diagnosis.issues, baseline);
          gatingIssues = filtered.active;
          suppressedCount = filtered.suppressed.length;
        }

        const failed = shouldFail(gatingIssues, failOn);

        // Regression check vs the last comparable full-scan history entry.
        let regression: import("../app-quality/history.js").RegressionCheck | undefined;
        if (opts.failOnRegression !== undefined || opts.trend) {
          const { readHistory, checkRegression, entryFromDiagnosis, renderTrend } = await import("../app-quality/history.js");
          const history = await readHistory(engine.config.projectRoot);
          const currentEntry = entryFromDiagnosis(diagnosis);
          if (opts.failOnRegression !== undefined) {
            const budget = typeof opts.failOnRegression === "string" ? Number.parseInt(opts.failOnRegression, 10) : 0;
            regression = checkRegression(currentEntry, history, Number.isFinite(budget) ? budget : 0);
          }
          if (opts.trend && !opts.json) {
            const lines = renderTrend(history, diagnosis.policy?.hash, currentEntry.coverageFingerprint);
            console.log(ui.section("Score trend (comparable runs)"));
            if (lines.length === 0) {
              console.log(ui.dim("  No comparable history yet — entries accrue on every full scan that writes reports under the same policy."));
            } else {
              for (const line of lines) console.log(ui.dim(`  ${line}`));
            }
          }
        }
        const regressionFailed = regression?.comparable === true && regression.regressed === true;

        if (opts.agentContext) {
          const context = await buildRepositoryAgentAuditContext(
            engine.config.projectRoot,
            diagnosis,
            {
              maxFiles: positiveInteger(opts.contextFiles ?? "40", "context-files"),
              maxIssues: positiveInteger(opts.contextIssues ?? "20", "context-issues"),
              routingMode: contextRoutingMode(opts.contextRouting ?? "auto"),
            },
          );
          console.log(JSON.stringify({
            ...context,
            gate: { failOn, failed, baselineApplied: Boolean(opts.baseline), gatingIssues: gatingIssues.length, suppressedByBaseline: suppressedCount, regression },
          }, null, 2));
          if (failed || regressionFailed) process.exitCode = 1;
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify({
            ...diagnosis,
            gate: { failOn, failed, baselineApplied: Boolean(opts.baseline), gatingIssues: gatingIssues.length, suppressedByBaseline: suppressedCount, regression },
          }, null, 2));
          if (failed || regressionFailed) process.exitCode = 1;
          return;
        }

        printDiagnosis(diagnosis, opts.write !== false);
        if (diagnosis.scope) {
          console.log(ui.dim(`  Scope: ${diagnosis.scope.emittedIssues} issue(s) touching ${diagnosis.scope.effectiveFiles} scoped file(s); ${diagnosis.scope.filteredOutIssues} out-of-scope issue(s) hidden (still reflected in scores)`));
        }
        if (suppressedCount > 0) {
          console.log(ui.dim(`  Baseline: ${suppressedCount} accepted finding(s) suppressed from gating (still counted above)`));
        }
        if (regression && !regression.comparable) {
          console.log(ui.dim(`  Regression check skipped: ${regression.reason}`));
        }
        if (regressionFailed && regression?.previous) {
          console.log(ui.fail(`Regression: score ${diagnosis.summary.score} dropped ${Math.abs(regression.delta ?? 0)} point(s) vs ${regression.previous.sha ?? regression.previous.at} (${regression.previous.score})`));
        }
        if (failed) {
          console.log(ui.fail(`Gate: at least one ${opts.baseline ? "new (non-baselined) " : ""}issue at or above "${failOn}" severity (--fail-on ${failOn})`));
          console.log();
        }
        if (failed || regressionFailed) {
          process.exitCode = 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (opts.json || opts.agentContext) {
          console.log(JSON.stringify({ status: "failed", error: message }));
        } else {
          console.log(ui.fail(message));
        }
        process.exitCode = 1;
      }
    });
}

function contextRoutingMode(
  value: string,
): "full" | "index-only" | "abstain" | undefined {
  if (value === "auto") return undefined;
  if (value === "full" || value === "index-only" || value === "abstain") {
    return value;
  }
  throw new Error(
    "context-routing must be auto, full, index-only, or abstain",
  );
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be positive`);
  }
  return parsed;
}

function printDiagnosis(diagnosis: AppQualityDiagnosis, wroteReports: boolean): void {
  console.log(ui.brand("Read-only design engineering audit"));
  console.log(ui.dots("Target", diagnosis.target));
  console.log(ui.dots("Score", `${diagnosis.summary.score}/100`));
  console.log(ui.dots("Verdict", diagnosis.summary.verdict));
  console.log(ui.dots("Files", String(diagnosis.summary.scannedFiles)));
  if (diagnosis.summary.scanMs !== undefined || diagnosis.summary.analysisMs !== undefined) {
    console.log(ui.dots(
      "Scan",
      `${diagnosis.summary.scanMs ?? 0}ms scan · ${diagnosis.summary.analysisMs ?? 0}ms total`,
    ));
  }
  console.log(ui.dots("Routes", String(diagnosis.summary.routes)));
  console.log(ui.dots("Components", String(diagnosis.summary.components)));
  if (diagnosis.sourceCoverage.web.scannedFiles > 0) {
    console.log(ui.dots("Web files", String(diagnosis.sourceCoverage.web.scannedFiles)));
    console.log(ui.dots("Tailwind classes", String(diagnosis.summary.tailwindClasses)));
  }
  if (diagnosis.sourceCoverage.swiftui.scannedFiles > 0) {
    console.log(ui.dots("SwiftUI files", `${diagnosis.sourceCoverage.swiftui.scannedFiles} (partial static checks)`));
  }
  if (diagnosis.sourceCoverage.metal.scannedFiles > 0) {
    console.log(ui.dots("Metal files", `${diagnosis.sourceCoverage.metal.scannedFiles} (unassessed)`));
  }
  if (diagnosis.unassessedDimensions.length > 0) {
    console.log(ui.dots("Unassessed", diagnosis.unassessedDimensions.join(", ")));
  }
  console.log();

  console.log(ui.section("Highest impact issues"));
  if (diagnosis.issues.length === 0) {
    console.log(diagnosis.unassessedDimensions.length > 0
      ? ui.dim("No findings from assessed checks; unassessed dimensions remain unverified")
      : ui.ok("No major app-quality issues detected"));
  } else {
    for (const issue of diagnosis.issues.slice(0, 6)) {
      const label = `${issue.severity.toUpperCase()} ${issue.category}`;
      console.log(`  [${label}] ${issue.title}`);
      console.log(`      ${issue.recommendation}`);
      if (issue.affectedFiles?.[0]) {
        const location = issue.evidenceLocations?.[0];
        const evidencePath = `${location?.file ?? issue.affectedFiles[0]}${location?.line ? `:${location.line}` : ""}`;
        console.log(ui.dim(`      evidence: ${sanitizeDisplayText(evidencePath)}`));
      }
      if (issue.confidence !== undefined || issue.estimatedEffort) {
        const confidence = issue.confidence !== undefined ? `${Math.round(issue.confidence * 100)}% confidence` : "";
        const effort = issue.estimatedEffort ? `${issue.estimatedEffort} effort` : "";
        console.log(ui.dim(`      ${[confidence, effort, issue.fixCategory].filter(Boolean).join(" · ")}`));
      }
    }
  }

  if (diagnosis.directions.length > 0) {
    console.log(ui.section("Design directions"));
    for (const direction of diagnosis.directions) {
      console.log(`  ${direction.id}  ${direction.name}`);
      console.log(`      ${direction.fit}`);
    }
  }

  console.log(ui.section("Next"));
  for (const action of diagnosis.nextActions) console.log(`  ${action}`);
  if (wroteReports) {
    console.log();
    console.log(ui.dim("  Reports written to .memoire/app-quality/diagnosis.{json,md}"));
  }
  console.log();
}
