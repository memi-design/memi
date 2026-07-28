import { z } from "zod";

export const designEvaluationDimensionSchema = z.object({
  id: z.string().min(1),
  weight: z.number().positive().max(100),
  baselineScore: z.number().min(0).max(100),
  memiScore: z.number().min(0).max(100),
});

export const designHarnessEvaluationSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string().min(1),
  modelId: z.string().min(1),
  baselineRunId: z.string().min(1),
  memiRunId: z.string().min(1),
  dimensions: z.array(designEvaluationDimensionSchema),
  reviewer: z.object({
    kind: z.enum(["self", "independent"]),
    id: z.string().min(1),
  }),
  evidenceRefs: z.array(z.string().min(1)),
  status: z.enum(["unassessed", "verified"]),
  baselineScore: z.number().min(0).max(100).optional(),
  memiScore: z.number().min(0).max(100).optional(),
  delta: z.number().min(-100).max(100).optional(),
  claim: z.enum(["insufficient_evidence", "improved", "neutral", "regressed"]),
  assessedAt: z.string(),
});

export type DesignHarnessEvaluation = z.infer<typeof designHarnessEvaluationSchema>;

export interface DesignHarnessEvaluationInput {
  readonly taskId: string;
  readonly modelId: string;
  readonly baselineRunId: string;
  readonly memiRunId: string;
  readonly dimensions: readonly z.infer<typeof designEvaluationDimensionSchema>[];
  readonly reviewer: {
    readonly kind: "self" | "independent";
    readonly id: string;
  };
  readonly evidenceRefs: readonly string[];
  readonly assessedAt?: string;
}

export function buildDesignHarnessEvaluation(
  input: DesignHarnessEvaluationInput,
): Readonly<DesignHarnessEvaluation> {
  const totalWeight = input.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  const verified = input.reviewer.kind === "independent"
    && input.evidenceRefs.length >= 2
    && input.dimensions.length > 0
    && Math.abs(totalWeight - 100) < 0.001
    && input.baselineRunId !== input.memiRunId;

  if (!verified) {
    return Object.freeze(designHarnessEvaluationSchema.parse({
      schemaVersion: 1,
      ...input,
      dimensions: [...input.dimensions],
      evidenceRefs: [...input.evidenceRefs],
      status: "unassessed",
      claim: "insufficient_evidence",
      assessedAt: input.assessedAt ?? new Date().toISOString(),
    }));
  }

  const baselineScore = weightedScore(input.dimensions, "baselineScore");
  const memiScore = weightedScore(input.dimensions, "memiScore");
  const delta = round(memiScore - baselineScore);
  const claim = delta > 0 ? "improved" : delta < 0 ? "regressed" : "neutral";

  return Object.freeze(designHarnessEvaluationSchema.parse({
    schemaVersion: 1,
    ...input,
    dimensions: [...input.dimensions],
    evidenceRefs: [...input.evidenceRefs],
    status: "verified",
    baselineScore,
    memiScore,
    delta,
    claim,
    assessedAt: input.assessedAt ?? new Date().toISOString(),
  }));
}

function weightedScore(
  dimensions: readonly z.infer<typeof designEvaluationDimensionSchema>[],
  field: "baselineScore" | "memiScore",
): number {
  return round(dimensions.reduce(
    (sum, dimension) => sum + dimension[field] * (dimension.weight / 100),
    0,
  ));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
