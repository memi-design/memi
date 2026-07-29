import type { BenchmarkRunRecord } from "./contracts.js";

export interface AdoptionMetrics {
  readonly generatedAt: string;
  readonly successfulFirstAudits: number;
  readonly repeatAuditProjects: number;
  readonly ciReuseProjects: number;
  readonly repeatRate: number;
}

export function calculateAdoptionMetrics(
  runs: readonly BenchmarkRunRecord[],
): Readonly<AdoptionMetrics> {
  const successful = runs.filter((run) =>
    run.condition === "memi"
    && run.outcome.accepted
    && run.outcome.testsPassed);
  const projects = new Map<string, BenchmarkRunRecord[]>();
  for (const run of successful) {
    const existing = projects.get(run.repository.pathHash) ?? [];
    projects.set(run.repository.pathHash, [...existing, run]);
  }

  const repeatAuditProjects = Array.from(projects.values())
    .filter((projectRuns) => new Set(
      projectRuns.map((run) => run.timing.completedAt.slice(0, 10)),
    ).size >= 2)
    .length;
  const ciReuseProjects = Array.from(projects.values())
    .filter((projectRuns) => projectRuns.some((run) => run.invocation === "ci"))
    .length;
  const successfulFirstAudits = projects.size;

  return Object.freeze({
    generatedAt: new Date().toISOString(),
    successfulFirstAudits,
    repeatAuditProjects,
    ciReuseProjects,
    repeatRate: successfulFirstAudits === 0
      ? 0
      : Math.round((repeatAuditProjects / successfulFirstAudits) * 10_000) / 10_000,
  });
}
