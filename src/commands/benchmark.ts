import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";
import {
  benchmarkConditionSchema,
  benchmarkRunRecordSchema,
  benchmarkTaskSchema,
  codexCaseStudyTaskSchema,
  type BenchmarkRunRecord,
} from "../efficiency/contracts.js";
import {
  benchmarkRepositoryRevision,
  benchmarkRepositoryStatus,
  runCodexCaseStudy,
} from "../efficiency/codex-runner.js";
import {
  createRegradeAmendment,
  gradeCaseStudyResponse,
} from "../efficiency/codex-evidence.js";
import {
  createClaudeWorkflowAdapter,
  createCodexWorkflowAdapter,
} from "../efficiency/workflow-adapters.js";
import { runWorkflowTrial } from "../efficiency/workflow-runner.js";
import {
  createWorkflowBenchmarkPlan,
  workflowTaskSchema,
  type WorkflowProvider,
} from "../efficiency/workflow.js";
import { buildEfficiencyReport } from "../efficiency/evaluation.js";
import { createPairedBenchmarkPlan } from "../efficiency/plan.js";
import { calculateAdoptionMetrics } from "../efficiency/retention.js";
import { EfficiencyRunStore } from "../efficiency/store.js";
import {
  formatRoutedSkillContext,
  NoteLoader,
  resolveRoutedSkills,
  buildRepositoryFingerprint,
  SkillFitnessRouteSchema,
  appendSkillFitnessEvent,
  buildSkillFitnessEvent,
  loadSkillFitnessEvents,
  projectSkillFitness,
} from "../notes/index.js";
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
    .command("workflow-plan <task>")
    .description("Plan paired multi-minute product workflow trials")
    .requiredOption("--suite <id>", "Benchmark suite id")
    .requiredOption("--experiment <id>", "Experiment id")
    .option("--providers <values>", "Comma-separated providers", "codex")
    .option("--repeats <count>", "Paired repetitions per provider", "3")
    .option("--seed <number>", "Deterministic ordering seed", "42")
    .option("--out <path>", "Plan output path")
    .option("--json", "Output JSON")
    .action(async (taskPath: string, opts: {
      suite: string;
      experiment: string;
      providers: string;
      repeats: string;
      seed: string;
      out?: string;
      json?: boolean;
    }) => {
      await engine.init("minimal");
      const task = workflowTaskSchema.parse(
        JSON.parse(await readFile(resolve(taskPath), "utf8")),
      );
      const plan = createWorkflowBenchmarkPlan({
        suiteId: opts.suite,
        experimentId: opts.experiment,
        task,
        providers: providers(opts.providers),
        repeats: positiveInteger(opts.repeats, "repeats"),
        seed: integer(opts.seed, "seed"),
      });
      const out = resolve(opts.out ?? join(
        engine.config.projectRoot,
        ".memoire",
        "efficiency",
        "plans",
        `${opts.experiment}-workflow.json`,
      ));
      await writeJson(out, plan);
      const payload = { status: "planned", path: out, plan };
      if (opts.json) console.log(JSON.stringify(payload, null, 2));
      else {
        console.log(ui.ok(`Workflow benchmark plan: ${plan.trials.length} trials`));
        console.log(ui.dots("Plan", out));
      }
    });

  benchmark
    .command("workflow-run <task>")
    .description("Run one isolated writable product workflow trial")
    .requiredOption("--condition <condition>", "baseline or memi")
    .requiredOption("--provider <provider>", "codex or claude")
    .requiredOption("--repository <path>", "Pinned clean Git repository")
    .requiredOption("--evidence-root <path>", "Private raw evidence root")
    .requiredOption("--store-root <path>", "External immutable run store root")
    .requiredOption("--suite <id>", "Benchmark suite id")
    .requiredOption("--experiment <id>", "Experiment id")
    .requiredOption("--repeat <count>", "Paired repetition number")
    .option("--skills-root <path>", "Root containing a skills/ catalog")
    .option("--capabilities <values>", "Comma-separated available capabilities", "")
    .option("--platforms <values>", "Comma-separated repository platforms", "")
    .option("--model <id>", "Provider model id")
    .option("--reasoning <effort>", "Reasoning effort", "medium")
    .option("--codex <path>", "Codex CLI path", "codex")
    .option("--claude <path>", "Claude Code path", "claude")
    .option("--execute", "Acknowledge model quota and disposable writes")
    .option("--json", "Output JSON")
    .action(async (taskPath: string, opts: {
      condition: string;
      provider: string;
      repository: string;
      evidenceRoot: string;
      storeRoot: string;
      suite: string;
      experiment: string;
      repeat: string;
      skillsRoot?: string;
      capabilities: string;
      platforms: string;
      model?: string;
      reasoning: string;
      codex: string;
      claude: string;
      execute?: boolean;
      json?: boolean;
    }) => {
      if (!opts.execute) {
        throw new Error(
          "workflow-run requires --execute because it invokes a model and writes to a disposable clone",
        );
      }
      const task = workflowTaskSchema.parse(
        JSON.parse(await readFile(resolve(taskPath), "utf8")),
      );
      const condition = benchmarkConditionSchema.parse(opts.condition);
      const provider = providers(opts.provider)[0];
      const modelId = opts.model ?? (
        provider === "codex" ? "gpt-5.6-sol" : "claude-sonnet-4-6"
      );
      let routedContext = "";
      let route: Awaited<ReturnType<typeof resolveRoutedSkills>> | null = null;
      if (condition === "memi") {
        const loader = opts.skillsRoot
          ? new NoteLoader(resolve(opts.skillsRoot))
          : engine.notes;
        if (!loader.loaded) await loader.loadAll();
        const repositoryFingerprint = await buildRepositoryFingerprint(
          resolve(opts.repository),
        );
        route = await resolveRoutedSkills({
          intent: task.intent,
          notes: loader.notes,
          capabilities: csv(opts.capabilities),
          platforms: csv(opts.platforms),
          repositoryFingerprint,
          maximumSkills: 2,
          maximumContextBytes: 8_000,
        });
        routedContext = formatRoutedSkillContext(route);
      }
      const adapter = provider === "codex"
        ? createCodexWorkflowAdapter({
          executable: opts.codex,
          modelId,
          reasoningEffort: opts.reasoning,
        })
        : createClaudeWorkflowAdapter({
          executable: opts.claude,
          modelId,
          reasoningEffort: opts.reasoning,
        });
      const startedAt = new Date();
      const result = await runWorkflowTrial({
        sourceRepository: resolve(opts.repository),
        evidenceRoot: resolve(opts.evidenceRoot),
        task,
        condition,
        routedContext,
        adapter,
      });
      const completedAt = new Date();
      const routePath = route
        ? join(result.evidenceDirectory, "skill-route.json")
        : null;
      if (routePath && route) await writeJson(routePath, route);
      const repositoryRoot = resolve(opts.repository);
      const failures = result.verification.filter((check) => !check.passed).length
        + (result.adapter.exitCode === 0 ? 0 : 1);
      const record = benchmarkRunRecordSchema.parse({
        schemaVersion: 1,
        runId: result.runId,
        experimentId: opts.experiment,
        suiteId: opts.suite,
        taskId: task.id,
        repeat: positiveInteger(opts.repeat, "repeat"),
        condition,
        invocation: "ci",
        repository: {
          pathHash: `sha256:${createHash("sha256").update(repositoryRoot).digest("hex")}`,
          revision: result.sourceRevision,
          dirty: false,
        },
        harness: {
          id: provider,
          modelId,
          reasoningEffort: opts.reasoning,
        },
        timing: {
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          wallTimeMs: result.durationMs,
          toolTimeMs: result.verification.reduce(
            (sum, check) => sum + check.durationMs,
            0,
          ),
        },
        usage: result.adapter.usage,
        tools: result.adapter.tools,
        outcome: {
          accepted: result.accepted,
          testsPassed: result.verification.every((check) => check.passed),
          qualityScore: result.accepted ? 100 : Math.max(0, 100 - failures * 25),
          defects: failures,
          humanInterventions: 0,
        },
        evidenceRefs: [
          join(result.evidenceDirectory, "git.patch"),
          join(result.evidenceDirectory, "preparation.json"),
          join(result.evidenceDirectory, "verification.json"),
          join(result.evidenceDirectory, "events.jsonl"),
          ...(routePath ? [routePath] : []),
          ...(result.adapter.usage.estimatedCostUsd === null
            ? [`estimatedCostUsd:unassessed-${provider}-subscription`]
            : []),
        ],
      });
      const store = new EfficiencyRunStore(resolve(opts.storeRoot));
      await store.append(record);
      await writeJson(join(result.evidenceDirectory, "run.json"), record);
      const payload = {
        status: result.accepted ? "accepted" : "failed-quality-gate",
        run: record,
        route: route?.route ?? null,
        evidenceDirectory: result.evidenceDirectory,
      };
      if (opts.json) console.log(JSON.stringify(payload, null, 2));
      else {
        console.log(result.accepted
          ? ui.ok(`Accepted ${result.runId}`)
          : ui.warn(`Quality gate failed for ${result.runId}`));
        console.log(ui.dots("Evidence", result.evidenceDirectory));
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
    .command("fitness-record")
    .description("Append skill fitness evidence from one exact paired workflow")
    .requiredOption("--baseline <run-id>", "Baseline run id")
    .requiredOption("--memi <run-id>", "Memi run id")
    .requiredOption("--route <path>", "Memi skill-route.json receipt")
    .requiredOption("--task-class <id>", "Stable task class")
    .requiredOption("--store-root <path>", "External immutable run store root")
    .option("--json", "Output JSON")
    .action(async (opts: {
      baseline: string;
      memi: string;
      route: string;
      taskClass: string;
      storeRoot: string;
      json?: boolean;
    }) => {
      const storeRoot = resolve(opts.storeRoot);
      const store = new EfficiencyRunStore(storeRoot);
      const runs = await store.list();
      const baseline = uniqueRun(runs, opts.baseline, "baseline");
      const memi = uniqueRun(runs, opts.memi, "memi");
      const route = SkillFitnessRouteSchema.parse(
        JSON.parse(await readFile(resolve(opts.route), "utf8")),
      );
      const event = buildSkillFitnessEvent({
        baseline,
        memi,
        route,
        taskClass: opts.taskClass,
      });
      const path = skillFitnessPath(storeRoot);
      await appendSkillFitnessEvent(path, event);
      const projection = projectSkillFitness(await loadSkillFitnessEvents(path));
      const payload = { status: "recorded", path, event, projection };
      if (opts.json) console.log(JSON.stringify(payload, null, 2));
      else {
        console.log(ui.ok(`Recorded fitness evidence ${event.eventId}`));
        console.log(ui.dots("Fitness store", path));
      }
    });

  benchmark
    .command("fitness")
    .description("Project content-addressed skill fitness recommendations")
    .requiredOption("--store-root <path>", "External immutable run store root")
    .option("--json", "Output JSON")
    .action(async (opts: { storeRoot: string; json?: boolean }) => {
      const path = skillFitnessPath(resolve(opts.storeRoot));
      const projection = projectSkillFitness(await loadSkillFitnessEvents(path));
      const payload = { status: "projected", path, projection };
      if (opts.json) console.log(JSON.stringify(payload, null, 2));
      else {
        console.log(ui.section("MEMI SKILL FITNESS"));
        console.log(ui.dots("Events", String(projection.events)));
        console.log(ui.dots("Skills", String(projection.skills.length)));
      }
    });

  benchmark
    .command("codex-run <task>")
    .description("Execute one isolated read-only Codex case-study trial and record its trace")
    .requiredOption("--condition <condition>", "baseline or memi")
    .requiredOption("--repository <path>", "Pinned clean Git worktree")
    .requiredOption("--suite <id>", "Benchmark suite id")
    .requiredOption("--experiment <id>", "Experiment id")
    .requiredOption("--repeat <count>", "Paired repetition number")
    .requiredOption("--evidence-dir <path>", "Private raw evidence directory")
    .requiredOption("--store-root <path>", "External root for immutable run records")
    .option("--codex <path>", "Codex CLI path", "codex")
    .option("--model <id>", "Model id", "gpt-5.6-sol")
    .option("--reasoning <effort>", "Reasoning effort", "medium")
    .option("--harness <id>", "Harness identity", "codex-cli-0.145.0")
    .option("--memi-cli <path>", "Candidate CLI entrypoint", process.argv[1])
    .option("--timeout-ms <milliseconds>", "Per-run timeout", "600000")
    .option("--execute", "Acknowledge that this invokes a model and consumes quota")
    .option("--json", "Output JSON")
    .action(async (taskPath: string, opts: {
      condition: string;
      repository: string;
      suite: string;
      experiment: string;
      repeat: string;
      evidenceDir: string;
      storeRoot: string;
      codex: string;
      model: string;
      reasoning: string;
      harness: string;
      memiCli: string;
      timeoutMs: string;
      execute?: boolean;
      json?: boolean;
    }) => {
      if (!opts.execute) {
        throw new Error("codex-run requires --execute because it invokes a model and consumes quota");
      }
      const task = codexCaseStudyTaskSchema.parse(
        JSON.parse(await readFile(resolve(taskPath), "utf-8")),
      );
      const result = await runCodexCaseStudy({
        repositoryRoot: resolve(opts.repository),
        task,
        condition: benchmarkConditionSchema.parse(opts.condition),
        suiteId: opts.suite,
        experimentId: opts.experiment,
        repeat: positiveInteger(opts.repeat, "repeat"),
        evidenceDirectory: resolve(opts.evidenceDir),
        codexPath: opts.codex,
        modelId: opts.model,
        reasoningEffort: opts.reasoning,
        harnessId: opts.harness,
        memiCliPath: resolve(opts.memiCli),
        timeoutMs: positiveInteger(opts.timeoutMs, "timeout-ms"),
      });
      const store = new EfficiencyRunStore(resolve(opts.storeRoot));
      await store.append(result.record);
      const payload = {
        status: result.record.outcome.accepted ? "accepted" : "failed-quality-gate",
        run: result.record,
        grade: result.grade,
        evidenceDirectory: result.evidenceDirectory,
      };
      if (opts.json) console.log(JSON.stringify(payload, null, 2));
      else {
        console.log(result.record.outcome.accepted
          ? ui.ok(`Accepted ${result.record.runId}`)
          : ui.warn(`Quality gate failed for ${result.record.runId}`));
        console.log(ui.dots("Evidence", result.evidenceDirectory));
      }
    });

  benchmark
    .command("regrade <run> <task>")
    .description("Append an immutable grader amendment for an existing raw trace")
    .requiredOption("--repository <path>", "Pinned clean Git worktree")
    .requiredOption("--response <path>", "Raw final response to regrade")
    .requiredOption("--evidence-dir <path>", "Private regrade receipt directory")
    .requiredOption("--store-root <path>", "External root containing immutable run records")
    .option("--grader-version <id>", "Deterministic grader version", "source-citations-v2")
    .option("--json", "Output JSON")
    .action(async (runPath: string, taskPath: string, opts: {
      repository: string;
      response: string;
      evidenceDir: string;
      storeRoot: string;
      graderVersion: string;
      json?: boolean;
    }) => {
      const repositoryRoot = resolve(opts.repository);
      const original = benchmarkRunRecordSchema.parse(
        JSON.parse(await readFile(resolve(runPath), "utf-8")),
      );
      const task = codexCaseStudyTaskSchema.parse(
        JSON.parse(await readFile(resolve(taskPath), "utf-8")),
      );
      const revision = await benchmarkRepositoryRevision(repositoryRoot);
      if (revision !== original.repository.revision) {
        throw new Error(
          `regrade revision mismatch: expected ${original.repository.revision}, received ${revision}`,
        );
      }
      const sourceStatus = await benchmarkRepositoryStatus(repositoryRoot);
      if (sourceStatus) {
        throw new Error(`regrade repository must be source-clean: ${repositoryRoot}`);
      }
      const responsePath = resolve(opts.response);
      const response = await readFile(responsePath, "utf-8");
      const grade = await gradeCaseStudyResponse({
        repositoryRoot,
        response,
        minimumValidCitations: task.rubric.minimumValidCitations,
        requiredTerms: task.rubric.requiredTerms,
      });
      const evidenceDirectory = resolve(opts.evidenceDir);
      const safeGrader = opts.graderVersion.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const receiptPath = join(evidenceDirectory, `regrade-${safeGrader}.json`);
      const amendmentPath = join(
        evidenceDirectory,
        `run-amendment-${safeGrader}.json`,
      );
      const amendment = createRegradeAmendment({
        original,
        grade,
        graderVersion: opts.graderVersion,
        receiptRef: receiptPath,
      });
      await writeJson(receiptPath, {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        graderVersion: opts.graderVersion,
        originalRunPath: resolve(runPath),
        responsePath,
        originalRunId: original.runId,
        amendmentRunId: amendment.runId,
        before: original.outcome,
        after: amendment.outcome,
        grade,
      });
      await writeJson(amendmentPath, amendment);
      const store = new EfficiencyRunStore(resolve(opts.storeRoot));
      await store.append(amendment);
      const payload = {
        status: grade.accepted ? "accepted" : "failed-quality-gate",
        receiptPath,
        amendmentPath,
        amendment,
        grade,
      };
      if (opts.json) console.log(JSON.stringify(payload, null, 2));
      else {
        console.log(grade.accepted
          ? ui.ok(`Regrade accepted ${original.runId}`)
          : ui.warn(`Regrade failed ${original.runId}`));
        console.log(ui.dots("Receipt", receiptPath));
      }
    });

  benchmark
    .command("report")
    .requiredOption("--suite <id>", "Benchmark suite id")
    .option("--minimum-pairs <count>", "Minimum valid pairs required", "5")
    .option("--bootstrap-samples <count>", "Bootstrap samples", "2000")
    .option("--seed <number>", "Deterministic bootstrap seed", "42")
    .option("--target <ratio>", "Required lower confidence bound", "0.25")
    .option("--experiments <ids>", "Comma-separated canonical experiment allowlist")
    .option("--store-root <path>", "External root containing immutable run records")
    .option("--out <path>", "Report output path")
    .option("--json", "Output JSON")
    .action(async (opts: {
      suite: string;
      minimumPairs: string;
      bootstrapSamples: string;
      seed: string;
      target: string;
      experiments?: string;
      storeRoot?: string;
      out?: string;
      json?: boolean;
    }) => {
      if (!opts.storeRoot) await engine.init("minimal");
      const storeRoot = resolve(opts.storeRoot ?? engine.config.projectRoot);
      const store = new EfficiencyRunStore(storeRoot);
      const report = buildEfficiencyReport({
        suiteId: opts.suite,
        experimentIds: opts.experiments ? csv(opts.experiments) : undefined,
        runs: await store.list(),
        minimumPairs: positiveInteger(opts.minimumPairs, "minimum-pairs"),
        bootstrapSamples: positiveInteger(opts.bootstrapSamples, "bootstrap-samples"),
        seed: integer(opts.seed, "seed"),
        targetImprovement: ratio(opts.target, "target"),
      });
      const out = resolve(opts.out ?? join(
        storeRoot,
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

function csv(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function skillFitnessPath(storeRoot: string): string {
  return join(storeRoot, ".memoire", "efficiency", "skill-fitness.jsonl");
}

function uniqueRun(
  runs: readonly BenchmarkRunRecord[],
  runId: string,
  label: string,
): BenchmarkRunRecord {
  const matches = runs.filter((run) => run.runId === runId);
  if (matches.length !== 1) {
    throw new Error(`${label} run ${runId} was found ${matches.length} times`);
  }
  return matches[0];
}

function providers(value: string): WorkflowProvider[] {
  const values = csv(value);
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error("providers must be a non-empty unique comma-separated list");
  }
  for (const provider of values) {
    if (provider !== "codex" && provider !== "claude") {
      throw new Error(`unsupported workflow provider: ${provider}`);
    }
  }
  return values as WorkflowProvider[];
}
