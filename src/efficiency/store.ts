import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  benchmarkRunRecordSchema,
  type BenchmarkRunRecord,
} from "./contracts.js";

export class EfficiencyRunStore {
  readonly path: string;
  private inflight: Promise<void> = Promise.resolve();

  constructor(projectRoot: string) {
    this.path = join(projectRoot, ".memoire", "efficiency", "runs.jsonl");
  }

  async append(input: BenchmarkRunRecord): Promise<void> {
    const record = benchmarkRunRecordSchema.parse(input);
    const pending = this.inflight.then(async () => {
      const existing = await this.list();
      if (existing.some((candidate) => candidate.runId === record.runId)) {
        throw new Error(`benchmark run ${record.runId} already exists`);
      }
      await mkdir(join(this.path, ".."), { recursive: true, mode: 0o700 });
      const handle = await open(this.path, "a", 0o600);
      try {
        await handle.appendFile(`${JSON.stringify(record)}\n`, "utf-8");
      } finally {
        await handle.close();
      }
    });
    this.inflight = pending.catch(() => undefined);
    await pending;
  }

  async list(): Promise<BenchmarkRunRecord[]> {
    const raw = await readFile(this.path, "utf-8").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return "";
      throw error;
    });
    const records: BenchmarkRunRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const parsed = benchmarkRunRecordSchema.safeParse(JSON.parse(line));
      if (parsed.success) records.push(parsed.data);
    }
    return records;
  }
}
