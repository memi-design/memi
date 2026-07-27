import { readFile } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("runtime release workflow", () => {
  it("names runtime resources from the runtime tag instead of the npm package version", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "runtime-release.yml"),
      "utf-8",
    );

    expect(workflow).toContain('VERSION="${TAG#runtime-v}"');
    expect(workflow).not.toContain('VERSION=$(node -p "require(\\\'./package.json\\\').version")');
    expect(workflow).not.toContain('VERSION=$(node -p "require(\'./package.json\').version")');
  });
});

describe("release binary workflow", () => {
  it("keeps platform optional packages available without bypassing the audit gate", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf-8",
    );

    expect(workflow).toContain("npm ci --include=optional --ignore-scripts");
    expect(workflow).toContain("esbuildPackage: darwin-x64");
    expect(workflow).toContain("esbuildPackage: win32-x64");
    expect(workflow).toContain("ESBUILD_VERSION=\"$(node -p \"require('./node_modules/vite/node_modules/esbuild/package.json').version\")\"");
    expect(workflow).toContain('npm install --no-save --package-lock=false --ignore-scripts "@esbuild/${{ matrix.esbuildPackage }}@${ESBUILD_VERSION}"');
    expect(workflow).not.toContain("SKIP_AUDIT_GATE");
  });

  it("supports repairing an existing release without moving its tag", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf-8",
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("release_tag:");
    expect(workflow).toContain("RELEASE_TAG:");
    expect(workflow).toContain("VERSION=${{ env.RELEASE_TAG }}");
    expect(workflow).not.toContain("VERSION=${{ github.ref_name }}");
  });

  it("fails when the Homebrew tap cannot be published", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf-8",
    );

    expect(workflow).toContain('node scripts/homebrew/update-formula.mjs --version="${VERSION}" --out=memoire.rb');
    expect(workflow).toContain('test -s memoire.rb');
    expect(workflow).toContain('echo "::error::HOMEBREW_TAP_TOKEN secret is required to publish the tap"');
    expect(workflow).not.toContain("skipping tap push");
  });

  it("installs the container entrypoint on the standard executable path", async () => {
    const dockerfile = await readFile(
      join(process.cwd(), "docker", "Dockerfile.binary"),
      "utf-8",
    );

    expect(dockerfile).toContain("ln -s /opt-design/cli/memi /usr/local/bin/memi");
    expect(dockerfile).not.toContain("/usr/local/bin-design/cli");
    expect(dockerfile).toContain('ENTRYPOINT ["memi"]');
  });
});
