# Memi public parity check

Verified: 2026-07-26

## Verdict

Public release parity is still not achieved.

The engine release is live at `2.6.2`, the Studio release is live at `2.5.0`,
and repo-local release checks pass. The published npm README and deployed
website do not yet carry the primary read-only design-engineering story, and
the website is also behind on CLI, Studio, docs, and changelog versions.
Therefore the scorecard cap for public version drift cannot clear.

## Local checks from the source checkout

These commands were run from the current Memi checkout:

```bash
npm run check:release-manifest
npm run check:release
npm run check:public-release
npm run growth:status
```

Observed results:

- `npm run check:release-manifest` passed.
- `npm run check:release` passed.
- `npm run check:public-release` failed on live npm and the deployed website:
  - `npm README missing phrase: read-only design engineering audit and skill layer for coding agents`
  - `docs missing CLI version 2.6.2`
  - `changelog missing release 2.6.2`
- `npm run growth:status` reported:
  - package `@memi-design/cli@2.6.2`
  - official MCP Registry listed
  - Studio release `v2.5.0`
  - stale references `0` in the local repo after the truth-reset pass

## Live public evidence

### Website homepage

The deployed homepage still shows:

- `Changelog v2.4.0`
- `Download macOS · 2.4.0`
- `@memi-design/cli@2.5.0`

It does not show the primary story: `Memi is the read-only design engineering
audit and skill layer for coding agents.`

This proves the website is not yet synchronized to the current engine or Studio release lines.

### Website docs

The deployed docs page still says:

- `Current npm target: 2.5.0`

This directly contradicts the current source-of-truth release docs and the live npm package state.

### npm README

The published `@memi-design/cli@2.6.2` README has the earlier
`Design QA skills for coding agents` headline. The repository now defines the
more precise primary story above. A new verified engine release is required
before npm can satisfy the updated public-story gate; mutating the historical
`2.6.2` release is not allowed.

### Website changelog

The deployed changelog still says:

- `Current CLI release: v2.5.0`
- latest visible changelog date `2026-07-14`

That is older than the restored `v2.6.2` GitHub release created on 2026-07-26.

### GitHub release

The public GitHub release page for Memi shows:

- release title `Memi v2.6.2`
- created `26 Jul`
- tag `v2.6.2`
- commit `ee3f3f0`

This matches the current release manifest and `docs/CURRENT_RELEASE.md`.

The repository description was also aligned during this check to:
`Memi is the read-only design engineering audit and skill layer for coding agents.`

### Studio release

The public Studio release page shows:

- release title `memi-studio v2.5.0`
- tag `v2.5.0`

This matches the current release manifest and current release doc.

## Scorecard impact

The following scorecard items remain blocked by this evidence:

- cap `public-version-drift`
- criterion `surface-parity/public-release-parity`
- criterion `testing-and-operations/aggregate-clean-room-release`

The website-hosted CI blocker may also still be active, but this check did not independently clear it.

## What must happen next

1. Cut a new verified engine release containing the primary story; do not
   republish or retag `2.6.2`.
2. Deploy the website with current engine and Studio metadata.
3. Ensure the first fold uses the primary read-only design-engineering story.
4. Ensure the docs page shows the new CLI version.
5. Ensure the changelog page includes the new CLI release.
6. Re-run `npm run check:public-release`.
7. Capture the successful hosted website CI run and add it to the scorecard evidence ledger.

## Website source status after the parity repair pass

The separate `memoire-web` source checkout was updated and pushed at commit
`ed746daedfdde52b7d8cdb326c9db29560fdbaa6` after this public check. It now
reflects the current release truth in the source tree:

- docs import the central release constants and show the current CLI version
- docs now surface the read-only first-audit command
- OG API taglines now use the read-only design-engineering story
- the Design CI registry JSON and its tests stay pinned to the current CLI line
- the Product Hunt update page no longer repeats the older primary slogan in its
  launch-copy block

Local verification completed in the website source checkout:

```bash
npm test
npm run build
npm run check:size
npx playwright test --project chromium
```

Observed result:

- 31 unit-test files and 208 tests passed
- full Astro production build completed successfully
- all deterministic bundle budgets passed
- 76 Chromium E2E tests passed and 4 were intentionally skipped
- Vercel preview deployment completed successfully
- the public Design CI recipe pins both checkout and Memi to audited immutable
  commit SHAs

This improves source readiness, but it does **not** clear the public-version
drift cap. The deployed site and published npm package must still be updated and
re-verified independently.

The website hosted-CI cap also remains active. Run
<https://github.com/sarveshsea/memoire-web/actions/runs/30225897481> failed before
executing any workflow step. GitHub reported that recent account payments failed
or the spending limit must be increased. This is an external account blocker,
not a passing or failing execution of the candidate.
