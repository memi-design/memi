import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { canvasProjectionSchema } from "../src/studio/canvas/contracts.js";
import { providerRuntimeEventSchema } from "../src/studio/contracts/provider-runtime.js";
import { designHarnessEvaluationSchema } from "../src/studio/evaluation/design-evaluation.js";
import {
  runRecordSchema,
  spanRecordSchema,
} from "../src/studio/tracing/contracts.js";
import {
  benchmarkRunRecordSchema,
  benchmarkSuiteSchema,
} from "../src/efficiency/contracts.js";
import { efficiencyReportSchema } from "../src/efficiency/evaluation.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "schemas", "memi-runtime-trace-v1.schema.json");

function definition(schema: Parameters<typeof zodToJsonSchema>[0]): Record<string, unknown> {
  const converted = zodToJsonSchema(schema, {
    target: "jsonSchema2019-09",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  const { $schema: _schema, ...rest } = converted;
  return rest;
}

const output = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://memi.design/schemas/runtime-trace/v1",
  title: "Memi Runtime Trace Contract v1",
  description: "Provider-neutral run, span, runtime event, design evaluation, and canvas projection records shared by TypeScript, Rust, and GUI consumers.",
  oneOf: [
    { $ref: "#/$defs/RunRecord" },
    { $ref: "#/$defs/SpanRecord" },
    { $ref: "#/$defs/RuntimeEvent" },
    { $ref: "#/$defs/DesignHarnessEvaluation" },
    { $ref: "#/$defs/CanvasProjection" },
    { $ref: "#/$defs/BenchmarkRunRecord" },
    { $ref: "#/$defs/BenchmarkSuite" },
    { $ref: "#/$defs/EfficiencyReport" },
  ],
  $defs: {
    RunRecord: definition(runRecordSchema),
    SpanRecord: definition(spanRecordSchema),
    RuntimeEvent: definition(providerRuntimeEventSchema),
    DesignHarnessEvaluation: definition(designHarnessEvaluationSchema),
    CanvasProjection: definition(canvasProjectionSchema),
    BenchmarkRunRecord: definition(benchmarkRunRecordSchema),
    BenchmarkSuite: definition(benchmarkSuiteSchema),
    EfficiencyReport: definition(efficiencyReportSchema),
  },
};

const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf-8").catch(() => "");
  if (current !== serialized) {
    console.error("schemas/memi-runtime-trace-v1.schema.json is stale; run npm run build:runtime-schema");
    process.exitCode = 1;
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf-8");
}
