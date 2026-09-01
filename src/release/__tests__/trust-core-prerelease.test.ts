import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveReleaseChannel,
  validateRegistryVersion,
} from "../../../scripts/lib/npm-release-verification.mjs";

const betaVersion = "2.8.0-beta.1";
const stableVersion = "2.7.9";

describe("Trust Core release channel policy", () => {
  it.each([
    betaVersion,
    "2.8.0-beta.2",
    "2.8.0-rc.1",
    "2.8.0-alpha",
    "2.8.0-0",
    "2.8.0-beta.2+build.7",
  ])("routes valid prerelease %s through isolated prerelease channels", (version) => {
    expect(resolveReleaseChannel({
      version,
      previousPublicRelease: stableVersion,
    })).toEqual({
      version,
      distTag: "next",
      expectedLatest: stableVersion,
      isPrerelease: true,
      githubPrerelease: true,
      githubMakeLatest: "false",
      promoteStableChannels: false,
    });
  });

  it("keeps exact stable SemVer behavior unchanged", () => {
    expect(resolveReleaseChannel({
      version: stableVersion,
      previousPublicRelease: "2.7.8",
    })).toEqual({
      version: stableVersion,
      distTag: "latest",
      expectedLatest: stableVersion,
      isPrerelease: false,
      githubPrerelease: false,
      githubMakeLatest: "legacy",
      promoteStableChannels: true,
    });
  });

  it.each([
    "v2.8.0-beta.1",
    "2.8",
    "2.8.0-",
    "2.8.0-beta..1",
    "2.8.0-01",
    "02.8.0-beta.1",
    "latest",
    "",
  ])("fails closed for invalid release version %j", (version) => {
    expect(() => resolveReleaseChannel({
      version,
      previousPublicRelease: stableVersion,
    })).toThrow("unsupported release version");
  });

  it.each([undefined, "", "2.8.0-rc.1", "v2.7.9", "2.7"])(
    "fails closed when prerelease latest cannot be preserved from %j",
    (previousPublicRelease) => {
      expect(() => resolveReleaseChannel({
        version: "2.8.0-rc.1",
        previousPublicRelease,
      })).toThrow("valid stable previousPublicRelease");
    },
  );

  it("accepts prerelease metadata only when next is the candidate and latest stays stable", () => {
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

  it("emits fail-closed GitHub outputs for any valid prerelease tag", async () => {
    const temp = await mkdtemp(join(tmpdir(), "memi-release-channel-"));
    const outputPath = join(temp, "github-output");
    try {
      const result = spawnSync(process.execPath, [
        join(process.cwd(), "scripts", "resolve-release-channel.mjs"),
        "--tag",
        "v2.8.0-rc.1",
        "--github-output",
        outputPath,
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
      });

      expect(result.status, result.stderr).toBe(0);
      expect(await readFile(outputPath, "utf8")).toBe([
        "release_version=2.8.0-rc.1",
        "npm_dist_tag=next",
        "expected_latest=2.7.9",
        "is_prerelease=true",
        "github_prerelease=true",
        "github_make_latest=false",
        "promote_stable_channels=false",
        "",
      ].join("\n"));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("returns nonzero before emitting outputs for an invalid release tag", async () => {
    const temp = await mkdtemp(join(tmpdir(), "memi-release-channel-"));
    const outputPath = join(temp, "github-output");
    try {
      const result = spawnSync(process.execPath, [
        join(process.cwd(), "scripts", "resolve-release-channel.mjs"),
        "--tag",
        "v2.8.0-01",
        "--github-output",
        outputPath,
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("unsupported release version");
      await expect(readFile(outputPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("drives npm publishing from the shared channel helper", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "publish.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      'node scripts/resolve-release-channel.mjs --version "${EXPECTED_VERSION}" --github-output "${GITHUB_OUTPUT}"',
    );
    expect(workflow).toContain(
      "NPM_DIST_TAG: ${{ steps.release-channel.outputs.npm_dist_tag }}",
    );
    expect(workflow).toContain(
      'npm publish --access public --provenance --ignore-scripts --tag "${NPM_DIST_TAG}"',
    );
    expect(workflow).not.toContain("inputs.expected_version == '2.8.0-beta.1'");
    expect(workflow).not.toContain("inputs.expected_version != '2.8.0-beta.1'");
  });
});

describe("Trust Core binary prerelease isolation", () => {
  it("drives GitHub release and promotion policy from the shared channel helper", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release-binaries.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      'node scripts/resolve-release-channel.mjs --tag "${RELEASE_TAG}" --github-output "${GITHUB_OUTPUT}"',
    );
    expect(workflow).not.toContain('"v2.8.0-beta.1"');
    expect(workflow).toContain(
      "is_prerelease: ${{ steps.release-channel.outputs.is_prerelease }}",
    );
    expect(workflow).toContain(
      "github_make_latest: ${{ steps.release-channel.outputs.github_make_latest }}",
    );
    expect(workflow).toContain(
      "promote_stable_channels: ${{ steps.release-channel.outputs.promote_stable_channels }}",
    );
    expect(workflow.match(/prerelease: \$\{\{ needs\.release-gate\.outputs\.is_prerelease == 'true' \}\}/g))
      .toHaveLength(2);
    expect(workflow.match(/make_latest: \$\{\{ needs\.release-gate\.outputs\.github_make_latest \}\}/g))
      .toHaveLength(2);
    expect(workflow).toMatch(
      /publish-docker:\r?\n\s+needs: \[release-gate, publish-checksums\]\r?\n\s+if: needs\.release-gate\.outputs\.promote_stable_channels == 'true'/,
    );
    expect(workflow).toMatch(
      /publish-homebrew:\r?\n\s+needs: \[release-gate, publish-checksums\]\r?\n\s+if: needs\.release-gate\.outputs\.promote_channels == 'true' && needs\.release-gate\.outputs\.promote_stable_channels == 'true'/,
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
