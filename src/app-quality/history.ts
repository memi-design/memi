/**
 * Score History — append-only ledger (.memoire/app-quality/history.jsonl) so
 * design debt is tracked over time, not just at a point in time. One JSON
 * object per line; capped so it never grows unbounded.
 *
 * Comparability rule: a run is only comparable to prior runs with the SAME
 * policy hash and a full (non-scoped) scan — comparing scores produced under
 * different thresholds, or from partial scans, is noise dressed as signal.
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import type { AppQualityDiagnosis } from "./engine.js";

export interface HistoryEntry {
  at: string;
  sha?: string;
  branch?: string;
  scope: "full" | "scoped";
  policyHash?: string;
  coverageFingerprint?: string;
  score: number;
  categoryScores: Record<string, number>;
  severityCounts: { critical: number; high: number; medium: number; low: number };
}

export interface RegressionCheck {
  comparable: boolean;
  reason?: string;
  previous?: HistoryEntry;
  delta?: number;
  regressed?: boolean;
}

const HISTORY_RELATIVE = join(".memoire", "app-quality", "history.jsonl");
const MAX_ENTRIES = 2000;

export function historyPath(projectRoot: string): string {
  return join(projectRoot, HISTORY_RELATIVE);
}

function gitValue(args: string[], cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, encoding: "utf-8" }, (error, stdout) => {
      resolve(error ? undefined : stdout.trim() || undefined);
    });
  });
}

export function entryFromDiagnosis(diagnosis: AppQualityDiagnosis): HistoryEntry {
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const issue of diagnosis.issues) severityCounts[issue.severity] += 1;
  return {
    at: diagnosis.generatedAt,
    scope: diagnosis.scope ? "scoped" : "full",
    policyHash: diagnosis.policy?.hash,
    coverageFingerprint: sourceCoverageFingerprint(diagnosis),
    score: diagnosis.summary.score,
    categoryScores: diagnosis.scores,
    severityCounts,
  };
}

/** Append a run to the ledger, stamping git SHA/branch when available. */
export async function appendHistory(projectRoot: string, diagnosis: AppQualityDiagnosis): Promise<HistoryEntry> {
  const entry = entryFromDiagnosis(diagnosis);
  entry.sha = await gitValue(["rev-parse", "--short", "HEAD"], projectRoot);
  entry.branch = await gitValue(["rev-parse", "--abbrev-ref", "HEAD"], projectRoot);

  const path = historyPath(projectRoot);
  await mkdir(join(projectRoot, ".memoire", "app-quality"), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf-8");
  await rotateIfNeeded(path);
  return entry;
}

async function rotateIfNeeded(path: string): Promise<void> {
  const raw = await readFile(path, "utf-8").catch(() => "");
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length <= MAX_ENTRIES) return;
  await writeFile(path, `${lines.slice(-MAX_ENTRIES).join("\n")}\n`, "utf-8");
}

export async function readHistory(projectRoot: string): Promise<HistoryEntry[]> {
  const raw = await readFile(historyPath(projectRoot), "utf-8").catch(() => "");
  const entries: HistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as HistoryEntry);
    } catch {
      // Skip corrupt lines rather than losing the whole ledger.
    }
  }
  return entries;
}

/**
 * Compare the current run against the most recent COMPARABLE prior entry
 * (same policy hash, full scan). Returns comparable:false with a reason when
 * no honest comparison exists — callers must not fabricate a trend from
 * incomparable runs.
 */
export function checkRegression(
  current: HistoryEntry,
  history: HistoryEntry[],
  budget: number,
): RegressionCheck {
  if (current.scope !== "full") {
    return { comparable: false, reason: "current run is scoped — regression detection requires a full scan" };
  }
  const previous = [...history]
    .reverse()
    .find((entry) =>
      entry.scope === "full"
      && entry.policyHash === current.policyHash
      && entry.coverageFingerprint === current.coverageFingerprint
      && entry.at !== current.at,
    );
  if (!previous) {
    return { comparable: false, reason: "no prior full-scan entry with the same policy hash and source coverage" };
  }
  const delta = current.score - previous.score;
  return {
    comparable: true,
    previous,
    delta,
    regressed: delta < -budget,
  };
}

/** Render a compact trend line for terminal display (oldest → newest, comparable entries only). */
export function renderTrend(
  history: HistoryEntry[],
  policyHash: string | undefined,
  coverageFingerprint?: string,
  limit = 10,
): string[] {
  const comparable = history.filter((entry) =>
    entry.scope === "full"
    && entry.policyHash === policyHash
    && (coverageFingerprint === undefined || entry.coverageFingerprint === coverageFingerprint),
  );
  const window = comparable.slice(-limit);
  return window.map((entry) => {
    const sha = entry.sha ? ` ${entry.sha}` : "";
    const branch = entry.branch ? ` (${entry.branch})` : "";
    return `${entry.at.slice(0, 10)}${sha}${branch}: ${entry.score}/100 — ${entry.severityCounts.critical}c/${entry.severityCounts.high}h/${entry.severityCounts.medium}m/${entry.severityCounts.low}l`;
  });
}

function sourceCoverageFingerprint(diagnosis: AppQualityDiagnosis): string {
  const target = diagnosis.summary.scanTarget ?? diagnosis.target;
  const scanContext = `target=${target}|scanLimit=${diagnosis.summary.scanLimit ?? "legacy"}`;
  if (!diagnosis.sourceCoverage) return `${scanContext}|legacy:unknown`;
  const entries = Object.entries(diagnosis.sourceCoverage).map(([platform, coverage]) => {
    const dimensions = [...coverage.assessedDimensions].sort().join(",");
    const checks = [...coverage.assessedChecks].sort().join(",");
    return `${platform}:${coverage.analysis}:dimensions=${dimensions}:checks=${checks}`;
  });
  return `${scanContext}|${entries.sort().join("|")}`;
}
