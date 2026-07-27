import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerCiCommand } from "../ci.js";
import { captureLogs, lastLog } from "./test-helpers.js";

describe("memi ci coverage gate", () => {
  it("fails when the repository is wholly unassessed", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-ci-unassessed-"));
    const previousExitCode = process.exitCode;
    try {
      await mkdir(join(root, "lib"), { recursive: true });
      await writeFile(join(root, "lib", "server.js"), "export const server = true;\n");
      const logs = captureLogs();
      const program = new Command();
      registerCiCommand(program, { config: { projectRoot: root } } as never);

      await program.parseAsync(["ci", "--no-scope", "--fail-on", "none", "--json"], { from: "user" });
      const payload = JSON.parse(lastLog(logs));

      expect(payload.status).toBe("failed");
      expect(payload.gates.coverage).toEqual({
        failed: true,
        reason: "no design dimensions were assessed",
      });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(root, { recursive: true, force: true });
    }
  });
});
