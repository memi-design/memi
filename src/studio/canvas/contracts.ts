import { z } from "zod";

export const atomicDesignLevelSchema = z.enum([
  "atom",
  "molecule",
  "organism",
  "template",
  "page",
]);

export const canvasNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["run", "span", "artifact", "evidence", "design_component"]),
  atomicLevel: atomicDesignLevelSchema,
  label: z.string().min(1),
  spanId: z.string().regex(/^[0-9a-f]{16}$/).optional(),
  artifactRef: z.string().min(1).optional(),
  evidenceRef: z.string().min(1).optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }).optional(),
});

export const canvasEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(["contains", "produced", "used", "evaluated", "handoff"]),
});

export const canvasProjectionSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
  nodes: z.array(canvasNodeSchema),
  edges: z.array(canvasEdgeSchema),
}).superRefine((projection, ctx) => {
  const ids = new Set(projection.nodes.map((node) => node.id));
  for (const [index, edge] of projection.edges.entries()) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["edges", index],
        message: `canvas edge ${edge.id} references an unknown node`,
      });
    }
  }
});

export type CanvasProjection = z.infer<typeof canvasProjectionSchema>;

export function createCanvasProjection(
  input: Omit<CanvasProjection, "schemaVersion">,
): Readonly<CanvasProjection> {
  const parsed = canvasProjectionSchema.parse({
    schemaVersion: 1,
    ...input,
  });
  return Object.freeze({
    ...parsed,
    nodes: Object.freeze(parsed.nodes.map((node) => Object.freeze({ ...node }))),
    edges: Object.freeze(parsed.edges.map((edge) => Object.freeze({ ...edge }))),
  }) as Readonly<CanvasProjection>;
}
