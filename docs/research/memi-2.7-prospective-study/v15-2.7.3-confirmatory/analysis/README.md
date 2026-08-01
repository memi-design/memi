# V15 Confirmatory Analysis

This package owns the deterministic analysis pipeline for the exact-2.7.3 V15
confirmatory study.

## Entry points

- `python3 analysis/run_analysis.py`
  - Executes the notebook in place with the local deterministic notebook runner.
- `python3 analysis/run_analysis.py --analysis-only`
  - Runs the underlying analysis directly without re-executing the notebook.

## Expected blinded grading input

The analysis expects a blinded grading file at:

- `analysis/blinded_grading.json`

Required schema:

```json
{
  "schemaVersion": 1,
  "studyId": "memi-2.7-prospective-v15-273-confirmatory",
  "entries": [
    {
      "trialId": "memi-2.7-v15-2.7.3-confirmatory:buzzr-tab-unread-badge:r1:baseline",
      "ratings": [
        {
          "graderId": "grader-a",
          "blinded": true,
          "receiptRef": "receipt://grader-a/buzzr-r1-baseline",
          "score": 82,
          "dimensions": {
            "task-interaction-correctness": 20,
            "accessibility": 16,
            "visual-hierarchy": 12,
            "design-system-consistency": 13,
            "responsive-adaptive-behavior": 13,
            "implementation-quality": 8
          },
          "criticalDefects": []
        }
      ]
    }
  ]
}
```

Notes:

- Every non-excluded graded trial must appear exactly once.
- The pipeline treats `rendered-frontend-grading-only` exclusions as
  preregistered omissions from the quality panel only.
- The notebook fails closed on missing evidence, duplicate trial receipts,
  missing blinded grades, or malformed grader payloads.
