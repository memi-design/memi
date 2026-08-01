#!/usr/bin/env python3
"""Execute the V15 pair-complete fitness replay against an isolated evidence copy."""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from analysis.fitness_backtest import (
    BacktestInputError,
    BacktestPaths,
    artifact_set_mismatches,
    default_backtest_paths,
    execute_backtest,
    execution_artifact_paths,
    write_execution_artifacts,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--study-root", type=Path)
    parser.add_argument("--engine-cli", type=Path)
    parser.add_argument("--source-store-root", type=Path)
    parser.add_argument("--source-runs-root", type=Path)
    parser.add_argument("--scratch-root", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    paths = default_backtest_paths(
        study_root=args.study_root,
        engine_cli=args.engine_cli,
        source_store_root=args.source_store_root,
        source_runs_root=args.source_runs_root,
    )
    result = execute_backtest(paths, args.scratch_root)
    if args.check:
        _check_outputs(paths, result)
        print("V15 fitness backtest artifacts are current and deterministic.")
        return 0
    write_execution_artifacts(paths, result)
    print(
        "Wrote V15 fitness backtest artifacts from "
        f"{result['summary']['storeWriteCount']} isolated CLI writes and "
        f"{len(result['snapshots'])} no-look-ahead cutoffs."
    )
    return 0


def _check_outputs(paths: BacktestPaths, result: dict[str, object]) -> None:
    with tempfile.TemporaryDirectory(prefix="memi-v15-fitness-check-") as directory:
        expected_paths = BacktestPaths(
            study_root=Path(directory),
            engine_cli=paths.engine_cli,
            source_store_root=paths.source_store_root,
            source_runs_root=paths.source_runs_root,
        )
        write_execution_artifacts(expected_paths, result)
        actual_by_relative = {
            str(path.relative_to(paths.study_root)): path.read_bytes()
            for path in execution_artifact_paths(paths)
        }
        expected_by_relative = {
            str(path.relative_to(expected_paths.study_root)): path.read_bytes()
            for path in execution_artifact_paths(expected_paths)
        }
        mismatches = artifact_set_mismatches(actual_by_relative, expected_by_relative)
        if mismatches:
            raise BacktestInputError("fitness backtest artifacts differ: " + ", ".join(mismatches))


if __name__ == "__main__":
    raise SystemExit(main())
