#!/usr/bin/env python3
"""Validate three independent blinded panels and bind them to V15 trials."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


STUDY_ROOT = Path(__file__).resolve().parent
RENDERED_ROOT = Path(
    "/Volumes/ExtremeSSD/Projects/_evidence/"
    "memi-2.7-v15-2.7.3-confirmatory/rendered"
)
MAPPING_PATH = RENDERED_ROOT / "sealed-blinding-map.json"
RESPONSES_ROOT = RENDERED_ROOT / "grader-responses"
OUTPUT_PATH = STUDY_ROOT / "analysis" / "blinded_grading.json"
RECEIPTS_PATH = STUDY_ROOT / "grading-receipts.json"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def validate_score(dimensions: dict[str, Any], rubric: dict[str, Any]) -> float:
    expected = {entry["id"]: float(entry["points"]) for entry in rubric["dimensions"]}
    if set(dimensions) != set(expected):
        raise RuntimeError(
            f"dimension mismatch: expected {sorted(expected)}, found {sorted(dimensions)}"
        )
    score = 0.0
    for dimension, maximum in expected.items():
        value = float(dimensions[dimension])
        if not 0 <= value <= maximum:
            raise RuntimeError(f"{dimension} score {value} is outside 0..{maximum}")
        score += value
    return score


def build() -> tuple[dict[str, Any], dict[str, Any]]:
    rubric = load_json(STUDY_ROOT / "rubric.json")
    protocol = load_json(STUDY_ROOT / "protocol.json")
    receipts = load_json(STUDY_ROOT / "evidence-receipts.json")
    exclusions = load_json(STUDY_ROOT / "exclusions.json")
    mapping = load_json(MAPPING_PATH)
    excluded = {entry["trialId"] for entry in exclusions["entries"]}
    expected_trials = {
        entry["trialId"] for entry in receipts["entries"]
        if entry["accepted"] and entry["trialId"] not in excluded
    }
    mapping_by_anon = {entry["anonId"]: entry for entry in mapping["entries"]}
    mapped_trials = {entry["trialId"] for entry in mapping_by_anon.values()}
    if mapped_trials != expected_trials:
        raise RuntimeError(
            "blinding map does not match accepted non-excluded trials: "
            f"missing={sorted(expected_trials - mapped_trials)}, "
            f"extra={sorted(mapped_trials - expected_trials)}"
        )
    if len(mapping_by_anon) != len(mapping["entries"]):
        raise RuntimeError("duplicate anonId in blinding map")

    response_paths = sorted(RESPONSES_ROOT.glob("*.json"))
    expected_graders = int(rubric["graderRules"]["graderCount"])
    if len(response_paths) != expected_graders:
        raise RuntimeError(
            f"expected {expected_graders} grader response files, found {len(response_paths)}"
        )

    ratings_by_trial: dict[str, list[dict[str, Any]]] = {
        trial_id: [] for trial_id in expected_trials
    }
    grader_receipts: list[dict[str, Any]] = []
    grader_ids: set[str] = set()
    for response_path in response_paths:
        response = load_json(response_path)
        grader_id = str(response.get("graderId", "")).strip()
        if not grader_id or grader_id in grader_ids:
            raise RuntimeError(f"missing or duplicate graderId in {response_path}")
        grader_ids.add(grader_id)
        if response.get("blinded") is not True:
            raise RuntimeError(f"grader {grader_id} was not declared blinded")
        entries = response.get("entries", [])
        if {entry.get("anonId") for entry in entries} != set(mapping_by_anon):
            raise RuntimeError(f"grader {grader_id} did not score the exact blinded bundle")
        response_sha = sha256_file(response_path)
        grader_receipts.append(
            {
                "graderId": grader_id,
                "model": response.get("model"),
                "responsePath": str(response_path),
                "responseSha256": response_sha,
                "blinded": True,
                "entries": len(entries),
            }
        )
        for entry in entries:
            anon_id = entry["anonId"]
            trial_id = mapping_by_anon[anon_id]["trialId"]
            dimensions = entry.get("dimensions")
            if not isinstance(dimensions, dict):
                raise RuntimeError(f"grader {grader_id} omitted dimensions for {anon_id}")
            score = validate_score(dimensions, rubric)
            if abs(float(entry.get("score")) - score) > 1e-9:
                raise RuntimeError(f"grader {grader_id} total does not equal dimensions for {anon_id}")
            critical = entry.get("criticalDefects", [])
            evidence = entry.get("evidence", [])
            if not isinstance(critical, list) or not isinstance(evidence, list) or not evidence:
                raise RuntimeError(f"grader {grader_id} omitted required evidence for {anon_id}")
            ratings_by_trial[trial_id].append(
                {
                    "graderId": grader_id,
                    "blinded": True,
                    "score": score,
                    "dimensions": dimensions,
                    "criticalDefects": critical,
                    "evidence": evidence,
                    "notes": entry.get("notes", ""),
                    "receiptRef": f"{response_sha}#{anon_id}",
                }
            )

    grading_entries = [
        {"trialId": trial_id, "ratings": sorted(ratings, key=lambda item: item["graderId"])}
        for trial_id, ratings in sorted(ratings_by_trial.items())
    ]
    grading = {
        "schemaVersion": 1,
        "studyId": protocol["protocolId"],
        "rubricVersion": rubric["rubricVersion"],
        "modelGraded": True,
        "independentHumanPractitionerEvidence": False,
        "graderCount": expected_graders,
        "entries": grading_entries,
    }
    grading_receipts = {
        "schemaVersion": 1,
        "studyId": protocol["protocolId"],
        "mappingPath": str(MAPPING_PATH),
        "mappingSha256": sha256_file(MAPPING_PATH),
        "graderReceipts": grader_receipts,
        "gradedTrials": len(grading_entries),
        "excludedTrials": len(excluded),
    }
    return grading, grading_receipts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    grading, receipts = build()
    outputs = {OUTPUT_PATH: grading, RECEIPTS_PATH: receipts}
    if args.check:
        stale = [path for path, payload in outputs.items() if load_json(path) != payload]
        if stale:
            raise SystemExit("stale grading artifacts: " + ", ".join(map(str, stale)))
        print("Blinded grading artifacts are complete and current.")
        return 0
    for path, payload in outputs.items():
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Bound {len(grading['entries'])} trials to {grading['graderCount']} blinded graders.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
