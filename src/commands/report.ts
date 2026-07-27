/**
 * `memi report` — one self-contained design-health artifact (HTML + markdown
 * twin, optional SVG badge) composed from every persisted .memoire report.
 * Static files only: attach to a PR, upload as a CI artifact, or email —
 * explicitly not a web app.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";
import { auditContextFromDiagnosis, diagnoseAppQuality } from "../app-quality/engine.js";
import { loadPolicy } from "../app-quality/policy.js";
import { buildUxAuditReport, writeUxAuditReport } from "../ux/tenets-traps.js";
import { buildInterfaceCraftReport, writeInterfaceCraftReport } from "../ux/interface-craft.js";
import { composeReport } from "../reporters/report-html.js";
import { renderBadgeSvg } from "../reporters/badge.js";
import { ui } from "../tui/format.js";

interface ReportOptions {
  json?: boolean;
  out?: string;
  redact?: boolean;
  badge?: boolean;
  fresh?: boolean;
  maxFiles?: string;
}

export function registerReportCommand(program: Command, engine: MemoireEngine): void {
  program
    .command("report [target]")
    .description("Compose one self-contained design-health report (HTML + markdown, optional badge) from all persisted audits")
    .option("--out <dir>", "Output directory (default .memoire/app-quality)")
    .option("--redact", "Strip evidence excerpts — paths and counts only, for NDA-safe sharing")
    .option("--badge", "Also write a deterministic design-health SVG badge")
    .option("--no-fresh", "Compose from existing persisted artifacts without re-scanning")
    .option("--max-files <count>", "Maximum source files to scan when refreshing", "500")
    .option("--json", "Output report metadata as JSON")
    .action(async (target: string | undefined, opts: ReportOptions) => {
      try {
        const projectRoot = engine.config.projectRoot;

        // Fresh by default: refresh all three underlying artifacts so the
        // composed report never silently mixes runs from different commits.
        if (opts.fresh !== false) {
          const policy = await loadPolicy(projectRoot);
          const maxFiles = Number.parseInt(opts.maxFiles ?? "500", 10);
          const diagnosis = await diagnoseAppQuality({
            projectRoot,
            target,
            maxFiles: Number.isFinite(maxFiles) ? maxFiles : 500,
            write: true,
            policy,
          });
          const auditContext = auditContextFromDiagnosis(diagnosis);
          await writeUxAuditReport(projectRoot, buildUxAuditReport({
            target: diagnosis.target,
            issues: diagnosis.issues,
            appQualityScore: diagnosis.summary.score,
            ...auditContext,
          }));
          await writeInterfaceCraftReport(projectRoot, buildInterfaceCraftReport({
            target: diagnosis.target,
            issues: diagnosis.issues,
            appQualityScore: diagnosis.summary.score,
            ...auditContext,
          }));
        }

        const composed = await composeReport({ projectRoot, redact: opts.redact });

        const outDir = resolve(opts.out ?? join(projectRoot, ".memoire", "app-quality"));
        await mkdir(outDir, { recursive: true });
        const htmlPath = join(outDir, "design-health.html");
        const markdownPath = join(outDir, "design-health.md");
        await writeFile(htmlPath, composed.html, "utf-8");
        await writeFile(markdownPath, composed.markdown, "utf-8");

        let badgePath: string | undefined;
        if (opts.badge && composed.score !== null) {
          badgePath = join(outDir, "design-health-badge.svg");
          await writeFile(badgePath, renderBadgeSvg({ score: composed.score }), "utf-8");
        }

        if (opts.json) {
          console.log(JSON.stringify({
            status: "completed",
            htmlPath,
            markdownPath,
            badgePath,
            score: composed.score,
            sections: composed.sections,
            missing: composed.missing,
            redacted: opts.redact === true,
          }, null, 2));
          return;
        }

        console.log(ui.brand("Design Health Report"));
        if (composed.score !== null) console.log(ui.dots("Score", `${composed.score}/100`));
        console.log(ui.dots("Sections", composed.sections.join(", ") || "none"));
        if (composed.missing.length > 0) {
          console.log(ui.dots("Not included", composed.missing.join("; ")));
        }
        console.log(ui.dots("HTML", htmlPath));
        console.log(ui.dots("Markdown", markdownPath));
        if (badgePath) console.log(ui.dots("Badge", badgePath));
        if (opts.redact) console.log(ui.dim("  Redacted: evidence excerpts removed (paths retained)"));
        console.log();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          console.log(JSON.stringify({ status: "failed", error: message }));
        } else {
          console.log(ui.fail(message));
        }
        process.exitCode = 1;
      }
    });
}
