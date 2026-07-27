import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerUxCommand } from "../ux.js";
import { captureLogs, lastLog } from "./test-helpers.js";

describe("memi ux audit", () => {
  it("emits stable UX tenets and traps JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-ux-command-"));
    try {
      await mkdir(join(root, "src", "app"), { recursive: true });
      await writeFile(join(root, "src", "app", "page.tsx"), `
export default function Page() {
  return <button onClick={() => null} className="bg-[#123456] p-[13px]">Start</button>;
}
`, "utf-8");

      const logs = captureLogs();
      const program = new Command();
      registerUxCommand(program, { config: { projectRoot: root } } as never);

      await program.parseAsync(["ux", "audit", "--json", "--no-write"], { from: "user" });
      const payload = JSON.parse(lastLog(logs));

      expect(payload.schemaVersion).toBe(2);
      expect(payload.confidence).toEqual(expect.any(Number));
      expect(payload.assessedDimensions).toContain("tenet:consistency");
      expect(payload.unassessedDimensions).toContain("tenet:feedback");
      expect(payload.evidenceProvenance).toEqual([
        expect.objectContaining({ kind: "static-scan", analyzed: true }),
      ]);
      expect(payload.appliedScoreCaps).toEqual([]);
      expect(payload.score).toBeLessThan(100);
      expect(payload.tenetCoverage.map((tenet: { tenetId: string }) => tenet.tenetId)).toContain("consistency");
      expect(payload.trapRisks.map((trap: { trapId: string }) => trap.trapId)).toContain("token-drift");
      expect(payload.recommendedTweaks.length).toBeGreaterThan(0);
      expect(payload.findings[0]).toEqual(expect.objectContaining({
        normalizedId: expect.any(String),
      }));
      await expect(access(join(root, ".memoire"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects screenshot audits when the screenshot artifact does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-ux-command-"));
    const previousExitCode = process.exitCode;
    try {
      const logs = captureLogs();
      const program = new Command();
      registerUxCommand(program, { config: { projectRoot: root } } as never);

      await program.parseAsync(["ux", "audit", "--json", "--no-write", "--screenshot", join(root, "missing.png")], { from: "user" });
      const payload = JSON.parse(lastLog(logs));

      expect(payload).toMatchObject({
        status: "failed",
        error: expect.stringContaining("Screenshot artifact is not readable"),
      });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not report an unanalyzed screenshot as a perfect audit", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-ux-screenshot-"));
    try {
      const screenshot = join(root, "screen.png");
      await writeFile(screenshot, "not-analyzed");
      const logs = captureLogs();
      const program = new Command();
      registerUxCommand(program, { config: { projectRoot: root } } as never);

      await program.parseAsync(["ux", "audit", "--json", "--no-write", "--screenshot", screenshot], { from: "user" });
      const payload = JSON.parse(lastLog(logs));

      expect(payload.score).toBe(0);
      expect(payload.confidence).toBe(0);
      expect(payload.assessedDimensions).toEqual([]);
      expect(payload.unassessedDimensions.length).toBeGreaterThan(0);
      expect(payload.appliedScoreCaps).toEqual([
        expect.objectContaining({ id: "no-analyzed-evidence", maximum: 0 }),
      ]);
      expect(payload.evidenceProvenance).toEqual([
        expect.objectContaining({ kind: "screenshot", analyzed: false }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves native partial-analysis caps when a screenshot is attached", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-ux-native-"));
    try {
      await mkdir(join(root, "Sources"), { recursive: true });
      await writeFile(join(root, "Sources", "View.swift"), "import SwiftUI\nstruct View: SwiftUI.View { var body: some SwiftUI.View { Text(\"Static\") } }\n");
      const screenshot = join(root, "screen.png");
      await writeFile(screenshot, "not-analyzed");
      const logs = captureLogs();
      const program = new Command();
      registerUxCommand(program, { config: { projectRoot: root } } as never);

      await program.parseAsync(["ux", "audit", ".", "--json", "--no-write", "--screenshot", screenshot], { from: "user" });
      const payload = JSON.parse(lastLog(logs));

      expect(payload.score).toBe(0);
      expect(payload.appliedScoreCaps).toEqual(expect.arrayContaining([
        expect.objectContaining({ maximum: 0 }),
      ]));
      expect(payload.assessedDimensions).not.toContain("tenet:consistency");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
