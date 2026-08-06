import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseSkillMarkdown } from "../frontmatter.js";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const capsuleBudgetBytes = 4_096;
const expectedSkills = [
  {
    id: "map-design-system",
    activateOn: "component-creation",
    taskClasses: ["design-system-map", "component-map", "token-map"],
  },
  {
    id: "implement-adaptive-interface",
    activateOn: "design-creation",
    taskClasses: ["responsive-layout", "adaptive-interaction", "interface-state-implementation"],
  },
  {
    id: "verify-interface-accessibility",
    activateOn: "design-review",
    taskClasses: ["accessibility-check", "keyboard-focus-verification", "semantic-interface-verification"],
  },
] as const;

describe("frontend execution skill capsules", () => {
  it("registers independently routable built-in skills with exact task classes", async () => {
    const registry = JSON.parse(
      await readFile(join(projectRoot, "skills", "registry.json"), "utf8"),
    ) as { skills: Array<Record<string, unknown>> };

    for (const expected of expectedSkills) {
      expect(registry.skills).toContainEqual(expect.objectContaining({
        id: expected.id,
        file: `skills/${expected.id}/SKILL.md`,
        activateOn: expected.activateOn,
        taskClasses: [...expected.taskClasses],
      }));
    }

    expect(new Set(expectedSkills.map((skill) => skill.activateOn)).size).toBe(expectedSkills.length);
  });

  it("keeps every skill self-contained and within the focused capsule budget", async () => {
    for (const expected of expectedSkills) {
      const source = await readFile(
        join(projectRoot, "skills", expected.id, "SKILL.md"),
        "utf8",
      );
      const parsed = parseSkillMarkdown(source);

      expect(parsed.frontmatter).toEqual({
        name: expected.id,
        description: expect.any(String),
      });
      expect(Buffer.byteLength(source, "utf8")).toBeLessThanOrEqual(capsuleBudgetBytes);
      expect(parsed.body).toContain("## Route Contract");
      expect(parsed.body).toContain("## Repository Preconditions");
      expect(parsed.body).toContain("## Required Evidence");
      expect(parsed.body).toContain("## Verification Commands");
      expect(parsed.body).toContain("## Stop And Fallback");
      for (const taskClass of expected.taskClasses) expect(parsed.body).toContain(`\`${taskClass}\``);
    }
  });

  it("ships every capsule and its agent metadata in the npm package", async () => {
    const { stdout } = await execFileAsync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 },
    );
    const pack = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = new Set(pack[0]?.files.map((file) => file.path));

    for (const expected of expectedSkills) {
      expect(files).toContain(`skills/${expected.id}/SKILL.md`);
      expect(files).toContain(`skills/${expected.id}/agents/openai.yaml`);
    }
  });
});
