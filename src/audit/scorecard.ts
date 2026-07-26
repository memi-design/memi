import { z } from "zod";

export const AUDIT_SCORECARD_SCHEMA_VERSION = 1 as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;

export const EVIDENCE_TTL_DAYS = {
  "live-release": 1,
  security: 7,
  adoption: 7,
  implementation: 30,
  rendered: 30,
  "clean-install": 30,
  review: 30,
  "shader-reference": 180,
} as const;

const AuditEvidenceSchema = z.object({
  id: z.string().regex(IDENTIFIER),
  kind: z.enum([
    "live-release",
    "security",
    "adoption",
    "implementation",
    "rendered",
    "clean-install",
    "review",
    "shader-reference",
  ]),
  status: z.enum(["passed", "failed", "contradicted"]),
  capturedAt: z.string().datetime({ offset: true }),
  artifact: z.object({
    location: z.string().min(1),
    sha256: z.string().regex(SHA256, "Artifact sha256 must be 64 lowercase hexadecimal characters."),
  }),
  producer: z.string().min(1),
  verifier: z.string().min(1),
  environment: z.string().min(1),
  ttlDays: z.number().int().positive().max(3650).optional(),
});

const AuditCriterionSchema = z.object({
  id: z.string().regex(IDENTIFIER),
  title: z.string().min(1),
  points: z.number().int().positive(),
  assessment: z.enum(["passed", "failed", "unassessed"]),
  evidenceIds: z.array(z.string().regex(IDENTIFIER)),
  requiresIndependentVerification: z.boolean(),
}).superRefine((criterion, context) => {
  if (criterion.assessment === "passed" && criterion.evidenceIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A passed criterion must reference point-bearing evidence.",
      path: ["evidenceIds"],
    });
  }
});

const AuditDimensionSchema = z.object({
  id: z.string().regex(IDENTIFIER),
  title: z.string().min(1),
  maximum: z.number().int().positive(),
  owner: z.string().min(1),
  criteria: z.array(AuditCriterionSchema).min(1),
});

const AuditScoreCapSchema = z.object({
  id: z.string().regex(IDENTIFIER),
  maximum: z.number().int().min(0),
  reason: z.string().min(1),
  state: z.enum(["active", "cleared"]),
  clearingEvidenceIds: z.array(z.string().regex(IDENTIFIER)),
  requiresIndependentVerification: z.boolean(),
}).superRefine((cap, context) => {
  if (cap.state === "cleared" && cap.clearingEvidenceIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A cleared score cap must reference clearing evidence.",
      path: ["clearingEvidenceIds"],
    });
  }
});

export const AuditScorecardSchema = z.object({
  schemaVersion: z.literal(AUDIT_SCORECARD_SCHEMA_VERSION),
  auditId: z.string().regex(IDENTIFIER),
  title: z.string().min(1),
  targetScore: z.literal(100),
  assessedAt: z.string().datetime({ offset: true }),
  subject: z.object({
    repository: z.string().url(),
    commit: z.string().regex(/^[a-f0-9]{40,64}$/),
  }),
  evidence: z.array(AuditEvidenceSchema),
  dimensions: z.array(AuditDimensionSchema).min(1),
  caps: z.array(AuditScoreCapSchema),
}).superRefine((scorecard, context) => {
  addDuplicateIssues(scorecard.evidence.map((entry) => entry.id), "Duplicate evidence id", ["evidence"], context);
  addDuplicateIssues(scorecard.dimensions.map((entry) => entry.id), "Duplicate dimension id", ["dimensions"], context);
  addDuplicateIssues(scorecard.caps.map((entry) => entry.id), "Duplicate score cap id", ["caps"], context);

  const criterionIds: string[] = [];
  for (const [dimensionIndex, dimension] of scorecard.dimensions.entries()) {
    const allocated = dimension.criteria.reduce((sum, criterion) => sum + criterion.points, 0);
    if (allocated !== dimension.maximum) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Dimension criterion points total ${allocated}, expected maximum ${dimension.maximum}.`,
        path: ["dimensions", dimensionIndex, "criteria"],
      });
    }
    criterionIds.push(...dimension.criteria.map((criterion) => `${dimension.id}/${criterion.id}`));
  }
  addDuplicateIssues(criterionIds, "Duplicate criterion id", ["dimensions"], context);

  const maximum = scorecard.dimensions.reduce((sum, dimension) => sum + dimension.maximum, 0);
  if (maximum !== scorecard.targetScore) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Dimension maximums total ${maximum}, expected target score ${scorecard.targetScore}.`,
      path: ["dimensions"],
    });
  }
  for (const [capIndex, cap] of scorecard.caps.entries()) {
    if (cap.maximum > maximum) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Score cap maximum ${cap.maximum} exceeds scorecard maximum ${maximum}.`,
        path: ["caps", capIndex, "maximum"],
      });
    }
  }
});

export type AuditScorecard = z.infer<typeof AuditScorecardSchema>;
export type AuditEvidence = AuditScorecard["evidence"][number];

export interface EvaluatedAuditDimension {
  id: string;
  title: string;
  score: number;
  maximum: number;
}

export interface EvaluatedAuditScorecard {
  auditId: string;
  title: string;
  asOf: string;
  rawScore: number;
  score: number;
  maximum: number;
  confidence: number;
  dimensions: EvaluatedAuditDimension[];
  unassessedDimensions: string[];
  unassessedCriteria: string[];
  failedCriteria: string[];
  unverifiedCriteria: string[];
  missingEvidenceIds: string[];
  staleEvidenceIds: string[];
  invalidEvidenceIds: string[];
  failedEvidenceIds: string[];
  contradictedEvidenceIds: string[];
  selfVerifiedEvidenceIds: string[];
  appliedCaps: Array<{ id: string; maximum: number; reason: string }>;
}

export function evaluateAuditScorecard(
  input: AuditScorecard,
  options: { asOf?: string } = {},
): EvaluatedAuditScorecard {
  const scorecard = AuditScorecardSchema.parse(input);
  const asOf = parseInstant(options.asOf ?? scorecard.assessedAt, "asOf");
  const evidenceById = new Map(scorecard.evidence.map((entry) => [entry.id, entry]));
  const evidenceState = createEvidenceState(asOf, evidenceById);

  const unassessedCriteria: string[] = [];
  const failedCriteria: string[] = [];
  const unverifiedCriteria: string[] = [];
  const unassessedDimensions = new Set<string>();
  const dimensions: EvaluatedAuditDimension[] = [];

  for (const dimension of scorecard.dimensions) {
    let dimensionScore = 0;
    for (const criterion of dimension.criteria) {
      const criterionId = `${dimension.id}/${criterion.id}`;
      if (criterion.assessment === "unassessed") {
        unassessedCriteria.push(criterionId);
        unassessedDimensions.add(dimension.id);
        continue;
      }
      if (criterion.assessment === "failed") {
        failedCriteria.push(criterionId);
        continue;
      }

      const valid = criterion.evidenceIds.every((evidenceId) =>
        evidenceState.isValid(evidenceId, criterion.requiresIndependentVerification),
      );
      if (valid) {
        dimensionScore += criterion.points;
      } else {
        unverifiedCriteria.push(criterionId);
      }
    }
    dimensions.push({
      id: dimension.id,
      title: dimension.title,
      score: dimensionScore,
      maximum: dimension.maximum,
    });
  }

  const maximum = dimensions.reduce((sum, dimension) => sum + dimension.maximum, 0);
  const rawScore = dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
  const appliedCaps = scorecard.caps
    .filter((cap) => {
      if (cap.state === "active") return true;
      return !cap.clearingEvidenceIds.every((evidenceId) =>
        evidenceState.isValid(evidenceId, cap.requiresIndependentVerification),
      );
    })
    .map(({ id, maximum: capMaximum, reason }) => ({ id, maximum: capMaximum, reason }));
  const effectiveCap = appliedCaps.reduce(
    (minimum, cap) => Math.min(minimum, cap.maximum),
    maximum,
  );
  const score = Math.min(rawScore, effectiveCap);

  return {
    auditId: scorecard.auditId,
    title: scorecard.title,
    asOf: asOf.toISOString(),
    rawScore,
    score,
    maximum,
    confidence: Number((rawScore / maximum).toFixed(2)),
    dimensions,
    unassessedDimensions: sorted(unassessedDimensions),
    unassessedCriteria: sorted(unassessedCriteria),
    failedCriteria: sorted(failedCriteria),
    unverifiedCriteria: sorted(unverifiedCriteria),
    missingEvidenceIds: sorted(evidenceState.missing),
    staleEvidenceIds: sorted(evidenceState.stale),
    invalidEvidenceIds: sorted(evidenceState.invalid),
    failedEvidenceIds: sorted(evidenceState.failed),
    contradictedEvidenceIds: sorted(evidenceState.contradicted),
    selfVerifiedEvidenceIds: sorted(evidenceState.selfVerified),
    appliedCaps,
  };
}

export function renderAuditScorecardMarkdown(
  input: AuditScorecard,
  options: { asOf?: string } = {},
): string {
  const result = evaluateAuditScorecard(input, options);
  const lines = [
    `# ${result.title}`,
    "",
    `Evidence evaluated: ${result.asOf}`,
    "",
    `**Verified score: ${result.score}/${result.maximum}**`,
    "",
    "| Dimension | Verified | Maximum |",
    "| --- | ---: | ---: |",
    ...result.dimensions.map((dimension) =>
      `| ${dimension.title} | ${dimension.score} | ${dimension.maximum} |`,
    ),
    "",
    "## Remaining gaps",
    "",
  ];
  const gaps = [
    ...result.unassessedCriteria.map((id) => `Unassessed criterion: \`${id}\``),
    ...result.failedCriteria.map((id) => `Failed criterion: \`${id}\``),
    ...result.unverifiedCriteria.map((id) => `Unverified criterion: \`${id}\``),
    ...result.appliedCaps.map((cap) => `Applied cap: \`${cap.id}\` at ${cap.maximum}`),
  ];
  lines.push(...(gaps.length > 0 ? gaps.map((gap) => `- ${gap}`) : ["- None."]));
  lines.push("");
  return lines.join("\n");
}

function createEvidenceState(asOf: Date, evidenceById: Map<string, AuditEvidence>) {
  const missing = new Set<string>();
  const stale = new Set<string>();
  const invalid = new Set<string>();
  const failed = new Set<string>();
  const contradicted = new Set<string>();
  const selfVerified = new Set<string>();

  function isValid(id: string, requiresIndependentVerification: boolean): boolean {
    const evidence = evidenceById.get(id);
    if (!evidence) {
      missing.add(id);
      return false;
    }

    const capturedAt = parseInstant(evidence.capturedAt, `evidence ${id}`);
    if (capturedAt.getTime() > asOf.getTime()) {
      invalid.add(id);
      return false;
    }
    const ttlDays = evidence.ttlDays ?? EVIDENCE_TTL_DAYS[evidence.kind];
    if (asOf.getTime() - capturedAt.getTime() > ttlDays * DAY_MS) {
      stale.add(id);
      return false;
    }
    if (evidence.status === "failed") {
      failed.add(id);
      return false;
    }
    if (evidence.status === "contradicted") {
      contradicted.add(id);
      return false;
    }
    if (requiresIndependentVerification && evidence.producer === evidence.verifier) {
      selfVerified.add(id);
      return false;
    }
    return true;
  }

  return { missing, stale, invalid, failed, contradicted, selfVerified, isValid };
}

function addDuplicateIssues(
  values: string[],
  message: string,
  path: Array<string | number>,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `${message}: ${value}`, path });
    }
    seen.add(value);
  }
}

function parseInstant(value: string, label: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid ${label} timestamp: ${value}`);
  }
  return parsed;
}

function sorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}
