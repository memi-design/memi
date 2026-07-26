export const AUDIT_SCHEMA_VERSION = 2 as const;

export type AuditEvidenceKind = "static-scan" | "rendered-probe" | "vision" | "screenshot" | "manual";

export interface AuditEvidenceProvenance {
  kind: AuditEvidenceKind;
  analyzed: boolean;
  target?: string;
  artifactPath?: string;
}

export interface AuditScoreCap {
  id: string;
  maximum: number;
  reason: string;
}

export interface AuditEvidenceMetadata {
  confidence: number;
  assessedDimensions: string[];
  unassessedDimensions: string[];
  evidenceProvenance: AuditEvidenceProvenance[];
  appliedScoreCaps: AuditScoreCap[];
}

interface BuildAuditEvidenceMetadataInput {
  dimensions: string[];
  unassessedDimensions?: Iterable<string>;
  evidenceProvenance: AuditEvidenceProvenance[];
  findingConfidences?: Array<number | undefined>;
  appliedScoreCaps?: AuditScoreCap[];
}

export function buildAuditEvidenceMetadata(input: BuildAuditEvidenceMetadataInput): AuditEvidenceMetadata {
  const dimensions = uniqueSorted(input.dimensions);
  const unassessedSet = new Set(input.unassessedDimensions ?? []);
  const unassessedDimensions = dimensions.filter((dimension) => unassessedSet.has(dimension));
  const assessedDimensions = dimensions.filter((dimension) => !unassessedSet.has(dimension));
  const analyzedEvidence = input.evidenceProvenance.filter((entry) => entry.analyzed);
  const confidence = analyzedEvidence.length === 0 || assessedDimensions.length === 0
    ? 0
    : calculateConfidence({
      coverage: assessedDimensions.length / Math.max(1, dimensions.length),
      findingConfidences: input.findingConfidences ?? [],
    });

  return {
    confidence,
    assessedDimensions,
    unassessedDimensions,
    evidenceProvenance: input.evidenceProvenance.map((entry) => ({ ...entry })),
    appliedScoreCaps: (input.appliedScoreCaps ?? []).map((cap) => ({ ...cap })),
  };
}

export function normalizeAuditFindingId(id: string): string {
  return id.replace(/^(ux|craft)\./, "");
}

function calculateConfidence(input: { coverage: number; findingConfidences: Array<number | undefined> }): number {
  const numeric = input.findingConfidences.filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value),
  );
  const evidenceReliability = numeric.length > 0
    ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length
    : 0.8;
  return Number((Math.min(1, Math.max(0, input.coverage)) * evidenceReliability).toFixed(2));
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}
