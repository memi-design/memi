import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  benchmarkRepositoryStatus,
  buildCodexCasePrompt,
  buildIsolatedCodexEnvironment,
} from "../codex-runner.js";

const execFileAsync = promisify(execFile);

const task = {
  id: "design-system-map",
  intent: "Map the repository design system with exact evidence.",
  rubric: {
    minimumValidCitations: 6,
    requiredTerms: [
      "color",
      "typography",
      "spacing",
      "radius",
      "elevation",
      "component",
    ],
  },
} as const;

describe("Codex paired benchmark prompt", () => {
  it("keeps behavioral and output constraints identical across conditions", () => {
    const baseline = buildCodexCasePrompt(task, {
      condition: "baseline",
      memiCliPath: "/candidate/dist/index.js",
    });
    const memi = buildCodexCasePrompt(task, {
      condition: "memi",
      memiCliPath: "/candidate/dist/index.js",
    });

    for (const shared of [
      task.intent,
      "Do not run unrelated tests",
      "at least 6 distinct source-line citations",
      "color, typography, spacing, radius, elevation, component",
      "Work alone and do not delegate",
      "Do not load user-installed skills",
      "Use repository-relative Markdown links",
    ]) {
      expect(baseline).toContain(shared);
      expect(memi).toContain(shared);
    }
    expect(baseline).toContain("Do not use Memi");
    expect(baseline).not.toContain("--agent-context");
    expect(memi).toContain(
      "node /candidate/dist/index.js diagnose . --agent-context",
    );
    expect(memi).toContain(
      "Treat sourceExcerpts as line-numbered source evidence",
    );
    expect(memi).toContain("Read routing first");
  });

  it("isolates both Codex and user-home discovery from ambient skills", () => {
    const environment = buildIsolatedCodexEnvironment(
      {
        HOME: "/Users/example",
        CODEX_HOME: "/Users/example/.codex",
        CODEX_THREAD_ID: "ambient-thread",
        PATH: "/usr/bin",
      },
      "/private/tmp/memi-isolated",
    );

    expect(environment).toMatchObject({
      HOME: "/private/tmp/memi-isolated",
      CODEX_HOME: "/private/tmp/memi-isolated",
      PATH: "/usr/bin",
    });
    expect(environment).not.toHaveProperty("CODEX_THREAD_ID");
  });

  it("ignores Memi-owned benchmark metadata but rejects source changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-codex-status-"));
    try {
      await execFileAsync("git", ["init", "-q"], { cwd: root });
      await execFileAsync("git", ["config", "user.email", "benchmark@example.invalid"], { cwd: root });
      await execFileAsync("git", ["config", "user.name", "Benchmark"], { cwd: root });
      await writeFile(path.join(root, "App.tsx"), "export const App = () => <main />;\n");
      await execFileAsync("git", ["add", "App.tsx"], { cwd: root });
      await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: root });
      await mkdir(path.join(root, ".memoire"), { recursive: true });
      await writeFile(path.join(root, ".memoire", "project.json"), "{}\n");

      await expect(benchmarkRepositoryStatus(root)).resolves.toBe("");

      await writeFile(path.join(root, "App.tsx"), "export const App = () => <aside />;\n");
      await expect(benchmarkRepositoryStatus(root)).resolves.toContain("App.tsx");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
