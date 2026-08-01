import { access, mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoireEngine } from "../../engine/core.js";
import { registerExportCommand } from "../export.js";
import { captureLogs, lastLog } from "./test-helpers.js";

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `memoire-export-json-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(testDir, "generated", "components", "molecules"), { recursive: true });
  await mkdir(join(testDir, "generated", "pages"), { recursive: true });
  await mkdir(join(testDir, "generated", "dataviz"), { recursive: true });

  await writeFile(join(testDir, "generated", "components", "molecules", "MetricCard.tsx"), "export const MetricCard = () => null;\n", "utf-8");
  await writeFile(join(testDir, "generated", "pages", "Dashboard.tsx"), "export const Dashboard = () => null;\n", "utf-8");
  await writeFile(join(testDir, "generated", "dataviz", "ActivityChart.tsx"), "export const ActivityChart = () => null;\n", "utf-8");
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await rm(testDir, { recursive: true, force: true });
});

describe("export --json", () => {
  it("emits structured dry-run mappings", async () => {
    const logs = captureLogs();
    const program = new Command();
    program.exitOverride();

    registerExportCommand(program, makeEngine());

    await program.parseAsync(["export", "--dry-run", "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      status: "completed",
      options: {
        target: null,
        dryRun: true,
        force: false,
        json: true,
      },
      summary: {
        discovered: 3,
        attempted: 3,
        written: 3,
        skipped: 0,
        failed: 0,
      },
    });
    expect(payload.exports).toEqual([
      {
        source: join("components", "molecules", "MetricCard.tsx"),
        kind: "components",
        targetBase: join("src", "components"),
        destination: join("src", "components", "molecules", "MetricCard.tsx"),
        status: "would-write",
        reason: null,
      },
      {
        source: join("dataviz", "ActivityChart.tsx"),
        kind: "dataviz",
        targetBase: join("src", "components", "dataviz"),
        destination: join("src", "components", "dataviz", "ActivityChart.tsx"),
        status: "would-write",
        reason: null,
      },
      {
        source: join("pages", "Dashboard.tsx"),
        kind: "pages",
        targetBase: join("src", "pages"),
        destination: join("src", "pages", "Dashboard.tsx"),
        status: "would-write",
        reason: null,
      },
    ]);
  });

  it("reports skipped files when targets already exist", async () => {
    const logs = captureLogs();
    const program = new Command();
    program.exitOverride();

    await mkdir(join(testDir, "src", "components", "molecules"), { recursive: true });
    await writeFile(join(testDir, "src", "components", "molecules", "MetricCard.tsx"), "existing\n", "utf-8");

    registerExportCommand(program, makeEngine());

    await program.parseAsync(["export", "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload.summary).toMatchObject({
      discovered: 3,
      attempted: 3,
      written: 2,
      skipped: 1,
      failed: 0,
    });
    expect(payload.exports.find((entry: { source: string }) => entry.source === join("components", "molecules", "MetricCard.tsx"))).toMatchObject({
      status: "skipped",
      reason: "exists",
    });

    const dashboardOutput = await readFile(join(testDir, "src", "pages", "Dashboard.tsx"), "utf-8");
    expect(dashboardOutput).toContain("Dashboard");
    await access(join(testDir, "src", "components", "dataviz", "ActivityChart.tsx"));
  });

  it("returns a structured failure payload when project context is missing", async () => {
    const logs = captureLogs();
    const program = new Command();
    program.exitOverride();

    const engine = {
      config: { projectRoot: testDir },
      project: null,
      init: vi.fn(async () => undefined),
    } as unknown as MemoireEngine;

    registerExportCommand(program, engine);

    await program.parseAsync(["export", "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      status: "failed",
      summary: {
        discovered: 0,
        attempted: 0,
        written: 0,
        skipped: 0,
        failed: 0,
      },
      error: {
        message: "Could not detect project context. Run `memi init` first.",
      },
    });
    expect(process.exitCode).toBe(1);
  });
});

function makeEngine(): MemoireEngine {
  return {
    config: { projectRoot: testDir },
    project: {
      framework: "vite",
      language: "typescript",
      styling: {
        tailwind: true,
        cssModules: false,
        styledComponents: false,
      },
      shadcn: {
        installed: true,
        components: [],
        config: {},
      },
      designTokens: {
        source: "none",
        tokenCount: 0,
      },
      paths: {
        components: "src/components",
      },
      detectedAt: new Date().toISOString(),
    },
    init: vi.fn(async () => undefined),
  } as unknown as MemoireEngine;
}
