import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerReportCommand } from "../report.js";
import { captureLogs } from "./test-helpers.js";

describe("memi report evidence propagation", () => {
  it("keeps wholly unassessed caps in freshly rebuilt UX and craft artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-report-unassessed-"));
    try {
      await mkdir(join(root, "lib"), { recursive: true });
      await writeFile(join(root, "lib", "server.js"), "export const server = true;\n");
      captureLogs();
      const program = new Command();
      registerReportCommand(program, { config: { projectRoot: root } } as never);

      await program.parseAsync(["report", "--json", "--out", join(root, "out")], { from: "user" });
      const ux = JSON.parse(await readFile(join(root, ".memoire", "app-quality", "ux-audit.json"), "utf8"));
      const craft = JSON.parse(await readFile(join(root, ".memoire", "app-quality", "interface-craft.json"), "utf8"));

      for (const artifact of [ux, craft]) {
        expect(artifact.score).toBe(0);
        expect(artifact.assessedDimensions).toEqual([]);
        expect(artifact.appliedScoreCaps).toEqual(expect.arrayContaining([
          expect.objectContaining({ maximum: 0 }),
        ]));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
