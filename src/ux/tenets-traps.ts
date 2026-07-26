import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppQualityIssue, AppQualitySeverity } from "../app-quality/engine.js";
import {
  buildAuditEvidenceMetadata,
  normalizeAuditFindingId,
  type AuditEvidenceMetadata,
} from "../audit/evidence.js";

export type UxTenetId =
  | "clarity"
  | "feedback"
  | "control"
  | "consistency"
  | "accessibility"
  | "error-recovery"
  | "progressive-disclosure"
  | "workflow-fit"
  | "trust"
  | "state-continuity";

export type UxTrapId =
  | "ambiguous-affordance"
  | "missing-state"
  | "silent-system"
  | "choice-overload"
  | "layout-instability"
  | "token-drift"
  | "inaccessible-interaction"
  | "copy-theater"
  | "context-leak"
  | "destructive-default";

export interface UxTenetDefinition {
  id: UxTenetId;
  name: string;
  description: string;
  protectBy: string[];
}

export interface UxTrapDefinition {
  id: UxTrapId;
  name: string;
  description: string;
  defaultFix: string;
  tenetIds: UxTenetId[];
}

export type UxFindingSource = "app-quality" | "screenshot" | "manual" | "mcp";

/**
 * How a finding was evidenced. 2.3 only ever emits "static-scan" — the other
 * values are reserved so 2.4's rendered probes / vision critique can slot in
 * without another schema bump.
 */
export type UxFindingProvenance = "static-scan" | "rendered-probe" | "vision" | "manual";

export interface UxAuditFinding {
  id: string;
  normalizedId: string;
  title: string;
  severity: AppQualitySeverity;
  tenetIds: UxTenetId[];
  trapIds: UxTrapId[];
  evidence: string[];
  recommendation: string;
  source: UxFindingSource;
  provenance: UxFindingProvenance;
  artifactPath?: string;
  confidence?: number;
  affectedFiles?: string[];
}

export interface UxTenetCoverage {
  tenetId: UxTenetId;
  name: string;
  /**
   * "not-assessed" means no static-scan evidence path can ever evidence this
   * tenet — it is NOT the same as "protected". Only tenets the scan can
   * actually violate may read "protected" when clean.
   */
  status: "protected" | "at-risk" | "unknown" | "not-assessed";
  findingIds: string[];
  notes: string[];
}

export interface UxTrapRisk {
  trapId: UxTrapId;
  name: string;
  /** "not-assessed" — no static-scan evidence path exists for this trap; see UxTenetCoverage.status. */
  status: "clear" | "watch" | "present" | "not-assessed";
  riskScore: number;
  findingIds: string[];
  defaultFix: string;
  note?: string;
}

export interface UxAuditReport {
  schemaVersion: 2;
  target: string;
  generatedAt: string;
  score: number;
  tenetCoverage: UxTenetCoverage[];
  trapRisks: UxTrapRisk[];
  findings: UxAuditFinding[];
  recommendedTweaks: string[];
  artifactPath?: string;
  /** Present when a screenshot was attached: it is recorded, not analyzed — no vision pass runs in 2.3. */
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

export interface BuildUxAuditReportInput {
  target?: string;
  generatedAt?: string;
  artifactPath?: string | null;
  issues?: AppQualityIssue[];
  appQualityScore?: number;
  source?: UxFindingSource;
}

interface Mapping {
  tenetIds: UxTenetId[];
  trapIds: UxTrapId[];
  recommendation?: string;
}

export const UX_TENETS: UxTenetDefinition[] = [
  {
    id: "clarity",
    name: "Clarity",
    description: "Users can tell what matters, what each control does, and what to do next.",
    protectBy: ["clear hierarchy", "specific labels", "visible primary action"],
  },
  {
    id: "feedback",
    name: "Feedback",
    description: "The system acknowledges user actions, progress, loading, success, and failure.",
    protectBy: ["loading states", "success receipts", "error messages", "disabled state reasons"],
  },
  {
    id: "control",
    name: "Control",
    description: "Users can review, undo, cancel, and steer consequential actions.",
    protectBy: ["undo paths", "confirmations", "manual overrides", "escape hatches"],
  },
  {
    id: "consistency",
    name: "Consistency",
    description: "The product repeats tokens, components, copy patterns, and interaction rules.",
    protectBy: ["semantic tokens", "component variants", "shared layout rhythm"],
  },
  {
    id: "accessibility",
    name: "Accessibility",
    description: "The interface works across keyboard, screen reader, contrast, motion, and touch needs.",
    protectBy: ["focus visibility", "text alternatives", "semantic controls", "contrast checks"],
  },
  {
    id: "error-recovery",
    name: "Error Recovery",
    description: "Errors are specific, recoverable, and keep user work intact.",
    protectBy: ["inline repair", "retry paths", "saved drafts", "actionable messages"],
  },
  {
    id: "progressive-disclosure",
    name: "Progressive Disclosure",
    description: "Complexity appears when it is useful instead of overwhelming the default path.",
    protectBy: ["advanced controls behind intent", "sane defaults", "scannable details"],
  },
  {
    id: "workflow-fit",
    name: "Workflow Fit",
    description: "The screen matches the cadence, density, and decision shape of the user's work.",
    protectBy: ["compact repeated actions", "responsive layouts", "task-oriented grouping"],
  },
  {
    id: "trust",
    name: "Trust",
    description: "The product makes claims, sources, permissions, and irreversible actions legible.",
    protectBy: ["evidence links", "honest copy", "permission receipts", "audit trails"],
  },
  {
    id: "state-continuity",
    name: "State Continuity",
    description: "Navigation, refreshes, retries, and background work preserve context and progress.",
    protectBy: ["persistent session state", "draft preservation", "clear current location"],
  },
];

export const UX_TRAPS: UxTrapDefinition[] = [
  {
    id: "ambiguous-affordance",
    name: "Ambiguous Affordance",
    description: "Interactive elements do not clearly read as clickable, editable, selected, or disabled.",
    defaultFix: "Clarify labels, state styling, cursor/focus behavior, and primary/secondary action hierarchy.",
    tenetIds: ["clarity", "control"],
  },
  {
    id: "missing-state",
    name: "Missing State",
    description: "Loading, empty, error, disabled, selected, or success states are absent or inconsistent.",
    defaultFix: "Add explicit default, loading, empty, error, success, disabled, focus, and selected states.",
    tenetIds: ["feedback", "error-recovery", "state-continuity"],
  },
  {
    id: "silent-system",
    name: "Silent System",
    description: "The interface performs work without visible progress, acknowledgement, or receipt.",
    defaultFix: "Add progress feedback, status copy, completion receipts, and failure reasons near the action.",
    tenetIds: ["feedback", "trust"],
  },
  {
    id: "choice-overload",
    name: "Choice Overload",
    description: "Too many equally weighted controls, styles, or content blocks compete at once.",
    defaultFix: "Group related choices, reduce simultaneous options, and reveal advanced controls after intent.",
    tenetIds: ["clarity", "progressive-disclosure", "workflow-fit"],
  },
  {
    id: "layout-instability",
    name: "Layout Instability",
    description: "The layout is fragile across breakpoints, content lengths, loading, or dynamic states.",
    defaultFix: "Add responsive constraints, stable dimensions, overflow rules, and route-level breakpoint coverage.",
    tenetIds: ["workflow-fit", "state-continuity"],
  },
  {
    id: "token-drift",
    name: "Token Drift",
    description: "Raw values and one-off styles break the visual system and make meaning inconsistent.",
    defaultFix: "Promote repeated colors, spacing, type, radius, and elevation into semantic tokens and variants.",
    tenetIds: ["consistency", "trust"],
  },
  {
    id: "inaccessible-interaction",
    name: "Inaccessible Interaction",
    description: "Keyboard, screen reader, contrast, label, motion, or touch expectations are not met.",
    defaultFix: "Patch semantic markup, focus states, labels, alternatives, contrast, and reduced-motion behavior.",
    tenetIds: ["accessibility", "control", "trust"],
  },
  {
    id: "copy-theater",
    name: "Copy Theater",
    description: "The UI explains intent with vague or decorative copy instead of useful next-step language.",
    defaultFix: "Replace decorative or generic copy with task-specific labels, outcomes, and constraints.",
    tenetIds: ["clarity", "trust"],
  },
  {
    id: "context-leak",
    name: "Context Leak",
    description: "The product loses project, selection, permissions, or history context across work surfaces.",
    defaultFix: "Persist current context in receipts, breadcrumbs, session records, and recovery flows.",
    tenetIds: ["state-continuity", "workflow-fit", "trust"],
  },
  {
    id: "destructive-default",
    name: "Destructive Default",
    description: "Risky actions are too easy to trigger or do not explain consequence before execution.",
    defaultFix: "Make destructive paths explicit, reversible where possible, and guarded with clear confirmation.",
    tenetIds: ["control", "error-recovery", "trust"],
  },
];

const ISSUE_MAPPINGS: Record<string, Mapping> = {
  "scan.empty": {
    tenetIds: ["clarity", "trust"],
    trapIds: ["ambiguous-affordance", "copy-theater"],
    recommendation: "Point the audit at visible UI code or a rendered page so hierarchy and state evidence can be checked.",
  },
  "system.tokens.missing": {
    tenetIds: ["consistency", "trust"],
    trapIds: ["token-drift"],
    recommendation: "Create semantic tokens for core surfaces, text, radius, spacing, and state colors before expanding screens.",
  },
  "color.raw-hex": {
    tenetIds: ["consistency", "trust"],
    trapIds: ["token-drift"],
  },
  "color.scale-wide": {
    tenetIds: ["consistency", "clarity"],
    trapIds: ["token-drift", "choice-overload"],
  },
  "type.scale-wide": {
    tenetIds: ["clarity", "consistency"],
    trapIds: ["choice-overload", "token-drift"],
  },
  "spacing.scale-wide": {
    tenetIds: ["clarity", "workflow-fit", "consistency"],
    trapIds: ["choice-overload", "layout-instability", "token-drift"],
  },
  "shape.radius-drift": {
    tenetIds: ["consistency", "trust"],
    trapIds: ["token-drift"],
  },
  "depth.shadow-drift": {
    tenetIds: ["clarity", "consistency"],
    trapIds: ["choice-overload", "token-drift"],
  },
  "components.default-shadcn": {
    tenetIds: ["consistency", "trust"],
    trapIds: ["token-drift", "ambiguous-affordance"],
  },
  "maintainability.arbitrary-tailwind": {
    tenetIds: ["consistency", "workflow-fit"],
    trapIds: ["token-drift", "layout-instability"],
  },
  "responsive.coverage-low": {
    tenetIds: ["workflow-fit", "state-continuity"],
    trapIds: ["layout-instability"],
  },
  "a11y.image-alt": {
    tenetIds: ["accessibility", "trust"],
    trapIds: ["inaccessible-interaction"],
  },
  "a11y.focus-missing": {
    tenetIds: ["accessibility", "control", "trust"],
    trapIds: ["inaccessible-interaction", "ambiguous-affordance"],
  },
};

const CATEGORY_MAPPINGS: Record<AppQualityIssue["category"], Mapping> = {
  "visual-system": { tenetIds: ["clarity", "consistency"], trapIds: ["token-drift", "choice-overload"] },
  typography: { tenetIds: ["clarity", "consistency"], trapIds: ["choice-overload"] },
  spacing: { tenetIds: ["clarity", "workflow-fit"], trapIds: ["choice-overload", "layout-instability"] },
  color: { tenetIds: ["consistency", "trust"], trapIds: ["token-drift"] },
  components: { tenetIds: ["consistency", "control"], trapIds: ["ambiguous-affordance", "missing-state"] },
  accessibility: { tenetIds: ["accessibility", "control"], trapIds: ["inaccessible-interaction"] },
  responsive: { tenetIds: ["workflow-fit", "state-continuity"], trapIds: ["layout-instability"] },
  maintainability: { tenetIds: ["consistency", "workflow-fit"], trapIds: ["token-drift"] },
};

const SEVERITY_PENALTY: Record<AppQualitySeverity, number> = {
  critical: 24,
  high: 18,
  medium: 10,
  low: 5,
};

/**
 * Tenets/traps the static scan can actually evidence, computed from the
 * mapping tables — anything outside these sets can never fire from a scan
 * and must report "not-assessed", never "protected"/"clear". Self-maintaining:
 * adding a mapping automatically makes its tenets/traps assessable.
 */
const ASSESSABLE_TENET_IDS = new Set<UxTenetId>();
const ASSESSABLE_TRAP_IDS = new Set<UxTrapId>();
for (const mapping of [...Object.values(ISSUE_MAPPINGS), ...Object.values(CATEGORY_MAPPINGS)]) {
  for (const tenetId of mapping.tenetIds) ASSESSABLE_TENET_IDS.add(tenetId);
  for (const trapId of mapping.trapIds) ASSESSABLE_TRAP_IDS.add(trapId);
}

const NOT_ASSESSED_TENET_NOTE =
  "Not assessable by static scan — needs rendered/behavioral evidence (screenshots analyzed by vision, interaction probes). Planned for a future release; until then this tenet is unverified, not verified-good.";
const NOT_ASSESSED_TRAP_NOTE =
  "No static-scan evidence path exists for this trap — 'not-assessed' means unverified, not clear.";

export function mapAppQualityIssueToUxFinding(issue: AppQualityIssue): UxAuditFinding {
  const mapping = ISSUE_MAPPINGS[issue.id] ?? CATEGORY_MAPPINGS[issue.category];
  return {
    id: `ux.${issue.id}`,
    normalizedId: normalizeAuditFindingId(issue.normalizedId ?? issue.id),
    title: issue.title,
    severity: issue.severity,
    tenetIds: mapping.tenetIds,
    trapIds: mapping.trapIds,
    evidence: [
      issue.detail,
      ...issue.evidence,
      ...(issue.affectedFiles?.slice(0, 3).map((file) => `Affected file: ${file}`) ?? []),
    ],
    recommendation: mapping.recommendation ?? issue.recommendation,
    source: "app-quality",
    provenance: "static-scan",
    confidence: issue.confidence,
    affectedFiles: issue.affectedFiles,
  };
}

export function buildUxAuditReport(input: BuildUxAuditReportInput): UxAuditReport {
  const target = input.target ?? input.artifactPath ?? "workspace";
  // Screenshots are recorded, never analyzed — 2.3 has no vision pass, so no
  // finding is fabricated from a screenshot's mere existence. (The previous
  // placeholder emitted a fixed medium finding with an invented confidence.)
  const findings = (input.issues ?? [])
    .map(mapAppQualityIssueToUxFinding)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const tenetCoverage = buildTenetCoverage(findings);
  const trapRisks = buildTrapRisks(findings);
  const hasAnalyzedEvidence = input.appQualityScore !== undefined || findings.length > 0;
  const noEvidenceCap = hasAnalyzedEvidence ? [] : [{
    id: "no-analyzed-evidence",
    maximum: 0,
    reason: "The supplied artifact was recorded but not analyzed.",
  }];
  const score = noEvidenceCap.length > 0 ? 0 : scoreUx(findings, input.appQualityScore);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const dimensionStatuses = [
    ...tenetCoverage.map((entry) => ({
      id: `tenet:${entry.tenetId}`,
      unassessed: entry.status === "unknown" || entry.status === "not-assessed",
    })),
    ...trapRisks.map((entry) => ({
      id: `trap:${entry.trapId}`,
      unassessed: entry.status === "not-assessed",
    })),
  ];
  const auditEvidence = buildAuditEvidenceMetadata({
    dimensions: dimensionStatuses.map((entry) => entry.id),
    unassessedDimensions: dimensionStatuses
      .filter((entry) => !hasAnalyzedEvidence || entry.unassessed)
      .map((entry) => entry.id),
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
    appliedScoreCaps: noEvidenceCap,
  });

  return {
    schemaVersion: 2,
    target,
    generatedAt,
    score,
    tenetCoverage,
    trapRisks,
    findings,
    recommendedTweaks: recommendedTweaks(findings),
    artifactPath: input.artifactPath ?? undefined,
    artifactNote: input.artifactPath
      ? "Screenshot attached for reference only — it was not analyzed. Static-scan findings above come from source code, not pixels."
      : undefined,
    metadata: {
      issueCount: input.issues?.length ?? 0,
      appQualityScore: input.appQualityScore,
    },
    ...auditEvidence,
  };
}

export async function writeUxAuditReport(projectRoot: string, report: UxAuditReport): Promise<{ jsonPath: string; markdownPath: string }> {
  const outDir = join(projectRoot, ".memoire", "app-quality");
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "ux-audit.json");
  const markdownPath = join(outDir, "ux-audit.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  await writeFile(markdownPath, renderUxAuditMarkdown(report), "utf-8");
  return { jsonPath, markdownPath };
}

export function renderUxAuditMarkdown(report: UxAuditReport): string {
  const lines = [
    "# Memoire UX Tenets and Traps Audit",
    "",
    `Target: \`${report.target}\``,
    `Score: ${report.score}/100`,
    `Generated: ${report.generatedAt}`,
  ];
  if (report.artifactPath) lines.push(`Artifact: \`${report.artifactPath}\``);
  if (report.artifactNote) lines.push(`> ${report.artifactNote}`);

  lines.push(
    "",
    "> Statuses: **at-risk** = static-scan findings exist · **protected** = the scan can detect violations and found none · **not-assessed** = no static evidence path exists (unverified, NOT verified-good).",
  );

  lines.push("", "## Tenet Coverage", "");
  for (const tenet of report.tenetCoverage) {
    lines.push(`- **${tenet.name}**: ${tenet.status}${tenet.findingIds.length ? ` (${tenet.findingIds.join(", ")})` : ""}`);
  }

  lines.push("", "## Trap Risks", "");
  for (const trap of report.trapRisks.filter((risk) => risk.status !== "clear" && risk.status !== "not-assessed")) {
    lines.push(`- **${trap.name}**: ${trap.status} (${trap.riskScore}/100)`);
    lines.push(`  Fix: ${trap.defaultFix}`);
  }
  const notAssessedTraps = report.trapRisks.filter((risk) => risk.status === "not-assessed");
  if (notAssessedTraps.length > 0) {
    lines.push(`- Not assessed by static scan: ${notAssessedTraps.map((t) => t.name).join(", ")}`);
  }
  if (!report.trapRisks.some((risk) => risk.status === "present" || risk.status === "watch")) {
    lines.push("- No trap risk detected among statically-assessable traps.");
  }

  lines.push("", "## Findings", "");
  if (report.findings.length === 0) {
    lines.push("- No UX trap findings detected from available evidence.");
  } else {
    for (const finding of report.findings) {
      lines.push(`- **${finding.severity.toUpperCase()} ${finding.title}**`);
      lines.push(`  Traps: ${finding.trapIds.join(", ")}`);
      lines.push(`  Recommendation: ${finding.recommendation}`);
      if (finding.evidence[0]) lines.push(`  Evidence: ${finding.evidence[0]}`);
    }
  }

  lines.push("", "## Recommended Tweaks", "");
  for (const tweak of report.recommendedTweaks) lines.push(`- ${tweak}`);
  if (report.recommendedTweaks.length === 0) lines.push("- Preserve current tenets and keep collecting screenshot/code evidence.");
  lines.push("");
  return lines.join("\n");
}

function buildTenetCoverage(findings: UxAuditFinding[]): UxTenetCoverage[] {
  return UX_TENETS.map((tenet) => {
    const related = findings.filter((finding) => finding.tenetIds.includes(tenet.id));
    if (related.length > 0) {
      return {
        tenetId: tenet.id,
        name: tenet.name,
        status: "at-risk" as const,
        findingIds: related.map((finding) => finding.id),
        notes: related.map((finding) => finding.title).slice(0, 3),
      };
    }
    // No findings for this tenet. Only claim "protected" when the scan could
    // actually have violated it — an unassessable tenet must never read as
    // verified-good just because other findings exist.
    if (!ASSESSABLE_TENET_IDS.has(tenet.id)) {
      return {
        tenetId: tenet.id,
        name: tenet.name,
        status: "not-assessed" as const,
        findingIds: [],
        notes: [NOT_ASSESSED_TENET_NOTE],
      };
    }
    return {
      tenetId: tenet.id,
      name: tenet.name,
      status: findings.length > 0 ? ("protected" as const) : ("unknown" as const),
      findingIds: [],
      notes: tenet.protectBy.slice(0, 2),
    };
  });
}

function buildTrapRisks(findings: UxAuditFinding[]): UxTrapRisk[] {
  return UX_TRAPS.map((trap) => {
    const related = findings.filter((finding) => finding.trapIds.includes(trap.id));
    const riskScore = Math.min(100, related.reduce((sum, finding) => sum + SEVERITY_PENALTY[finding.severity], 0) * 3);
    const highestSeverity = related.map((finding) => finding.severity).sort((a, b) => severityRank(b) - severityRank(a))[0];
    if (related.length === 0 && !ASSESSABLE_TRAP_IDS.has(trap.id)) {
      return {
        trapId: trap.id,
        name: trap.name,
        status: "not-assessed" as const,
        riskScore: 0,
        findingIds: [],
        defaultFix: trap.defaultFix,
        note: NOT_ASSESSED_TRAP_NOTE,
      };
    }
    return {
      trapId: trap.id,
      name: trap.name,
      status: related.length === 0 ? "clear" : highestSeverity === "critical" || highestSeverity === "high" ? "present" : "watch",
      riskScore,
      findingIds: related.map((finding) => finding.id),
      defaultFix: trap.defaultFix,
    };
  });
}

function recommendedTweaks(findings: UxAuditFinding[]): string[] {
  const seen = new Set<string>();
  const tweaks: string[] = [];
  for (const finding of findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))) {
    if (seen.has(finding.recommendation)) continue;
    seen.add(finding.recommendation);
    tweaks.push(finding.recommendation);
    for (const trapId of finding.trapIds) {
      const trap = UX_TRAPS.find((candidate) => candidate.id === trapId);
      if (!trap || seen.has(trap.defaultFix)) continue;
      seen.add(trap.defaultFix);
      tweaks.push(trap.defaultFix);
      break;
    }
    if (tweaks.length >= 6) break;
  }
  return tweaks;
}

function scoreUx(findings: UxAuditFinding[], appQualityScore?: number): number {
  const trapPenalty = findings.reduce((sum, finding) => sum + SEVERITY_PENALTY[finding.severity], 0);
  const evidenceScore = Math.max(0, 100 - trapPenalty);
  if (appQualityScore === undefined) return evidenceScore;
  return Math.max(0, Math.round((evidenceScore * 0.65) + (appQualityScore * 0.35)));
}

function severityRank(severity: AppQualitySeverity): number {
  return severity === "critical" ? 4 : severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}
