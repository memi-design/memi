import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppQualityIssue, AppQualitySeverity } from "../app-quality/engine.js";
import {
  buildAuditEvidenceMetadata,
  normalizeAuditFindingId,
  type AuditEvidenceMetadata,
  type AuditScoreCap,
} from "../audit/evidence.js";

export type InterfaceCraftDimensionId =
  | "focusing-mechanism"
  | "visual-weight"
  | "typographic-hierarchy"
  | "spacing-rhythm"
  | "color-intentionality"
  | "shadow-stroke-quality"
  | "icon-consistency"
  | "information-density"
  | "affordance-quality"
  | "state-feedback"
  | "component-cohesion"
  | "platform-conventions"
  | "motion-restraint"
  | "responsive-resilience"
  | "user-context-care";

export type InterfaceCraftLens = "visual-design" | "interface-design" | "conventions" | "user-context";
export type InterfaceCraftFindingSource = "app-quality" | "screenshot" | "manual" | "mcp";

/** 2.3 only emits "static-scan"; other values reserved for 2.4 rendered probes / vision. */
export type InterfaceCraftProvenance = "static-scan" | "rendered-probe" | "vision" | "manual";

export interface InterfaceCraftDimensionDefinition {
  id: InterfaceCraftDimensionId;
  name: string;
  lens: InterfaceCraftLens;
  description: string;
  inspectFor: string[];
}

export interface InterfaceCraftFinding {
  id: string;
  normalizedId: string;
  title: string;
  severity: AppQualitySeverity;
  lens: InterfaceCraftLens;
  dimensionIds: InterfaceCraftDimensionId[];
  evidence: string[];
  recommendation: string;
  source: InterfaceCraftFindingSource;
  provenance: InterfaceCraftProvenance;
  artifactPath?: string;
  confidence?: number;
  affectedFiles?: string[];
}

export interface InterfaceCraftDimensionAssessment {
  dimensionId: InterfaceCraftDimensionId;
  name: string;
  lens: InterfaceCraftLens;
  /**
   * "not-assessed" — no static-scan evidence path can ever reach this
   * dimension; it is unverified, NOT verified-good. "strong" is only claimed
   * for dimensions the scan can actually violate and found clean.
   */
  status: "strong" | "watch" | "needs-work" | "unknown" | "not-assessed";
  /** null when status is "not-assessed" — an unassessed dimension has no score, not a perfect one. */
  score: number | null;
  findingIds: string[];
  notes: string[];
}

export interface InterfaceCraftCritique {
  firstImpression: string;
  visualDesign: string;
  interfaceDesign: string;
  consistencyAndConventions: string;
  userContext: string;
}

export interface InterfaceCraftReport {
  schemaVersion: 2;
  target: string;
  generatedAt: string;
  score: number;
  dimensions: InterfaceCraftDimensionAssessment[];
  critique: InterfaceCraftCritique;
  findings: InterfaceCraftFinding[];
  topOpportunities: string[];
  artifactPath?: string;
  /** Present when a screenshot was attached: recorded, not analyzed — no vision pass runs in 2.3. */
  artifactNote?: string;
  metadata?: {
    issueCount?: number;
    appQualityScore?: number;
  };
  confidence: AuditEvidenceMetadata["confidence"];
  assessedDimensions: AuditEvidenceMetadata["assessedDimensions"];
  unassessedDimensions: AuditEvidenceMetadata["unassessedDimensions"];
  evidenceProvenance: AuditEvidenceMetadata["evidenceProvenance"];
  appliedScoreCaps: AuditEvidenceMetadata["appliedScoreCaps"];
}

export interface BuildInterfaceCraftReportInput {
  target?: string;
  generatedAt?: string;
  artifactPath?: string | null;
  issues?: AppQualityIssue[];
  appQualityScore?: number;
  source?: InterfaceCraftFindingSource;
  assessedCategories?: AppQualityIssue["category"][];
  analysisPerformed?: boolean;
  partialAnalysis?: boolean;
  appliedScoreCaps?: AuditScoreCap[];
}

interface CraftMapping {
  lens: InterfaceCraftLens;
  dimensionIds: InterfaceCraftDimensionId[];
  recommendation?: string;
}

export const INTERFACE_CRAFT_DIMENSIONS: InterfaceCraftDimensionDefinition[] = [
  {
    id: "focusing-mechanism",
    name: "Focusing Mechanism",
    lens: "interface-design",
    description: "The first glance makes one primary purpose, path, or decision feel inevitable.",
    inspectFor: ["primary action", "scan order", "decision hierarchy"],
  },
  {
    id: "visual-weight",
    name: "Visual Weight",
    lens: "visual-design",
    description: "Size, contrast, density, and placement make important elements feel important.",
    inspectFor: ["contrast balance", "surface emphasis", "quiet secondary UI"],
  },
  {
    id: "typographic-hierarchy",
    name: "Typographic Hierarchy",
    lens: "visual-design",
    description: "Type scale, weight, line length, and casing create a readable information structure.",
    inspectFor: ["type ramp", "heading/body contrast", "line length"],
  },
  {
    id: "spacing-rhythm",
    name: "Spacing Rhythm",
    lens: "visual-design",
    description: "Spacing repeats with enough consistency to make groups, edges, and relationships legible.",
    inspectFor: ["layout rhythm", "component padding", "group gaps"],
  },
  {
    id: "color-intentionality",
    name: "Color Intentionality",
    lens: "visual-design",
    description: "Color communicates role, state, hierarchy, and brand without becoming decorative noise.",
    inspectFor: ["semantic color roles", "state color", "raw color drift"],
  },
  {
    id: "shadow-stroke-quality",
    name: "Shadow And Stroke Quality",
    lens: "visual-design",
    description: "Depth, borders, and dividers create hierarchy without muddying the surface.",
    inspectFor: ["elevation scale", "border contrast", "divider restraint"],
  },
  {
    id: "icon-consistency",
    name: "Icon Consistency",
    lens: "conventions",
    description: "Icons share stroke, size, metaphors, and alignment with the controls they support.",
    inspectFor: ["stroke width", "symbol choice", "button icon alignment"],
  },
  {
    id: "information-density",
    name: "Information Density",
    lens: "interface-design",
    description: "The screen carries the right amount of information for the user's cadence and device.",
    inspectFor: ["scan density", "empty space", "progressive detail"],
  },
  {
    id: "affordance-quality",
    name: "Affordance Quality",
    lens: "interface-design",
    description: "Controls clearly communicate click, edit, selected, disabled, loading, and destructive states.",
    inspectFor: ["control states", "button hierarchy", "input clarity"],
  },
  {
    id: "state-feedback",
    name: "State Feedback",
    lens: "interface-design",
    description: "The interface acknowledges work, transitions, failures, and completion near the action.",
    inspectFor: ["loading state", "success receipt", "error repair"],
  },
  {
    id: "component-cohesion",
    name: "Component Cohesion",
    lens: "conventions",
    description: "Components feel like one system through shared variants, anatomy, tokens, and behavior.",
    inspectFor: ["variant reuse", "shadcn fit", "duplicate controls"],
  },
  {
    id: "platform-conventions",
    name: "Platform Conventions",
    lens: "conventions",
    description: "The UI honors expected web, app, and design-system patterns instead of inventing friction.",
    inspectFor: ["native semantics", "standard layout patterns", "expected keyboard behavior"],
  },
  {
    id: "motion-restraint",
    name: "Motion Restraint",
    lens: "conventions",
    description: "Motion supports cause, continuity, and feedback while respecting reduced-motion needs.",
    inspectFor: ["purposeful transitions", "reduced motion", "state continuity"],
  },
  {
    id: "responsive-resilience",
    name: "Responsive Resilience",
    lens: "user-context",
    description: "Layouts survive breakpoints, long content, touch targets, and repeated work contexts.",
    inspectFor: ["breakpoints", "overflow", "touch ergonomics"],
  },
  {
    id: "user-context-care",
    name: "User Context Care",
    lens: "user-context",
    description: "The screen respects user stakes, attention, time pressure, recovery paths, and confidence needs.",
    inspectFor: ["job-to-be-done fit", "risk signaling", "recovery path"],
  },
];

const ISSUE_MAPPINGS: Record<string, CraftMapping> = {
  "scan.empty": {
    lens: "interface-design",
    dimensionIds: ["focusing-mechanism", "information-density", "user-context-care"],
    recommendation: "Point the craft audit at visible UI code or a rendered surface before changing interface hierarchy.",
  },
  "system.tokens.missing": {
    lens: "visual-design",
    dimensionIds: ["color-intentionality", "spacing-rhythm", "component-cohesion"],
    recommendation: "Create a token backbone before polishing individual screens so craft decisions repeat.",
  },
  "color.raw-hex": {
    lens: "visual-design",
    dimensionIds: ["color-intentionality", "visual-weight"],
  },
  "color.scale-wide": {
    lens: "visual-design",
    dimensionIds: ["color-intentionality", "visual-weight", "state-feedback"],
  },
  "type.scale-wide": {
    lens: "visual-design",
    dimensionIds: ["typographic-hierarchy", "focusing-mechanism"],
  },
  "spacing.scale-wide": {
    lens: "visual-design",
    dimensionIds: ["spacing-rhythm", "information-density"],
  },
  "shape.radius-drift": {
    lens: "visual-design",
    dimensionIds: ["component-cohesion", "shadow-stroke-quality"],
  },
  "depth.shadow-drift": {
    lens: "visual-design",
    dimensionIds: ["shadow-stroke-quality", "visual-weight"],
  },
  "components.default-shadcn": {
    lens: "conventions",
    dimensionIds: ["component-cohesion", "affordance-quality", "platform-conventions"],
  },
  "maintainability.arbitrary-tailwind": {
    lens: "conventions",
    dimensionIds: ["component-cohesion", "spacing-rhythm", "platform-conventions"],
  },
  "responsive.coverage-low": {
    lens: "user-context",
    dimensionIds: ["responsive-resilience", "information-density", "user-context-care"],
  },
  "a11y.image-alt": {
    lens: "user-context",
    dimensionIds: ["user-context-care", "affordance-quality"],
  },
  "a11y.focus-missing": {
    lens: "interface-design",
    dimensionIds: ["affordance-quality", "state-feedback", "user-context-care"],
  },
};

const CATEGORY_MAPPINGS: Record<AppQualityIssue["category"], CraftMapping> = {
  "visual-system": { lens: "visual-design", dimensionIds: ["visual-weight", "shadow-stroke-quality", "color-intentionality"] },
  typography: { lens: "visual-design", dimensionIds: ["typographic-hierarchy", "focusing-mechanism"] },
  spacing: { lens: "visual-design", dimensionIds: ["spacing-rhythm", "information-density"] },
  color: { lens: "visual-design", dimensionIds: ["color-intentionality", "visual-weight"] },
  components: { lens: "conventions", dimensionIds: ["component-cohesion", "affordance-quality"] },
  accessibility: { lens: "user-context", dimensionIds: ["affordance-quality", "state-feedback", "user-context-care"] },
  responsive: { lens: "user-context", dimensionIds: ["responsive-resilience", "information-density"] },
  maintainability: { lens: "conventions", dimensionIds: ["component-cohesion", "platform-conventions"] },
};

const SEVERITY_PENALTY: Record<AppQualitySeverity, number> = {
  critical: 24,
  high: 18,
  medium: 10,
  low: 5,
};

/**
 * Dimensions the static scan can actually evidence, computed from the mapping
 * tables — dimensions outside this set (e.g. icon-consistency, motion-restraint)
 * can never fire from a scan and must report "not-assessed", never "strong 100/100".
 */
const ASSESSABLE_DIMENSION_IDS = new Set<InterfaceCraftDimensionId>();
for (const mapping of [...Object.values(ISSUE_MAPPINGS), ...Object.values(CATEGORY_MAPPINGS)]) {
  for (const dimensionId of mapping.dimensionIds) ASSESSABLE_DIMENSION_IDS.add(dimensionId);
}

const NOT_ASSESSED_DIMENSION_NOTE =
  "Not assessable by static scan — needs rendered/visual evidence. Unverified, not verified-good.";

export function mapAppQualityIssueToInterfaceCraftFinding(issue: AppQualityIssue): InterfaceCraftFinding {
  const mapping = ISSUE_MAPPINGS[issue.id] ?? CATEGORY_MAPPINGS[issue.category];
  return {
    id: `craft.${issue.id}`,
    normalizedId: normalizeAuditFindingId(issue.normalizedId ?? issue.id),
    title: issue.title,
    severity: issue.severity,
    lens: mapping.lens,
    dimensionIds: mapping.dimensionIds,
    evidence: [
      issue.detail,
      ...issue.evidence,
      ...(issue.affectedFiles?.slice(0, 4).map((file) => `Affected file: ${file}`) ?? []),
    ],
    recommendation: mapping.recommendation ?? issue.recommendation,
    source: "app-quality",
    provenance: "static-scan",
    confidence: issue.confidence,
    affectedFiles: issue.affectedFiles,
  };
}

export function buildInterfaceCraftReport(input: BuildInterfaceCraftReportInput): InterfaceCraftReport {
  const target = input.target ?? input.artifactPath ?? "workspace";
  // Screenshots are recorded, never analyzed — no finding is fabricated from
  // a screenshot's mere existence (the previous placeholder invented one with
  // a hardcoded confidence).
  const findings = (input.issues ?? [])
    .map(mapAppQualityIssueToInterfaceCraftFinding)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const hasAnalyzedEvidence = input.analysisPerformed ?? (
    findings.length > 0
    || (input.assessedCategories === undefined
      ? input.appQualityScore !== undefined
      : input.assessedCategories.length > 0)
  );
  const assessmentScope = buildAssessmentScope(
    hasAnalyzedEvidence ? findings : [],
    input.assessedCategories,
  );
  const dimensions = buildDimensionAssessments(findings, assessmentScope);
  const noEvidenceCap = hasAnalyzedEvidence ? [] : [{
    id: "no-analyzed-evidence",
    maximum: 0,
    reason: "The supplied artifact was recorded but not analyzed.",
  }];
  const partialEvidenceCap = hasAnalyzedEvidence && input.partialAnalysis ? [{
    id: "partial-static-analysis",
    maximum: 0,
    reason: "Static checks ran, but the available evidence does not cover whole interface-craft categories.",
  }] : [];
  const evidenceCaps = mergeScoreCaps(
    input.appliedScoreCaps ?? [],
    noEvidenceCap,
    partialEvidenceCap,
  );
  const auditEvidence = buildAuditEvidenceMetadata({
    dimensions: dimensions.map((dimension) => dimension.dimensionId),
    unassessedDimensions: dimensions
      .filter((dimension) => dimension.status === "unknown" || dimension.status === "not-assessed")
      .map((dimension) => dimension.dimensionId),
    evidenceProvenance: [
      ...(hasAnalyzedEvidence ? [{ kind: "static-scan" as const, analyzed: true, target }] : []),
      ...(input.artifactPath ? [{
        kind: "screenshot" as const,
        analyzed: false,
        target,
        artifactPath: input.artifactPath,
      }] : []),
    ],
    findingConfidences: findings.map((finding) => finding.confidence),
    appliedScoreCaps: evidenceCaps,
  });
  const rawScore = scoreInterfaceCraft(findings, input.appQualityScore);
  const score = evidenceCaps.length > 0
    ? Math.min(rawScore, ...evidenceCaps.map((cap) => cap.maximum))
    : rawScore;

  return {
    schemaVersion: 2,
    target,
    generatedAt,
    score,
    dimensions,
    critique: buildCritique(findings, input.appQualityScore),
    findings,
    topOpportunities: buildTopOpportunities(findings),
    artifactPath: input.artifactPath ?? undefined,
    artifactNote: input.artifactPath
      ? "Screenshot attached for reference only — it was not analyzed. Static-scan findings come from source code, not pixels."
      : undefined,
    metadata: {
      issueCount: input.issues?.length ?? 0,
      appQualityScore: input.appQualityScore,
    },
    ...auditEvidence,
  };
}

export async function writeInterfaceCraftReport(
  projectRoot: string,
  report: InterfaceCraftReport,
): Promise<{ jsonPath: string; markdownPath: string }> {
  const outDir = join(projectRoot, ".memoire", "app-quality");
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "interface-craft.json");
  const markdownPath = join(outDir, "interface-craft.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  await writeFile(markdownPath, renderInterfaceCraftMarkdown(report), "utf-8");
  return { jsonPath, markdownPath };
}

export function renderInterfaceCraftMarkdown(report: InterfaceCraftReport): string {
  const lines = [
    "# Memoire Interface Craft Audit",
    "",
    `Target: \`${report.target}\``,
    `Score: ${report.score}/100`,
    `Generated: ${report.generatedAt}`,
  ];
  if (report.artifactPath) lines.push(`Artifact: \`${report.artifactPath}\``);
  if (report.artifactNote) lines.push(`> ${report.artifactNote}`);

  lines.push(
    "",
    "> Statuses: **needs-work/watch** = static-scan findings exist · **strong** = the scan can detect violations and found none · **not-assessed** = no static evidence path exists (unverified, NOT verified-good).",
  );

  lines.push("", "## Critique", "");
  lines.push(`- **First impression:** ${report.critique.firstImpression}`);
  lines.push(`- **Visual design:** ${report.critique.visualDesign}`);
  lines.push(`- **Interface design:** ${report.critique.interfaceDesign}`);
  lines.push(`- **Consistency and conventions:** ${report.critique.consistencyAndConventions}`);
  lines.push(`- **User context:** ${report.critique.userContext}`);

  lines.push("", "## Craft Dimensions", "");
  for (const dimension of report.dimensions) {
    const scoreLabel = dimension.score === null ? "no score — not assessed" : `${dimension.score}/100`;
    lines.push(`- **${dimension.name}**: ${dimension.status} (${scoreLabel})`);
    if (dimension.notes[0]) lines.push(`  Note: ${dimension.notes[0]}`);
  }

  lines.push("", "## Findings", "");
  if (report.findings.length === 0) {
    lines.push("- No interface craft findings detected from available evidence.");
  } else {
    for (const finding of report.findings) {
      lines.push(`- **${finding.severity.toUpperCase()} ${finding.title}**`);
      lines.push(`  Lens: ${finding.lens}`);
      lines.push(`  Dimensions: ${finding.dimensionIds.join(", ")}`);
      lines.push(`  Recommendation: ${finding.recommendation}`);
      if (finding.evidence[0]) lines.push(`  Evidence: ${finding.evidence[0]}`);
    }
  }

  lines.push("", "## Top Opportunities", "");
  for (const opportunity of report.topOpportunities) lines.push(`- ${opportunity}`);
  if (report.topOpportunities.length === 0) lines.push("- Preserve the current craft baseline and collect screenshot evidence for final polish.");
  lines.push("");
  return lines.join("\n");
}

function buildAssessmentScope(
  findings: InterfaceCraftFinding[],
  assessedCategories?: AppQualityIssue["category"][],
): ReadonlySet<InterfaceCraftDimensionId> {
  if (assessedCategories === undefined) return ASSESSABLE_DIMENSION_IDS;
  const dimensionIds = new Set<InterfaceCraftDimensionId>();
  for (const category of assessedCategories) {
    for (const dimensionId of CATEGORY_MAPPINGS[category].dimensionIds) dimensionIds.add(dimensionId);
  }
  for (const finding of findings) {
    for (const dimensionId of finding.dimensionIds) dimensionIds.add(dimensionId);
  }
  return dimensionIds;
}

function buildDimensionAssessments(
  findings: InterfaceCraftFinding[],
  assessableDimensionIds: ReadonlySet<InterfaceCraftDimensionId> = ASSESSABLE_DIMENSION_IDS,
): InterfaceCraftDimensionAssessment[] {
  return INTERFACE_CRAFT_DIMENSIONS.map((dimension) => {
    const related = findings.filter((finding) => finding.dimensionIds.includes(dimension.id));
    if (!assessableDimensionIds.has(dimension.id)) {
      return {
        dimensionId: dimension.id,
        name: dimension.name,
        lens: dimension.lens,
        status: "not-assessed" as const,
        score: null,
        findingIds: [],
        notes: [NOT_ASSESSED_DIMENSION_NOTE],
      };
    }
    const penalty = related.reduce((sum, finding) => sum + SEVERITY_PENALTY[finding.severity], 0);
    const highestSeverity = related.map((finding) => finding.severity).sort((a, b) => severityRank(b) - severityRank(a))[0];
    return {
      dimensionId: dimension.id,
      name: dimension.name,
      lens: dimension.lens,
      status: dimensionStatus(related.length, highestSeverity),
      score: Math.max(0, 100 - (penalty * 2)),
      findingIds: related.map((finding) => finding.id),
      notes: related.length > 0
        ? related.map((finding) => finding.title).slice(0, 3)
        : dimension.inspectFor.slice(0, 2),
    };
  });
}

function mergeScoreCaps(...groups: AuditScoreCap[][]): AuditScoreCap[] {
  const caps = new Map<string, AuditScoreCap>();
  for (const cap of groups.flat()) {
    const previous = caps.get(cap.id);
    if (!previous || cap.maximum < previous.maximum) caps.set(cap.id, { ...cap });
  }
  return [...caps.values()];
}

function buildCritique(findings: InterfaceCraftFinding[], appQualityScore?: number): InterfaceCraftCritique {
  const byLens = (lens: InterfaceCraftLens) => findings.filter((finding) => finding.lens === lens);
  const visualCount = byLens("visual-design").length;
  const interfaceCount = byLens("interface-design").length;
  const conventionCount = byLens("conventions").length;
  const contextCount = byLens("user-context").length;
  const scorePhrase = appQualityScore === undefined ? "local evidence" : `app-quality score ${appQualityScore}/100`;

  return {
    firstImpression: findings.length === 0
      ? `No craft risk is obvious from ${scorePhrase}; validate first glance with a screenshot before launch.`
      : `${findings.length} craft signal(s) need attention before the interface reads as polished.`,
    visualDesign: visualCount === 0
      ? "color, type, spacing, shadow, and visual weight need screenshot confirmation; no local visual-design risk was detected."
      : `${visualCount} visual-design signal(s) affect color, type, spacing, visual weight, or depth quality.`,
    interfaceDesign: interfaceCount === 0
      ? "The focusing mechanism, information density, affordances, and state feedback need live-route confirmation."
      : `${interfaceCount} interface-design signal(s) affect the focusing mechanism, affordance quality, information density, or feedback loops.`,
    consistencyAndConventions: conventionCount === 0
      ? "Component cohesion, platform conventions, icons, and motion should still be checked against the target stack."
      : `${conventionCount} convention signal(s) affect component cohesion, platform expectations, icon consistency, or motion restraint.`,
    userContext: contextCount === 0
      ? "User context, responsive resilience, touch ergonomics, and recovery expectations need evidence from the real workflow."
      : `${contextCount} user-context signal(s) affect responsive resilience, accessibility, confidence, or recovery in the real workflow.`,
  };
}

function buildTopOpportunities(findings: InterfaceCraftFinding[]): string[] {
  const seen = new Set<string>();
  const opportunities: string[] = [];
  for (const finding of findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))) {
    if (seen.has(finding.recommendation)) continue;
    seen.add(finding.recommendation);
    opportunities.push(finding.recommendation);
    if (opportunities.length >= 6) break;
  }
  return opportunities;
}

function scoreInterfaceCraft(findings: InterfaceCraftFinding[], appQualityScore?: number): number {
  const craftPenalty = findings.reduce((sum, finding) => sum + SEVERITY_PENALTY[finding.severity], 0);
  const evidenceScore = Math.max(0, 100 - craftPenalty);
  if (appQualityScore === undefined) return evidenceScore;
  return Math.max(0, Math.round((evidenceScore * 0.7) + (appQualityScore * 0.3)));
}

function dimensionStatus(
  relatedCount: number,
  highestSeverity: AppQualitySeverity | undefined,
): InterfaceCraftDimensionAssessment["status"] {
  if (relatedCount === 0) return "strong";
  if (highestSeverity === "critical" || highestSeverity === "high") return "needs-work";
  return "watch";
}

function severityRank(severity: AppQualitySeverity): number {
  return severity === "critical" ? 4 : severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}
