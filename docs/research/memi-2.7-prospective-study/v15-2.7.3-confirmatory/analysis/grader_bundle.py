from __future__ import annotations

import copy
import hashlib
import json
import random
from pathlib import Path
from typing import Any


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def build_bundle(
    receipts: dict[str, Any],
    exclusions: dict[str, Any],
    sources: list[dict[str, Any]],
    *,
    seed: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    excluded = {str(entry["trialId"]) for entry in exclusions.get("entries", [])}
    expected = {
        str(entry["runId"]): str(entry["trialId"])
        for entry in receipts["entries"]
        if entry.get("accepted") is True and str(entry["trialId"]) not in excluded
    }
    rows_by_run: dict[str, dict[str, Any]] = {}
    for source in sources:
        for row in source["rows"]:
            run_id = str(row["runId"])
            if run_id in rows_by_run:
                raise RuntimeError(f"duplicate source run: {run_id}")
            rows_by_run[run_id] = {
                "taskId": str(source["taskId"]),
                "captureMode": str(source["captureMode"]),
                "taskContractPath": str(source.get("taskContractPath", "")),
                "caveats": copy.deepcopy(source.get("caveats", [])),
                "evidence": copy.deepcopy(row["evidence"]),
                "sourceAnonId": str(row["sourceAnonId"]),
            }
    if set(rows_by_run) != set(expected):
        raise RuntimeError(
            "source coverage mismatch: "
            f"missing={sorted(set(expected) - set(rows_by_run))}, "
            f"extra={sorted(set(rows_by_run) - set(expected))}"
        )

    ordered_run_ids = sorted(expected)
    random.Random(seed).shuffle(ordered_run_ids)
    grader_entries: list[dict[str, Any]] = []
    mapping_entries: list[dict[str, Any]] = []
    for index, run_id in enumerate(ordered_run_ids, start=1):
        anon_id = f"anon-v15-{index:03d}"
        source = rows_by_run[run_id]
        grader_entries.append({
            "anonId": anon_id,
            "taskId": source["taskId"],
            "taskContractPath": source["taskContractPath"],
            "captureMode": source["captureMode"],
            "caveats": source["caveats"],
            "evidence": source["evidence"],
        })
        mapping_entries.append({
            "anonId": anon_id,
            "trialId": expected[run_id],
            "runId": run_id,
            "sourceAnonId": source["sourceAnonId"],
        })

    bundle_payload = {
        "schemaVersion": 1,
        "seed": seed,
        "conditionLabelsHidden": True,
        "runIdentifiersHidden": True,
        "entryCount": len(grader_entries),
        "entries": grader_entries,
    }
    bundle = {**bundle_payload, "bundleSha256": canonical_sha256(bundle_payload)}
    mapping_payload = {
        "schemaVersion": 1,
        "seed": seed,
        "bundleSha256": bundle["bundleSha256"],
        "entries": mapping_entries,
    }
    mapping = {**mapping_payload, "mappingSha256": canonical_sha256(mapping_payload)}
    return bundle, mapping


def load_sources(study_root: Path, rendered_root: Path) -> list[dict[str, Any]]:
    buzzr_manifest = _load_json(rendered_root / "buzzr" / "manifest.json")
    buzzr_mapping = _load_json(rendered_root / "buzzr-sealed-trial-map.json")
    buzzr_trials = {entry["anonTrialId"]: entry for entry in buzzr_manifest["trials"]}
    buzzr_rows = []
    for mapping in buzzr_mapping["rows"]:
        trial = buzzr_trials[mapping["anonTrialId"]]
        buzzr_rows.append({
            "runId": mapping["runId"],
            "sourceAnonId": mapping["anonTrialId"],
            "evidence": [
                {
                    "kind": kind,
                    "sha256": artifact["sha256"],
                    "bytes": artifact["bytes"],
                    "path": str(rendered_root / "buzzr" / artifact["path"]),
                }
                for kind, artifact in sorted(trial["artifacts"].items())
            ],
        })

    paraform_manifest = _load_json(rendered_root / "paraform" / "manifest.json")
    paraform_mapping = _load_json(rendered_root / "paraform-sealed-mapping.json")
    paraform_cases = {entry["anonTrialId"]: entry for entry in paraform_manifest["cases"]}
    paraform_rows = []
    for mapping in paraform_mapping["cases"]:
        case = paraform_cases[mapping["anonTrialId"]]
        captured_states = {capture["state"] for capture in case["captures"]}
        required_states = {
            "light",
            "keyboard_focus",
            "filter",
            "empty",
            "reduced_motion",
            "dark",
            "mobile",
        }
        if not required_states.issubset(captured_states):
            raise RuntimeError(
                f"Paraform {mapping['anonTrialId']} is missing required rendered states: "
                f"{sorted(required_states - captured_states)}"
            )
        paraform_rows.append({
            "runId": mapping["runId"],
            "sourceAnonId": mapping["anonTrialId"],
            "evidence": [
                {
                    "kind": "browser-capture",
                    "state": capture["state"],
                    "sha256": "sha256:" + capture["object"]["sha256"].removeprefix("sha256:"),
                    "bytes": capture["object"]["bytes"],
                    "path": capture["object"]["path"],
                    "viewport": capture["viewport"],
                }
                for capture in case["captures"]
            ] + [{
                "kind": "replay-verification",
                "status": case["replayStatus"],
                "exclusions": copy.deepcopy(case.get("exclusions", [])),
            }],
        })

    tasks_root = study_root / "tasks"
    return [
        {
            "taskId": "buzzr-tab-unread-badge",
            "captureMode": "react-native-testing-library-renderer",
            "taskContractPath": str(tasks_root / "buzzr-tab-unread-badge.json"),
            "caveats": [
                "Renderer state capture is not an Expo Simulator screenshot.",
                "The pinned fixture has no committed native project; generating one would change the frozen workflow.",
            ],
            "rows": buzzr_rows,
        },
        {
            "taskId": "paraform-command-menu",
            "captureMode": "playwright-browser-screenshot",
            "taskContractPath": str(tasks_root / "paraform-command-menu.json"),
            "caveats": [],
            "rows": paraform_rows,
        },
    ]


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))
