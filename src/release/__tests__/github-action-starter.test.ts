import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");

describe("GitHub Action starter workflow", () => {
  it("teaches a pinned, least-privilege public setup", async () => {
    const workflow = await readFile(join(root, "examples/github-actions/memi-design.yml"), "utf8");

    expect(workflow).toContain("on:\n  pull_request:");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    );
    expect(workflow).toContain(
      "memi-design/memi@74fc6ce8c66182b4aa06e1250cb169da8b1fc54c",
    );
    expect(workflow).toContain('version: "2.7.7"');
    expect(workflow).toContain('report: "true"');
    expect(workflow).toContain('upload-sarif: "true"');
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d/);
  });
});
