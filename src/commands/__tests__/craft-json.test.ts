import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerCraftCommand } from "../craft.js";
import { captureLogs, lastLog } from "./test-helpers.js";

describe("memi craft audit", () => {
  it("emits a stable interface craft report from local app evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-craft-command-"));
    try {
      await mkdir(join(root, "src", "app"), { recursive: true });
      await writeFile(join(root, "src", "app", "page.tsx"), `
export default function Page() {
  return <main className="bg-[#101010] p-[17px] text-[13px]"><button className="rounded-[9px] px-[11px]">Ship</button></main>;
}
`, "utf-8");

      const logs = captureLogs();
      const program = new Command();
      registerCraftCommand(program, { config: { projectRoot: root } } as never);

      await program.parseAsync(["craft", "audit", "--json", "--no-write"], { from: "user" });
      const payload = JSON.parse(lastLog(logs));

      expect(payload.schemaVersion).toBe(2);
      expect(payload.confidence).toEqual(expect.any(Number));
      expect(payload.assessedDimensions).toContain("spacing-rhythm");
      expect(payload.unassessedDimensions).toContain("motion-restraint");
      expect(payload.evidenceProvenance).toEqual([
        expect.objectContaining({ kind: "static-scan", analyzed: true }),
      ]);
      expect(payload.appliedScoreCaps).toEqual([]);
      expect(payload.score).toBeLessThan(100);
      expect(payload.dimensions.map((dimension: { dimensionId: string }) => dimension.dimensionId)).toContain("spacing-rhythm");
      expect(payload.findings.length).toBeGreaterThan(0);
      expect(payload.findings[0]).toEqual(expect.objectContaining({
        normalizedId: expect.any(String),
      }));
      expect(payload.critique).toMatchObject({
        visualDesign: expect.any(String),
        interfaceDesign: expect.any(String),
        consistencyAndConventions: expect.any(String),
        userContext: expect.any(String),
      });
      expect(payload.topOpportunities.length).toBeGreaterThan(0);
      await expect(access(join(root, ".memoire"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
