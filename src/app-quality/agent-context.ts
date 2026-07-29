import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  AppQualityDiagnosis,
  AppQualityFileSignal,
  AppQualityIssue,
  AppQualitySeverity,
} from "./engine.js";

export interface AgentAuditContextOptions {
  readonly maxFiles?: number;
  readonly maxIssues?: number;
  readonly maxExcerptFiles?: number;
  readonly maxExcerptsPerFile?: number;
  readonly routingMode?: AgentContextRouting["mode"];
}

export interface AgentContextRouting {
  readonly mode: "full" | "index-only" | "abstain";
  readonly reason:
    | "supported-multi-surface-repository"
    | "supported-large-web-repository"
    | "react-native-analyzer-incomplete"
    | "native-analysis-partial"
    | "low-discovery-complexity"
    | "moderate-discovery-complexity"
    | "manual-override";
}

const DEFAULT_MAX_FILES = 40;
const DEFAULT_MAX_ISSUES = 20;
const DEFAULT_MAX_EXCERPT_FILES = 15;
const DEFAULT_MAX_EXCERPTS_PER_FILE = 6;
const SEVERITY_RANK: Readonly<Record<AppQualitySeverity, number>> = Object.freeze({
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
});
const KIND_WEIGHT: Readonly<Record<AppQualityFileSignal["kind"], number>> = Object.freeze({
  component: 50,
  style: 45,
  route: 30,
  config: 10,
  markup: 5,
});

export function buildAgentAuditContext(
  diagnosis: AppQualityDiagnosis,
  options: AgentAuditContextOptions = {},
): Readonly<ReturnType<typeof createContext>> {
  const maxFiles = positiveBound(options.maxFiles ?? DEFAULT_MAX_FILES, "maxFiles");
  const maxIssues = positiveBound(options.maxIssues ?? DEFAULT_MAX_ISSUES, "maxIssues");
  return deepFreeze(createContext(diagnosis, maxFiles, maxIssues));
}

export async function buildRepositoryAgentAuditContext(
  repositoryRoot: string,
  diagnosis: AppQualityDiagnosis,
  options: AgentAuditContextOptions = {},
) {
  const base = buildAgentAuditContext(diagnosis, options);
  const routing = options.routingMode
    ? deepFreeze({
      mode: options.routingMode,
      reason: "manual-override" as const,
    })
    : deriveAgentContextRouting(diagnosis);
  const root = await realpath(repositoryRoot);
  const requestedExcerptFiles = positiveBound(
    options.maxExcerptFiles ?? DEFAULT_MAX_EXCERPT_FILES,
    "maxExcerptFiles",
  );
  const requestedExcerptsPerFile = positiveBound(
    options.maxExcerptsPerFile ?? DEFAULT_MAX_EXCERPTS_PER_FILE,
    "maxExcerptsPerFile",
  );
  const effectiveFileLimit = routing.mode === "full"
    ? base.files.length
    : routing.mode === "index-only"
      ? Math.min(base.files.length, 10)
      : Math.min(base.files.length, 5);
  const files = base.files.slice(0, effectiveFileLimit);
  const maxExcerptFiles = routing.mode === "full"
    ? requestedExcerptFiles
    : routing.mode === "index-only"
      ? Math.min(requestedExcerptFiles, 6)
      : 0;
  const maxExcerptsPerFile = routing.mode === "full"
    ? requestedExcerptsPerFile
    : Math.min(requestedExcerptsPerFile, 4);
  const sourceExcerpts: Array<{
    path: string;
    excerpts: Array<{ line: number; text: string }>;
  }> = [];
  for (const file of files.slice(0, maxExcerptFiles)) {
    const candidate = path.resolve(root, file.path);
    const relative = path.relative(root, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    let content: string;
    try {
      content = await readFile(candidate, "utf8");
    } catch {
      continue;
    }
    const excerpts = extractDesignExcerpts(content, maxExcerptsPerFile);
    if (excerpts.length > 0) {
      sourceExcerpts.push({ path: file.path, excerpts });
    }
  }
  return deepFreeze({
    ...base,
    routing,
    files,
    sourceExcerpts,
    limits: {
      ...base.limits,
      effectiveFiles: files.length,
      effectiveExcerptFiles: sourceExcerpts.length,
    },
    usage: {
      instruction: routing.mode === "full"
        ? "Use the bounded file index and line-numbered sourceExcerpts first. Inspect source only when an excerpt lacks required context."
        : routing.mode === "index-only"
          ? "Use this compact index only as a starting hint. Keep normal source verification narrow."
          : "Memi predicts no net benefit from expanded context for this repository. Continue with normal source discovery.",
      citation: "Each excerpt line is repository source evidence and may be cited after checking that it supports the claim.",
      abstention: "Treat unassessed dimensions as unknown, not as passing checks.",
    },
  });
}

export function deriveAgentContextRouting(
  diagnosis: AppQualityDiagnosis,
): Readonly<AgentContextRouting> {
  const dependencies = new Set([
    ...(diagnosis.appGraph?.package.dependencies ?? []),
    ...(diagnosis.appGraph?.package.devDependencies ?? []),
  ]);
  if (dependencies.has("react-native") || dependencies.has("expo")) {
    return deepFreeze({
      mode: "abstain",
      reason: "react-native-analyzer-incomplete",
    });
  }
  const webFiles = diagnosis.sourceCoverage.web?.scannedFiles ?? 0;
  const swiftUiFiles = diagnosis.sourceCoverage.swiftui?.scannedFiles ?? 0;
  if (webFiles === 0 && swiftUiFiles > 0) {
    return deepFreeze({
      mode: "index-only",
      reason: "native-analysis-partial",
    });
  }
  if (diagnosis.summary.scannedFiles < 100) {
    return deepFreeze({
      mode: "abstain",
      reason: "low-discovery-complexity",
    });
  }
  if (
    diagnosis.summary.scannedFiles >= 200
    && webFiles > 0
    && swiftUiFiles > 0
  ) {
    return deepFreeze({
      mode: "full",
      reason: "supported-multi-surface-repository",
    });
  }
  if (
    diagnosis.summary.scannedFiles >= 250
    && diagnosis.summary.routes >= 5
    && diagnosis.summary.components >= 50
    && diagnosis.summary.styleFiles >= 2
  ) {
    return deepFreeze({
      mode: "full",
      reason: "supported-large-web-repository",
    });
  }
  return deepFreeze({
    mode: "index-only",
    reason: "moderate-discovery-complexity",
  });
}

function createContext(
  diagnosis: AppQualityDiagnosis,
  maxFiles: number,
  maxIssues: number,
) {
  const files = diagnosis.files
    .map((file) => ({ file, score: fileSignalScore(file) }))
    .sort((left, right) =>
      right.score - left.score || left.file.path.localeCompare(right.file.path))
    .slice(0, maxFiles)
    .map(({ file }) => ({
      path: file.path,
      kind: file.kind,
      classCount: file.classCount,
      shadcnImports: [...file.shadcnImports],
      hexColorCount: file.hexColors.length,
      cssVariables: [...file.cssVariables],
    }));
  const issues = [...diagnosis.issues]
    .sort((left, right) =>
      SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]
      || left.id.localeCompare(right.id))
    .slice(0, maxIssues)
    .map(compactIssue);

  return {
    schemaVersion: 1 as const,
    kind: "memi-agent-audit-context" as const,
    target: diagnosis.target,
    generatedAt: diagnosis.generatedAt,
    summary: { ...diagnosis.summary },
    appGraph: diagnosis.appGraph
      ? {
        ...diagnosis.appGraph,
        shadcnComponents: [...diagnosis.appGraph.shadcnComponents],
        package: {
          name: diagnosis.appGraph.package.name,
          version: diagnosis.appGraph.package.version,
          hasShadcn: diagnosis.appGraph.package.hasShadcn,
          hasTailwind: diagnosis.appGraph.package.hasTailwind,
          dependencyCount: diagnosis.appGraph.package.dependencies.length,
          devDependencyCount: diagnosis.appGraph.package.devDependencies.length,
          platformSignals: [
            ...diagnosis.appGraph.package.dependencies,
            ...diagnosis.appGraph.package.devDependencies,
          ].filter((dependency) =>
            /^(?:expo|react-native|next|react|@tauri-apps\/|@visx\/|tailwindcss|swift)/.test(
              dependency,
            )),
        },
      }
      : undefined,
    sourceCoverage: cloneSourceCoverage(diagnosis),
    confidence: diagnosis.confidence,
    assessedDimensions: [...diagnosis.assessedDimensions],
    unassessedDimensions: [...diagnosis.unassessedDimensions],
    evidenceProvenance: diagnosis.evidenceProvenance.map((entry) => ({ ...entry })),
    files,
    issues,
    limits: {
      maxFiles,
      maxIssues,
      totalFiles: diagnosis.files.length,
      totalIssues: diagnosis.issues.length,
      filesTruncated: diagnosis.files.length > maxFiles,
      issuesTruncated: diagnosis.issues.length > maxIssues,
    },
    usage: {
      instruction: "Use this bounded index to choose source files. Verify material claims against source lines.",
      abstention: "Treat unassessed dimensions as unknown, not as passing checks.",
    },
  };
}

function compactIssue(issue: AppQualityIssue) {
  return {
    id: issue.id,
    category: issue.category,
    severity: issue.severity,
    title: issue.title,
    evidence: [...issue.evidence],
    recommendation: issue.recommendation,
    affectedFiles: [...(issue.affectedFiles ?? [])],
    evidenceLocations: (issue.evidenceLocations ?? []).map((location) => ({
      ...location,
    })),
    confidence: issue.confidence,
  };
}

function cloneSourceCoverage(diagnosis: AppQualityDiagnosis) {
  return Object.fromEntries(
    Object.entries(diagnosis.sourceCoverage).map(([surface, coverage]) => [
      surface,
      {
        ...coverage,
        assessedDimensions: [...coverage.assessedDimensions],
        assessedChecks: [...coverage.assessedChecks],
      },
    ]),
  );
}

function fileSignalScore(file: AppQualityFileSignal): number {
  return KIND_WEIGHT[file.kind]
    + Math.min(file.classCount, 20)
    + file.shadcnImports.length * 6
    + file.hexColors.length * 8
    + file.cssVariables.length * 5;
}

function extractDesignExcerpts(
  content: string,
  maximum: number,
): Array<{ line: number; text: string }> {
  const candidates = content.split(/\r?\n/)
    .map((raw, index) => ({
      line: index + 1,
      text: raw.trim().slice(0, 240),
      score: designLineScore(raw),
    }))
    .filter((entry) => entry.text.length > 0 && entry.score > 0)
    .sort((left, right) =>
      right.score - left.score || left.line - right.line)
    .slice(0, maximum)
    .sort((left, right) => left.line - right.line)
    .map(({ line, text }) => ({ line, text }));
  return candidates;
}

function designLineScore(line: string): number {
  let score = 0;
  if (/--(?:color|font|text|space|spacing|radius|shadow|motion|ease|duration)-/i.test(line)) {
    score += 24;
  }
  if (
    /\b(?:static\s+let|(?:export\s+)?const)\s+[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)
    && /\b(?:Color|Font|Typography|Palette|Token|Theme|Motion|Animation|Duration|Radius|Shadow)\b|(?:#[0-9a-f]{3,8}|oklch\(|rgba?\(|Color\()/i.test(line)
  ) {
    score += 28;
  }
  if (/\b(?:struct|class|enum)\s+[A-Za-z0-9_]*(?:Palette|Typography|Theme|Tokens?)\b/.test(line)) {
    score += 20;
  }
  if (/\b(?:export\s+)?(?:struct|class|enum|function)\s+[A-Z][A-Za-z0-9_]*/.test(line)) {
    score += 18;
  }
  if (/\b(?:Color|Font|Typography|Palette|Token|Theme|Motion|Animation|ViewModifier)\b/.test(line)) {
    score += 12;
  }
  if (/\b(?:className|foregroundStyle|background|font|cornerRadius|shadow|animation)\b/i.test(line)) {
    score += 8;
  }
  if (/(?:#[0-9a-f]{3,8}|oklch\(|rgba?\(|Color\()/i.test(line)) {
    score += 6;
  }
  return score;
}

function positiveBound(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be positive`);
  }
  return value;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
