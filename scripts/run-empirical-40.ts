import { spawn } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { benchmarkRepositoryRevision, benchmarkRepositoryStatus } from "../src/efficiency/codex-runner.js";
import { hashFile } from "../src/efficiency/prospective-files.js";
import {
  hashValue,
  prospectiveFreezeSchema,
  prospectiveStudyPlanSchema,
  selectProspectiveBatch,
  verifyProspectiveFreeze,
} from "../src/efficiency/prospective-study.js";
import { EfficiencyRunStore } from "../src/efficiency/store.js";

const repositoryMapSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9-]*$/),
  z.string().min(1),
);

const options = parseOptions(process.argv.slice(2));
if (!options.execute) {
  throw new Error(
    "run-empirical-40 requires --execute because it installs the frozen candidate and invokes model trials",
  );
}
if (options.maximumTrials === null) {
  throw new Error(
    "run-empirical-40 requires --max-trials so a batch cannot consume the full provider quota by default",
  );
}

const planPath = path.resolve(options.plan);
const freezePath = path.resolve(options.freeze);
const taskRoot = path.resolve(options.taskRoot);
const evidenceRoot = path.resolve(options.evidenceRoot);
const storeRoot = path.resolve(options.storeRoot);
const candidateArtifact = path.resolve(options.candidateArtifact);
const evaluationOut = path.resolve(options.evaluationOut);
const progressPath = path.join(evidenceRoot, "prospective-progress.json");
const failuresPath = path.join(evidenceRoot, "orchestration-failures.jsonl");
const plan = prospectiveStudyPlanSchema.parse(JSON.parse(
  await readFile(planPath, "utf8"),
));
const freeze = prospectiveFreezeSchema.parse(JSON.parse(
  await readFile(freezePath, "utf8"),
));
const repositoryMap = repositoryMapSchema.parse(JSON.parse(
  await readFile(path.resolve(options.repositories), "utf8"),
));

const freezeVerification = verifyProspectiveFreeze(freeze);
if (!freezeVerification.valid) {
  throw new Error(
    `prospective freeze is invalid: ${freezeVerification.reasons.join(", ")}`,
  );
}
if (freeze.planHash !== hashValue(plan)) {
  throw new Error("prospective plan does not match the frozen plan hash");
}
const effectiveTemporaryRoot = path.resolve(
  process.env.TMPDIR ?? tmpdir(),
);
if (effectiveTemporaryRoot !== path.resolve(freeze.environment.temporaryRoot)) {
  throw new Error(
    `TMPDIR drift: expected ${freeze.environment.temporaryRoot}, received ${effectiveTemporaryRoot}`,
  );
}
if (await hashFile(candidateArtifact) !== freeze.candidate.artifactSha256) {
  throw new Error("candidate package artifact does not match the freeze receipt");
}
for (const task of plan.tasks) {
  if (!repositoryMap[task.id]) {
    throw new Error(`repository mapping is missing task ${task.id}`);
  }
  const taskPath = path.join(taskRoot, `${task.id}.json`);
  if (await hashFile(taskPath) !== freeze.taskManifestHashes[task.id]) {
    throw new Error(`task manifest drift detected for ${task.id}`);
  }
  const repository = path.resolve(repositoryMap[task.id]);
  const revision = await benchmarkRepositoryRevision(repository);
  if (revision !== task.revision) {
    throw new Error(
      `repository revision drift for ${task.id}: expected ${task.revision}, received ${revision}`,
    );
  }
  const status = await benchmarkRepositoryStatus(repository);
  if (status) {
    throw new Error(`repository must be clean for ${task.id}: ${repository}`);
  }
}

await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
await mkdir(storeRoot, { recursive: true, mode: 0o700 });
const installationRoot = await mkdtemp(path.join(
  tmpdir(),
  "memi-2.7-prospective-install-",
));

try {
  await run({
    command: "npm",
    args: [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      installationRoot,
      candidateArtifact,
    ],
    cwd: process.cwd(),
  });
  const packageRoot = path.join(
    installationRoot,
    "node_modules",
    "@memi-design",
    "cli",
  );
  const cliEntry = path.join(packageRoot, "dist", "index.js");
  const skillsRoot = path.join(packageRoot, "skills");
  const store = new EfficiencyRunStore(storeRoot);
  const existingRuns = (await store.list()).filter((run) =>
    run.prospective?.freezeHash === freeze.freezeHash);
  const existingTrialIds = new Set<string>();
  for (const run of existingRuns) {
    const trialId = run.prospective?.trialId;
    if (!trialId || existingTrialIds.has(trialId)) {
      throw new Error(`duplicate existing prospective trial: ${trialId ?? run.runId}`);
    }
    existingTrialIds.add(trialId);
  }
  const batch = selectProspectiveBatch({
    freeze,
    completedTrialIds: [...existingTrialIds],
    maximumTrials: options.maximumTrials,
  });
  let completed = 0;
  let haltedPair: string | null = null;
  for (const trial of batch) {
    const pairId = `${trial.taskId}:r${trial.repeat}`;
    if (haltedPair && haltedPair !== pairId) break;
    const task = plan.tasks.find((candidate) =>
      candidate.id === trial.taskId);
    if (!task) throw new Error(`frozen task missing from plan: ${trial.taskId}`);
    await writeProgress({
      status: "running",
      currentTrial: trial.trialId,
      completed: existingTrialIds.size + completed,
      skipped: existingTrialIds.size,
      total: freeze.trials.length,
    });
    const commandArgs = [
      cliEntry,
      "benchmark",
      "workflow-run",
      path.join(taskRoot, `${trial.taskId}.json`),
      "--condition",
      trial.condition,
      "--provider",
      freeze.harness.provider,
      "--repository",
      path.resolve(repositoryMap[trial.taskId]!),
      "--evidence-root",
      evidenceRoot,
      "--store-root",
      storeRoot,
      "--suite",
      freeze.studyId,
      "--experiment",
      freeze.planId,
      "--repeat",
      String(trial.repeat),
      "--skills-root",
      skillsRoot,
      "--platforms",
      task.platformFamily,
      "--model",
      freeze.harness.modelId,
      "--reasoning",
      freeze.harness.reasoningEffort,
      "--freeze",
      freezePath,
      "--trial",
      trial.trialId,
      "--execute",
      "--json",
    ];
    const result = await run({
      command: process.execPath,
      args: commandArgs,
      cwd: process.cwd(),
      allowFailure: true,
    });
    if (result.exitCode !== 0) {
      const failure = {
        schemaVersion: 1,
        recordedAt: new Date().toISOString(),
        trialId: trial.trialId,
        sequence: trial.sequence,
        exitCode: result.exitCode,
      };
      await appendFile(failuresPath, `${JSON.stringify(failure)}\n`, {
        mode: 0o600,
      });
      await writeProgress({
        status: "blocked",
        currentTrial: trial.trialId,
        completed: existingTrialIds.size + completed,
        skipped: existingTrialIds.size,
        total: freeze.trials.length,
      });
      throw new Error(
        `prospective trial failed before an immutable run record was stored: ${trial.trialId}`,
      );
    }
    completed += 1;
    const stored = (await store.list()).filter((run) =>
      run.prospective?.freezeHash === freeze.freezeHash
      && run.prospective.trialId === trial.trialId);
    if (stored.length !== 1) {
      throw new Error(`prospective trial did not persist exactly one receipt: ${trial.trialId}`);
    }
    if (!stored[0]!.outcome.accepted) haltedPair = pairId;
  }

  await run({
    command: process.execPath,
    args: [
      cliEntry,
      "benchmark",
      "prospective-evaluate",
      planPath,
      freezePath,
      "--store-root",
      storeRoot,
      "--evidence-root",
      evidenceRoot,
      "--out",
      evaluationOut,
      "--json",
    ],
    cwd: process.cwd(),
  });
  const evaluation = JSON.parse(await readFile(evaluationOut, "utf8")) as {
    evaluation?: { score?: number; reachedTarget?: boolean };
  };
  await writeProgress({
    status: evaluation.evaluation?.reachedTarget
      ? "target-reached"
      : haltedPair
        ? "halted-after-complete-pair"
        : "batch-complete",
    currentTrial: null,
    completed: existingTrialIds.size + completed,
    skipped: existingTrialIds.size,
    total: freeze.trials.length,
    score: evaluation.evaluation?.score ?? null,
    remaining: freeze.trials.length - existingTrialIds.size - completed,
    maximumTrials: options.maximumTrials,
  });
} finally {
  await rm(installationRoot, { recursive: true, force: true });
}

async function writeProgress(input: Record<string, unknown>): Promise<void> {
  await writeFile(progressPath, `${JSON.stringify({
    schemaVersion: 1,
    freezeHash: freeze.freezeHash,
    updatedAt: new Date().toISOString(),
    ...input,
  }, null, 2)}\n`, { mode: 0o600 });
}

async function run(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly allowFailure?: boolean;
}): Promise<{ exitCode: number }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !input.allowFailure) {
        reject(new Error(`${input.command} exited ${exitCode}`));
        return;
      }
      resolve({ exitCode });
    });
  });
}

function parseOptions(args: readonly string[]): {
  plan: string;
  freeze: string;
  repositories: string;
  taskRoot: string;
  evidenceRoot: string;
  storeRoot: string;
  candidateArtifact: string;
  evaluationOut: string;
  maximumTrials: number | null;
  execute: boolean;
} {
  const values = new Map<string, string>();
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--execute") {
      execute = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`unexpected argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${argument}`);
    }
    values.set(argument.slice(2), value);
    index += 1;
  }
  const required = [
    "plan",
    "freeze",
    "repositories",
    "task-root",
    "evidence-root",
    "store-root",
    "candidate-artifact",
    "evaluation-out",
  ];
  for (const key of required) {
    if (!values.get(key)) throw new Error(`missing required option --${key}`);
  }
  return {
    plan: values.get("plan")!,
    freeze: values.get("freeze")!,
    repositories: values.get("repositories")!,
    taskRoot: values.get("task-root")!,
    evidenceRoot: values.get("evidence-root")!,
    storeRoot: values.get("store-root")!,
    candidateArtifact: values.get("candidate-artifact")!,
    evaluationOut: values.get("evaluation-out")!,
    maximumTrials: values.has("max-trials")
      ? parseMaximumTrials(values.get("max-trials")!)
      : null,
    execute,
  };
}

function parseMaximumTrials(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("max-trials must be a positive even integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 2 || parsed % 2 !== 0) {
    throw new Error("max-trials must be a positive even integer");
  }
  return parsed;
}
