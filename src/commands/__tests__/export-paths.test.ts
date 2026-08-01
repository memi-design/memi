import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoireEngine } from "../../engine/core.js";
import { registerExportCommand } from "../export.js";

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `memoire-export-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(testDir, "generated", "components", "molecules"), { recursive: true });
  await mkdir(join(testDir, "generated", "pages"), { recursive: true });
  await mkdir(join(testDir, "generated", "dataviz"), { recursive: true });

  await writeFile(join(testDir, "generated", "components", "molecules", "MetricCard.tsx"), "export {};\n", "utf-8");
  await writeFile(join(testDir, "generated", "pages", "Dashboard.tsx"), "export {};\n", "utf-8");
  await writeFile(join(testDir, "generated", "dataviz", "ActivityChart.tsx"), "export {};\n", "utf-8");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(testDir, { recursive: true, force: true });
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

describe("memi export path mapping", () => {
  it("routes generated components, pages, and dataviz into their expected default destinations", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const program = new Command();
    program.exitOverride();

    registerExportCommand(program, makeEngine());

    await program.parseAsync(["export", "--dry-run"], { from: "user" });

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");

    expect(output).toContain("EXPORT");
    expect(output).toContain(join("components", "molecules", "MetricCard.tsx"));
    expect(output).toContain(join("src", "components", "molecules", "MetricCard.tsx"));
    expect(output).toContain(join("pages", "Dashboard.tsx"));
    expect(output).toContain(join("src", "pages", "Dashboard.tsx"));
    expect(output).toContain(join("dataviz", "ActivityChart.tsx"));
    expect(output).toContain(join("src", "components", "dataviz", "ActivityChart.tsx"));
    expect(output).not.toContain("components/components");
    expect(output).toContain("DRY RUN");

    logSpy.mockRestore();
  });
});
