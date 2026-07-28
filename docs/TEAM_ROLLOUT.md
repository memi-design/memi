# Team rollout

How a design-conscious team goes from zero to a shared, enforced design gate. Every step is deterministic: findings cite file:line, re-run identically, and no LLM sits in the enforcement path.

## Day 1 — one person runs init

```bash
npm i -g @memi-design/cli
cd your-app
memi init --team
git add memoire.policy.json .memoire/baseline.json .gitignore
git commit -m "chore: memi design gate (policy + accepted baseline)"
```

What that did, honestly:

- **`memoire.policy.json`** — the committed rulebook (preset `memi-recommended`). Thresholds and gate severity live in the repo, not in someone's shell. Every report stamps the policy hash, so a score is only ever compared against runs under the same rules.
- **`.memoire/baseline.json`** — every finding that existed today, accepted loudly as known debt. From now on **only new findings gate**. Suppressed counts stay visible in every report; a baseline hides nothing, it just stops old debt from blocking new work.
- **`.gitignore`** — a managed block keeps `.memoire/*` workspace state local while sharing `baseline.json`. If you had a plain `.memoire/` ignore line, init warns you: git cannot re-include a file inside an ignored directory, so the old line must go.
- **An agent kit** — `.agents/skills/` (or `--kit claude-code`, `cursor`, …) so every teammate's coding agent uses the same design tooling. `--kit none` skips it.

## Day 1 — everyone else

```bash
npm i -g @memi-design/cli
memi init --team        # detects the committed policy + baseline, installs the kit, changes nothing shared
memi doctor             # Team gate section: policy ✓ baseline ✓ gitignore ✓
```

Teammate runs are idempotent: existing policy and baseline are reported, never overwritten. If the baseline was accepted under a different policy hash, init says so instead of pretending the numbers are comparable.

## Week 1 — wire the CI gate

See [CI_RECIPES.md](CI_RECIPES.md). Short version:

```yaml
# .github/workflows/design.yml
jobs:
  design:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with: { fetch-depth: 0 }
      - uses: memi-design/memi@ec4d804220bfbf08be810ceb692a338cf186e794 # v2.6.4
```

PRs now get SARIF annotations on the exact changed lines, a step-summary scorecard, and a design-health report artifact. Whole-tree stats are always computed (thresholds stay valid); the PR is only blamed for files it touched.

## Ongoing — burn the debt down

```bash
memi baseline status     # suppressed / new-active / stale-safe-to-prune
memi diagnose --trend    # score over time, same-policy runs only
memi report --badge      # shareable design-health.html + SVG badge
```

- Fix accepted debt → the fingerprint goes stale → `memi baseline status` lists it as prunable → re-accept to shrink the file.
- Tighten the gate when ready: switch the preset to `strict` in `memoire.policy.json` (fails on `medium`, zero regression budget, stale research citations fail audits). The policy hash changes, so trend lines honestly restart.

## What this does NOT do

- It does not grade taste. It gates the mechanical layer — token discipline, contrast, scale drift, accessibility signals — the part that is checkable, so review time goes to the part that isn't.
- It does not assess what it cannot see. Reports mark tenets/dimensions as "not-assessed" rather than inventing a score; provenance on every finding says how it was produced (`static-scan` today).
- It does not compare incomparable runs. Different policy hash or a scoped scan → trend and regression checks say "not comparable" instead of fabricating a delta.
