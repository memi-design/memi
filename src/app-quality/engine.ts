import { access, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { scanSources, type ScannedSourceFile } from "../utils/source-scanner.js";
import { buildAppGraph, type AppGraph } from "./app-graph.js";
import { buildUxAuditReport, type UxAuditReport } from "../ux/tenets-traps.js";
import { checkSkillCompliance, type ComplianceReport } from "../ux/skill-compliance.js";
import { defaultPolicy, applyPolicyToIssues, type ResolvedPolicy, type PolicyThresholds } from "./policy.js";
import {
  AUDIT_SCHEMA_VERSION,
  buildAuditEvidenceMetadata,
  normalizeAuditFindingId,
  type AuditEvidenceMetadata,
} from "../audit/evidence.js";

export type AppQualitySeverity = "critical" | "high" | "medium" | "low";
export type AppQualityCategory =
  | "visual-system"
  | "typography"
  | "spacing"
  | "color"
  | "components"
  | "accessibility"
  | "responsive"
  | "maintainability";

export interface AppQualityIssue {
  id: string;
  normalizedId: string;
  category: AppQualityCategory;
  severity: AppQualitySeverity;
  title: string;
  detail: string;
  evidence: string[];
  recommendation: string;
  evidenceLocations?: Array<{ file: string; line?: number; excerpt?: string }>;
  affectedFiles?: string[];
  confidence?: number;
  estimatedEffort?: "small" | "medium" | "large";
  fixCategory?: "tokens" | "components" | "accessibility" | "responsive" | "code-health";
}

export interface AppQualityDirection {
  id: string;
  name: string;
  fit: string;
  tokenMoves: string[];
  componentMoves: string[];
  patchScope: string[];
}

export interface AppQualityFileSignal {
  path: string;
  kind: "component" | "route" | "style" | "config" | "markup";
  classCount: number;
  shadcnImports: string[];
  hexColors: string[];
  cssVariables: string[];
}

export interface AppQualityDiagnosis {
  version: 1;
  schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  target: string;
  generatedAt: string;
  summary: {
    score: number;
    verdict: string;
    scannedFiles: number;
    routes: number;
    components: number;
    styleFiles: number;
    tailwindClasses: number;
    shadcnImports: number;
    cssVariables: number;
    hexColors: number;
    scannedBytes?: number;
    scanMs?: number;
    analysisMs?: number;
  };
  scores: Record<AppQualityCategory, number>;
  files: AppQualityFileSignal[];
  issues: AppQualityIssue[];
  ux: UxAuditReport;
  directions: AppQualityDirection[];
  nextActions: string[];
  appGraph?: {
    routes: number;
    components: number;
    imports: number;
    shadcnComponents: string[];
    package: AppGraph["package"];
    graphMs?: number;
  };
  /** Post-hoc verification of real source files against skills/ATOMIC_DESIGN.md and skills/MOTION_VIDEO_DESIGN.md's checkable rules. */
  compliance?: ComplianceReport;
  /** The policy this diagnosis was produced under — scores are only comparable across identical policy hashes. */
  policy?: {
    hash: string;
    source: "default" | "file";
    preset: string;
  };
  /**
   * Present when the scan was PR-scoped. Scores remain whole-tree (labeled
   * scan-scoped for trend purposes); `issues` contains only scoped findings.
   */
  scope?: {
    base?: string;
    requestedFiles: number;
    effectiveFiles: number;
    expandedWithDependents: boolean;
    emittedIssues: number;
    filteredOutIssues: number;
  };
  confidence: AuditEvidenceMetadata["confidence"];
  assessedDimensions: AuditEvidenceMetadata["assessedDimensions"];
  unassessedDimensions: AuditEvidenceMetadata["unassessedDimensions"];
  evidenceProvenance: AuditEvidenceMetadata["evidenceProvenance"];
  appliedScoreCaps: AuditEvidenceMetadata["appliedScoreCaps"];
}

interface ScanOptions {
  target?: string;
  projectRoot: string;
  maxFiles?: number;
  write?: boolean;
  /** Resolved policy (thresholds, rule overrides). Defaults to the built-in memi-recommended policy. */
  policy?: ResolvedPolicy;
  /**
   * PR scope: whole-tree stats/scores are STILL computed (thresholds stay
   * meaningful), but emitted issues are filtered to those touching these
   * repo-relative files. Aggregate issues with no file anchor are dropped
   * from the scoped issue list — they gate via score budgets, not per-file
   * blame. expandImports adds one hop of dependents via the app graph.
   */
  scope?: {
    files: string[];
    base?: string;
    expandImports?: boolean;
  };
}

interface RawFile {
  path: string;
  absolutePath: string;
  content: string;
}

const DEFAULT_MAX_FILES = 500;
const FETCH_TIMEOUT_MS = 15000;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".html", ".css", ".mdx"]);
const MAX_BYTES_PER_FILE = 750_000;
const IGNORE_DIRS = new Set([
  ".git",
  ".astro",
  ".next",
  ".turbo",
  ".vite",
  "agent-kits",
  "coverage",
  "dist",
  "dist-runtime-resources",
  "examples",
  "generated",
  "notes",
  "plugin",
  "plugins",
  "build",
  "node_modules",
  "out",
  "target",
]);

const CATEGORY_BASE: Record<AppQualityCategory, number> = {
  "visual-system": 100,
  typography: 100,
  spacing: 100,
  color: 100,
  components: 100,
  accessibility: 100,
  responsive: 100,
  maintainability: 100,
};

export async function diagnoseAppQuality(options: ScanOptions): Promise<AppQualityDiagnosis> {
  const target = options.target ?? options.projectRoot;
  const startedAt = performance.now();
  const sources = await scanTargetSources(options.projectRoot, target, options.maxFiles ?? DEFAULT_MAX_FILES);
  const scanMs = performance.now() - startedAt;
  const files = sources.map(sourceToRawFile);
  const graphStartedAt = performance.now();
  const appGraph = await buildAppGraph({
    projectRoot: options.projectRoot,
    target,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    sources,
  });
  const graphMs = performance.now() - graphStartedAt;
  const policy = options.policy ?? defaultPolicy();
  const fileSignals = files.map(analyzeFile);
  const aggregate = aggregateSignals(files, fileSignals);
  // Policy overrides apply BEFORE enrichment/scoring so severities, scores,
  // and downstream UX reports all reflect the team's policy, not the defaults.
  const policyAdjusted = applyPolicyToIssues(buildIssues(aggregate, policy.thresholds), policy);
  const allIssues = enrichIssues(policyAdjusted, appGraph, files);
  // Whole-tree scores stay valid regardless of scope — scope only filters
  // which issues are EMITTED (noise reduction), never the statistics.
  const scores = scoreCategories(allIssues);

  let issues = allIssues;
  let scopeMetadata: AppQualityDiagnosis["scope"];
  if (options.scope) {
    let effectiveFiles = options.scope.files;
    if (options.scope.expandImports) {
      const { expandScopeWithDependents } = await import("./git-scope.js");
      effectiveFiles = expandScopeWithDependents(effectiveFiles, appGraph.files);
    }
    const scopeSet = new Set(effectiveFiles);
    issues = allIssues.filter((current) => current.affectedFiles?.some((file) => scopeSet.has(file)));
    scopeMetadata = {
      base: options.scope.base,
      requestedFiles: options.scope.files.length,
      effectiveFiles: effectiveFiles.length,
      expandedWithDependents: options.scope.expandImports === true,
      emittedIssues: issues.length,
      filteredOutIssues: allIssues.length - issues.length,
    };
  }
  const score = Math.round(Object.values(scores).reduce((sum, value) => sum + value, 0) / Object.values(scores).length);
  const analysisMs = performance.now() - startedAt;
  const ux = buildUxAuditReport({ target, issues, appQualityScore: score });
  const compliance = checkSkillCompliance(files, { target });
  const auditEvidence = buildAuditEvidenceMetadata({
    dimensions: Object.keys(CATEGORY_BASE),
    evidenceProvenance: [{ kind: "static-scan", analyzed: true, target }],
    findingConfidences: issues.map((issue) => issue.confidence),
  });

  const diagnosis: AppQualityDiagnosis = {
    version: 1,
    schemaVersion: AUDIT_SCHEMA_VERSION,
    target,
    generatedAt: new Date().toISOString(),
    summary: {
      score,
      verdict: verdictForScore(score),
      scannedFiles: files.length,
      routes: fileSignals.filter((file) => file.kind === "route").length,
      components: fileSignals.filter((file) => file.kind === "component").length,
      styleFiles: fileSignals.filter((file) => file.kind === "style").length,
      tailwindClasses: aggregate.classTokens.length,
      shadcnImports: aggregate.shadcnImports.length,
      cssVariables: aggregate.cssVariables.length,
      hexColors: aggregate.hexColors.length,
      scannedBytes: sources.reduce((sum, source) => sum + (source.sizeBytes ?? source.content.length), 0),
      scanMs: Math.round(scanMs),
      analysisMs: Math.round(analysisMs),
    },
    scores,
    files: fileSignals,
    issues,
    ux,
    directions: buildDirections(aggregate, issues),
    nextActions: [
      "Run `memi diagnose --json` in CI to track design debt over time.",
      "Start with the highest-severity issue before applying visual directions.",
      "Use `memi theme import` or `memi publish` after the improved system is stable.",
    ],
    appGraph: {
      routes: appGraph.summary.routes,
      components: appGraph.summary.components,
      imports: appGraph.summary.imports,
      shadcnComponents: appGraph.shadcn.components,
      package: appGraph.package,
      graphMs: Math.round(graphMs),
    },
    compliance,
    policy: {
      hash: policy.policyHash,
      source: policy.source,
      preset: policy.preset,
    },
    scope: scopeMetadata,
    ...auditEvidence,
  };

  if (options.write !== false) {
    await writeDiagnosis(options.projectRoot, diagnosis);
  }

  return diagnosis;
}

async function scanTargetSources(projectRoot: string, target: string, maxFiles: number): Promise<ScannedSourceFile[]> {
  const sources = await scanSources({
    projectRoot,
    target,
    extensions: SOURCE_EXTENSIONS,
    ignoreDirs: IGNORE_DIRS,
    maxFiles,
    maxBytesPerFile: MAX_BYTES_PER_FILE,
    concurrency: 16,
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    includeInlineStyles: true,
    includeLinkedStyles: false,
    userAgent: "Memoire-Diagnose/1.0",
  });
  return shouldApplyDefaultNoiseFilters(projectRoot, target)
    ? sources.filter((source) => !isDefaultNoisePath(source.projectPath))
    : sources;
}

function shouldApplyDefaultNoiseFilters(projectRoot: string, target: string): boolean {
  if (/^https?:\/\//i.test(target)) return false;
  const root = resolve(projectRoot);
  const resolvedTarget = isAbsolute(target) ? resolve(target) : resolve(root, target);
  return resolvedTarget === root;
}

function isDefaultNoisePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith(".superpowers/")
    || normalized.startsWith("docs/audits/artifacts/")
    || normalized.startsWith("examples/site-bundle/")
    || normalized.includes("/src-tauri/resources/memoire-runtime/");
}

function sourceToRawFile(source: ScannedSourceFile): RawFile {
  return {
    path: source.projectPath,
    absolutePath: source.absolutePath,
    content: source.content,
  };
}

function analyzeFile(file: RawFile): AppQualityFileSignal {
  const classTokens = extractClassTokens(file.content);
  const shadcnImports = [...file.content.matchAll(/from\s+["'][^"']*components\/ui\/([^"']+)["']/g)]
    .map((match) => match[1].replace(/\.(tsx?|jsx?)$/, ""));
  const hexColors = [...file.content.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
  const cssVariables = [...file.content.matchAll(/--[a-zA-Z0-9-_]+/g)].map((match) => match[0]);

  return {
    path: file.path,
    kind: classifyFile(file.path),
    classCount: classTokens.length,
    shadcnImports: [...new Set(shadcnImports)],
    hexColors: [...new Set(hexColors)],
    cssVariables: [...new Set(cssVariables)],
  };
}

function classifyFile(path: string): AppQualityFileSignal["kind"] {
  if (/\.(test|spec)\.(tsx?|jsx?)$/.test(path) || path.includes("/__tests__/")) return "config";
  if (/(\.css|tailwind\.config|components\.json)$/.test(path)) return "style";
  if (/(^|\/)(app|pages|routes)\//.test(path) || /page\.(tsx|jsx|ts|js|html)$/.test(path)) return "route";
  if (/(^|\/)components\//.test(path)) return "component";
  if (/\.html$/.test(path)) return "markup";
  return "config";
}

function extractClassTokens(content: string): string[] {
  const chunks: string[] = [];
  const patterns = [
    /className\s*=\s*["']([^"']+)["']/g,
    /class\s*=\s*["']([^"']+)["']/g,
    /className\s*=\s*\{`([^`]+)`\}/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      chunks.push(match[1]);
    }
  }
  return chunks.flatMap((chunk) => chunk.split(/\s+/)).map((token) => token.trim()).filter(Boolean);
}

function aggregateSignals(files: RawFile[], fileSignals: AppQualityFileSignal[]) {
  const scopedPairs = uiSignalPairs(files, fileSignals);
  const scopedFiles = scopedPairs.map((pair) => pair.file);
  const scopedSignals = scopedPairs.map((pair) => pair.signal);
  const allContent = scopedFiles.map((file) => file.content).join("\n");
  const classTokens = scopedFiles.flatMap((file) => extractClassTokens(file.content));
  const spacing = classTokens.filter((token) => /^(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|space-[xy])-/.test(stripVariants(token)));
  const textSizes = classTokens.filter((token) => /^text-(xs|sm|base|lg|xl|[2-9]xl|\[[^\]]+\])$/.test(stripVariants(token)));
  const colors = classTokens.filter((token) => /(bg|text|border|ring|from|to|via)-/.test(stripVariants(token)));
  const radius = classTokens.filter((token) => /^rounded/.test(stripVariants(token)));
  const shadows = classTokens.filter((token) => /^shadow/.test(stripVariants(token)));
  const responsive = classTokens.filter((token) => /^(sm|md|lg|xl|2xl):/.test(token));
  const arbitrary = classTokens.filter((token) => /\[[^\]]+\]/.test(token));
  const shadcnImports = scopedSignals.flatMap((file) => file.shadcnImports);
  const hexColors = scopedSignals.flatMap((file) => file.hexColors);
  const cssVariables = scopedSignals.flatMap((file) => file.cssVariables);
  const buttons = (allContent.match(/<button\b|<Button\b/g) ?? []).length;
  const images = (allContent.match(/<img\b|<Image\b/g) ?? []).length;
  const imagesWithAlt = (allContent.match(/<(?:img|Image)\b[^>]*\salt=/g) ?? []).length;
  const interactive = (allContent.match(/onClick=|<button\b|<Button\b|role=["']button/g) ?? []).length;
  const focusClasses = [
    ...classTokens.filter((token) => /focus:|focus-visible:/.test(token)),
    ...scopedFiles.flatMap((file) => file.content.match(/:focus-visible\b|:focus\b/g) ?? []),
  ];

  return {
    classTokens,
    spacing,
    textSizes,
    colors,
    radius,
    shadows,
    responsive,
    arbitrary,
    shadcnImports,
    hexColors,
    cssVariables,
    buttons,
    images,
    imagesWithAlt,
    interactive,
    focusClasses,
    styleFiles: scopedSignals.filter((file) => file.kind === "style"),
    componentFiles: scopedSignals.filter((file) => file.kind === "component"),
    routeFiles: scopedSignals.filter((file) => file.kind === "route"),
  };
}

function uiSignalPairs(files: RawFile[], fileSignals: AppQualityFileSignal[]): Array<{ file: RawFile; signal: AppQualityFileSignal }> {
  const pairs = files
    .map((file, index) => ({ file, signal: fileSignals[index] }))
    .filter((pair): pair is { file: RawFile; signal: AppQualityFileSignal } => Boolean(pair.signal));
  const uiPairs = pairs.filter((pair) => pair.signal.kind !== "config");
  return uiPairs.length > 0 ? uiPairs : pairs;
}

function stripVariants(token: string): string {
  const parts = token.split(":");
  return parts.at(-1) ?? token;
}

function buildIssues(aggregate: ReturnType<typeof aggregateSignals>, thresholds: PolicyThresholds): AppQualityIssue[] {
  const issues: AppQualityIssue[] = [];
  const spacingScale = new Set(aggregate.spacing.map(stripVariants));
  const textScale = new Set(aggregate.textSizes.map(stripVariants));
  const radiusScale = new Set(aggregate.radius.map(stripVariants));
  const shadowScale = new Set(aggregate.shadows.map(stripVariants));
  const colorScale = new Set(aggregate.colors.map(stripVariants));

  if (aggregate.classTokens.length === 0) {
    issues.push(issue("scan.empty", "visual-system", "high", "No UI class signal found", "Memoire could not find Tailwind or HTML class usage in the scanned target.", ["0 class tokens"], "Run this against a route, app directory, or built HTML page with visible UI."));
  }
  if (aggregate.cssVariables.length < thresholds.minCssVariables && aggregate.classTokens.length > 5) {
    issues.push(issue("system.tokens.missing", "visual-system", "high", "Weak token backbone", "The app has enough UI surface to need a token layer, but very few CSS variables were detected.", [`${aggregate.cssVariables.length} CSS variable references`], "Define color, radius, spacing, and font variables before widening the visual system."));
  }
  if (aggregate.hexColors.length > 0) {
    const severity: AppQualitySeverity = new Set(aggregate.hexColors).size > thresholds.rawHexHighThreshold ? "high" : "medium";
    issues.push(issue("color.raw-hex", "color", severity, "Raw colors are leaking into UI code", "Hardcoded hex values make redesigns brittle and block consistent theme generation.", [`${new Set(aggregate.hexColors).size} unique hex colors`], "Move recurring colors into CSS variables or Tailwind theme tokens."));
  }
  if (colorScale.size > thresholds.maxColorUtilities) {
    issues.push(issue("color.scale-wide", "color", "medium", "Color utility surface is too wide", "A broad color utility set usually means states and surfaces are being styled case by case.", [`${colorScale.size} unique color utilities`], "Collapse colors into semantic roles: background, surface, foreground, muted, primary, destructive, success, warning."));
  }
  if (textScale.size > thresholds.maxTextSizes) {
    issues.push(issue("type.scale-wide", "typography", "medium", "Typography scale is drifting", "Many text sizes make hierarchy harder to read and harder to maintain.", [`${textScale.size} text size utilities`], "Use a tighter type ramp and reserve large sizes for page-level hierarchy."));
  }
  if (spacingScale.size > thresholds.maxSpacingUtilities) {
    issues.push(issue("spacing.scale-wide", "spacing", "medium", "Spacing scale is too loose", "Large spacing variety creates an uneven rhythm across routes and components.", [`${spacingScale.size} spacing utilities`], "Normalize spacing around a smaller set of layout and component gaps."));
  }
  if (radiusScale.size > thresholds.maxRadiusUtilities) {
    issues.push(issue("shape.radius-drift", "visual-system", "medium", "Radius styles are inconsistent", "Too many radius values makes primitives feel like they came from different systems.", [`${radiusScale.size} radius utilities`], "Pick one default radius, one small radius, and one full radius for pills/avatars."));
  }
  if (shadowScale.size > thresholds.maxShadowUtilities) {
    issues.push(issue("depth.shadow-drift", "visual-system", "medium", "Shadow styles are inconsistent", "Many shadow treatments create noisy depth and weak hierarchy.", [`${shadowScale.size} shadow utilities`], "Define one elevation scale and reserve shadows for layered surfaces."));
  }
  if (aggregate.shadcnImports.length > 4 && aggregate.cssVariables.length < thresholds.minCssVariables) {
    issues.push(issue("components.default-shadcn", "components", "high", "shadcn primitives look under-branded", "The app uses shadcn primitives but does not expose enough token signal to make them feel custom.", [`${aggregate.shadcnImports.length} shadcn imports`, `${aggregate.cssVariables.length} CSS variables`], "Customize shadcn variables, component variants, and state styles before generating more screens."));
  }
  if (aggregate.arbitrary.length > thresholds.maxArbitraryValues) {
    issues.push(issue("maintainability.arbitrary-tailwind", "maintainability", "medium", "Too many arbitrary Tailwind values", "Arbitrary values are useful during exploration but become design debt when repeated.", [`${aggregate.arbitrary.length} arbitrary utilities`], "Promote repeated arbitrary values into tokens or named utilities."));
  }
  if (aggregate.routeFiles.length > 1 && aggregate.responsive.length < Math.max(4, aggregate.routeFiles.length * 2)) {
    issues.push(issue("responsive.coverage-low", "responsive", "medium", "Responsive coverage looks thin", "Multiple routes were found, but responsive utility usage is light.", [`${aggregate.routeFiles.length} routes`, `${aggregate.responsive.length} responsive utilities`], "Audit mobile/tablet layouts and add route-level responsive rules before launch."));
  }
  if (aggregate.images > aggregate.imagesWithAlt) {
    issues.push(issue("a11y.image-alt", "accessibility", "high", "Images need accessible text", "Some rendered images do not appear to include alt text.", [`${aggregate.images - aggregate.imagesWithAlt} image(s) without alt`], "Add meaningful alt text for content images and empty alt text for decorative images."));
  }
  if (aggregate.interactive > 2 && aggregate.focusClasses.length === 0) {
    issues.push(issue("a11y.focus-missing", "accessibility", "high", "Focus states are not visible in code", "Interactive UI was found, but no focus-visible styling was detected.", [`${aggregate.interactive} interactive signals`, "0 focus utilities"], "Add visible focus states to buttons, links, inputs, menus, and custom interactive controls."));
  }

  return issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function issue(
  id: string,
  category: AppQualityCategory,
  severity: AppQualitySeverity,
  title: string,
  detail: string,
  evidence: string[],
  recommendation: string,
): AppQualityIssue {
  return {
    id,
    normalizedId: normalizeAuditFindingId(id),
    category,
    severity,
    title,
    detail,
    evidence,
    recommendation,
  };
}

function enrichIssues(issues: AppQualityIssue[], graph: AppGraph, files: RawFile[]): AppQualityIssue[] {
  return issues.map((current) => {
    const affectedFiles = affectedFilesForIssue(current, graph);
    const evidenceLocations = evidenceLocationsForIssue(current, files, affectedFiles);
    return {
      ...current,
      affectedFiles,
      evidenceLocations,
      confidence: confidenceForIssue(current, evidenceLocations.length),
      estimatedEffort: effortForIssue(current, affectedFiles.length),
      fixCategory: fixCategoryForIssue(current),
    };
  });
}

function affectedFilesForIssue(issue: AppQualityIssue, graph: AppGraph): string[] {
  const graphFiles = scopedGraphFiles(graph);
  const files = graphFiles.filter((file) => {
    if (issue.id === "color.raw-hex") return file.hexColors.length > 0;
    if (issue.id === "maintainability.arbitrary-tailwind") return file.tailwindClasses.some((token) => /\[[^\]]+\]/.test(token));
    if (issue.id.startsWith("a11y.")) return file.componentRefs.length > 0 || file.kind === "route" || file.kind === "component";
    if (issue.category === "components") return file.kind === "component" || file.shadcnImports.length > 0;
    if (issue.category === "responsive") return file.kind === "route";
    if (issue.category === "spacing" || issue.category === "typography") return file.tailwindClasses.length > 0;
    return file.kind === "route" || file.kind === "component" || file.kind === "style";
  });
  return files.map((file) => file.path).slice(0, 12);
}

function scopedGraphFiles(graph: AppGraph): AppGraph["files"] {
  const uiFiles = graph.files.filter((file) => file.kind !== "config" && file.kind !== "test" && file.kind !== "other");
  return uiFiles.length > 0 ? uiFiles : graph.files;
}

function evidenceLocationsForIssue(issue: AppQualityIssue, files: RawFile[], affectedFiles: string[]): Array<{ file: string; line?: number; excerpt?: string }> {
  const pattern = patternForIssue(issue);
  if (!pattern) {
    return affectedFiles.slice(0, 5).map((file) => ({ file }));
  }

  const locations: Array<{ file: string; line?: number; excerpt?: string }> = [];
  const affected = new Set(affectedFiles);
  for (const file of files) {
    if (affected.size > 0 && !affected.has(file.path)) continue;
    const lines = file.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!pattern.test(lines[index])) continue;
      pattern.lastIndex = 0;
      locations.push({ file: file.path, line: index + 1, excerpt: lines[index].trim().slice(0, 160) });
      break;
    }
    if (locations.length >= 5) break;
  }
  return locations;
}

function patternForIssue(issue: AppQualityIssue): RegExp | null {
  if (issue.id === "color.raw-hex") return /#[0-9a-fA-F]{3,8}\b/g;
  if (issue.id === "maintainability.arbitrary-tailwind") return /\[[^\]]+\]/g;
  if (issue.id === "a11y.image-alt") return /<(img|Image)\b(?![^>]*\salt=)/g;
  if (issue.id === "a11y.focus-missing") return /onClick=|<button\b|<Button\b|role=["']button/g;
  if (issue.category === "spacing") return /class(Name)?=.*\b(p|px|py|m|mx|my|gap)-/g;
  if (issue.category === "typography") return /class(Name)?=.*\btext-/g;
  return null;
}

function confidenceForIssue(issue: AppQualityIssue, evidenceLocationCount: number): number {
  const base = issue.evidence.length > 0 ? 0.78 : 0.62;
  const locationBoost = Math.min(0.17, evidenceLocationCount * 0.04);
  const severityBoost = issue.severity === "high" || issue.severity === "critical" ? 0.05 : 0;
  return Math.min(0.97, Number((base + locationBoost + severityBoost).toFixed(2)));
}

function effortForIssue(issue: AppQualityIssue, affectedFileCount: number): AppQualityIssue["estimatedEffort"] {
  if (issue.severity === "critical" || affectedFileCount > 8) return "large";
  if (issue.severity === "high" || affectedFileCount > 3) return "medium";
  return "small";
}

function fixCategoryForIssue(issue: AppQualityIssue): AppQualityIssue["fixCategory"] {
  if (issue.id.includes("token") || issue.category === "color" || issue.category === "spacing" || issue.category === "typography") return "tokens";
  if (issue.category === "components" || issue.category === "visual-system") return "components";
  if (issue.category === "accessibility") return "accessibility";
  if (issue.category === "responsive") return "responsive";
  return "code-health";
}

function scoreCategories(issues: AppQualityIssue[]): Record<AppQualityCategory, number> {
  const scores = { ...CATEGORY_BASE };
  for (const current of issues) {
    const penalty = current.severity === "critical" ? 30
      : current.severity === "high" ? 20
        : current.severity === "medium" ? 12
          : 6;
    scores[current.category] = Math.max(0, scores[current.category] - penalty);
  }
  return scores;
}

function severityRank(severity: AppQualitySeverity): number {
  return severity === "critical" ? 4 : severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

function verdictForScore(score: number): string {
  if (score >= 90) return "strong";
  if (score >= 75) return "usable but uneven";
  if (score >= 60) return "visibly inconsistent";
  return "needs a design-system pass";
}

function buildDirections(
  aggregate: ReturnType<typeof aggregateSignals>,
  issues: AppQualityIssue[],
): AppQualityDirection[] {
  const hasDashboard = aggregate.routeFiles.some((file) => /dashboard|admin|analytics/i.test(file.path));
  const hasDocs = aggregate.routeFiles.some((file) => /docs|blog|article|marketing/i.test(file.path));
  const baseScope = [
    "Normalize CSS variables and Tailwind theme tokens",
    "Unify Button, Card, Input, Badge, and navigation variants",
    "Patch route-level spacing and responsive rules",
  ];

  return [
    {
      id: "premium-saas",
      name: "Premium SaaS",
      fit: hasDashboard ? "Best for dashboards, admin tools, and B2B workflows." : "Best for product-led web apps with forms and account flows.",
      tokenMoves: ["Tighter neutral surfaces", "One strong accent", "Reduced radius drift", "Cleaner type hierarchy"],
      componentMoves: ["Primary/secondary/destructive button split", "Sharper card headers", "Intentional empty and loading states"],
      patchScope: baseScope,
    },
    {
      id: "dense-ops",
      name: "Dense Ops",
      fit: "Best when users scan tables, metrics, alerts, and repeated controls all day.",
      tokenMoves: ["Compact spacing scale", "High-contrast state colors", "Clear borders over heavy shadows", "Smaller text ramp"],
      componentMoves: ["Compact table rows", "Status badges", "Toolbar-first forms", "Keyboard-visible focus"],
      patchScope: [...baseScope, "Reduce low-value whitespace on data-heavy routes"],
    },
    {
      id: "editorial-product",
      name: "Editorial Product",
      fit: hasDocs ? "Best for docs, knowledge products, landing pages, and content-heavy SaaS." : "Best for apps that need more trust and narrative polish.",
      tokenMoves: ["More deliberate font pairing", "Softer surface contrast", "Wider reading rhythm", " restrained accent use"],
      componentMoves: ["Better section hierarchy", "Reading-friendly cards", "Stronger forms and onboarding copy surfaces"],
      patchScope: [...baseScope, "Improve page rhythm and content hierarchy"],
    },
  ].map((direction) => ({
    ...direction,
    patchScope: issues.length > 0 ? direction.patchScope : ["Preserve current system and add CI checks"],
  }));
}

async function writeDiagnosis(projectRoot: string, diagnosis: AppQualityDiagnosis): Promise<void> {
  const outDir = join(projectRoot, ".memoire", "app-quality");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "diagnosis.json"), JSON.stringify(diagnosis, null, 2) + "\n", "utf-8");
  await writeFile(join(outDir, "diagnosis.md"), renderDiagnosisMarkdown(diagnosis), "utf-8");
  // Append to the score-history ledger — delivers the "track design debt over
  // time" this file has promised in nextActions since v2.0.
  const { appendHistory } = await import("./history.js");
  await appendHistory(projectRoot, diagnosis).catch(() => {
    // History is best-effort — a ledger write failure must not fail the scan.
  });
}

function renderDiagnosisMarkdown(diagnosis: AppQualityDiagnosis): string {
  const lines = [
    "# Memoire App Diagnosis",
    "",
    `Target: \`${diagnosis.target}\``,
    `Score: ${diagnosis.summary.score}/100 (${diagnosis.summary.verdict})`,
    `Generated: ${diagnosis.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Files scanned: ${diagnosis.summary.scannedFiles}`,
    `- Routes: ${diagnosis.summary.routes}`,
    `- Components: ${diagnosis.summary.components}`,
    `- Tailwind classes: ${diagnosis.summary.tailwindClasses}`,
    `- shadcn imports: ${diagnosis.summary.shadcnImports}`,
    `- CSS variables: ${diagnosis.summary.cssVariables}`,
    `- Raw hex colors: ${diagnosis.summary.hexColors}`,
    "",
    "## Issues",
    "",
  ];

  if (diagnosis.issues.length === 0) {
    lines.push("- No major app-quality issues detected.");
  } else {
    for (const current of diagnosis.issues) {
      lines.push(`- **${current.severity.toUpperCase()} ${current.category}: ${current.title}**`);
      lines.push(`  ${current.detail}`);
      lines.push(`  Recommendation: ${current.recommendation}`);
      if (current.confidence !== undefined) lines.push(`  Confidence: ${Math.round(current.confidence * 100)}%`);
      if (current.estimatedEffort) lines.push(`  Estimated effort: ${current.estimatedEffort}`);
      if (current.affectedFiles && current.affectedFiles.length > 0) lines.push(`  Affected files: ${current.affectedFiles.slice(0, 5).join(", ")}`);
      if (current.evidenceLocations && current.evidenceLocations.length > 0) {
        const location = current.evidenceLocations[0];
        lines.push(`  Evidence: ${location.file}${location.line ? `:${location.line}` : ""}${location.excerpt ? ` — ${location.excerpt}` : ""}`);
      }
    }
  }

  lines.push("", "## UX Tenets and Traps", "");
  lines.push(`- UX score: ${diagnosis.ux.score}/100`);
  const activeTraps = diagnosis.ux.trapRisks.filter((risk) => risk.status !== "clear").slice(0, 5);
  if (activeTraps.length === 0) {
    lines.push("- No major UX traps detected from available evidence.");
  } else {
    for (const trap of activeTraps) {
      lines.push(`- ${trap.name}: ${trap.status} (${trap.riskScore}/100)`);
    }
  }
  for (const tweak of diagnosis.ux.recommendedTweaks.slice(0, 3)) {
    lines.push(`- Tweak: ${tweak}`);
  }

  lines.push("", "## Directions", "");
  for (const direction of diagnosis.directions) {
    lines.push(`- **${direction.name}**: ${direction.fit}`);
  }
  lines.push("", "## Next Actions", "");
  for (const action of diagnosis.nextActions) lines.push(`- ${action}`);
  lines.push("");
  return lines.join("\n");
}

export async function hasDiagnosis(projectRoot: string): Promise<boolean> {
  try {
    await access(join(projectRoot, ".memoire", "app-quality", "diagnosis.json"));
    return true;
  } catch {
    return false;
  }
}
