import {
  benchmarkPlanSchema,
  type BenchmarkPlan,
} from "./contracts.js";

export interface PairedBenchmarkPlanInput {
  readonly suiteId: string;
  readonly experimentId: string;
  readonly seed: number;
  readonly repeats: number;
  readonly tasks: readonly {
    readonly id: string;
    readonly intent: string;
  }[];
}

export function createPairedBenchmarkPlan(
  input: PairedBenchmarkPlanInput,
): Readonly<BenchmarkPlan> {
  const random = seededRandom(input.seed);
  const trials: BenchmarkPlan["trials"] = [];
  let sequence = 0;

  for (const task of input.tasks) {
    for (let repeat = 1; repeat <= input.repeats; repeat += 1) {
      const order = random() < 0.5
        ? (["baseline", "memi"] as const)
        : (["memi", "baseline"] as const);
      for (const condition of order) {
        trials.push({
          trialId: `${input.experimentId}:${task.id}:${repeat}:${condition}`,
          suiteId: input.suiteId,
          experimentId: input.experimentId,
          taskId: task.id,
          repeat,
          condition,
          sequence,
        });
        sequence += 1;
      }
    }
  }

  const plan = benchmarkPlanSchema.parse({
    schemaVersion: 1,
    suiteId: input.suiteId,
    experimentId: input.experimentId,
    seed: input.seed,
    repeats: input.repeats,
    conditions: ["baseline", "memi"],
    tasks: input.tasks.map((task) => ({ ...task })),
    trials,
  });
  return deepFreeze(plan);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
