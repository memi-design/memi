import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cleanup: string[] = [];
const repositoryRoot = process.cwd();
const tsxCli = resolve(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const memiCli = resolve(repositoryRoot, "src", "index.ts");

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("local profile command containment", () => {
  it("runs actual --profile local diagnose without creating legacy or local state", async () => {
    const fixture = await makeFixture("diagnose");

    const result = runMemi(fixture, [
      "--profile", "local",
      "diagnose", ".",
      "--json",
      "--fail-on", "none",
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ version: 1 });
    await expect(access(join(fixture.projectRoot, ".memoire"))).rejects.toThrow();
    await expect(access(join(fixture.projectRoot, ".memi"))).rejects.toThrow();
    await expect(access(join(fixture.homeDir, ".memoire"))).rejects.toThrow();
  });

  it("runs actual --profile local doctor --json without creating legacy or local state", async () => {
    const fixture = await makeFixture("doctor");

    const result = runMemi(fixture, [
      "--profile", "local",
      "doctor",
      "--json",
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      policy: { profile: "local" },
    });
    await expect(access(join(fixture.projectRoot, ".memoire"))).rejects.toThrow();
    await expect(access(join(fixture.projectRoot, ".memi"))).rejects.toThrow();
    await expect(access(join(fixture.homeDir, ".memoire"))).rejects.toThrow();
  });
});

async function makeFixture(label: string): Promise<{ projectRoot: string; homeDir: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), `memi-local-${label}-`));
  cleanup.push(projectRoot);
  const homeDir = join(projectRoot, "home");
  await Promise.all([
    mkdir(join(projectRoot, "src"), { recursive: true }),
    mkdir(homeDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(projectRoot, "package.json"), `${JSON.stringify({ name: `local-${label}-fixture`, private: true })}\n`, "utf8"),
    writeFile(join(projectRoot, "src", "index.ts"), "export const fixture = true;\n", "utf8"),
  ]);
  return { projectRoot, homeDir };
}

function runMemi(
  fixture: { projectRoot: string; homeDir: string },
  args: string[],
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [tsxCli, memiCli, ...args], {
    cwd: fixture.projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: fixture.homeDir,
      USERPROFILE: fixture.homeDir,
      NO_COLOR: "1",
    },
    timeout: 20_000,
  });
}
