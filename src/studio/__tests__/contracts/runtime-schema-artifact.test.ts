import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("runtime schema artifact", () => {
  it("publishes one versioned JSON Schema boundary for Rust and GUI consumers", async () => {
    const schema = JSON.parse(
      await readFile(new URL("../../../../schemas/memi-runtime-trace-v1.schema.json", import.meta.url), "utf-8"),
    );
    expect(schema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://memi.design/schemas/runtime-trace/v1",
      title: "Memi Runtime Trace Contract v1",
    });
    expect(schema.$defs).toHaveProperty("RunRecord");
    expect(schema.$defs).toHaveProperty("SpanRecord");
    expect(schema.$defs).toHaveProperty("CanvasProjection");
  });
});
