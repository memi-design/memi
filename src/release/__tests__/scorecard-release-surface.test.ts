import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("audit scorecard release surfaces", () => {
  it("never skips the scorecard gate in tagged binary release jobs", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8",
    );

    expect(workflow).not.toContain("SKIP_AUDIT_GATE");
    expect(workflow.match(/npm run check:release/g)).toHaveLength(2);
  });

  it("restores exact Git archive bytes after install before Windows release verification", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8",
    );

    expect(workflow).toContain("if: runner.os == 'Windows'");
    expect(workflow).toContain("git config core.autocrlf false");
    expect(workflow).toContain("git archive --format=tar HEAD | tar --extract --file=-");
    expect(workflow).toContain("git diff --exit-code");
    const buildJobStart = workflow.indexOf("\n  build:");
    const installStart = workflow.indexOf(
      "Ensure platform esbuild binary",
      buildJobStart,
    );
    const restoreStart = workflow.indexOf(
      "git archive --format=tar HEAD | tar --extract --file=-",
      buildJobStart,
    );
    const releaseCheckStart = workflow.indexOf(
      "npm run check:release",
      buildJobStart,
    );
    expect(restoreStart).toBeGreaterThan(installStart);
    expect(restoreStart).toBeLessThan(releaseCheckStart);
  });

  it("scopes the historical Windows scorecard compatibility shim to v2.6.3", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      '[[ "${RUNNER_OS}" == "Windows" && "${RELEASE_TAG}" == "v2.6.3" ]]',
    );
    expect(workflow).toContain(
      "docs\\\\audits\\\\memi-100-scorecard.json",
    );
    expect(workflow).toMatch(
      /git archive --format=tar HEAD \\\s+docs\/audits\/memi-100-scorecard\.md \\\s+scripts\/check-release\.mjs/,
    );
    expect(workflow).toContain(
      'shell: process.platform === "win32"',
    );
  });

  it("repairs the immutable v2.6.4 Windows runtime-schema command without retagging", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      '[[ "${RUNNER_OS}" == "Windows" && "${RELEASE_TAG}" == "v2.6.4" ]]',
    );
    expect(workflow).toContain("v2.6.4 runtime schema compatibility precondition failed");
    expect(workflow).toContain(
      'const windowsRuntimeSchema = \'const runtimeSchema = spawnSync("npm", ["run", "check:runtime-schema"], {\\n  shell: process.platform === "win32",\\n  cwd: root,\';',
    );
    expect(workflow).toMatch(
      /git archive --format=tar HEAD scripts\/check-release\.mjs \| tar --extract --file=-/,
    );
  });

  it("uses URL-safe benchmark paths and repairs the immutable v2.7.0 Windows tag", async () => {
    const validator = await readFile(
      join(process.cwd(), "scripts", "validate-interface-benchmark.mjs"),
      "utf8",
    );
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8",
    );

    expect(validator).toContain('fileURLToPath(new URL("..", import.meta.url))');
    expect(validator).not.toContain('new URL("..", import.meta.url).pathname');
    expect(workflow).toContain(
      '[[ "${RUNNER_OS}" == "Windows" && "${RELEASE_TAG}" == "v2.7.0" ]]',
    );
    expect(workflow).toContain(
      "v2.7.0 interface benchmark path compatibility precondition failed",
    );
    expect(workflow).toMatch(
      /git archive --format=tar HEAD scripts\/validate-interface-benchmark\.mjs \| tar --extract --file=-/,
    );
  });

  it("executes npm audit through the Windows command shell", async () => {
    const releaseCheck = await readFile(
      join(process.cwd(), "scripts", "check-release.mjs"),
      "utf8",
    );

    expect(releaseCheck).toContain(
      'shell: process.platform === "win32"',
    );
  });

  it("resolves one version-matched tag commit for every binary release job", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8",
    );

    expect(workflow.match(/ref: \$\{\{ env\.RELEASE_TAG \}\}/g)).toHaveLength(1);
    expect(
      workflow.match(/ref: \$\{\{ needs\.release-gate\.outputs\.release_commit \}\}/g),
    ).toHaveLength(4);
    expect(workflow).toContain('test "${RELEASE_TAG}" = "v${package_version}"');
    expect(workflow).toContain(
      'node scripts/resolve-release-channel.mjs --tag "${RELEASE_TAG}" --github-output "${GITHUB_OUTPUT}"',
    );
    expect(workflow).toContain('test "${manifest_version}" = "${package_version}"');
    expect(workflow).toContain('release_commit=${resolved_commit}');
    expect(workflow).toContain('git rev-parse "${RELEASE_TAG}^{commit}"');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$(git rev-parse "${RELEASE_TAG}^{commit}")"');
    expect(workflow).toMatch(
      /publish-docker:\r?\n\s+needs: \[release-gate, publish-checksums\]/,
    );
  });

  it("repairs historical tags without downgrading mutable release channels", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "promote_channels: ${{ steps.resolve-release.outputs.promote_channels }}",
    );
    expect(workflow).toContain('if [ "${GITHUB_EVENT_NAME}" = "push" ]');
    expect(workflow).toContain('current_manifest_version="$(');
    expect(workflow).toContain(
      'git show "origin/${DEFAULT_BRANCH}:release-manifest.json"',
    );
    expect(workflow).toContain(
      'git merge-base --is-ancestor "${resolved_commit}" "origin/${DEFAULT_BRANCH}"',
    );
    expect(workflow).toContain(
      "if: needs.release-gate.outputs.promote_channels == 'true'",
    );
    expect(workflow).toContain("ghcr.io/memi-design/memi:${{ env.RELEASE_TAG }}");
    expect(workflow).toContain(
      "docker buildx imagetools create --tag ghcr.io/memi-design/memi:latest",
    );
    expect(workflow).not.toMatch(
      /tags:\s*\|[\s\S]*?ghcr\.io\/sarveshsea\/memi:latest[\s\S]*?ghcr\.io\/sarveshsea\/memi:\$\{\{ env\.RELEASE_TAG \}\}/,
    );
  });

  it("promotes a verified existing release without rebuilding immutable assets", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "promote-release.yml"),
      "utf8",
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("release_tag:");
    expect(workflow).toContain("packages: write");
    expect(workflow).toContain('git rev-parse "${RELEASE_TAG}^{commit}"');
    expect(workflow).toContain(
      'git merge-base --is-ancestor "${release_commit}" "origin/${DEFAULT_BRANCH}"',
    );
    expect(workflow).toContain(
      'test "${RELEASE_TAG}" = "v${current_package_version}"',
    );
    expect(workflow).toContain(
      'test "$(npm view @memi-design/cli version)" = "${RELEASE_TAG#v}"',
    );
    expect(workflow.indexOf("docker/login-action")).toBeLessThan(
      workflow.indexOf("Verify current immutable release"),
    );
    expect(workflow).toContain("gh release download");
    expect(workflow).toContain("sha256sum --check SHA256SUMS.txt");
    expect(workflow).toContain(
      "docker buildx imagetools create --tag ghcr.io/memi-design/memi:latest",
    );
    expect(workflow).toContain(
      'git tag --force "v${major}" "${RELEASE_COMMIT}"',
    );
    expect(workflow).toContain("gh release edit");
    expect(workflow).not.toContain("docker/build-push-action");
    expect(workflow).not.toContain("softprops/action-gh-release");
  });

  it("bounds and supersedes stalled clean-install matrix runs", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "clean-install.yml"),
      "utf8",
    );

    expect(workflow).toContain("concurrency:");
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("timeout-minutes: 30");
  });
});
