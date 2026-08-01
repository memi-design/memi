from __future__ import annotations

import argparse
import json
import sys

from notebook_executor import execute_notebook
from pipeline import AnalysisInputError, run_confirmatory_analysis, study_paths


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the V15 confirmatory analysis pipeline.")
    parser.add_argument(
        "--analysis-only",
        action="store_true",
        help="Run the analysis directly instead of executing analysis.ipynb.",
    )
    args = parser.parse_args()

    paths = study_paths()
    if args.analysis_only:
        try:
            summary = run_confirmatory_analysis(write_outputs=True)
        except AnalysisInputError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        print(json.dumps(summary["primarySummary"], indent=2))
        return 0

    result = execute_notebook(paths.notebook_path, working_directory=paths.study_root)
    if not result.succeeded:
        print(
            f"analysis notebook executed with a fail-closed error after {result.executed_cells} code cells: "
            f"{paths.notebook_path}",
            file=sys.stderr,
        )
        return 1
    print(f"analysis notebook executed successfully: {paths.notebook_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
