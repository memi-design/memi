import { afterEach, describe, expect, it } from "vitest";
import { Command } from "commander";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDiagnoseCommand } from "../diagnose.js";
import { captureLogs, lastLog } from "./test-helpers.js";

afterEach(() => {
  process.exitCode = 0;
});

async function makeDebtRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memoire-diagnose-command-"));
  await mkdir(join(root, "src", "app"), { recursive: true });
  // >4 unique hex colors so color.raw-hex reaches "high" severity (engine.ts
  // promotes it above "medium" past 4 unique hexes) — the gate tests depend on
  // at least one high-severity issue existing.
  await writeFile(join(root, "src", "app", "page.tsx"), `
export default function Page() {
  return (
    <div className="bg-[#0a0a0a] border-[#333333]">
      <span className="text-[#ff0000]">alert</span>
      <button onClick={() => null} className="p-1 p-2 p-3 bg-[#111111] text-[#ffffff]">Start</button>
    </div>
  );
}
`, "utf-8");
  return root;
}

describe("memi diagnose", () => {
  it("emits app-quality JSON for an existing web app", async () => {
    const root = await makeDebtRepo();
    try {
      const logs = captureLogs();
      const program = new Command();
      registerDiagnoseCommand(program, { config: { projectRoot: root } } as never);

      await program.parseAsync(["diagnose", "--json", "--no-write", "--fail-on", "none"], { from: "user" });
      const payload = JSON.parse(lastLog(logs));

      expect(payload.version).toBe(1);
      expect(payload.schemaVersion).toBe(2);
      expect(payload.confidence).toEqual(expect.any(Number));
      expect(payload.confidence).toBeGreaterThan(0);
      expect(payload.confidence).toBeLessThanOrEqual(1);
      expect(payload.assessedDimensions).toContain("color");
      expect(payload.unassessedDimensions).toEqual([]);
      expect(payload.evidenceProvenance).toEqual([
        expect.objectContaining({
          kind: "static-scan",
          analyzed: true,
        }),
      ]);
      expect(payload.appliedScoreCaps).toEqual([]);
      expect(payload.summary.scannedFiles).toBe(1);
      expect(payload.summary.score).toBeLessThan(100);
      expect(payload.issues.some((issue: { id: string }) => issue.id === "color.raw-hex")).toBe(true);
      expect(payload.issues.find((issue: { id: string }) => issue.id === "color.raw-hex")).toMatchObject({
        normalizedId: "color.raw-hex",
      });
      expect(payload.ux.score).toBeLessThan(100);
      expect(payload.ux.assessedDimensions.length).toBeGreaterThan(0);
      expect(payload.ux.unassessedDimensions.length).toBeGreaterThan(0);
      expect(payload.ux.trapRisks.some((trap: { trapId: string }) => trap.trapId === "token-drift")).toBe(true);
      expect(process.exitCode ?? 0).toBe(0);
      await expect(access(join(root, ".memoire"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits read-only file-anchored SwiftUI findings without a nominal web score", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-diagnose-swiftui-"));
    try {
      await mkdir(join(root, "Sources"), { recursive: true });
      await writeFile(join(root, "Sources", "MotionView.swift"), `import SwiftUI
struct MotionView: View {
    var body: some View {
        Text("Motion")
            .phaseAnimator([false, true]) { view, active in
                view.opacity(active ? 1 : 0)
            }
    }
}
`, "utf-8");
      const logs = captureLogs();
      const program = new Command();
      registerDiagnoseCommand(program, { config: { projectRoot: root } } as never);

      await program.parseAsync(["diagnose", "--json", "--no-write", "--fail-on", "none"], { from: "user" });
      const payload = JSON.parse(lastLog(logs));
      const finding = payload.issues.find((issue: { id: string }) => issue.id === "swiftui.reduced-motion-missing");

      expect(payload.summary).toMatchObject({
        scannedFiles: 1,
        score: 0,
        verdict: "unassessed — SwiftUI coverage is partial",
      });
      expect(payload.assessedDimensions).toEqual([
        "swiftui.gesture-accessibility-action",
        "swiftui.reduced-motion",
      ]);
      expect(payload.unassessedDimensions).toContain("swiftui:whole-category-analysis");
      expect(payload.unassessedDimensions).toContain("swiftui:rendered-quality");
      expect(payload.unassessedDimensions).toContain("swiftui:runtime-accessibility");
      expect(payload.sourceCoverage.swiftui.analysis).toBe("partial");
      expect(finding).toMatchObject({
        normalizedId: "swiftui.reduced-motion-missing",
        affectedFiles: ["Sources/MotionView.swift"],
      });
      expect(finding.evidenceLocations[0]).toMatchObject({
        file: "Sources/MotionView.swift",
        line: 5,
      });
      expect(process.exitCode ?? 0).toBe(0);
      await expect(access(join(root, ".memoire"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("gates: exits non-zero on high-severity issues by default, including in --json mode", async () => {
    const root = await makeDebtRepo();
    try {
      captureLogs();
      const program = new Command();
      registerDiagnoseCommand(program, { config: { projectRoot: root } } as never);

      await program.parseAsync(["diagnose", "--json", "--no-write"], { from: "user" });
      // The fixture produces at least one high-severity issue; the default
      // --fail-on high gate must fire. (Pre-2.3 this gate required "critical",
      // which the engine never emits, and never ran in --json mode at all.)
      expect(process.exitCode).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("gates: --fail-on none disables the gate", async () => {
    const root = await makeDebtRepo();
    try {
      captureLogs();
      const program = new Command();
      registerDiagnoseCommand(program, { config: { projectRoot: root } } as never);

      await program.parseAsync(["diagnose", "--json", "--no-write", "--fail-on", "none"], { from: "user" });
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scopes emitted issues to --files while keeping whole-tree scores", async () => {
    const root = await makeDebtRepo();
    try {
      // Second file with no debt — scoping to it should hide the debt issues
      // from the emitted list while whole-tree scores still reflect them.
      await writeFile(join(root, "src", "app", "clean.tsx"), `
export function Clean() {
  return <p className="p-2">clean</p>;
}
`, "utf-8");

      const logs = captureLogs();
      const program = new Command();
      registerDiagnoseCommand(program, { config: { projectRoot: root } } as never);

      await program.parseAsync([
        "diagnose", "--json", "--no-write", "--fail-on", "none",
        "--files", "src/app/clean.tsx",
      ], { from: "user" });
      const payload = JSON.parse(lastLog(logs));

      expect(payload.scope).toMatchObject({
        requestedFiles: 1,
        expandedWithDependents: false,
      });
      // The raw-hex debt lives in page.tsx, out of scope → not emitted...
      expect(payload.issues.every((issue: { affectedFiles?: string[] }) =>
        (issue.affectedFiles ?? []).includes("src/app/clean.tsx") || false,
      )).toBe(true);
      // ...but whole-tree score still reflects it.
      expect(payload.summary.score).toBeLessThan(100);
      expect(payload.scope.filteredOutIssues).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an invalid --fail-on value", async () => {
    const root = await makeDebtRepo();
    try {
      const logs = captureLogs();
      const program = new Command();
      registerDiagnoseCommand(program, { config: { projectRoot: root } } as never);

      await program.parseAsync(["diagnose", "--json", "--no-write", "--fail-on", "sometimes"], { from: "user" });
      expect(process.exitCode).toBe(1);
      expect(lastLog(logs)).toContain("Invalid --fail-on value");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
