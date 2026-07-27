# Release Gates

The generated [current release truth](./CURRENT_RELEASE.md) defines the active
engine, Studio, and website release groups. Do not infer parity from a single
package version.

The primary public story is: `Memi is the read-only design engineering audit and skill layer for coding agents.` Studio is a companion.

Use these checks before announcing, tagging, or publishing a public release.

## Canonical Release Manifest

`release-manifest.json` is the machine-readable source for the public engine,
npm package, GitHub release, GitHub Action, MCP server, Studio, and website
release groups. Do not start a release by editing downstream version copies.

```bash
# After reviewing and committing release-manifest.json:
npm run sync:release-manifest
npm run check:release-manifest
npm run check:release
```

The sync command writes
`release-artifacts/memoire-web.release.json`. Copy that file byte-for-byte to
`src/data/memi-release.generated.json` in `sarveshsea/memoire-web`; the website
derives CLI and Studio metadata from it and verifies its SHA-256 provenance
offline with `npm run check:release-manifest`. The export records the exact
Memi commit that contains the canonical manifest. Push that commit before
opening or refreshing the website pull request, then run the website's
`npm run check:public-release-manifest` network gate. That gate fetches the
immutable source manifest and verifies the tagged Memi release plus the exact
Studio arm64, x64, and checksum assets. Because the repositories publish
independently, the Memi source commit must be reachable before website CI runs,
and both pull requests must merge before the public-site gate is complete.

## Local Publish-Ready Gate

`npm run publish:ready` verifies the local package is safe to publish before npm mutates anything:

- npm auth is active for `https://registry.npmjs.org/` when the maintainer is
  deliberately checking account access. The authoritative publish path uses
  GitHub OIDC instead of a local token.
- `package.json`, `package-lock.json`, `server.json`, Codex plugin metadata, examples, and package docs use the same version.
- Local version is newer than npm `latest`.
- `server.json`, `dist/index.js`, `README.md`, `NOTICE`, Agent Skills, agent kits, and selected docs are present in the package tarball.
- The git worktree is clean.

```bash
npm run build
npm run check:release
npm run smoke:mcp
npm run smoke:codex-plugin
npm run pack:dry-run
npm run publish:ready
```

For a local release-prep pass where npm auth or git cleanliness is intentionally blocked:

```bash
MEMOIRE_PUBLISH_READY_SKIP_AUTH=1 MEMOIRE_PUBLISH_READY_SKIP_GIT=1 npm run publish:ready
npm publish --dry-run --access public --ignore-scripts --json
```

## Public npm Gate

`npm run check:public-release` verifies the live npm surface after publish:

- npm `dist-tags.latest` matches `package.json`.
- npm README includes `read-only design engineering audit and skill layer for coding agents`.
- npm README includes `npm i -g @memi-design/cli`.
- Website homepage still links to the npm package and does not contain stale Studio 1.0.4 copy.
- Website docs mention the current CLI version and do not contain the old `Current npm target: 0.14.1` line.
- Website changelog includes the current release.
- Website community Notes catalog contains at least five approved community Notes and was generated no earlier than July 4, 2026.
- A clean temp install can run `memi --version`.

The gate records every attempted stage in one JSON result. Registry, site, and
install checks run as independent stages; a network or runtime exception is
captured as a stage failure instead of hiding the other results. Unless
`SKIP_INSTALL_SMOKE=1` is set, the clean install smoke still runs when npm or
site parity fails.

```bash
npm run check:public-release
SKIP_INSTALL_SMOKE=1 npm run check:public-release
SKIP_SITE_SMOKE=1 npm run check:public-release # diagnostic only; never parity evidence
EXPECTED_STUDIO_VERSION=2.5.0 EXPECTED_COMMUNITY_NOTES=5 npm run check:public-release
```

For the current public engine line, npm must report the current `package.json` version and `memoire.cv` must show the same first-fold story before MCP Registry, Codex marketplace announcements, Product Hunt, or directory follow-up. `SKIP_SITE_SMOKE=1` is diagnostic only and never proves release parity.

## External Trust Gate

Before any public distribution push, verify every external surface points to the same current release story:

- npm latest: current `package.json` version, currently `2.6.2`
- npm README phrase: `read-only design engineering audit and skill layer for coding agents`
- npm install command: `npm i -g @memi-design/cli`
- MCP name: `io.github.sarveshsea/memi`
- Agent Skills command: `npx skills add sarveshsea/memi --skill memoire-design-tooling`
- Codex marketplace command: `codex plugin marketplace add sarveshsea/memi --ref main --sparse .agents/plugins --sparse plugins/memoire`
- GitHub description: `Memi is the read-only design engineering audit and skill layer for coding agents.`
- GitHub topics: `interface-understanding`, `design-system`, `shadcn-registry`, `tailwind-audit`, `ux-audit`, `mcp-server`, `agent-skills`, `codex-plugin`, `design-tokens`, `figma-to-code`
- Website hero or first-fold proof line: the current read-only audit story and current release metadata
- Website `/components`: non-empty registry catalog with npm install commands and shadcn item URLs
- Website `/notes/community/catalog.v1.json`: non-empty community Notes catalog with the public starter Notes

## Publish Sequence

The npm account owner must configure one npm trusted publisher for
`@memi-design/cli`:

- repository: `sarveshsea/memi`
- workflow: `publish.yml`
- permission: publish

Do not add a long-lived `NPM_TOKEN` fallback. Releases use a fail-closed
two-phase state machine:

1. Prepare and merge candidate commit X. Every version-bearing engine surface
   must use the new version. The manifest engine state is `candidate`, with
   `sourceCommit: null`, `releaseRecord: null`, and the previous public release
   identified separately. A candidate is unreleased and can never clear public
   parity or audit score caps.
2. Dispatch `Publish to npm` from `main` with `mode: publish` and the exact
   `expected_version`. The workflow proves the version is absent from npm before
   running the release suite and the single
   `npm publish --access public --provenance` operation.
3. The workflow verifies the downloaded tarball against npm integrity and
   shasum, verifies registry signatures and SLSA provenance, and emits an
   immutable release record. The record binds version, commit X, tarball
   digests, attestation, workflow run and attempt, CycloneDX SBOM digest, and
   npm's publish timestamp.
4. Publish the GitHub tag and checksummed assets from X, move the reviewed
   Action major tag to X, publish the matching MCP Registry record, and verify
   the pinned Studio release.
5. Download the workflow's release record to
   `release-artifacts/npm/<version>.release.json`. Configure the website's
   same-origin `releaseArtifactUrl`, then stage the post-publish manifest:

   ```bash
   node scripts/sync-release-manifest.mjs \
     --stage-published release-artifacts/npm/<version>.release.json
   ```

6. Commit that transition as Y. The transition gate requires the preceding
   manifest revision to be the same candidate version, proves X is an ancestor
   of Y, re-reads every version surface at X, and verifies the committed release
   record hash. Generate the website artifact from Y, deploy it, and run
   `npm run check:public-release`.
7. Merge or announce only when the live gate independently verifies npm
   provenance, the exact GitHub tag and binary checksums, Action `v2`, the MCP
   Registry, Studio assets, and the deployed website artifact. Published engine
   state is immutable.

If npm publish succeeds but evidence generation, a downstream surface, or the
website deployment fails, leave the manifest in candidate state. Dispatch the
same workflow with `mode: recover` and the original `source_run_id`. Recovery
also requires the original `source_run_attempt`; this prevents a later rerun
from being mistaken for the attempt that performed the publish. Recovery
validates that exact main-branch workflow attempt, downloads its attempt-bound
SBOM, verifies npm provenance still resolves X, and reconstructs the record.
Recovery must never republish an existing version; recovery mode is evidence
reconstruction only.

The post-publish gate must then prove all of the following before any
announcement:

- npm registry integrity, shasum, and package signature exist.
- SLSA provenance resolves the exact package digest, repository,
  `.github/workflows/publish.yml`, Git ref, and source commit.
- `npm audit signatures --include-attestations` succeeds in a clean consumer.
- The public README contains the primary story and install command.

If trusted publishing is missing or any post-publish verification fails, stop
the release in candidate state. Do not bypass the workflow with a desktop
publish.

Then verify the remaining public surfaces:

```bash
npm view @memi-design/cli version dist-tags.latest mcpName --json
mcp-publisher login github
mcp-publisher publish server.json
npm run check:public-release
```

Seven days after publish, compare metrics against [METRICS.md](./METRICS.md) and log the next distribution action before changing positioning again.
