# Memi 2.7.3 confirmatory study

This directory contains the public research artifact for *Evaluating
History-Aware Design Skills for Coding Agents: A Preregistered Matched-Pair
Study of Memi 2.7.3*. It is intended for researchers, tool builders, and
practitioners who want to inspect the study rather than rely on a product
claim.

The experiment compares a frozen Memi 2.7.3 candidate with a matched baseline
across three software fixtures. It includes 18 randomized matched pairs and 36
serialized agent cells. The primary endpoint is blinded, model-panel design
quality; functional and resource outcomes are secondary. Results are reported
without imputation, and pooled cross-fixture estimates are descriptive because
the tasks are heterogeneous.

The evidence supports task-specific non-inferiority for the two fixtures with
complete quality pairs. It does not establish universal superiority, human
preference, or dollar savings. The authors developed the evaluated system and
conducted the study; this package is a transparent technical disclosure, not
an independently commissioned evaluation or a peer-reviewed acceptance.

## Artifact map

- `main.tex` and `memi-2.7.3-confirmatory-audit.pdf`: paper source and compiled paper
- `analysis.ipynb`: executed statistical analysis
- `protocol.json`, `plan.json`, `environment.json`, and `rubric.json`: frozen design
- `candidate-provenance.json` and `release-provenance.json`: artifact lineage
- `generated/`: tables, figures, policy replay, TeX fragments, and checksums
- `receipts/`, `evidence-receipts.json`, and `rendered-audit-ledger.json`: cell-level evidence
- `exclusions.json` and `deviations.json`: complete exception ledgers
- `figure-map.md`: analytical contract and limitations for every paper figure
- `next-release-plan.md`: evidence-led 2.7.5 plan for native frontend quality,
  measured billing, and fail-closed skill improvement

## Reproduce the analysis

From this directory:

```bash
python3 analysis/run_analysis.py
python3 run-fitness-backtest.py
python3 build-report-package.py
```

Verify committed derivatives and the analysis test suite:

```bash
python3 build-report-package.py --check
python3 run-fitness-backtest.py --check
python3 -m unittest discover -s analysis/tests -p 'test_*.py'
```

The checksum inventory deliberately excludes PDFs and itself, preventing a
cyclic self-hash contract. The PDF checksum is maintained as a detached
sidecar after compilation.
