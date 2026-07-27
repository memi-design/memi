import type { Command } from "commander";
import { stat } from "node:fs/promises";
import type { MemoireEngine } from "../engine/core.js";
import { auditContextFromDiagnosis, diagnoseAppQuality } from "../app-quality/engine.js";
import { buildUxAuditReport, writeUxAuditReport, type UxAuditReport } from "../ux/tenets-traps.js";
import { ui } from "../tui/format.js";

interface UxAuditOptions {
  json?: boolean;
  maxFiles?: string;
  screenshot?: string;
  write?: boolean;
}

export function registerUxCommand(program: Command, engine: MemoireEngine): void {
  const ux = program
    .command("ux")
    .description("Audit UX tenets and traps from app-quality evidence or screenshot artifacts");

  ux
    .command("audit [target]")
    .description("Audit a screen, app, or screenshot for UX tenets and traps")
    .option("--json", "Output stable JSON")
    .option("--max-files <count>", "Maximum source files to scan", "500")
    .option("--screenshot <path>", "Screenshot artifact path to include in the audit")
    .option("--no-write", "Do not write .memoire/app-quality/ux-audit reports")
    .action(async (target: string | undefined, opts: UxAuditOptions) => {
      try {
        const maxFiles = Number.parseInt(opts.maxFiles ?? "500", 10);
        const report = await createUxAuditReport({
          projectRoot: engine.config.projectRoot,
          target,
          screenshot: opts.screenshot,
          maxFiles: Number.isFinite(maxFiles) ? maxFiles : 500,
        });

        if (opts.write !== false) await writeUxAuditReport(engine.config.projectRoot, report);

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        printUxAudit(report, opts.write !== false);
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

async function createUxAuditReport(options: {
  projectRoot: string;
  target?: string;
  screenshot?: string;
  maxFiles: number;
}): Promise<UxAuditReport> {
  if (options.screenshot) await assertReadableScreenshot(options.screenshot);

  if (options.screenshot && !options.target) {
    return buildUxAuditReport({
      target: "screenshot",
      artifactPath: options.screenshot,
      source: "screenshot",
    });
  }

  const diagnosis = await diagnoseAppQuality({
    projectRoot: options.projectRoot,
    target: options.target,
    maxFiles: options.maxFiles,
    write: false,
  });

  if (!options.screenshot) return diagnosis.ux;

  const auditContext = auditContextFromDiagnosis(diagnosis);
  return buildUxAuditReport({
    target: diagnosis.target,
    issues: diagnosis.issues,
    appQualityScore: diagnosis.summary.score,
    artifactPath: options.screenshot,
    source: "screenshot",
    ...auditContext,
  });
}

async function assertReadableScreenshot(path: string): Promise<void> {
  const info = await stat(path).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Screenshot artifact is not readable: ${path}. ${message}`);
  });
  if (!info.isFile()) {
    throw new Error(`Screenshot artifact is not a file: ${path}`);
  }
}

function printUxAudit(report: UxAuditReport, wroteReports: boolean): void {
  console.log(ui.brand("Memoire UX Tenets and Traps"));
  console.log(ui.dots("Target", report.target));
  console.log(ui.dots("Score", `${report.score}/100`));
  if (report.artifactPath) console.log(ui.dots("Artifact", report.artifactPath));
  console.log();

  const traps = report.trapRisks.filter((risk) => risk.status !== "clear").slice(0, 6);
  console.log(ui.section("Trap risks"));
  if (traps.length === 0) {
    console.log(ui.ok("No major UX trap risk detected"));
  } else {
    for (const trap of traps) {
      console.log(`  [${trap.status.toUpperCase()}] ${trap.name}`);
      console.log(ui.dim(`      ${trap.defaultFix}`));
    }
  }

  console.log(ui.section("Recommended tweaks"));
  for (const tweak of report.recommendedTweaks.slice(0, 6)) {
    console.log(`  ${tweak}`);
  }
  if (report.recommendedTweaks.length === 0) console.log(ui.ok("Preserve current tenets and keep collecting evidence"));
  if (wroteReports) {
    console.log();
    console.log(ui.dim("  Reports written to .memoire/app-quality/ux-audit.{json,md}"));
  }
  console.log();
}
