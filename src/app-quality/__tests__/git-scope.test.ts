import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expandScopeWithDependents, resolveGitScope } from "../git-scope.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("git audit scope", () => {
  it("resolves committed, modified, and untracked files against a merge base", async () => {
    const root = await makeRepository();
    await writeFile(join(root, "src", "button.ts"), "export const button = 'ruby';\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "feat: update button");
    await writeFile(join(root, "src", "index.ts"), "export * from './button.js';\n");
    await writeFile(join(root, "src", "new.ts"), "export const newFile = true;\n");

    const scope = await resolveGitScope({
      projectRoot: root,
      base: "main",
    });

    expect(scope.base).toBe("main");
    expect(scope.mergeBase).toMatch(/^[a-f0-9]{40}$/);
    expect(scope.files).toEqual([
      "src/button.ts",
      "src/index.ts",
      "src/new.ts",
    ]);

    const committedOnly = await resolveGitScope({
      projectRoot: root,
      base: "main",
      includeWorkingTree: false,
    });
    expect(committedOnly.files).toEqual(["src/button.ts"]);
  });

  it("returns a useful shallow or missing-base error instead of silently passing an empty audit", async () => {
    const root = await makeRepository();
    await expect(resolveGitScope({
      projectRoot: root,
      base: "origin/missing",
    })).rejects.toThrow(/Cannot resolve merge base.*fetch-depth: 0/s);
  });

  it("expands changed files with one-hop dependents and returns sorted unique paths", () => {
    expect(expandScopeWithDependents(
      ["src/button.ts", "src/button.ts"],
      [
        { path: "src/button.ts", importedBy: ["src/page.ts", "src/form.ts"] },
        { path: "src/page.ts", importedBy: ["src/app.ts"] },
      ],
    )).toEqual([
      "src/button.ts",
      "src/form.ts",
      "src/page.ts",
    ]);
  });
});

async function makeRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memi-git-scope-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Memi Test");
  await git(root, "config", "user.email", "memi-test@example.com");
  await writeFile(join(root, "src", "button.ts"), "export const button = true;\n");
  await writeFile(join(root, "src", "index.ts"), "export { button } from './button.js';\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "chore: initial fixture");
  await git(root, "checkout", "-b", "feature");
  return root;
}

async function git(root: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: root });
}
