import { lstat, mkdir, open, readFile } from "node:fs/promises";
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
      const existing = await this.listStrict();
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

  async listStrict(options: {
    readonly maxBytes?: number;
  } = {}): Promise<BenchmarkRunRecord[]> {
    const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new Error("maxBytes must be a positive integer");
    }
    const metadata = await lstat(this.path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
      throw error;
    });
    if (!metadata) return [];
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error("benchmark run store must be a regular non-symlink file");
    }
    if (metadata.size > maxBytes) {
      throw new Error(`benchmark run store exceeds the ${maxBytes}-byte safety limit`);
    }
    const raw = await readFile(this.path, "utf8");
    const records: BenchmarkRunRecord[] = [];
    const runIds = new Set<string>();
    for (const [index, line] of raw.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid benchmark run JSON at line ${index + 1}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
      const parsed = benchmarkRunRecordSchema.safeParse(value);
      if (!parsed.success) {
        throw new Error(
          `Invalid benchmark run schema at line ${index + 1}: ${parsed.error.message}`,
        );
      }
      if (runIds.has(parsed.data.runId)) {
        throw new Error(`duplicate benchmark run ${parsed.data.runId}`);
      }
      runIds.add(parsed.data.runId);
      records.push(parsed.data);
    }
    return records;
  }
}
