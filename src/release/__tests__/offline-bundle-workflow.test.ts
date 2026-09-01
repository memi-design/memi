import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = join(process.cwd(), ".github", "workflows", "release-binaries.yml");

describe("offline bundle release workflow", () => {
  it("builds the five explicit OS and architecture targets without replacing legacy assets", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    for (const contract of [
      ["darwin-arm64", "macos-14", "darwin-arm64"],
      ["darwin-x64", "macos-15-intel", "darwin-x64"],
      ["linux-arm64", "ubuntu-24.04-arm", "linux-arm64"],
      ["linux-x64", "ubuntu-latest", "linux-x64"],
      ["windows-x64", "windows-latest", "win32-x64"],
    ] as const) {
      const [target, runner, esbuildPackage] = contract;
      expect(workflow).toContain(`offlineTarget: ${target}`);
      expect(workflow).toContain(`runner: ${runner}`);
      expect(workflow).toContain(`esbuildPackage: ${esbuildPackage}`);
    }

    expect(workflow).toContain("node scripts/build-offline-bundle.mjs --target=${{ matrix.offlineTarget }}");
    expect(workflow).toContain("bun-version: 1.3.11");
    expect(workflow).not.toContain("bun-version: latest");
    expect(workflow).toContain("dist-bin/memi-offline-*.tar.gz");
    expect(workflow).toContain("dist-bin/memi-${{ matrix.binaryTarget }}.tar.gz");
    expect(workflow).toContain("dist-bin/memi-${{ matrix.binaryTarget }}.zip");
    expect(workflow).toMatch(/^ {6}id-token: write$/m);
    expect(workflow).toMatch(/^ {6}attestations: write$/m);
    expect(workflow).toContain(
      "uses: actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a",
    );
    expect(workflow).toContain("subject-path: dist-bin/memi-offline-*.tar.gz");
  });
});
