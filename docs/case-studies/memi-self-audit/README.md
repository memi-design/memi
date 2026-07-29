# Memi self-audit

## Scope

- Repository: `memi-design/memi`
- Candidate: `2.7.0`
- Audit mode: read-only

## Reproduce

```sh
npx -y @memi-design/cli@2.7.0 diagnose . \
  --json --no-write --fail-on none
```

The candidate scanned 313 supported web files and reported a 59/100
evidence-scoped web score. It detected 265 raw colors across preview and
prototype surfaces plus thin responsive coverage. It assessed visual system,
color, accessibility, responsive behavior, and maintainability, while leaving
components, spacing, and typography unassessed. Confidence was 0.55.

The self-audit is intentionally public debt, not a curated success screenshot.
It shows that Memi can report a failing result against itself and state what it
did not measure.

## Efficiency experiment

Use `tasks.json` with `memi benchmark plan`, keep all baseline and Memi trials
on one clean revision, and publish the resulting metadata-only report. The
current case contains no paired agent runs and makes no efficiency claim.
