import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const action = readFileSync(join(process.cwd(), "action.yml"), "utf8")
  .replace(/\r\n/g, "\n");
const packageVersion = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version as string;

function runBlocks(source: string): string[] {
  return [...source.matchAll(/^\s+run:\s*\|\n((?:\s{8}.*(?:\n|$))*)/gm)].map(
    ([, block]) => block,
  );
}

describe("GitHub Action distribution contract", () => {
  it("keeps the backward-compatible design CI inputs and pins the release CLI", () => {
    expect(action).toMatch(/^name: ["']?memi design CI["']?$/m);
    expect(action).toContain(`default: "${packageVersion}"`);

    for (const input of [
      "version",
      "fail-on",
      "base",
      "target",
      "report",
      "upload-sarif",
    ]) {
      expect(action).toMatch(new RegExp(`^  ${input}:$`, "m"));
    }

    expect(action).toContain('"@memi-design/cli@$INPUT_VERSION"');
    expect(action).toContain('installed_version" != "$INPUT_VERSION');
    expect(action).toContain("version must be an exact semantic version");
    expect(action).not.toMatch(/@memi-design\/cli@(latest|next|\$\{\{)/);
  });

  it("declares stable machine-readable outputs and useful artifacts", () => {
    for (const output of [
      "cli-version",
      "gate-outcome",
      "sarif-path",
      "report-path",
      "artifact-id",
      "artifact-url",
    ]) {
      expect(action).toMatch(new RegExp(`^  ${output}:$`, "m"));
    }

    for (const artifact of [
      ".memoire/app-quality/diagnosis.json",
      ".memoire/app-quality/diagnosis.md",
      ".memoire/app-quality/memi-results.sarif",
      ".memoire/app-quality/design-health.html",
      ".memoire/app-quality/design-health.md",
      ".memoire/app-quality/design-health-badge.svg",
    ]) {
      expect(action).toContain(artifact);
    }

    expect(action).toContain("if-no-files-found: warn");
  });

  it("treats workflow inputs as data and uses fail-fast Bash", () => {
    const scripts = runBlocks(action);

    expect(scripts.length).toBeGreaterThanOrEqual(3);
    for (const script of scripts) {
      expect(script).toContain("set -euo pipefail");
      expect(script).not.toContain("${{ inputs.");
      expect(script).not.toContain("${{ inputs[");
    }

    expect(action).toContain('args+=(--fail-on "$INPUT_FAIL_ON")');
    expect(action).toContain('args+=(--base "$INPUT_BASE")');
    expect(action).toContain('args+=(-- "$INPUT_TARGET")');
    expect(action).toContain('memi "${args[@]}"');
  });

  it("does not accept secrets or enable telemetry", () => {
    expect(action).not.toMatch(/^  (token|api-key|secret):$/m);
    expect(action).not.toContain("secrets.");
    expect(action).not.toContain("FIGMA_TOKEN");
    expect(action).not.toContain("GITHUB_TOKEN");
    expect(action).toContain('DO_NOT_TRACK: "1"');
    expect(action).toContain('MEMI_TELEMETRY_DISABLED: "1"');
  });

  it("pins every third-party action to an immutable commit", () => {
    const uses = [...action.matchAll(/^\s+(?:- )?uses: ([^\s#]+)(?:\s+#.*)?$/gm)].map(
      ([, value]) => value,
    );

    expect(uses).toHaveLength(3);
    for (const value of uses) {
      expect(value).toMatch(/^[^@]+@[0-9a-f]{40}$/);
    }
  });
});
