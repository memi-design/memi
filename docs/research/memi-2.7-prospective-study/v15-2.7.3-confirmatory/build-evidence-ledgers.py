#!/usr/bin/env python3
"""Rebuild the V15 receipt and rendered-grading exclusion ledgers.

The script is deliberately self-contained so an auditor can recreate the two
ledgers from the frozen plan and immutable run evidence without the Memi CLI.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


STUDY_ROOT = Path(__file__).resolve().parent
RUNS_ROOT = Path(
    "/Volumes/ExtremeSSD/Projects/_evidence/"
    "memi-2.7-v15-2.7.3-confirmatory/runs"
)
MAX_INPUT_TOKENS = 450_000


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def run_artifact_sha256(path: Path) -> str:
    content = path.read_text(encoding="utf-8")
    run = json.loads(content)
    current = run.get("prospective", {}).get("evidenceManifestSha256")
    if not isinstance(current, str):
        return sha256_file(path)
    quoted = json.dumps(current)
    if content.count(quoted) != 1:
        raise RuntimeError(f"run receipt has ambiguous manifest binding: {path}")
    canonical = content.replace(quoted, json.dumps(f"sha256:{'0' * 64}"))
    return f"sha256:{hashlib.sha256(canonical.encode()).hexdigest()}"


def event_reason_codes(run_dir: Path) -> set[str]:
    codes: set[str] = set()
    events_path = run_dir / "events.jsonl"
    for line in events_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("type") == "workflow.verification.skipped":
            reason = str(event.get("reason", "")).strip()
            if reason:
                codes.add(reason)
        if event.get("type") == "workflow.budget.assessed" and not event.get("withinBudget", True):
            for exceeded in event.get("exceeded", []):
                codes.add(f"budget-{exceeded}-exceeded")
    return codes


def verification_reason_codes(run_dir: Path) -> set[str]:
    codes: set[str] = set()
    for result in load_json(run_dir / "verification.json"):
        if result.get("passed") is not False:
            continue
        kind = str(result.get("kind", "verification"))
        if kind == "build":
            codes.add("build-or-compile-failed")
        elif kind == "ios-simulator":
            codes.add("ios-simulator-verification-failed")
        elif kind == "rendered-flow":
            codes.add("rendered-flow-verification-failed")
        else:
            codes.add(f"{kind}-verification-failed")
    return codes


def build() -> tuple[dict[str, Any], dict[str, Any]]:
    freeze = load_json(STUDY_ROOT / "freeze.json")
    expected = {trial["trialId"] for trial in freeze["trials"]}
    existing_exclusions = load_json(STUDY_ROOT / "exclusions.json")
    existing_by_trial = {
        entry["trialId"]: entry for entry in existing_exclusions.get("entries", [])
    }

    runs: dict[str, tuple[dict[str, Any], Path]] = {}
    for run_path in sorted(RUNS_ROOT.glob("*/run.json")):
        run = load_json(run_path)
        trial_id = run["prospective"]["trialId"]
        if trial_id in runs:
            raise RuntimeError(f"duplicate trial receipt: {trial_id}")
        runs[trial_id] = (run, run_path.parent)

    missing = sorted(expected - set(runs))
    extra = sorted(set(runs) - expected)
    if missing or extra:
        raise RuntimeError(f"frozen trial mismatch: missing={missing}, extra={extra}")

    receipt_entries: list[dict[str, Any]] = []
    exclusion_entries: list[dict[str, Any]] = []
    completed_times: list[str] = []

    for trial_id in sorted(runs):
        run, run_dir = runs[trial_id]
        manifest_path = run_dir / "evidence-manifest.json"
        manifest = load_json(manifest_path)
        manifest_content = {
            "schemaVersion": manifest["schemaVersion"],
            "trialId": manifest["trialId"],
            "files": manifest["files"],
        }
        manifest_sha = canonical_sha256(manifest_content)
        if manifest_sha != run["prospective"]["evidenceManifestSha256"]:
            raise RuntimeError(f"evidence manifest hash mismatch: {trial_id}")
        if manifest.get("manifestSha256") != manifest_sha:
            raise RuntimeError(f"evidence manifest self-hash mismatch: {trial_id}")
        listed_files = {entry["name"]: entry for entry in manifest["files"]}
        for name, recorded in listed_files.items():
            target = run_dir / name
            actual = run_artifact_sha256(target) if name == "run.json" else sha256_file(target)
            if actual != recorded["sha256"]:
                raise RuntimeError(f"artifact hash mismatch: {trial_id}:{name}")

        completed_times.append(run["timing"]["completedAt"])
        receipt_entries.append(
            {
                "trialId": trial_id,
                "sequence": run["prospective"]["sequence"],
                "runId": run["runId"],
                "taskId": run["taskId"],
                "repeat": run["repeat"],
                "condition": run["condition"],
                "accepted": run["outcome"]["accepted"],
                "testsPassed": run["outcome"]["testsPassed"],
                "startedAt": run["timing"]["startedAt"],
                "completedAt": run["timing"]["completedAt"],
                "evidenceManifestSha256": manifest_sha,
                "runRawSha256": sha256_file(run_dir / "run.json"),
                "runManifestArtifactSha256": run_artifact_sha256(run_dir / "run.json"),
                "patchSha256": sha256_file(run_dir / "git.patch"),
                "verificationSha256": sha256_file(run_dir / "verification.json"),
                "environmentSha256": sha256_file(run_dir / "environment.json"),
                "eventsSha256": sha256_file(run_dir / "events.jsonl"),
                "routeSha256": (
                    sha256_file(run_dir / "skill-route.json")
                    if (run_dir / "skill-route.json").exists()
                    else None
                ),
            }
        )

        if run["outcome"]["accepted"]:
            continue

        reason_codes = event_reason_codes(run_dir) | verification_reason_codes(run_dir)
        if run["usage"]["inputTokens"] > MAX_INPUT_TOKENS:
            reason_codes.add("input-token-ceiling-exceeded")
        if (run_dir / "git.patch").stat().st_size == 0:
            reason_codes.add("no-renderable-patch")
        if not reason_codes:
            reason_codes.add("admission-quality-gate-failed")

        existing = existing_by_trial.get(trial_id, {})
        reason_codes.update(existing.get("reasonCodes", []))
        exclusion_entries.append(
            {
                "id": "",  # assigned after deterministic sorting
                "recordedAt": existing.get("recordedAt", run["timing"]["completedAt"]),
                "trialId": trial_id,
                "runId": run["runId"],
                "scope": "rendered-frontend-grading-only",
                "reasonCodes": sorted(reason_codes),
                "observedInputTokens": run["usage"]["inputTokens"],
                "maximumInputTokens": MAX_INPUT_TOKENS,
                "functionalOutcomeRetained": True,
                "resourceOutcomeRetained": True,
                "imputed": False,
                "evidenceManifestSha256": manifest_sha,
            }
        )

    receipt_entries.sort(key=lambda entry: entry["sequence"])
    exclusion_entries.sort(key=lambda entry: entry["trialId"])
    for index, entry in enumerate(exclusion_entries, start=1):
        entry["id"] = f"V15-EXC-{index:03d}"

    receipt_root = [
        {"trialId": entry["trialId"], "evidenceManifestSha256": entry["evidenceManifestSha256"]}
        for entry in receipt_entries
    ]
    receipts = {
        "schemaVersion": 1,
        "freezeHash": freeze["freezeHash"],
        "expectedCells": len(expected),
        "verifiedCells": len(receipt_entries),
        "generatedAt": max(completed_times),
        "evidenceRootDigest": canonical_sha256(receipt_root),
        "validationFailures": [],
        "entries": receipt_entries,
    }
    exclusions = {"schemaVersion": 1, "entries": exclusion_entries}
    return receipts, exclusions


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    receipts, exclusions = build()
    outputs = {
        STUDY_ROOT / "evidence-receipts.json": receipts,
        STUDY_ROOT / "exclusions.json": exclusions,
    }
    if args.check:
        mismatches = [path for path, value in outputs.items() if load_json(path) != value]
        if mismatches:
            raise SystemExit("stale ledgers: " + ", ".join(str(path) for path in mismatches))
        print("V15 evidence ledgers are current and complete.")
        return 0
    for path, value in outputs.items():
        path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(receipts['entries'])} receipts and "
        f"{len(exclusions['entries'])} rendered-grading exclusions."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
