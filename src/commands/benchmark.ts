import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";
import {
  benchmarkConditionSchema,
  benchmarkRunRecordSchema,
  benchmarkTaskSchema,
  codexCaseStudyTaskSchema,
  type BenchmarkRunRecord,
} from "../efficiency/contracts.js";
import { gradeAutomatedAcceptance } from "../efficiency/automated-acceptance.js";
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
  createEvidenceManifest,
  EVIDENCE_MANIFEST_HASH_PLACEHOLDER,
  hashFile,
  verifyEvidenceManifest,
} from "../efficiency/prospective-files.js";
import {
  buildProspectiveFreeze,
  evaluateProspectiveStudy,
  hashValue,
  prospectiveFreezeSchema,
  prospectiveStudyPlanSchema,
  selectProspectiveTrial,
} from "../efficiency/prospective-study.js";
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
  SkillFitnessBoundRouteReceiptSchema,
  SkillFitnessQualityEvidenceSchema,
  SkillFitnessRouteReceiptSchema,
  assessSkillRouteFitness,
  appendSkillFitnessEvent,
  backtestSkillFitness,
  buildSkillFitnessEvent,
  loadSkillFitnessEvents,
  projectSkillFitness,
  resolveSkillRouteExecutionMode,
  type SkillFitnessBoundRouteReceipt,
} from "../notes/index.js";
import { ui } from "../tui/format.js";

export function registerBenchmarkCommand(program: Command, engine: MemoireEngine): void {
  const benchmark = program
    .command("benchmark")
    .description("Plan, record, and evaluate paired baseline-versus-Memi experiments");

  benchmark
    .command("prospective-freeze <plan>")
    .description("Freeze a hash-verified prospective study before scored runs")
    .requiredOption("--candidate-artifact <path>", "Immutable candidate package artifact")
    .requiredOption("--candidate-version <version>", "Released candidate package version")
    .requiredOption("--candidate-revision <sha>", "Candidate Git revision")
    .requiredOption("--candidate-source-hash <sha256>", "Candidate source snapshot hash")
    .requiredOption("--candidate-source-state <state>", "clean or content-addressed-dirty-snapshot")
    .requiredOption("--candidate-dirty-files <count>", "Dirty file count at packaging")
    .requiredOption("--environment <path>", "Frozen environment JSON")
    .requiredOption("--task-root <path>", "Directory containing <task-id>.json manifests")
    .requiredOption("--out <path>", "Freeze receipt output path")
    .option("--provider <id>", "Provider", "codex")
    .option("--model <id>", "Model id", "gpt-5.6-sol")
    .option("--reasoning <effort>", "Reasoning effort", "medium")
    .option("--harness-version <version>", "Harness version", "codex-cli 0.145.0")
    .option("--permission-policy <policy>", "Permission policy", "workspace-write")
    .option("--maximum-skills <count>", "Maximum routed skills", "2")
    .option("--maximum-context-bytes <count>", "Maximum routed context bytes", "8000")
    .option("--frozen-at <timestamp>", "Explicit freeze timestamp")
    .option("--json", "Output JSON")
    .action(async (planPath: string, opts: {
      candidateArtifact: string;
      candidateVersion: string;
      candidateRevision: string;
      candidateSourceHash: string;
      candidateSourceState: string;
      candidateDirtyFiles: string;
      environment: string;
      taskRoot: string;
      out: string;
      provider: string;
      model: string;
      reasoning: string;
      harnessVersion: string;
      permissionPolicy: string;
      maximumSkills: string;
      maximumContextBytes: string;
      frozenAt?: string;
      json?: boolean;
    }) => {
      const plan = prospectiveStudyPlanSchema.parse(
        JSON.parse(await readFile(resolve(planPath), "utf8")),
      );
      const environment = JSON.parse(
        await readFile(resolve(opts.environment), "utf8"),
      ) as Record<string, unknown>;
      const taskRoot = resolve(opts.taskRoot);
      const taskManifestHashes = Object.fromEntries(await Promise.all(
        plan.tasks.map(async (task) => [
          task.id,
          await hashFile(join(taskRoot, `${task.id}.json`)),
        ]),
      ));
      const freeze = buildProspectiveFreeze({
        plan,
        frozenAt: opts.frozenAt ?? new Date().toISOString(),
        candidate: {
          version: opts.candidateVersion,
          revision: opts.candidateRevision,
          sourceState: candidateSourceState(opts.candidateSourceState),
          dirtyFileCount: nonnegativeInteger(
            opts.candidateDirtyFiles,
            "candidate-dirty-files",
          ),
          sourceTreeSha256: opts.candidateSourceHash,
          artifactSha256: await hashFile(resolve(opts.candidateArtifact)),
        },
        harness: {
          provider: providers(opts.provider)[0],
          modelId: opts.model,
          reasoningEffort: opts.reasoning,
          harnessVersion: opts.harnessVersion,
          permissionPolicy: opts.permissionPolicy,
          maximumSkills: positiveInteger(opts.maximumSkills, "maximum-skills"),
          maximumContextBytes: positiveInteger(
            opts.maximumContextBytes,
            "maximum-context-bytes",
          ),
        },
        environment: environment as never,
        taskManifestHashes,
      });
      const out = resolve(opts.out);
      await writeJson(out, freeze);
      const payload = { status: "frozen", path: out, freeze };
      if (opts.json) console.log(JSON.stringify(payload, null, 2));
      else {
        console.log(ui.ok(`Prospective study frozen: ${freeze.freezeHash}`));
        console.log(ui.dots("Receipt", out));
      }
    });

  benchmark
    .command("prospective-evaluate <plan> <freeze>")
    .description("Evaluate prospective receipts without granting credit to invalid evidence")
    .requiredOption("--store-root <path>", "External immutable run store root")
    .requiredOption("--evidence-root <path>", "Trusted root containing raw trial evidence")
    .requiredOption("--out <path>", "Evaluation report output path")
    .option("--json", "Output JSON")
    .action(async (planPath: string, freezePath: string, opts: {
      storeRoot: string;
      evidenceRoot: string;
      out: string;
      json?: boolean;
    }) => {
      const plan = prospectiveStudyPlanSchema.parse(JSON.parse(
        await readFile(resolve(planPath), "utf8"),
      ));
      const freeze = prospectiveFreezeSchema.parse(JSON.parse(
        await readFile(resolve(freezePath), "utf8"),
      ));
      const store = new EfficiencyRunStore(resolve(opts.storeRoot));
      const candidates = (await store.listStrict()).filter((run) =>
        run.prospective?.freezeHash === freeze.freezeHash);
      const verifiedRuns: BenchmarkRunRecord[] = [];
      const evidenceFailures: Array<{
        runId: string;
        trialId: string;
        reasons: readonly string[];
      }> = [];
      for (const run of candidates) {
        const runRef = run.evidenceRefs.find((reference) =>
          reference.endsWith("/run.json"));
        if (!runRef || !run.prospective) {
          evidenceFailures.push({
            runId: run.runId,
            trialId: run.prospective?.trialId ?? run.runId,
            reasons: ["evidence-directory-missing"],
          });
          continue;
        }
        const evidenceDirectory = dirname(runRef);
        const verification = await verifyEvidenceManifest({
          evidenceDirectory,
          expectedManifestSha256: run.prospective.evidenceManifestSha256,
          requiredArtifacts: freeze.requiredArtifacts,
          expectedBinding: {
            trialId: run.prospective.trialId,
            taskId: run.taskId,
            repeat: run.repeat,
            condition: run.condition,
            sequence: run.prospective.sequence,
          },
          allowedEvidenceRoot: resolve(opts.evidenceRoot),
        });
        if (!verification.valid) {
          evidenceFailures.push({
            runId: run.runId,
            trialId: run.prospective.trialId,
            reasons: verification.reasons,
          });
          continue;
        }
        let sealedRun: BenchmarkRunRecord;
        try {
          sealedRun = benchmarkRunRecordSchema.parse(JSON.parse(
            await readFile(runRef, "utf8"),
          ));
        } catch {
          evidenceFailures.push({
            runId: run.runId,
            trialId: run.prospective.trialId,
            reasons: ["run-receipt-invalid"],
          });
          continue;
        }
        if (JSON.stringify(sealedRun) !== JSON.stringify(run)) {
          evidenceFailures.push({
            runId: run.runId,
            trialId: run.prospective.trialId,
            reasons: ["store-run-mismatch"],
          });
          continue;
        }
        verifiedRuns.push(sealedRun);
      }
      const evaluation = evaluateProspectiveStudy({
        plan,
        freeze,
        runs: verifiedRuns,
      });
      const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        planId: plan.planId,
        freezeHash: freeze.freezeHash,
        candidates: candidates.length,
        verifiedRuns: verifiedRuns.length,
        evidenceFailures,
        evaluation,
      };
      const out = resolve(opts.out);
      await writeJson(out, report);
      const payload = {
        status: evaluation.reachedTarget ? "target-reached" : "evidence-incomplete",
        path: out,
        report,
      };
      if (opts.json) console.log(JSON.stringify(payload, null, 2));
      else {
        console.log(evaluation.reachedTarget
          ? ui.ok(`Empirical readiness target reached: ${evaluation.score}/100`)
          : ui.warn(`Empirical readiness: ${evaluation.score}/100`));
        console.log(ui.dots("Report", out));
      }
    });

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
    .option("--freeze <path>", "Prospective freeze receipt")
    .option("--trial <id>", "Frozen prospective trial id")
    .option("--task-class <id>", "Stable route-fitness task class (defaults to task id)")
    .option(
      "--recovery-probe",
      "Execute a currently suppressed exact route only as a frozen prospective recovery probe",
    )
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
      freeze?: string;
      trial?: string;
      taskClass?: string;
      recoveryProbe?: boolean;
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
      if (Boolean(opts.freeze) !== Boolean(opts.trial)) {
        throw new Error("--freeze and --trial must be provided together");
      }
      const condition = benchmarkConditionSchema.parse(opts.condition);
      const taskClass = stableTaskClass(opts.taskClass ?? task.id);
      if (opts.recoveryProbe && condition !== "memi") {
        throw new Error("--recovery-probe requires the memi condition");
      }
      const provider = providers(opts.provider)[0];
      const modelId = opts.model ?? (
        provider === "codex" ? "gpt-5.6-sol" : "claude-sonnet-4-6"
      );
      const taskManifestSha256 = await hashFile(resolve(taskPath));
      const repositoryRoot = resolve(opts.repository);
      const repositoryRevision = await benchmarkRepositoryRevision(repositoryRoot);
      const freeze = opts.freeze
        ? prospectiveFreezeSchema.parse(JSON.parse(
          await readFile(resolve(opts.freeze), "utf8"),
        ))
        : null;
      const frozenTrial = freeze && opts.trial
        ? selectProspectiveTrial({
          freeze,
          trialId: opts.trial,
          taskId: task.id,
          condition,
          repeat: positiveInteger(opts.repeat, "repeat"),
          provider,
          modelId,
          reasoningEffort: opts.reasoning,
          repositoryRevision,
          taskManifestSha256,
        })
        : null;
      let routedContext = "";
      let route: Awaited<ReturnType<typeof resolveRoutedSkills>> | null = null;
      let routePolicy: ReturnType<typeof assessSkillRouteFitness> | null = null;
      let routeExecutionMode: "production" | "repository-only" | "recovery-probe" =
        "production";
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
          maximumSkills: freeze?.harness.maximumSkills ?? 2,
          maximumContextBytes: freeze?.harness.maximumContextBytes ?? 8_000,
        });
        if (route.route.repositoryFingerprintHash && route.route.selected.length > 0) {
          routePolicy = assessSkillRouteFitness({
            events: await loadSkillFitnessEvents(
              skillFitnessPath(resolve(opts.storeRoot)),
            ),
            route: {
              routerVersion: route.route.routerVersion,
              repositoryFingerprintHash: route.route.repositoryFingerprintHash,
              taskClass,
              harness: {
                provider,
                modelId,
                reasoningEffort: opts.reasoning,
              },
              skills: route.route.selected.map(({ id, contentHash }) => ({
                skillId: id,
                contentHash,
              })),
            },
          });
          routeExecutionMode = resolveSkillRouteExecutionMode({
            assessment: routePolicy,
            recoveryProbe: opts.recoveryProbe === true,
            prospective: frozenTrial !== null,
          });
          if (routeExecutionMode === "repository-only") {
            route = suppressResolvedRoute(route, routePolicy.reasons);
          }
        }
        if (opts.recoveryProbe && routeExecutionMode !== "recovery-probe") {
          throw new Error("recovery probe requires an exact route that is currently suppressed");
        }
        routedContext = route.route.selected.length > 0
          ? formatRoutedSkillContext(route)
          : "";
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
      const routePath = route && route.route.selected.length > 0
        ? join(result.evidenceDirectory, "skill-route.json")
        : null;
      const routePolicyPath = routePolicy
        ? join(result.evidenceDirectory, "skill-fitness-policy.json")
        : null;
      if (routePolicyPath && routePolicy) {
        await writeJson(routePolicyPath, routePolicy);
      }
      const failedChecks = result.verification.filter((check) => !check.passed).length;
      const grade = gradeAutomatedAcceptance({
        accepted: result.accepted,
        verificationChecks: result.verification.length,
        failedChecks,
        adapterFailed: result.adapter.exitCode !== 0,
      });
      let evidenceManifestSha256: string | null = freeze && frozenTrial
        ? EVIDENCE_MANIFEST_HASH_PLACEHOLDER
        : null;
      if (freeze && frozenTrial) {
        await Promise.all([
          writeJson(join(result.evidenceDirectory, "environment.json"), {
            schemaVersion: 1,
            frozen: freeze.environment,
            candidate: freeze.candidate,
            freezeHash: freeze.freezeHash,
            observedAt: completedAt.toISOString(),
          }),
          writeJson(join(result.evidenceDirectory, "usage.json"), result.adapter.usage),
          writeJson(join(result.evidenceDirectory, "tools.json"), {
            aggregate: result.adapter.tools,
            profile: result.toolProfile,
          }),
          writeJson(join(result.evidenceDirectory, "route.json"), {
            condition,
            taskClass,
            executionMode: routeExecutionMode,
            route: route ?? null,
          }),
          writeJson(
            join(result.evidenceDirectory, "verification-isolation.json"),
            result.verificationIsolation,
          ),
        ]);
      }
      const evidenceRefs = freeze
        ? [...new Set([
          ...freeze.requiredArtifacts,
          "evidence-manifest.json",
          "run.json",
        ])].map((artifact) => join(result.evidenceDirectory, artifact))
        : [
          join(result.evidenceDirectory, "git.patch"),
          join(result.evidenceDirectory, "preparation.json"),
          join(result.evidenceDirectory, "verification.json"),
          join(result.evidenceDirectory, "events.jsonl"),
          ...(routePath ? [routePath] : []),
          ...(routePolicyPath ? [routePolicyPath] : []),
        ];
      let record = benchmarkRunRecordSchema.parse({
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
          qualityScore: grade.qualityScore,
          qualityEvidence: grade.qualityEvidence,
          qualityCeiling: grade.qualityCeiling,
          defects: grade.defects,
          humanInterventions: 0,
        },
        evidenceRefs: [
          ...evidenceRefs,
          ...(routePath && !evidenceRefs.includes(routePath) ? [routePath] : []),
          ...(routePolicyPath && !evidenceRefs.includes(routePolicyPath)
            ? [routePolicyPath]
            : []),
          ...(result.adapter.usage.estimatedCostUsd === null
            ? [`estimatedCostUsd:unassessed-${provider}-subscription`]
            : []),
        ],
        ...(freeze && frozenTrial && evidenceManifestSha256
          ? {
            prospective: {
              planHash: freeze.planHash,
              freezeHash: freeze.freezeHash,
              candidateArtifactSha256: freeze.candidate.artifactSha256,
              taskManifestSha256,
              evidenceManifestSha256,
              trialId: frozenTrial.trialId,
              sequence: frozenTrial.sequence,
            },
          }
          : {}),
      });
      if (routePath && route) {
        await writeJson(routePath, {
          schemaVersion: 2,
          runId: record.runId,
          taskId: record.taskId,
          taskClass,
          executionMode: routeExecutionMode,
          repeat: record.repeat,
          repository: {
            pathHash: record.repository.pathHash,
            revision: record.repository.revision,
          },
          harness: {
            provider: record.harness.id,
            modelId: record.harness.modelId,
            reasoningEffort: record.harness.reasoningEffort,
          },
          route: route.route,
        });
      }
      const runPath = join(result.evidenceDirectory, "run.json");
      if (freeze && frozenTrial) {
        await writeJson(runPath, record);
        const manifest = await createEvidenceManifest({
          evidenceDirectory: result.evidenceDirectory,
          trialId: frozenTrial.trialId,
          artifactNames: [
            ...freeze.requiredArtifacts.filter((artifact) =>
              artifact !== "evidence-manifest.json"),
            ...(routePath ? ["skill-route.json"] : []),
            ...(routePolicyPath ? ["skill-fitness-policy.json"] : []),
            "run.json",
          ],
        });
        evidenceManifestSha256 = manifest.manifestSha256;
        record = benchmarkRunRecordSchema.parse({
          ...record,
          prospective: {
            ...record.prospective,
            evidenceManifestSha256,
          },
        });
      }
      const store = new EfficiencyRunStore(resolve(opts.storeRoot));
      await writeJson(runPath, record);
      await store.append(record);
      const payload = {
        status: result.accepted ? "accepted" : "failed-quality-gate",
        run: record,
        route: route?.route ?? null,
        taskClass,
        routeExecutionMode,
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
    .option("--quality-evidence <path>", "Hash-verified blinded quality evidence v2")
    .option("--json", "Output JSON")
    .action(async (opts: {
      baseline: string;
      memi: string;
      route: string;
      taskClass: string;
      storeRoot: string;
      qualityEvidence?: string;
      json?: boolean;
    }) => {
      const storeRoot = resolve(opts.storeRoot);
      const store = new EfficiencyRunStore(storeRoot);
      const runs = await store.listStrict();
      const baseline = uniqueRun(runs, opts.baseline, "baseline");
      const memi = uniqueRun(runs, opts.memi, "memi");
      const routePath = resolve(opts.route);
      assertRouteReceiptReferenced(memi, routePath);
      await verifyManifestSealedFitnessRun({
        run: baseline,
        condition: "baseline",
      });
      await verifyManifestSealedFitnessRun({
        run: memi,
        condition: "memi",
      });
      const routeReceipt = await readBoundedJson(routePath, "route receipt");
      const boundResult = SkillFitnessBoundRouteReceiptSchema.safeParse(routeReceipt);
      const routeBinding = boundResult.success
        ? await validateManifestSealedBoundRoute({
          receipt: boundResult.data,
          memi,
          taskClass: opts.taskClass,
          routePath,
        })
        : await importProspectiveRawRoute({
          routeReceipt,
          routePath,
          memi,
          taskClass: opts.taskClass,
          boundError: boundResult.error.message,
        });
      const qualityEvidence = opts.qualityEvidence
        ? SkillFitnessQualityEvidenceSchema.parse(await readBoundedJson(
          resolve(opts.qualityEvidence),
          "quality evidence",
        ))
        : undefined;
      if (routeBinding.executionMode === "recovery-probe" && !qualityEvidence) {
        throw new Error("recovery-probe fitness evidence requires blinded quality evidence v2");
      }
      const event = buildSkillFitnessEvent({
        baseline,
        memi,
        route: routeBinding.route,
        taskClass: opts.taskClass,
        qualityEvidence,
        evidenceMode: routeBinding.executionMode,
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
    .command("fitness-backtest")
    .description("Replay exact-match route fitness policy chronologically")
    .requiredOption("--store-root <path>", "External immutable run store root")
    .option("--as-of <timestamp>", "Inclusive ISO-8601 replay cutoff")
    .option("--json", "Output JSON")
    .action(async (opts: {
      storeRoot: string;
      asOf?: string;
      json?: boolean;
    }) => {
      const path = skillFitnessPath(resolve(opts.storeRoot));
      const backtest = backtestSkillFitness({
        events: await loadSkillFitnessEvents(path),
        asOf: opts.asOf,
      });
      const payload = { status: "backtested", path, backtest };
      if (opts.json) console.log(JSON.stringify(payload, null, 2));
      else {
        console.log(ui.section("MEMI SKILL FITNESS BACKTEST"));
        console.log(ui.dots("Events replayed", String(backtest.eventsReplayed)));
        console.log(ui.dots("Exact routes", String(backtest.routes.length)));
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

function suppressResolvedRoute(
  route: Awaited<ReturnType<typeof resolveRoutedSkills>>,
  reasons: readonly string[],
): Awaited<ReturnType<typeof resolveRoutedSkills>> {
  const reason = `fitness-suppressed:${reasons.join("+") || "harmful-history"}`;
  return {
    route: {
      ...route.route,
      decision: "abstain",
      selected: [],
      excluded: [
        ...route.route.excluded,
        ...route.route.selected.map((skill) => ({ id: skill.id, reason })),
      ],
      contextBytes: 0,
    },
    skills: [],
    resources: [],
    contextBytes: 0,
  };
}

async function readBoundedJson(file: string, label: string): Promise<unknown> {
  const metadata = await lstat(file);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  if (metadata.size > 1_000_000) {
    throw new Error(`${label} exceeds the 1000000-byte safety limit`);
  }
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
}

async function importProspectiveRawRoute(input: {
  readonly routeReceipt: unknown;
  readonly routePath: string;
  readonly memi: BenchmarkRunRecord;
  readonly taskClass: string;
  readonly boundError: string;
}): Promise<SkillFitnessBoundRouteReceipt> {
  if (!input.memi.prospective) {
    throw new Error(
      `fitness-record requires a bound v2 route receipt: ${input.boundError}`,
    );
  }
  const rawResult = SkillFitnessRouteReceiptSchema.safeParse(input.routeReceipt);
  if (!rawResult.success) {
    throw new Error(`prospective raw route receipt is invalid: ${rawResult.error.message}`);
  }
  if (basename(input.routePath) !== "skill-route.json") {
    throw new Error("prospective raw route must be named skill-route.json");
  }
  const evidenceDirectory = dirname(input.routePath);
  const evidenceDirectoryMetadata = await lstat(evidenceDirectory);
  if (
    evidenceDirectoryMetadata.isSymbolicLink()
    || !evidenceDirectoryMetadata.isDirectory()
  ) {
    throw new Error("prospective evidence directory must be a regular non-symlink directory");
  }
  const routeArtifactPath = siblingEvidenceRef(
    input.memi,
    evidenceDirectory,
    "route.json",
  );
  const manifestPath = siblingEvidenceRef(
    input.memi,
    evidenceDirectory,
    "evidence-manifest.json",
  );
  const runPath = siblingEvidenceRef(input.memi, evidenceDirectory, "run.json");
  const [routeArtifact, sealedRunValue] = await Promise.all([
    readBoundedJson(routeArtifactPath, "prospective route artifact"),
    readBoundedJson(runPath, "prospective run receipt"),
    readBoundedJson(manifestPath, "prospective evidence manifest"),
  ]);
  const verification = await verifyEvidenceManifest({
    evidenceDirectory,
    expectedManifestSha256: input.memi.prospective.evidenceManifestSha256,
    requiredArtifacts: ["route.json", "run.json"],
    expectedBinding: {
      trialId: input.memi.prospective.trialId,
      taskId: input.memi.taskId,
      repeat: input.memi.repeat,
      condition: "memi",
      sequence: input.memi.prospective.sequence,
    },
    allowedEvidenceRoot: evidenceDirectory,
  });
  if (!verification.valid) {
    throw new Error(
      `prospective route evidence verification failed: ${verification.reasons.join(",")}`,
    );
  }
  const sealedRun = benchmarkRunRecordSchema.parse(sealedRunValue);
  if (hashValue(sealedRun) !== hashValue(input.memi)) {
    throw new Error("prospective run receipt does not match the immutable stored Memi run");
  }
  const sealedRoute = manifestSealedRawRoute(routeArtifact);
  if (hashValue(sealedRoute) !== hashValue(input.routeReceipt)) {
    throw new Error("raw route does not match the manifest-sealed route artifact");
  }
  const boundRoute = SkillFitnessBoundRouteReceiptSchema.parse({
    schemaVersion: 2,
    runId: input.memi.runId,
    taskId: input.memi.taskId,
    taskClass: input.memi.taskId,
    executionMode: "production",
    repeat: input.memi.repeat,
    repository: {
      pathHash: input.memi.repository.pathHash,
      revision: input.memi.repository.revision,
    },
    harness: {
      provider: input.memi.harness.id,
      modelId: input.memi.harness.modelId,
      reasoningEffort: input.memi.harness.reasoningEffort,
    },
    route: rawResult.data,
  });
  return validatedBoundRoute(boundRoute, input.memi, input.taskClass);
}

async function validateManifestSealedBoundRoute(input: {
  readonly receipt: SkillFitnessBoundRouteReceipt;
  readonly memi: BenchmarkRunRecord;
  readonly taskClass: string;
  readonly routePath: string;
}): Promise<SkillFitnessBoundRouteReceipt> {
  await verifyManifestSealedFitnessRun({
    run: input.memi,
    condition: "memi",
    requiredArtifactPath: input.routePath,
  });
  return validatedBoundRoute(input.receipt, input.memi, input.taskClass);
}

async function verifyManifestSealedFitnessRun(input: {
  readonly run: BenchmarkRunRecord;
  readonly condition: "baseline" | "memi";
  readonly requiredArtifactPath?: string;
}): Promise<void> {
  if (!input.run.prospective) {
    throw new Error(
      `${input.condition} fitness run requires manifest-sealed prospective evidence`,
    );
  }
  const runPath = uniqueEvidencePath(input.run, "run.json", input.condition);
  const manifestPath = uniqueEvidencePath(
    input.run,
    "evidence-manifest.json",
    input.condition,
  );
  const evidenceDirectory = dirname(runPath);
  if (dirname(manifestPath) !== evidenceDirectory) {
    throw new Error(`${input.condition} prospective evidence must be sibling artifacts`);
  }
  const directoryMetadata = await lstat(evidenceDirectory);
  if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) {
    throw new Error(
      `${input.condition} evidence directory must be a regular non-symlink directory`,
    );
  }
  await readBoundedJson(
    manifestPath,
    `${input.condition} prospective evidence manifest`,
  );
  if (
    input.requiredArtifactPath
    && dirname(input.requiredArtifactPath) !== evidenceDirectory
  ) {
    throw new Error("bound route receipt must be a sibling prospective artifact");
  }
  const requiredArtifacts = [
    "run.json",
    ...(input.requiredArtifactPath ? [basename(input.requiredArtifactPath)] : []),
  ];
  const verification = await verifyEvidenceManifest({
    evidenceDirectory,
    expectedManifestSha256: input.run.prospective.evidenceManifestSha256,
    requiredArtifacts,
    expectedBinding: {
      trialId: input.run.prospective.trialId,
      taskId: input.run.taskId,
      repeat: input.run.repeat,
      condition: input.condition,
      sequence: input.run.prospective.sequence,
    },
    allowedEvidenceRoot: evidenceDirectory,
  });
  if (!verification.valid) {
    throw new Error(
      `${input.condition} prospective evidence verification failed: ${verification.reasons.join(",")}`,
    );
  }
  const sealedRun = benchmarkRunRecordSchema.parse(
    await readBoundedJson(runPath, `${input.condition} prospective run receipt`),
  );
  if (hashValue(sealedRun) !== hashValue(input.run)) {
    throw new Error(
      `${input.condition} prospective run receipt does not match the immutable stored run`,
    );
  }
}

function uniqueEvidencePath(
  run: BenchmarkRunRecord,
  artifactName: string,
  condition: "baseline" | "memi",
): string {
  const matches = run.evidenceRefs.flatMap((reference) => {
    try {
      const candidate = resolve(reference);
      return basename(candidate) === artifactName ? [candidate] : [];
    } catch {
      return [];
    }
  });
  if (matches.length !== 1) {
    throw new Error(
      `${condition} manifest-sealed prospective evidence requires one ${artifactName} reference`,
    );
  }
  return matches[0];
}


function siblingEvidenceRef(
  memi: BenchmarkRunRecord,
  evidenceDirectory: string,
  artifactName: string,
): string {
  const matches = memi.evidenceRefs.flatMap((reference) => {
    try {
      const path = resolve(reference);
      return basename(path) === artifactName ? [path] : [];
    } catch {
      return [];
    }
  });
  if (matches.length !== 1 || dirname(matches[0]) !== evidenceDirectory) {
    throw new Error("prospective evidence must be sibling artifacts");
  }
  return matches[0];
}

function manifestSealedRawRoute(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("prospective route artifact is invalid");
  }
  const artifact = value as Record<string, unknown>;
  if (
    Object.keys(artifact).length !== 2
    || artifact.condition !== "memi"
    || !("route" in artifact)
  ) {
    throw new Error("prospective route artifact is invalid");
  }
  return artifact.route;
}

function assertRouteReceiptReferenced(
  memi: BenchmarkRunRecord,
  routePath: string,
): void {
  const referenced = memi.evidenceRefs.some((reference) => {
    try {
      return resolve(reference) === routePath;
    } catch {
      return false;
    }
  });
  if (!referenced) {
    throw new Error("route receipt is not referenced by the Memi run");
  }
}

function validateBoundRouteReceipt(
  receipt: SkillFitnessBoundRouteReceipt,
  memi: BenchmarkRunRecord,
  taskClass: string,
): void {
  const mismatches = [
    ["run id", receipt.runId, memi.runId],
    ["task id", receipt.taskId, memi.taskId],
    ["task class", receipt.taskClass ?? receipt.taskId, taskClass],
    ["repeat", receipt.repeat, memi.repeat],
    ["repository path", receipt.repository.pathHash, memi.repository.pathHash],
    ["repository revision", receipt.repository.revision, memi.repository.revision],
    ["provider", receipt.harness.provider, memi.harness.id],
    ["model", receipt.harness.modelId, memi.harness.modelId],
    ["reasoning effort", receipt.harness.reasoningEffort, memi.harness.reasoningEffort],
  ] as const;
  const mismatch = mismatches.find(([, observed, expected]) => observed !== expected);
  if (mismatch) throw new Error(`bound route ${mismatch[0]} mismatch`);
}

function validatedBoundRoute(
  receipt: SkillFitnessBoundRouteReceipt,
  memi: BenchmarkRunRecord,
  taskClass: string,
): SkillFitnessBoundRouteReceipt {
  validateBoundRouteReceipt(receipt, memi, taskClass);
  return receipt;
}

function stableTaskClass(value: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new Error("task-class must use lowercase kebab-case");
  }
  return value;
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

function nonnegativeInteger(value: string, label: string): number {
  const parsed = integer(value, label);
  if (parsed < 0) throw new Error(`${label} must be nonnegative`);
  return parsed;
}

function candidateSourceState(
  value: string,
): "clean" | "content-addressed-dirty-snapshot" {
  if (value === "clean" || value === "content-addressed-dirty-snapshot") {
    return value;
  }
  throw new Error(
    "candidate-source-state must be clean or content-addressed-dirty-snapshot",
  );
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
