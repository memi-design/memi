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

Do not add a long-lived `NPM_TOKEN` fallback. After the reviewed release commit
is merged to `main`, dispatch the GitHub Actions workflow named
`Publish to npm` from `main` and supply the required `expected_version`. The
workflow refuses other refs, verifies the requested version, installs from the
lockfile, runs the release suite, uploads a CycloneDX SBOM, and calls
`npm publish --access public --provenance`.

The post-publish gate must then prove all of the following before any
announcement:

- npm registry integrity, shasum, and package signature exist.
- SLSA provenance resolves the exact package digest, repository,
  `.github/workflows/publish.yml`, Git ref, and source commit.
- `npm audit signatures --include-attestations` succeeds in a clean consumer.
- The public README contains the primary story and install command.

If trusted publishing is missing or any post-publish verification fails, stop
the release. Do not bypass the workflow with a desktop publish.

Then verify the remaining public surfaces:

```bash
npm view @memi-design/cli version dist-tags.latest mcpName --json
mcp-publisher login github
mcp-publisher publish server.json
npm run check:public-release
```

Seven days after publish, compare metrics against [METRICS.md](./METRICS.md) and log the next distribution action before changing positioning again.
