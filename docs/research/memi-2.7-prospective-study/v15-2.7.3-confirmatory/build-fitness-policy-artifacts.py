#!/usr/bin/env python3
"""Build deterministic V15 skill-fitness dry-run artifacts."""

from __future__ import annotations

import argparse
from pathlib import Path

from analysis.fitness_policy import build_outputs, study_fitness_paths, verify_outputs, write_outputs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--study-root", type=Path)
    parser.add_argument("--runs-root", type=Path)
    parser.add_argument("--legacy-workflow-results", type=Path)
    parser.add_argument("--quality-evidence-v2-out", type=Path)
    parser.add_argument("--chronological-ingestion-plan-out", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    paths = study_fitness_paths(
        study_root=args.study_root,
        runs_root=args.runs_root,
        legacy_workflow_results_path=args.legacy_workflow_results,
        quality_evidence_v2_path=args.quality_evidence_v2_out,
        chronological_ingestion_plan_path=args.chronological_ingestion_plan_out,
    )
    quality_output, ingestion_output = build_outputs(paths)

    if args.check:
        mismatches = verify_outputs(paths, quality_output, ingestion_output)
        if mismatches:
            detail = ", ".join(f"{mismatch.path}: {mismatch.reason}" for mismatch in mismatches)
            raise SystemExit(f"stale fitness-policy artifacts: {detail}")
        print("Fitness-policy artifacts are current and deterministic.")
        return 0

    write_outputs(paths, quality_output, ingestion_output)
    print(
        f"Wrote {quality_output['entryCount']} v2 quality entries and "
        f"{ingestion_output['entryCount']} chronological ingestion entries."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
