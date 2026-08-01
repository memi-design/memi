#!/usr/bin/env python3
"""Build or verify deterministic V15 report-package artifacts."""

from __future__ import annotations

import argparse
from pathlib import Path

from analysis.report_package import build_outputs, study_report_paths, verify_outputs, write_outputs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--study-root", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    paths = study_report_paths(args.study_root)
    release_verified = paths.live_release_verification_path.is_file()
    outputs = build_outputs(paths)
    if args.check:
        mismatches = verify_outputs(paths, outputs)
        if mismatches:
            detail = ", ".join(f"{item.path}: {item.reason}" for item in mismatches)
            raise SystemExit(f"stale report-package artifacts: {detail}")
        release_state = (
            "public software channels verified"
            if release_verified
            else "release remains pending live verification"
        )
        print(f"Report-package artifacts are current and deterministic; {release_state}.")
        return 0

    write_outputs(paths, outputs)
    release_state = (
        "public software channels verified"
        if release_verified
        else "pending live release verification"
    )
    print(f"Wrote deterministic report-package artifacts; {release_state}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
