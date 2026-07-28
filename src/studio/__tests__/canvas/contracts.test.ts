import { describe, expect, it } from "vitest";
import {
  canvasProjectionSchema,
  createCanvasProjection,
} from "../../canvas/contracts.js";

describe("canvas/contracts", () => {
  it("projects traces and design evidence into Atomic Design canvas nodes", () => {
    const projection = createCanvasProjection({
      runId: "run-1",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      nodes: [
        {
          id: "span-audit",
          kind: "span",
          atomicLevel: "organism",
          label: "Design audit agent",
          spanId: "00f067aa0ba902b7",
        },
        {
          id: "artifact-report",
          kind: "artifact",
          atomicLevel: "molecule",
          label: "Audit report",
          artifactRef: "sha256:abc",
        },
      ],
      edges: [
        { id: "edge-1", from: "span-audit", to: "artifact-report", kind: "produced" },
      ],
    });

    expect(canvasProjectionSchema.parse(projection)).toMatchObject({
      schemaVersion: 1,
      runId: "run-1",
    });
  });
});
