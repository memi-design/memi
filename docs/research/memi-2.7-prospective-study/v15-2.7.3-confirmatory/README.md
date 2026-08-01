# Memi 2.7.3 V15 confirmatory audit

This directory is the single source of truth for the exact-2.7.3 confirmatory
study. The protocol, candidate, task revisions, condition-order seed, resource
ceilings, rubric, and acceptance rules are frozen before any provider cell.

The study contains 18 matched pairs and 36 serialized agent cells across
Buzzr/Expo, Paraform/web, and Nate/SwiftUI. Results are reported without
imputation. Model-panel design scores are labeled model-graded and are not
represented as independent practitioner evidence.

No broad superiority, dollar-savings, or cross-tool claim follows from this
study unless the corresponding preregistered gate passes.

## Current evidence boundary

- The receipt gate is complete: 36 of 36 frozen cells are manifest-verified.
- Fourteen cells are excluded only from rendered grading; functional and
  resource outcomes remain in the analysis without imputation.
- The model-graded panel contains 22 graded cells; 20 form 10 complete matched
  pairs (five Buzzr and five Paraform), while two remain unpaired after sibling
  exclusions. It is not independent human-practitioner evidence and does not
  authorize a superiority claim.
- Buzzr captures are testing-library renderer evidence, not Expo Simulator or
  native pixel proof. Paraform's mobile breakpoint blocks its desktop
  workspace, so the phone capture is a desktop-only placeholder.
- No billing observations were collected, so no dollar-savings claim is made.
- The controlled website remediation removed the serious Lighthouse
  `label-content-name-mismatch` finding and passed the unchanged blocking gate.
- Memi 2.7.4 publication remains **pending live verification** across every
  public channel. Local commits, tests, and dry-run policy artifacts are not
  release proof.

## Deterministic report package

Build the derived TeX, rendered/blinded audit ledger, and checksum inventory:

```bash
python3 build-report-package.py
```

Verify that committed derivatives still match their sealed inputs:

```bash
python3 build-report-package.py --check
python3 -m unittest analysis.tests.test_report_package
```

The builder writes:

- `generated/tex/website-audit-results.tex`
- `generated/tex/remediation-results.tex`
- `generated/tex/release-gates.tex`
- `rendered-audit-ledger.json`
- `generated/report-package-checksums.json`

The checksum inventory excludes all PDFs and excludes itself, preventing a
cyclic PDF/self-hash contract. The builder does not compile the final PDF.
