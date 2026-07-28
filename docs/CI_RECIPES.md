# CI recipes

`memi ci` is the one-command design gate: full-tree scan → PR scope → baseline filter → severity/score/regression gates → SARIF + step summary + report artifact. Exit code 1 when the gate fails. Deterministic by construction — same commit + same policy = same result.

## GitHub Actions — the shipped action (recommended)

```yaml
name: design
on:
  pull_request:
    branches: [main]

jobs:
  design:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write   # SARIF → code-scanning PR annotations
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          fetch-depth: 0        # memi ci needs the merge-base with the base branch
      - uses: memi-design/memi@0f89cbf1b9972c779dbf14cc09f6c91485a1182b # v2.6.3
        with:
          version: "2.6.3"      # CLI pin stays explicit even when the action commit is immutable
          # fail-on: high       # override memoire.policy.json if needed
          # report: "true"      # design-health.html artifact (default on)
          # upload-sarif: "false"  # set false on forks (no security-events permission)
```

What lands on the PR:

- **Code-scanning annotations** on the exact `file:line` of each gating finding (SARIF 2.1.0, category `memi-design`). Only gate-eligible severities map to `error` — reviewers aren't drowned in notes.
- **Step summary** on the run page: score, gate verdict, policy hash, PR scope size, baseline suppressions, trend vs the last comparable run.
- **`memi-design-health` artifact**: self-contained design-health.html + markdown + SVG badge.

## GitHub Actions — raw commands (no marketplace action)

```yaml
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
        with: { node-version: 22 }
      - run: npm i -g @memi-design/cli@2.6.3
      - run: memi ci --report
      - uses: github/codeql-action/upload-sarif@1b168cd39490f61582a9beae412bb7057a6b2c4e
        if: always()
        with:
          sarif_file: .memoire/app-quality/memi-results.sarif
          category: memi-design
```

## Any other CI (GitLab, Buildkite, Jenkins, …)

```bash
npm i -g @memi-design/cli@2.6.3
memi ci --base origin/main --json > memi-ci.json   # exit code is the gate
```

- `--json` gives machine-readable gates: `{ status, score, policyHash, gates: { severity, minScore, regression }, suppressedByBaseline, sarifPath }`.
- The SARIF file works with any SARIF viewer, not just GitHub.
- `--no-scope` gates on the whole tree (nightly jobs, main-branch audits) instead of PR-changed files.

## How the gate composes (so you can trust it)

1. **Full-tree scan always runs.** Ratio thresholds (token coverage, scale drift) are meaningless on a 3-file diff; scoping only narrows which findings *blame the PR*.
2. **Baseline filter.** Committed `.memoire/baseline.json` suppresses accepted debt by content fingerprint (line-number independent). Suppressed counts are printed, never hidden.
3. **Severity gate** on the remaining PR-scoped findings (`--fail-on` > `memoire.policy.json` > preset default `high`).
4. **Score gates** for whole-tree health: `gates.minScore` and `gates.regressionBudget` from the policy — aggregate rules gate here, never as per-file PR blame. Regression only compares runs with the same policy hash; anything else is reported "not comparable".

## Pre-commit / local

```bash
memi ci                      # same gate as CI, sub-second on warm history
memi diagnose --changed      # just the findings on your working-tree diff
memi baseline status         # what's suppressed, what's new, what's prunable
```

## Fork PRs

SARIF upload needs `security-events: write`, which fork PRs don't get. Set `upload-sarif: "false"` (the shipped action) or guard the upload step; the gate itself still runs and fails honestly.
