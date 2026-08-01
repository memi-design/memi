#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from analysis.grader_bundle import build_bundle, load_sources


STUDY_ROOT = Path(__file__).resolve().parent
RENDERED_ROOT = Path(
    "/Volumes/ExtremeSSD/Projects/_evidence/"
    "memi-2.7-v15-2.7.3-confirmatory/rendered"
)
BUNDLE_PATH = RENDERED_ROOT / "grader-bundle" / "manifest.json"
MAPPING_PATH = RENDERED_ROOT / "sealed-blinding-map.json"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    bundle, mapping = build_bundle(
        load_json(STUDY_ROOT / "evidence-receipts.json"),
        load_json(STUDY_ROOT / "exclusions.json"),
        load_sources(STUDY_ROOT, RENDERED_ROOT),
        seed=2715,
    )
    outputs = {BUNDLE_PATH: bundle, MAPPING_PATH: mapping}
    if args.check:
        stale = [path for path, payload in outputs.items() if not path.is_file() or load_json(path) != payload]
        if stale:
            raise SystemExit("stale grader artifacts: " + ", ".join(map(str, stale)))
        print(f"Grader bundle is complete and current: {len(bundle['entries'])} trials.")
        return 0
    BUNDLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    for path, payload in outputs.items():
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Built randomized blinded grader bundle for {len(bundle['entries'])} trials.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
