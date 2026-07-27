/**
 * Design-Health Report composer — merges every persisted .memoire artifact
 * (diagnosis, UX tenets/traps, interface craft, skill compliance, score
 * trend) into ONE self-contained HTML file (inline CSS, zero external
 * requests) plus a markdown twin. A static file, not a web app — it can be
 * attached to a PR, uploaded as a CI artifact, or emailed.
 *
 * Honesty invariants carried through from the source reports: provenance
 * badges on findings, an explicit not-assessed legend, suppressed-baseline
 * counts, and the policy hash so every score is traceable to its thresholds.
 * --redact strips file excerpts (paths stay) for NDA-safe sharing.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppQualityDiagnosis } from "../app-quality/engine.js";
import type { UxAuditReport } from "../ux/tenets-traps.js";
import type { InterfaceCraftReport } from "../ux/interface-craft.js";
import { entryFromDiagnosis, readHistory, renderTrend, type HistoryEntry } from "../app-quality/history.js";
import { readBaseline, filterWithBaseline } from "../app-quality/baseline.js";
import { markdownCodeSpan } from "../utils/output-sanitization.js";

export interface ComposeReportOptions {
  projectRoot: string;
  /** Strip evidence excerpts/snippets — paths and counts only. */
  redact?: boolean;
}

export interface ComposedReport {
  html: string;
  markdown: string;
  score: number | null;
  generatedAt: string;
  sections: string[];
  missing: string[];
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

export async function composeReport(options: ComposeReportOptions): Promise<ComposedReport> {
  const dir = join(options.projectRoot, ".memoire", "app-quality");
  const [diagnosis, ux, craft, history, baseline] = await Promise.all([
    readJson<AppQualityDiagnosis>(join(dir, "diagnosis.json")),
    readJson<UxAuditReport>(join(dir, "ux-audit.json")),
    readJson<InterfaceCraftReport>(join(dir, "interface-craft.json")),
    readHistory(options.projectRoot),
    readBaseline(options.projectRoot).catch(() => null),
  ]);

  const sections: string[] = [];
  const missing: string[] = [];
  const generatedAt = new Date().toISOString();
  const redact = options.redact === true;

  const md: string[] = [
    "# Design Health Report",
    "",
    `Generated: ${generatedAt}`,
  ];
  const body: string[] = [];

  if (diagnosis) {
    sections.push("diagnosis");
    const unassessed = diagnosis.unassessedDimensions ?? [];
    const coverage = diagnosis.sourceCoverage;
    md.push(
      "",
      "## App Quality",
      "",
      `Score: **${diagnosis.summary.score}/100** (${diagnosis.summary.verdict})`,
      `Policy: \`${diagnosis.policy?.hash ?? "default"}\` (${diagnosis.policy?.preset ?? "memi-recommended"})`,
      `Scanned: ${diagnosis.summary.scannedFiles} files`,
      ...(coverage ? [
        `Source coverage: web ${coverage.web.scannedFiles} (${coverage.web.analysis}), SwiftUI ${coverage.swiftui.scannedFiles} (${coverage.swiftui.analysis}), Metal ${coverage.metal.scannedFiles} (${coverage.metal.analysis})`,
      ] : []),
      `Unassessed dimensions: ${unassessed.length > 0 ? unassessed.join(", ") : "none"}`,
    );
    let suppressed = 0;
    if (baseline) {
      suppressed = filterWithBaseline(diagnosis.issues, baseline).suppressed.length;
      md.push(`Baseline: ${suppressed} accepted finding(s) suppressed from gating (visible below)`);
    }
    md.push("", "### Findings", "");
    if (diagnosis.issues.length === 0) {
      md.push(unassessed.length > 0
        ? "- No findings from assessed checks. Unassessed dimensions remain unverified."
        : "- No issues detected by the static scan.");
    }
    for (const issue of diagnosis.issues) {
      md.push(`- **[${issue.severity.toUpperCase()}] ${issue.title}** \`${issue.id}\``);
      md.push(`  - ${redact ? "(evidence redacted)" : issue.detail}`);
      const location = issue.evidenceLocations?.[0];
      if (location) {
        const path = markdownCodeSpan(`${location.file}${location.line ? `:${location.line}` : ""}`);
        const excerpt = redact || !location.excerpt ? "" : ` — ${markdownCodeSpan(location.excerpt.slice(0, 120))}`;
        md.push(`  - Evidence: ${path}${excerpt}`);
      }
      md.push(`  - Fix: ${issue.recommendation}`);
    }

    body.push(htmlSection("App Quality", [
      scoreRow(diagnosis.summary.score, diagnosis.summary.verdict),
      `<p class="meta">Policy <code>${escapeHtml(diagnosis.policy?.hash ?? "default")}</code> (${escapeHtml(diagnosis.policy?.preset ?? "memi-recommended")}) · ${diagnosis.summary.scannedFiles} files scanned${coverage ? ` · SwiftUI ${coverage.swiftui.scannedFiles} (${coverage.swiftui.analysis}) · Metal ${coverage.metal.scannedFiles} (${coverage.metal.analysis})` : ""}${suppressed ? ` · ${suppressed} baselined finding(s) suppressed from gating` : ""}</p>`,
      unassessed.length > 0
        ? `<p class="legend">Unassessed dimensions remain unverified: ${escapeHtml(unassessed.join(", "))}.</p>`
        : "",
      diagnosis.issues.length === 0
        ? unassessed.length > 0
          ? `<p class="legend">No findings from assessed checks. This is not a whole-product pass.</p>`
          : `<p class="ok">No issues detected by the static scan.</p>`
        : `<ul class="findings">${diagnosis.issues.map((issue) => {
            const location = issue.evidenceLocations?.[0];
            return `<li><span class="sev sev-${issue.severity}">${issue.severity}</span> <strong>${escapeHtml(issue.title)}</strong> <code>${escapeHtml(issue.id)}</code><span class="prov">static-scan</span>` +
              `${redact ? "" : `<div class="detail">${escapeHtml(issue.detail)}</div>`}` +
              `${location ? `<div class="evidence"><code>${escapeHtml(location.file)}${location.line ? `:${location.line}` : ""}</code>${redact || !location.excerpt ? "" : ` — <code>${escapeHtml(location.excerpt.slice(0, 120))}</code>`}</div>` : ""}` +
              `<div class="fix">${escapeHtml(issue.recommendation)}</div></li>`;
          }).join("")}</ul>`,
    ]));
  } else {
    missing.push("diagnosis (run `memi diagnose` first)");
  }

  if (ux) {
    sections.push("ux-audit");
    const notAssessedTenets = ux.tenetCoverage.filter((tenet) => tenet.status === "not-assessed");
    md.push(
      "",
      "## UX Tenets & Traps",
      "",
      `Score: **${ux.score}/100**`,
      "",
      ...ux.tenetCoverage.map((tenet) => `- ${tenet.name}: ${tenet.status}`),
    );
    body.push(htmlSection("UX Tenets & Traps", [
      scoreRow(ux.score),
      `<table class="grid"><tr><th>Tenet</th><th>Status</th></tr>${ux.tenetCoverage.map((tenet) =>
        `<tr><td>${escapeHtml(tenet.name)}</td><td><span class="status status-${tenet.status}">${tenet.status}</span></td></tr>`,
      ).join("")}</table>`,
      `<table class="grid"><tr><th>Trap</th><th>Status</th><th>Risk</th></tr>${ux.trapRisks.map((trap) =>
        `<tr><td>${escapeHtml(trap.name)}</td><td><span class="status status-${trap.status}">${trap.status}</span></td><td>${trap.status === "not-assessed" ? "—" : `${trap.riskScore}/100`}</td></tr>`,
      ).join("")}</table>`,
      notAssessedTenets.length > 0
        ? `<p class="legend">not-assessed = no static evidence path exists — unverified, NOT verified-good.</p>`
        : "",
    ]));
  } else {
    missing.push("ux-audit (run `memi ux audit` first)");
  }

  if (craft) {
    sections.push("interface-craft");
    md.push(
      "",
      "## Interface Craft",
      "",
      `Score: **${craft.score}/100**`,
      "",
      ...craft.dimensions.map((dimension) => `- ${dimension.name}: ${dimension.status}${dimension.score === null ? "" : ` (${dimension.score}/100)`}`),
    );
    body.push(htmlSection("Interface Craft", [
      scoreRow(craft.score),
      `<table class="grid"><tr><th>Dimension</th><th>Lens</th><th>Status</th><th>Score</th></tr>${craft.dimensions.map((dimension) =>
        `<tr><td>${escapeHtml(dimension.name)}</td><td>${dimension.lens}</td><td><span class="status status-${dimension.status}">${dimension.status}</span></td><td>${dimension.score === null ? "—" : `${dimension.score}/100`}</td></tr>`,
      ).join("")}</table>`,
    ]));
  } else {
    missing.push("interface-craft (run `memi craft audit` first)");
  }

  if (diagnosis?.compliance && diagnosis.compliance.findings.length > 0) {
    sections.push("skill-compliance");
    md.push(
      "",
      "## Skill Compliance",
      "",
      `${diagnosis.compliance.summary.critical} critical · ${diagnosis.compliance.summary.warning} warning across ${diagnosis.compliance.summary.filesChecked} files`,
      "",
      ...diagnosis.compliance.findings.slice(0, 30).map((finding) => `- [${finding.severity}] \`${finding.file}\`: ${finding.message}`),
    );
    body.push(htmlSection("Skill Compliance (ATOMIC_DESIGN.md / MOTION_VIDEO_DESIGN.md)", [
      `<p class="meta">${diagnosis.compliance.summary.critical} critical · ${diagnosis.compliance.summary.warning} warning · ${diagnosis.compliance.summary.filesChecked} files checked</p>`,
      `<ul class="findings">${diagnosis.compliance.findings.slice(0, 50).map((finding) =>
        `<li><span class="sev sev-${finding.severity === "critical" ? "critical" : "medium"}">${finding.severity}</span> <code>${escapeHtml(finding.file)}</code><div class="detail">${escapeHtml(finding.message)}</div><div class="fix">${escapeHtml(finding.fix ?? "")} <em>${escapeHtml(finding.docRef)}</em></div></li>`,
      ).join("")}</ul>`,
    ]));
  }

  const trendLines = renderTrend(
    history,
    diagnosis?.policy?.hash,
    diagnosis ? entryFromDiagnosis(diagnosis).coverageFingerprint : undefined,
    15,
  );
  if (trendLines.length > 0) {
    const coverageFingerprint = diagnosis ? entryFromDiagnosis(diagnosis).coverageFingerprint : undefined;
    const comparableHistory = history.filter((entry) =>
      entry.scope === "full"
      && entry.policyHash === diagnosis?.policy?.hash
      && (coverageFingerprint === undefined || entry.coverageFingerprint === coverageFingerprint),
    ).slice(-15);
    sections.push("trend");
    md.push("", "## Score Trend", "", ...trendLines.map((line) => `- ${line}`));
    body.push(htmlSection("Score Trend", [
      trendSvg(comparableHistory),
      `<pre class="trend">${trendLines.map(escapeHtml).join("\n")}</pre>`,
    ]));
  }

  if (missing.length > 0) {
    md.push("", "## Not Included", "", ...missing.map((entry) => `- ${entry}`));
    body.push(htmlSection("Not Included", [
      `<ul>${missing.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>`,
    ]));
  }

  md.push("", "---", "", "Every finding above cites its source and re-runs identically: checkers check, gates gate — no LLM in the enforcement path.", "");

  const score = diagnosis?.summary.score ?? null;
  const html = htmlShell({
    title: "Design Health Report",
    generatedAt,
    score,
    policyHash: diagnosis?.policy?.hash,
    redacted: redact,
    body: body.join("\n"),
  });

  return { html, markdown: md.join("\n"), score, generatedAt, sections, missing };
}

function scoreRow(score: number, verdict?: string): string {
  const color = score >= 90 ? "#3fb950" : score >= 75 ? "#d29922" : score >= 60 ? "#f0883e" : "#f85149";
  return `<p class="score"><span class="score-num" style="color:${color}">${score}</span><span class="score-denom">/100</span>${verdict ? ` <span class="verdict">${escapeHtml(verdict)}</span>` : ""}</p>`;
}

function trendSvg(entries: HistoryEntry[]): string {
  if (entries.length < 2) return "";
  const width = 640;
  const height = 120;
  const pad = 12;
  const step = (width - pad * 2) / (entries.length - 1);
  const y = (score: number) => height - pad - ((score / 100) * (height - pad * 2));
  const points = entries.map((entry, index) => `${pad + index * step},${y(entry.score)}`).join(" ");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="score trend">
    <polyline points="${points}" fill="none" stroke="#3fb950" stroke-width="2"/>
    ${entries.map((entry, index) => `<circle cx="${pad + index * step}" cy="${y(entry.score)}" r="3" fill="#3fb950"><title>${entry.at.slice(0, 10)}: ${entry.score}</title></circle>`).join("")}
  </svg>`;
}

function htmlSection(title: string, blocks: string[]): string {
  return `<section><h2>${escapeHtml(title)}</h2>${blocks.filter(Boolean).join("\n")}</section>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

function htmlShell(input: { title: string; generatedAt: string; score: number | null; policyHash?: string; redacted: boolean; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 15px/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 880px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; color: #1f2328; background: #ffffff; }
  @media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } .grid th { background: #161b22; } code, pre { background: #161b22; } }
  h1 { font-size: 1.6rem; margin-bottom: .25rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 .75rem; border-bottom: 1px solid #d0d7de44; padding-bottom: .35rem; }
  .meta { color: #656d76; font-size: .85rem; margin: .25rem 0 .75rem; }
  .score { margin: .5rem 0; } .score-num { font-size: 2.2rem; font-weight: 700; } .score-denom { color: #656d76; } .verdict { margin-left: .5rem; color: #656d76; }
  .grid { border-collapse: collapse; width: 100%; margin: .75rem 0; font-size: .88rem; }
  .grid th, .grid td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #d0d7de44; }
  .findings { list-style: none; padding: 0; } .findings li { padding: .6rem 0; border-bottom: 1px solid #d0d7de33; }
  .sev { display: inline-block; font-size: .7rem; font-weight: 700; text-transform: uppercase; padding: .1rem .45rem; border-radius: 3px; color: #fff; margin-right: .4rem; }
  .sev-critical { background: #f85149; } .sev-high { background: #f0883e; } .sev-medium { background: #d29922; } .sev-low { background: #656d76; }
  .prov { font-size: .7rem; color: #656d76; border: 1px solid #d0d7de66; border-radius: 3px; padding: .05rem .35rem; margin-left: .4rem; }
  .status { font-size: .78rem; font-weight: 600; } .status-at-risk, .status-present, .status-needs-work { color: #f85149; } .status-watch { color: #d29922; } .status-protected, .status-strong, .status-clear { color: #3fb950; } .status-not-assessed, .status-unknown { color: #656d76; }
  .detail { color: #656d76; font-size: .85rem; margin-top: .2rem; } .evidence { font-size: .82rem; margin-top: .2rem; } .fix { font-size: .85rem; margin-top: .2rem; }
  .legend { font-size: .8rem; color: #656d76; font-style: italic; }
  .ok { color: #3fb950; }
  code, pre { font: .84em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f6f8fa; border-radius: 4px; padding: .1em .35em; }
  pre { padding: .75rem; overflow-x: auto; }
  footer { margin-top: 3rem; color: #656d76; font-size: .8rem; border-top: 1px solid #d0d7de44; padding-top: 1rem; }
</style>
</head>
<body>
<h1>${escapeHtml(input.title)}</h1>
<p class="meta">Generated ${escapeHtml(input.generatedAt)}${input.policyHash ? ` · policy <code>${escapeHtml(input.policyHash)}</code>` : ""}${input.redacted ? " · redacted (evidence excerpts removed)" : ""}</p>
${input.body}
<footer>Produced by memi (@memi-design/cli). Every finding cites its source and re-runs identically — checkers check, gates gate; no LLM in the enforcement path. "not-assessed" means no static evidence path exists: unverified, not verified-good.</footer>
</body>
</html>
`;
}
