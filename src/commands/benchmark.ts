import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";
import {
  benchmarkRunRecordSchema,
  benchmarkTaskSchema,
} from "../efficiency/contracts.js";
import { buildEfficiencyReport } from "../efficiency/evaluation.js";
import { createPairedBenchmarkPlan } from "../efficiency/plan.js";
import { calculateAdoptionMetrics } from "../efficiency/retention.js";
import { EfficiencyRunStore } from "../efficiency/store.js";
import { ui } from "../tui/format.js";

export function registerBenchmarkCommand(program: Command, engine: MemoireEngine): void {
  const benchmark = program
    .command("benchmark")
    .description("Plan, record, and evaluate paired baseline-versus-Memi experiments");

  benchmark
    .command("plan <tasks>")
    .requiredOption("--suite <id>", "Benchmark suite id")
    .requiredOption("--experiment <id>", "Experiment id")
    .option("--repeats <count>", "Paired repetitions per task", "3")
    .option("--seed <number>", "Deterministic randomization seed", "42")
    .option("--out <path>", "Plan output path")
    .option("--json", "Output JSON")
    .action(async (tasksPath: string, opts: {
      suite: string;
      experiment: string;
      repeats: string;
      seed: string;
      out?: string;
      json?: boolean;
    }) => {
      await engine.init("minimal");
      const tasks = benchmarkTaskSchema.array().parse(
        JSON.parse(await readFile(resolve(tasksPath), "utf-8")),
      );
      const plan = createPairedBenchmarkPlan({
        suiteId: opts.suite,
        experimentId: opts.experiment,
        repeats: positiveInteger(opts.repeats, "repeats"),
        seed: integer(opts.seed, "seed"),
        tasks,
      });
      const out = resolve(opts.out ?? join(
        engine.config.projectRoot,
        ".memoire",
        "efficiency",
        "plans",
        `${opts.experiment}.json`,
      ));
      await writeJson(out, plan);
      const payload = { status: "planned", path: out, plan };
      if (opts.json) console.log(JSON.stringify(payload, null, 2));
      else {
        console.log(ui.ok(`Paired benchmark plan: ${plan.trials.length} trials`));
        console.log(ui.dots("Plan", out));
      }
    });

  benchmark
    .command("record <run>")
    .option("--json", "Output JSON")
    .action(async (runPath: string, opts: { json?: boolean }) => {
      await engine.init("minimal");
      const record = benchmarkRunRecordSchema.parse(
        JSON.parse(await readFile(resolve(runPath), "utf-8")),
      );
      const store = new EfficiencyRunStore(engine.config.projectRoot);
      await store.append(record);
      const payload = { status: "recorded", path: store.path, run: record };
      if (opts.json) console.log(JSON.stringify(payload, null, 2));
      else console.log(ui.ok(`Recorded ${record.runId}`));
    });

  benchmark
    .command("report")
    .requiredOption("--suite <id>", "Benchmark suite id")
    .option("--minimum-pairs <count>", "Minimum valid pairs required", "5")
    .option("--bootstrap-samples <count>", "Bootstrap samples", "2000")
    .option("--seed <number>", "Deterministic bootstrap seed", "42")
    .option("--target <ratio>", "Required lower confidence bound", "0.25")
    .option("--out <path>", "Report output path")
    .option("--json", "Output JSON")
    .action(async (opts: {
      suite: string;
      minimumPairs: string;
      bootstrapSamples: string;
      seed: string;
      target: string;
      out?: string;
      json?: boolean;
    }) => {
      await engine.init("minimal");
      const store = new EfficiencyRunStore(engine.config.projectRoot);
      const report = buildEfficiencyReport({
        suiteId: opts.suite,
        runs: await store.list(),
        minimumPairs: positiveInteger(opts.minimumPairs, "minimum-pairs"),
        bootstrapSamples: positiveInteger(opts.bootstrapSamples, "bootstrap-samples"),
        seed: integer(opts.seed, "seed"),
        targetImprovement: ratio(opts.target, "target"),
      });
      const out = resolve(opts.out ?? join(
        engine.config.projectRoot,
        ".memoire",
        "efficiency",
        "reports",
        `${opts.suite}.json`,
      ));
      await writeJson(out, report);
      const payload = { status: report.status, path: out, report };
      if (opts.json) console.log(JSON.stringify(payload, null, 2));
      else {
        console.log(report.claim === "verified_gt_25"
          ? ui.ok("Efficiency claim verified")
          : ui.warn("Efficiency claim not verified"));
        console.log(ui.dots("Valid pairs", String(report.pairs.included)));
        console.log(ui.dots("Report", out));
      }
    });

  benchmark
    .command("retention")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      await engine.init("minimal");
      const store = new EfficiencyRunStore(engine.config.projectRoot);
      const metrics = calculateAdoptionMetrics(await store.list());
      if (opts.json) console.log(JSON.stringify({ metrics }, null, 2));
      else {
        console.log(ui.section("MEMI ADOPTION"));
        console.log(ui.dots("Successful first audits", String(metrics.successfulFirstAudits)));
        console.log(ui.dots("Repeat audit projects", String(metrics.repeatAuditProjects)));
        console.log(ui.dots("CI reuse projects", String(metrics.ciReuseProjects)));
      }
    });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
}

function integer(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}

function positiveInteger(value: string, label: string): number {
  const parsed = integer(value, label);
  if (parsed <= 0) throw new Error(`${label} must be positive`);
  return parsed;
}

function ratio(value: string, label: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
  return parsed;
}
