import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseSkillMarkdown } from "../../notes/frontmatter.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const exporterPath = join(repoRoot, "scripts", "export-focused-skills.mjs");
const focusedSkills = [
  "audit-frontend-design",
  "enforce-design-ci",
  "remember-design-system",
];

describe("focused skill export", () => {
  it("exports each focused skill as a valid standalone package with provenance", async () => {
    const outputRoot = await makeTempDirectory("focused-skill-export-");

    try {
      await runExporter("--out-root", outputRoot, "--include-memi-enhancement");

      const expectedFiles = focusedSkills.flatMap((name) => [
          `${name}/LICENSE`,
          `${name}/README.md`,
          `${name}/SKILL.md`,
          `${name}/SOURCE.json`,
          `${name}/package.json`,
        ]).sort((left, right) => left.localeCompare(right));
      expect(await sortedFiles(outputRoot)).toEqual(expectedFiles);

      for (const name of focusedSkills) {
        const skill = await readFile(join(outputRoot, name, "SKILL.md"), "utf8");
        const parsed = parseSkillMarkdown(skill);
        const packageJson = JSON.parse(await readFile(join(outputRoot, name, "package.json"), "utf8"));
        const source = JSON.parse(await readFile(join(outputRoot, name, "SOURCE.json"), "utf8"));
        const readme = await readFile(join(outputRoot, name, "README.md"), "utf8");

        expect(parsed.frontmatter).toMatchObject({ name });
        expect(parsed.frontmatter.description).toEqual(expect.any(String));
        expect(parsed.body.trim()).not.toBe("");
        expect(skill).toContain("## Optional Memi enhancements");
        expect(packageJson).toMatchObject({
          name: `@memi-design/skill-${name}`,
          private: true,
          files: ["SKILL.md", "README.md", "SOURCE.json", "LICENSE"],
        });
        expect(source).toMatchObject({
          skill: name,
          sourcePath: `skills/${name}/SKILL.md`,
          sourceRepository: "https://github.com/memi-design/memi",
        });
        expect(readme).toContain(`# ${name}`);
        expect(readme).toContain("npx skills add");
        expect(readme).toContain("SOURCE.json");
        expect(await readFile(join(outputRoot, name, "LICENSE"), "utf8")).toContain("MIT License");
      }
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("produces byte-identical output across runs", async () => {
    const firstRoot = await makeTempDirectory("focused-skill-export-first-");
    const secondRoot = await makeTempDirectory("focused-skill-export-second-");

    try {
      await runExporter("--out-root", firstRoot, "--no-memi-enhancement");
      await runExporter("--out-root", secondRoot, "--no-memi-enhancement");

      const firstFiles = await sortedFiles(firstRoot);
      const secondFiles = await sortedFiles(secondRoot);
      expect(secondFiles).toEqual(firstFiles);
      for (const relativePath of firstFiles) {
        expect(await readFile(join(secondRoot, relativePath))).toEqual(
          await readFile(join(firstRoot, relativePath)),
        );
      }
    } finally {
      await Promise.all([
        rm(firstRoot, { recursive: true, force: true }),
        rm(secondRoot, { recursive: true, force: true }),
      ]);
    }
  });

  it("supports one skill without adding Memi language to the base export", async () => {
    const outputRoot = await makeTempDirectory("focused-skill-export-subset-");

    try {
      await runExporter(
        "--out-root", outputRoot,
        "--skills", "remember-design-system",
        "--no-memi-enhancement",
      );

      expect(await readdir(outputRoot)).toEqual(["remember-design-system"]);
      const exported = await readFile(join(outputRoot, "remember-design-system", "SKILL.md"), "utf8");
      const source = await readFile(join(repoRoot, "skills", "remember-design-system", "SKILL.md"), "utf8");
      expect(exported).toBe(source);
      expect(exported).not.toContain("## Optional Memi enhancements");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("normalizes a source repository clone URL without duplicating .git", async () => {
    const outputRoot = await makeTempDirectory("focused-skill-export-source-");

    try {
      await runExporter(
        "--out-root", outputRoot,
        "--skills", "audit-frontend-design",
        "--source-repository", "https://github.com/example/design-skills.git",
      );

      const packageJson = JSON.parse(await readFile(
        join(outputRoot, "audit-frontend-design", "package.json"),
        "utf8",
      ));
      const source = JSON.parse(await readFile(
        join(outputRoot, "audit-frontend-design", "SOURCE.json"),
        "utf8",
      ));
      expect(packageJson.repository.url).toBe("https://github.com/example/design-skills.git");
      expect(source.sourceRepository).toBe("https://github.com/example/design-skills");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("rejects an unknown skill before writing output", async () => {
    const outputRoot = await makeTempDirectory("focused-skill-export-invalid-");

    try {
      await expect(runExporter("--out-root", outputRoot, "--skills", "missing-skill"))
        .rejects.toThrow("Unknown focused skill");
      expect(await readdir(outputRoot)).toEqual([]);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});

async function runExporter(...args: string[]): Promise<void> {
  await execFileAsync(process.execPath, [exporterPath, ...args], { cwd: repoRoot });
}

async function makeTempDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function sortedFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = (await readdir(join(root, prefix), { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await sortedFiles(root, relativePath));
    else files.push(relativePath);
  }

  return files;
}
