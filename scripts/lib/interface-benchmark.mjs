import { access } from "node:fs/promises";
import path from "node:path";

export async function validateInterfaceBenchmark(manifest, options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const failures = [];
  if (!isRecord(manifest)) {
    return result(null, failures.concat("benchmark manifest must be an object"));
  }
  requiredString(manifest, "benchmarkId", failures);
  requiredString(manifest, "title", failures);
  if (manifest.schemaVersion !== 1) failures.push("schemaVersion must equal 1");
  if (!["specification", "calibration", "published"].includes(manifest.status)) {
    failures.push("status must be specification, calibration, or published");
  }
  if (manifest.status === "published" && !isRecord(manifest.results)) {
    failures.push("published benchmark requires measured results");
  }
  validateWeightedEntries("task family", manifest.taskFamilies, failures);
  validateScorecard("work product", manifest.scorecards?.workProduct, failures);
  validateScorecard("source trust", manifest.scorecards?.sourceTrust, failures);
  validateProtocol(manifest.protocol, failures);
  validateReferences(manifest.references, failures);
  await validateSeedTasks(manifest, root, failures);
  validateReleaseGates(manifest.releaseGates, failures);
  return result(manifest, failures);
}

function validateProtocol(protocol, failures) {
  if (!isRecord(protocol)) {
    failures.push("protocol must be an object");
    return;
  }
  const targetTasks = positiveInteger(protocol.targetTasks)
    ? protocol.targetTasks
    : 0;
  if (targetTasks === 0) failures.push("protocol.targetTasks must be positive");
  const split = protocol.taskSplit;
  if (!isRecord(split)) {
    failures.push("protocol.taskSplit must be an object");
  } else {
    const total = Object.values(split).reduce(
      (sum, value) => sum + (typeof value === "number" ? value : 0),
      0,
    );
    if (total !== targetTasks) {
      failures.push(`task split must sum to ${targetTasks}, received ${total}`);
    }
  }
  if (!Array.isArray(protocol.conditions)
    || protocol.conditions.join(",") !== "baseline,memi") {
    failures.push("protocol.conditions must be baseline, memi");
  }
  if (!positiveInteger(protocol.minimumIndependentRuns)
    || protocol.minimumIndependentRuns < 3) {
    failures.push("protocol.minimumIndependentRuns must be at least 3");
  }
}

async function validateSeedTasks(manifest, root, failures) {
  const tasks = manifest.seedTasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    failures.push("seedTasks must be a non-empty array");
    return;
  }
  const familyIds = new Set(
    Array.isArray(manifest.taskFamilies)
      ? manifest.taskFamilies.map((entry) => entry?.id)
      : [],
  );
  const ids = new Set();
  for (const task of tasks) {
    const id = typeof task?.id === "string" ? task.id : "unknown";
    if (ids.has(id)) failures.push(`duplicate seed task id ${id}`);
    ids.add(id);
    if (!familyIds.has(task?.family)) {
      failures.push(`seed task ${id} references unknown family ${String(task?.family)}`);
    }
    if (!/^[a-f0-9]{40}$/.test(task?.repository?.revision ?? "")) {
      failures.push(`seed task ${id} requires a full 40-character revision`);
    }
    if (typeof task?.workflowFile !== "string") {
      failures.push(`seed task ${id} requires workflowFile`);
    } else {
      const workflow = path.resolve(root, task.workflowFile);
      if (!insideRoot(root, workflow) || !await exists(workflow)) {
        failures.push(
          `seed task ${id} references missing workflow ${task.workflowFile}`,
        );
      }
    }
    validateWeightedEntries(
      `seed task ${id} rubric`,
      task?.rubric?.positiveCriteria,
      failures,
    );
    if (!Array.isArray(task?.rubric?.negativeCriteria)
      || task.rubric.negativeCriteria.length === 0) {
      failures.push(`seed task ${id} requires negative rubric criteria`);
    }
  }
}

function validateScorecard(name, scorecard, failures) {
  if (!isRecord(scorecard)) {
    failures.push(`${name} scorecard must be an object`);
    return;
  }
  validateWeightedEntries(`${name} dimension`, scorecard.dimensions, failures);
}

function validateWeightedEntries(label, entries, failures) {
  if (!Array.isArray(entries) || entries.length === 0) {
    failures.push(`${label}s must be a non-empty array`);
    return;
  }
  const ids = new Set();
  let total = 0;
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0) {
      failures.push(`${label} requires an id`);
      continue;
    }
    if (ids.has(entry.id)) failures.push(`duplicate ${label} id ${entry.id}`);
    ids.add(entry.id);
    if (typeof entry.weight !== "number" || entry.weight <= 0) {
      failures.push(`${label} ${entry.id} requires a positive weight`);
      continue;
    }
    total += entry.weight;
  }
  if (total !== 100) {
    failures.push(`${label} weights must sum to 100, received ${total}`);
  }
}

function validateReferences(references, failures) {
  if (!Array.isArray(references) || references.length < 7) {
    failures.push("references must contain at least seven primary sources");
    return;
  }
  const ids = new Set();
  for (const reference of references) {
    if (typeof reference?.id !== "string" || ids.has(reference.id)) {
      failures.push("reference ids must be present and unique");
    }
    ids.add(reference?.id);
    if (typeof reference?.url !== "string" || !reference.url.startsWith("https://")) {
      failures.push(`reference ${String(reference?.id)} requires an HTTPS URL`);
    }
  }
}

function validateReleaseGates(gates, failures) {
  const required = new Set([
    "quality-non-inferiority",
    "positive-cost-evidence",
    "positive-latency",
    "repeat-stability",
  ]);
  for (const gate of Array.isArray(gates) ? gates : []) required.delete(gate?.id);
  for (const id of required) failures.push(`missing release gate ${id}`);
}

function result(manifest, failures) {
  return Object.freeze({
    passed: failures.length === 0,
    benchmarkId: manifest?.benchmarkId ?? null,
    targetTasks: manifest?.protocol?.targetTasks ?? 0,
    seedTasks: Array.isArray(manifest?.seedTasks) ? manifest.seedTasks.length : 0,
    failures: Object.freeze([...failures]),
  });
}

function requiredString(value, field, failures) {
  if (typeof value[field] !== "string" || value[field].trim() === "") {
    failures.push(`${field} must be a non-empty string`);
  }
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
