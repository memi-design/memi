/**
 * GitHub step-summary markdown — the at-a-glance block a reviewer sees on the
 * workflow run page ($GITHUB_STEP_SUMMARY). Pure string builder.
 */

import type { AppQualityIssue } from "../app-quality/engine.js";
import type { RegressionCheck } from "../app-quality/history.js";
import { markdownCodeSpan } from "../utils/output-sanitization.js";

export interface StepSummaryInput {
  score: number;
  verdict: string;
  policyHash?: string;
  failOn: string;
  failed: boolean;
  gatingIssues: AppQualityIssue[];
  suppressedByBaseline: number;
  scopedFiles?: number;
  regression?: RegressionCheck;
  unassessedDimensions?: string[];
}

export function renderStepSummary(input: StepSummaryInput): string {
  const lines: string[] = [
    "## memi design CI",
    "",
    `| | |`,
    `|---|---|`,
    `| Score | **${input.score}/100** (${input.verdict}) |`,
    `| Gate | ${input.failed ? "❌ failed" : "✅ passed"} (fail-on: ${input.failOn}) |`,
  ];
  if (input.policyHash) lines.push(`| Policy | \`${input.policyHash}\` |`);
  if (input.scopedFiles !== undefined) lines.push(`| PR scope | ${input.scopedFiles} changed file(s) |`);
  if (input.suppressedByBaseline > 0) lines.push(`| Baseline | ${input.suppressedByBaseline} accepted finding(s) suppressed |`);
  if (input.regression?.comparable && input.regression.previous) {
    const delta = input.regression.delta ?? 0;
    const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "＝";
    lines.push(`| Trend | ${arrow} ${delta >= 0 ? "+" : ""}${delta} vs ${input.regression.previous.sha ?? input.regression.previous.at.slice(0, 10)} (${input.regression.previous.score}) ${input.regression.regressed ? "❌ over budget" : ""} |`);
  }

  lines.push("");
  if (input.gatingIssues.length === 0) {
    if ((input.unassessedDimensions?.length ?? 0) > 0) {
      lines.push("No gating findings from assessed checks.");
      lines.push(`Unassessed dimensions remain unverified: ${input.unassessedDimensions?.join(", ")}.`);
    } else {
      lines.push("No new gating findings. 🎉");
    }
  } else {
    lines.push(`### Gating findings (${input.gatingIssues.length})`, "");
    for (const issue of input.gatingIssues.slice(0, 15)) {
      const location = issue.evidenceLocations?.[0];
      lines.push(`- **[${issue.severity.toUpperCase()}] ${issue.title}**${location ? ` — ${markdownCodeSpan(`${location.file}${location.line ? `:${location.line}` : ""}`)}` : ""}`);
      lines.push(`  - ${issue.recommendation}`);
    }
    if (input.gatingIssues.length > 15) {
      lines.push(`- …and ${input.gatingIssues.length - 15} more (see the SARIF annotations / report artifact).`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
