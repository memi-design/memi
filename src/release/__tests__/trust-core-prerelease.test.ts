import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveNpmReleaseChannel,
  validateRegistryVersion,
} from "../../../scripts/lib/npm-release-verification.mjs";

const betaVersion = "2.8.0-beta.1";
const stableVersion = "2.7.9";

describe("Trust Core npm prerelease channel", () => {
  it("maps only the exact Trust Core beta to next while preserving latest", () => {
    expect(resolveNpmReleaseChannel(betaVersion)).toEqual({
      distTag: "next",
      expectedLatest: stableVersion,
      isPrerelease: true,
    });

    expect(resolveNpmReleaseChannel(stableVersion)).toEqual({
      distTag: "latest",
      expectedLatest: stableVersion,
      isPrerelease: false,
    });

    for (const version of [
      "2.8.0-beta.2",
      "2.8.0-rc.1",
      "v2.8.0-beta.1",
      "2.8",
      "latest",
    ]) {
      expect(() => resolveNpmReleaseChannel(version)).toThrow(
        "unsupported npm release version",
      );
    }
  });

  it("accepts beta metadata only when next is beta and latest stays 2.7.9", () => {
    const metadata = {
      "dist-tags": { latest: stableVersion, next: betaVersion },
      readme: "The design layer for agentic AI.\nnpm i -g @memi-design/cli",
      versions: {
        [betaVersion]: {
          dist: {
            integrity: `sha512-${Buffer.alloc(64, 0xab).toString("base64")}`,
            shasum: "b".repeat(40),
            signatures: [{ keyid: "fixture-key", sig: "fixture-signature" }],
          },
        },
      },
    };

    expect(validateRegistryVersion({
      metadata,
      packageName: "@memi-design/cli",
      expectedVersion: betaVersion,
      expectedPhrase: "The design layer for agentic AI.",
      expectedInstall: "npm i -g @memi-design/cli",
      expectedDistTag: "next",
      expectedLatest: stableVersion,
      requireProvenance: false,
    })).toMatchObject({
      distTag: "next",
      latest: stableVersion,
    });

    expect(() => validateRegistryVersion({
      metadata: {
        ...metadata,
        "dist-tags": { latest: betaVersion, next: betaVersion },
      },
      packageName: "@memi-design/cli",
      expectedVersion: betaVersion,
      expectedPhrase: "The design layer for agentic AI.",
      expectedInstall: "npm i -g @memi-design/cli",
      expectedDistTag: "next",
      expectedLatest: stableVersion,
      requireProvenance: false,
    })).toThrow("expected latest 2.7.9");
  });

  it("publishes the exact beta only through the next tag", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "publish.yml"),
      "utf8",
    );

    expect(workflow).toContain("inputs.expected_version == '2.8.0-beta.1'");
    expect(workflow).toContain(
      "npm publish --access public --provenance --ignore-scripts --tag next",
    );
    expect(workflow).toContain("inputs.expected_version != '2.8.0-beta.1'");
    expect(workflow).toContain(
      "npm publish --access public --provenance --ignore-scripts",
    );
    expect(workflow).not.toContain("--tag latest");
  });
});

describe("Trust Core binary prerelease isolation", () => {
  it("builds the exact beta as a GitHub prerelease without mutable promotions", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8",
    );

    expect(workflow).toContain('elif [ "${RELEASE_TAG}" = "v2.8.0-beta.1" ]; then');
    expect(workflow).toContain("is_prerelease=true");
    expect(workflow).toContain(
      "is_prerelease: ${{ steps.resolve-release.outputs.is_prerelease }}",
    );
    expect(workflow.match(/prerelease: \$\{\{ needs\.release-gate\.outputs\.is_prerelease == 'true' \}\}/g))
      .toHaveLength(2);
    expect(workflow.match(/make_latest: \$\{\{ needs\.release-gate\.outputs\.is_prerelease == 'true' && 'false' \|\| 'legacy' \}\}/g))
      .toHaveLength(2);
    expect(workflow).toMatch(
      /publish-docker:\r?\n\s+needs: \[release-gate, publish-checksums\]\r?\n\s+if: needs\.release-gate\.outputs\.is_prerelease != 'true'/,
    );
    expect(workflow).toMatch(
      /publish-homebrew:\r?\n\s+needs: \[release-gate, publish-checksums\]\r?\n\s+if: needs\.release-gate\.outputs\.promote_channels == 'true' && needs\.release-gate\.outputs\.is_prerelease != 'true'/,
    );
  });

  it("keeps manual channel promotion stable-only", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "promote-release.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      '[[ ! "${RELEASE_TAG}" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+$ ]]',
    );
    expect(workflow).toContain('isPrerelease --jq .isPrerelease)" = "false"');
    expect(workflow).toContain(
      "docker buildx imagetools create --tag ghcr.io/memi-design/memi:latest",
    );
    expect(workflow).toContain('git tag --force "v${major}" "${RELEASE_COMMIT}"');
  });
});
