import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FILES = {
  protocol: "protocol.json",
  plan: "plan.json",
  taskRegistry: "task-registry.json",
  analysisPlan: "analysis-plan.json",
  receiptLedger: "receipt-ledger.json",
  exclusions: "exclusions.json",
  deviations: "deviations.json",
  gradingLedger: "grading-ledger.json",
  rubric: "rubric.json",
  graderPlan: "grader-plan.json",
  priceCard: "price-card.json",
  predecessorStatus: "predecessor-status.json",
  freezeReadiness: "freeze-readiness.json",
};

async function readJson(root, filename) {
  return JSON.parse(await readFile(path.join(root, filename), "utf8"));
}

export async function loadPackage(root) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(FILES).map(async ([key, filename]) => [key, await readJson(root, filename)]),
    ),
  );
}

function countBy(items, key) {
  return items.reduce(
    (counts, item) => ({ ...counts, [item[key]]: (counts[item[key]] ?? 0) + 1 }),
    {},
  );
}

export function validatePackage(pkg) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const cells = pkg.plan.cells;
  const phaseCounts = countBy(cells, "phase");

  check(cells.length === 152, `expected 152 total cells, received ${cells.length}`);
  check(phaseCounts.aa === 6, `expected 6 A/A cells, received ${phaseCounts.aa ?? 0}`);
  check(
    phaseCounts.calibration === 6,
    `expected 6 calibration cells, received ${phaseCounts.calibration ?? 0}`,
  );
  check(
    phaseCounts.confirmatory === 120,
    `expected 120 confirmatory cells, received ${phaseCounts.confirmatory ?? 0}`,
  );
  check(
    phaseCounts.holdout === 20,
    `expected 20 holdout cells, received ${phaseCounts.holdout ?? 0}`,
  );
  check(new Set(cells.map((cell) => cell.cellId)).size === cells.length, "cell IDs must be unique");
  check(cells.every((cell) => cell.status === "not-run"), "all cells must remain not-run");

  const aa = cells.filter((cell) => cell.phase === "aa");
  for (const platform of ["web", "expo", "swiftui"]) {
    const platformCells = aa.filter((cell) => cell.platform === platform);
    check(platformCells.length === 2, `A/A must contain two ${platform} cells`);
    check(
      platformCells.every(
        (cell) => cell.condition === "baseline" && cell.artifactVersion === "2.7.9",
      ),
      `A/A ${platform} cells must both use the 2.7.9 baseline`,
    );
  }

  const calibration = cells.filter((cell) => cell.phase === "calibration");
  for (const platform of ["web", "expo", "swiftui"]) {
    const conditions = calibration
      .filter((cell) => cell.platform === platform)
      .map((cell) => cell.condition)
      .sort();
    check(
      JSON.stringify(conditions) === JSON.stringify(["baseline", "candidate"]),
      `calibration must contain one baseline and one candidate ${platform} cell`,
    );
  }

  const confirmatory = cells.filter((cell) => cell.phase === "confirmatory");
  const tasks = [...new Set(confirmatory.map((cell) => cell.taskId))];
  check(tasks.length === 12, `expected 12 confirmatory tasks, received ${tasks.length}`);
  const platformTaskCounts = countBy(
    pkg.taskRegistry.criticalTasks,
    "platform",
  );
  for (const platform of ["web", "expo", "swiftui"]) {
    check(
      platformTaskCounts[platform] === 4,
      `expected four critical ${platform} tasks, received ${platformTaskCounts[platform] ?? 0}`,
    );
  }
  for (const taskId of tasks) {
    const taskCells = confirmatory.filter((cell) => cell.taskId === taskId);
    const pairs = [...new Set(taskCells.map((cell) => cell.pairId))];
    check(taskCells.length === 10, `${taskId} must contain ten confirmatory cells`);
    check(pairs.length === 5, `${taskId} must contain five matched pairs`);
    for (const pairId of pairs) {
      const pair = taskCells.filter((cell) => cell.pairId === pairId);
      check(pair.length === 2, `${pairId} must contain two cells`);
      check(
        JSON.stringify(pair.map((cell) => cell.condition).sort()) ===
          JSON.stringify(["baseline", "candidate"]),
        `${pairId} must contain baseline and candidate conditions`,
      );
      check(
        new Set(pair.map((cell) => cell.withinPairOrder)).size === 2,
        `${pairId} must have unique within-pair order values`,
      );
    }
  }

  const holdouts = cells.filter((cell) => cell.phase === "holdout");
  check(
    holdouts.every(
      (cell) =>
        cell.condition === "candidate" &&
        cell.artifactVersion === "2.8.0-rc.1" &&
        cell.pairId === null,
    ),
    "all holdouts must be unpaired 2.8.0-rc.1 candidate cells",
  );
  check(
    new Set(holdouts.map((cell) => cell.taskId)).size === 20,
    "holdouts must reference 20 unique task slots",
  );

  check(pkg.protocol.claimHarness.client === "Codex", "claim harness must be Codex");
  check(pkg.protocol.claimHarness.model === "gpt-5.6-luna", "claim model must be gpt-5.6-luna");
  check(pkg.protocol.claimHarness.reasoningEffort === "low", "reasoning effort must be low");
  check(pkg.analysisPlan.methods.bootstrap.resamples === 10000, "bootstrap must use 10,000 resamples");
  check(pkg.analysisPlan.releaseGates.length === 10, "analysis plan must contain all ten release gates");

  check(
    pkg.receiptLedger.entries.length === 152,
    `expected 152 receipt-ledger entries, received ${pkg.receiptLedger.entries.length}`,
  );
  const planCellIds = [...cells.map((cell) => cell.cellId)].sort();
  const receiptCellIds = [...pkg.receiptLedger.entries.map((entry) => entry.cellId)].sort();
  check(
    JSON.stringify(receiptCellIds) === JSON.stringify(planCellIds),
    "receipt-ledger cell IDs must exactly match the plan matrix",
  );
  for (const entry of pkg.receiptLedger.entries) {
    check(
      entry.status === "not-run" &&
        entry.receiptPath === null &&
        entry.receiptSha256 === null &&
        entry.admission === "not-evaluated",
      `${entry.cellId} must remain not-run until execution`,
    );
  }
  check(pkg.receiptLedger.receiptRoot === null, "receipt root must remain unset before freeze");
  check(pkg.exclusions.entries.length === 0, "foundation must not fabricate exclusions");
  check(pkg.deviations.entries.length === 0, "foundation must not fabricate deviations");
  check(pkg.gradingLedger.entries.length === 0, "foundation must not fabricate grades");
  check(pkg.rubric.totalPoints === 100, "quality rubric must total 100 points");
  check(pkg.graderPlan.modelPanel.gradersPerArtifact === 3, "model panel must contain three graders");
  check(pkg.priceCard.usdClaimPlanned === false, "foundation must not preregister a USD claim");
  check(pkg.freezeReadiness.readyForProviderInvocation === false, "unfrozen foundation cannot be run");

  return { valid: errors.length === 0, errors, phaseCounts };
}

async function main() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const result = validatePackage(await loadPackage(root));
  if (!result.valid) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(
    JSON.stringify(
      {
        valid: true,
        studyId: "memi-v18-2.8-confirmatory",
        totalCells: 152,
        phaseCounts: result.phaseCounts,
        resultClaimsPresent: false,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
