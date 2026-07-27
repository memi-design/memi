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
      '[[ ! "${RELEASE_TAG}" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+$ ]]',
    );
    expect(workflow).toContain('test "${manifest_version}" = "${package_version}"');
    expect(workflow).toContain('release_commit=${resolved_commit}');
    expect(workflow).toContain('git rev-parse "${RELEASE_TAG}^{commit}"');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$(git rev-parse "${RELEASE_TAG}^{commit}")"');
    expect(workflow).toMatch(
      /publish-docker:\n\s+needs: \[release-gate, publish-checksums\]/,
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
    expect(workflow).toContain("ghcr.io/sarveshsea/memi:${{ env.RELEASE_TAG }}");
    expect(workflow).toContain(
      "docker buildx imagetools create --tag ghcr.io/sarveshsea/memi:latest",
    );
    expect(workflow).not.toMatch(
      /tags:\s*\|[\s\S]*?ghcr\.io\/sarveshsea\/memi:latest[\s\S]*?ghcr\.io\/sarveshsea\/memi:\$\{\{ env\.RELEASE_TAG \}\}/,
    );
  });
});
