# memi design CI for GitHub Actions

`memi design CI` is the supported GitHub distribution surface for the deterministic `memi ci` gate. It defaults to the reviewed `@memi-design/cli@2.7.4` pin, scans the checked-out repository, writes a GitHub step summary, uploads design-health evidence, and can publish SARIF annotations to code scanning.

The action does not accept API keys, Figma credentials, model credentials, or a GitHub token input. The design gate does not invoke an LLM, and the action sets `DO_NOT_TRACK=1` and `MEMI_TELEMETRY_DISABLED=1` for CLI execution.

## Recommended workflow

Pin the action commit, check out full history for PR merge-base discovery, and grant only the permissions needed by the selected outputs.

```yaml
name: design

on:
  pull_request:
    branches: [main]

jobs:
  memi:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0

      - id: memi
        uses: memi-design/memi@8aa4649f412bbcaaf2af4ee209bf79016566f035 # v2.7.4

      - name: Show evidence locations
        if: ${{ always() }}
        run: |
          printf 'Gate: %s\n' "${{ steps.memi.outputs['gate-outcome'] }}"
          printf 'SARIF: %s\n' "${{ steps.memi.outputs['sarif-path'] }}"
          printf 'Report: %s\n' "${{ steps.memi.outputs['report-path'] }}"
```

`fetch-depth: 0` is important for pull requests because `memi ci` resolves the merge base against the base branch. For scheduled or branch-wide checks, set `base` explicitly or configure the repository policy.

## Inputs

| Input | Default | Contract |
| --- | --- | --- |
| `version` | `2.7.4` | Exact CLI version. The reviewed default is pinned; exact prior versions remain accepted for existing workflows. Ranges and dist-tags are rejected. |
| `fail-on` | empty | `critical`, `high`, `medium`, `low`, or `none`. Empty defers to `memoire.policy.json`. |
| `base` | empty | Git ref used for PR scoping. Empty lets the CLI try `origin/$GITHUB_BASE_REF`, then `origin/main`. |
| `target` | empty | Directory to scan. Empty scans the repository root. Paths are passed as one argument, including spaces and leading dashes. |
| `report` | `true` | Generate and upload the `memi-design-health` artifact. Must be `true` or `false`. |
| `upload-sarif` | `true` | Upload SARIF when the file exists and code-scanning permissions are available. Must be `true` or `false`. |

Input names and defaults match the original v2 design-CI action. Inputs are validated before installation and are passed to Bash through environment variables and argument arrays, not interpolated into shell source.

## Outputs

| Output | Value |
| --- | --- |
| `cli-version` | Exact CLI version installed for this run. |
| `gate-outcome` | GitHub outcome of the `memi ci` step: `success` or `failure`. |
| `sarif-path` | `.memoire/app-quality/memi-results.sarif`. |
| `report-path` | `.memoire/app-quality/design-health.html`. |
| `artifact-id` | ID returned by `actions/upload-artifact`, or empty when no artifact was uploaded. |
| `artifact-url` | Authenticated URL returned by `actions/upload-artifact`, or empty when no artifact was uploaded. |

The action itself still fails when the design gate fails. `gate-outcome` and the evidence outputs are for `if: always()` reporting and downstream diagnostics, not for bypassing the gate.

## Evidence produced

With `report: "true"`, the `memi-design-health` artifact contains whichever files the CLI produced:

- `diagnosis.json` and `diagnosis.md` for machine-readable and reviewer-readable findings
- `memi-results.sarif` for portable code-scanning evidence
- `design-health.html`, `design-health.md`, and `design-health-badge.svg` for the health report

Artifacts are inspected and uploaded with `if: always()`, so a policy failure still leaves evidence for review. A setup or runtime failure before evidence exists does not trigger an empty upload.

## Restricted permissions and forks

SARIF upload requires `security-events: write`. The action automatically skips code-scanning upload for pull requests from forks, while still running the gate and uploading the report artifact. For repositories where code scanning is unavailable or permissions are intentionally read-only, disable only that integration:

```yaml
- uses: memi-design/memi@8aa4649f412bbcaaf2af4ee209bf79016566f035 # v2.7.4
  with:
    upload-sarif: "false"
```

No secret is needed for the report artifact. GitHub's maintained upload actions use the workflow's internal runtime credentials; memi does not receive or expose them.

## Custom policy example

```yaml
- id: memi
  uses: memi-design/memi@8aa4649f412bbcaaf2af4ee209bf79016566f035 # v2.7.4
  with:
    fail-on: high
    base: origin/main
    target: packages/web
    report: "true"
    upload-sarif: "false"
    version: "2.7.4"
```

## Marketplace release checklist

1. Run the focused contract test and release checks:

   ```bash
   npm test -- --run src/release/__tests__/github-action-contract.test.ts
   npm run check:release
   ```

2. Validate `action.yml` as YAML and with `actionlint` when available.
3. Merge the reviewed action commit to `main`.
4. Create the immutable `v2.7.4` release tag on that commit. Never retag an existing release.
5. In the GitHub release UI, select **Publish this Action to the GitHub Marketplace**.
6. Use **Code quality** as the primary category and **Continuous integration** as the secondary category.
7. After Marketplace publication, move the floating `v2` tag to the same reviewed commit for consumers that intentionally follow compatible v2 updates.

Marketplace metadata constraints are already represented in `action.yml`: the action is named `memi design CI`, has valid `layout`/`purple` branding, and keeps its top-level description under GitHub's 125-character limit.
