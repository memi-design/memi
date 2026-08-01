from __future__ import annotations

import hashlib
import json
import re
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_RUNS_ROOT = Path(
    "/Volumes/ExtremeSSD/Projects/_evidence/"
    "memi-2.7-v15-2.7.3-confirmatory/runs"
)


@dataclass(frozen=True)
class StudyFitnessPaths:
    study_root: Path
    analysis_root: Path
    generated_root: Path
    evidence_receipts_path: Path
    blinded_grading_path: Path
    protocol_path: Path
    rubric_path: Path
    exclusions_path: Path
    evidence_runs_root: Path
    legacy_workflow_results_path: Path
    quality_evidence_v2_path: Path
    chronological_ingestion_plan_path: Path


@dataclass(frozen=True)
class CheckMismatch:
    path: Path
    reason: str


def study_fitness_paths(
    study_root: Path | None = None,
    runs_root: Path | None = None,
    legacy_workflow_results_path: Path | None = None,
    quality_evidence_v2_path: Path | None = None,
    chronological_ingestion_plan_path: Path | None = None,
) -> StudyFitnessPaths:
    study_root = (study_root or Path(__file__).resolve().parent.parent).resolve()
    analysis_root = study_root / "analysis"
    generated_root = study_root / "generated" / "fitness-policy"
    return StudyFitnessPaths(
        study_root=study_root,
        analysis_root=analysis_root,
        generated_root=generated_root,
        evidence_receipts_path=study_root / "evidence-receipts.json",
        blinded_grading_path=analysis_root / "blinded_grading.json",
        protocol_path=study_root / "protocol.json",
        rubric_path=study_root / "rubric.json",
        exclusions_path=study_root / "exclusions.json",
        evidence_runs_root=(runs_root or DEFAULT_RUNS_ROOT).resolve(),
        legacy_workflow_results_path=(
            legacy_workflow_results_path
            or (study_root.parent.parent.parent / "case-studies" / "memi-2.7-workflow-proof" / "results.json")
        ).resolve(),
        quality_evidence_v2_path=(
            quality_evidence_v2_path or generated_root / "quality-evidence-v2.json"
        ).resolve(),
        chronological_ingestion_plan_path=(
            chronological_ingestion_plan_path or generated_root / "chronological-ingestion-plan.json"
        ).resolve(),
    )


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def build_outputs(paths: StudyFitnessPaths) -> tuple[dict[str, Any], dict[str, Any]]:
    protocol = load_json(paths.protocol_path)
    rubric = load_json(paths.rubric_path)
    exclusions = load_json(paths.exclusions_path)
    receipts = load_json(paths.evidence_receipts_path)
    grading = load_json(paths.blinded_grading_path)
    legacy_results = load_json(paths.legacy_workflow_results_path)

    exclusion_index = {
        entry["trialId"]
        for entry in exclusions.get("entries", [])
        if entry.get("scope") == "rendered-frontend-grading-only"
    }

    run_records = _load_runs(paths, receipts.get("entries", []))
    grades = _load_grades(
        grading=grading,
        protocol=protocol,
        rubric=rubric,
        exclusion_index=exclusion_index,
        run_records=run_records,
    )
    quality_entries = _build_v2_quality_entries(
        protocol=protocol,
        run_records=run_records,
        grades=grades,
        exclusion_index=exclusion_index,
    )
    quality_output = {
        "schemaVersion": 1,
        "kind": "memi-fitness-quality-evidence-v2",
        "studyId": protocol["protocolId"],
        "entryCount": len(quality_entries),
        "entries": quality_entries,
    }
    ingestion_entries = _build_ingestion_entries(
        quality_entries=quality_entries,
        legacy_results=legacy_results,
    )
    ingestion_output = {
        "schemaVersion": 1,
        "kind": "memi-fitness-chronological-ingestion-plan",
        "studyId": protocol["protocolId"],
        "dryRun": True,
        "storeWritePlanned": False,
        "entryCount": len(ingestion_entries),
        "entries": ingestion_entries,
    }
    return quality_output, ingestion_output


def write_outputs(
    paths: StudyFitnessPaths,
    quality_output: dict[str, Any],
    ingestion_output: dict[str, Any],
) -> None:
    paths.generated_root.mkdir(parents=True, exist_ok=True)
    paths.quality_evidence_v2_path.write_text(
        json.dumps(quality_output, indent=2) + "\n",
        encoding="utf-8",
    )
    paths.chronological_ingestion_plan_path.write_text(
        json.dumps(ingestion_output, indent=2) + "\n",
        encoding="utf-8",
    )


def verify_outputs(
    paths: StudyFitnessPaths,
    expected_quality: dict[str, Any],
    expected_ingestion: dict[str, Any],
) -> list[CheckMismatch]:
    mismatches: list[CheckMismatch] = []
    for target, expected in [
        (paths.quality_evidence_v2_path, expected_quality),
        (paths.chronological_ingestion_plan_path, expected_ingestion),
    ]:
        if not target.exists():
            mismatches.append(CheckMismatch(target, "file is missing"))
            continue
        actual = load_json(target)
        if actual != expected:
            mismatches.append(CheckMismatch(target, "content differs from deterministic rebuild"))
    return mismatches


def _load_runs(
    paths: StudyFitnessPaths,
    receipt_entries: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    runs: dict[str, dict[str, Any]] = {}
    for receipt in receipt_entries:
        run_id = receipt["runId"]
        run_dir = paths.evidence_runs_root / run_id
        run_path = run_dir / "run.json"
        route_path = run_dir / "route.json"
        if not run_path.exists():
            raise RuntimeError(f"missing sealed run receipt for {run_id}: {run_path}")
        if not route_path.exists():
            raise RuntimeError(f"missing route receipt for {run_id}: {route_path}")
        run = load_json(run_path)
        if run.get("runId") != run_id:
            raise RuntimeError(f"run id mismatch for {run_id}")
        if run.get("prospective", {}).get("trialId") != receipt["trialId"]:
            raise RuntimeError(f"trial id mismatch for {run_id}")
        if run.get("prospective", {}).get("evidenceManifestSha256") != receipt["evidenceManifestSha256"]:
            raise RuntimeError(f"evidence manifest hash mismatch for {run_id}")

        if receipt.get("routeSha256"):
            hashed_path = run_dir / "skill-route.json"
            if not hashed_path.exists():
                hashed_path = route_path
            actual_route_sha = sha256_file(hashed_path)
            if actual_route_sha != receipt["routeSha256"]:
                raise RuntimeError(f"route hash mismatch for {run_id}")

        parse_route_path = route_path
        if receipt.get("routeSha256"):
            hashed_path = run_dir / "skill-route.json"
            if hashed_path.exists():
                parse_route_path = hashed_path

        route_envelope = load_json(parse_route_path)
        route_receipt = _unwrap_route(route_envelope.get("route") if isinstance(route_envelope, dict) else route_envelope)
        repository_fingerprint_hash = None
        selected_skills: list[dict[str, str]] = []
        route_decision = "baseline"
        if route_receipt is not None:
            repository_fingerprint_hash = route_receipt.get("repositoryFingerprintHash")
            route_decision = route_receipt.get("decision", "unknown")
            selected_skills = [
                {
                    "skillId": entry["id"],
                    "contentHash": entry["contentHash"],
                }
                for entry in route_receipt.get("selected", [])
            ]

        runs[receipt["trialId"]] = {
            "receipt": receipt,
            "run": run,
            "routeDecision": route_decision,
            "repositoryFingerprintHash": repository_fingerprint_hash,
            "selectedSkills": selected_skills,
        }
    return runs


def _unwrap_route(candidate: Any) -> dict[str, Any] | None:
    current = candidate
    while isinstance(current, dict):
        if "decision" in current:
            return current
        current = current.get("route")
    return None


def _load_grades(
    *,
    grading: dict[str, Any],
    protocol: dict[str, Any],
    rubric: dict[str, Any],
    exclusion_index: set[str],
    run_records: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    if grading.get("schemaVersion") != 1:
        raise RuntimeError("unsupported blinded grading schema version")
    if grading.get("studyId") not in {None, protocol["protocolId"], "memi-2.7-prospective-v15-273-confirmatory"}:
        raise RuntimeError("blinded grading study id mismatch")

    required_dimensions = [entry["id"] for entry in rubric["dimensions"]]
    expected_trials = {
        trial_id
        for trial_id, record in run_records.items()
        if record["run"]["outcome"]["accepted"] and trial_id not in exclusion_index
    }
    grades: dict[str, dict[str, Any]] = {}
    for entry in grading.get("entries", []):
        trial_id = str(entry.get("trialId", "")).strip()
        ratings = entry.get("ratings")
        if not trial_id:
            raise RuntimeError("grading entry is missing trialId")
        if trial_id in grades:
            raise RuntimeError(f"duplicate grading entry for {trial_id}")
        if not isinstance(ratings, list) or not ratings:
            raise RuntimeError(f"grading entry {trial_id} has no ratings")
        if trial_id not in run_records:
            raise RuntimeError(f"grading entry {trial_id} does not match any accepted sealed run")

        score_values: list[float] = []
        dimension_values = {dimension: [] for dimension in required_dimensions}
        critical_counts: list[int] = []
        grader_ids: set[str] = set()
        for rating in ratings:
            grader_id = str(rating.get("graderId", "")).strip()
            if not grader_id or grader_id in grader_ids:
                raise RuntimeError(f"invalid grader set for {trial_id}")
            grader_ids.add(grader_id)
            if rating.get("blinded") is not True:
                raise RuntimeError(f"non-blinded rating for {trial_id}")
            dimensions = rating.get("dimensions")
            if not isinstance(dimensions, dict):
                raise RuntimeError(f"missing dimensions for {trial_id}")
            score_values.append(float(rating["score"]))
            for dimension in required_dimensions:
                if dimension not in dimensions:
                    raise RuntimeError(f"missing dimension {dimension} for {trial_id}")
                dimension_values[dimension].append(float(dimensions[dimension]))
            critical_defects = rating.get("criticalDefects", [])
            if not isinstance(critical_defects, list):
                raise RuntimeError(f"criticalDefects must be an array for {trial_id}")
            critical_counts.append(len(critical_defects))

        if len(score_values) != int(rubric["graderRules"]["graderCount"]):
            raise RuntimeError(f"unexpected grader count for {trial_id}")
        grades[trial_id] = {
            "trialId": trial_id,
            "score": float(statistics.median(score_values)),
            "dimensionMedians": {
                dimension: float(statistics.median(values))
                for dimension, values in dimension_values.items()
            },
            "criticalDefectCount": int(statistics.median(critical_counts)),
            "graderCount": len(score_values),
            "rawScores": tuple(float(value) for value in score_values),
        }

    missing = sorted(expected_trials - set(grades))
    if missing:
        raise RuntimeError(
            "missing blinded grading entries for accepted trials: " + ", ".join(missing)
        )
    return grades


def _build_v2_quality_entries(
    *,
    protocol: dict[str, Any],
    run_records: dict[str, dict[str, Any]],
    grades: dict[str, dict[str, Any]],
    exclusion_index: set[str],
) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, int], dict[str, dict[str, Any]]] = {}
    for trial_id, record in run_records.items():
        run = record["run"]
        if not run["outcome"]["accepted"]:
            continue
        if trial_id in exclusion_index:
            continue
        key = (run["taskId"], int(run["repeat"]))
        grouped.setdefault(key, {})[run["condition"]] = record

    entries: list[dict[str, Any]] = []
    for task_id, repeat in sorted(grouped):
        pair = grouped[(task_id, repeat)]
        baseline = pair.get("baseline")
        memi = pair.get("memi")
        if baseline is None or memi is None:
            continue
        baseline_trial_id = baseline["run"]["prospective"]["trialId"]
        memi_trial_id = memi["run"]["prospective"]["trialId"]
        if baseline_trial_id not in grades or memi_trial_id not in grades:
            continue
        baseline_grade = grades[baseline_trial_id]
        memi_grade = grades[memi_trial_id]
        quality_evidence = {
            "studyId": protocol["protocolId"],
            "taskId": task_id,
            "repeat": repeat,
            "baselineTrialId": baseline_trial_id,
            "memiTrialId": memi_trial_id,
            "graderCount": baseline_grade["graderCount"],
            "baseline": {
                "score": baseline_grade["score"],
                "dimensionMedians": baseline_grade["dimensionMedians"],
                "criticalDefectCount": baseline_grade["criticalDefectCount"],
                "rawScores": list(baseline_grade["rawScores"]),
            },
            "memi": {
                "score": memi_grade["score"],
                "dimensionMedians": memi_grade["dimensionMedians"],
                "criticalDefectCount": memi_grade["criticalDefectCount"],
                "rawScores": list(memi_grade["rawScores"]),
            },
        }
        quality_sha = canonical_sha256(quality_evidence)
        route = {
            "decision": memi["routeDecision"],
            "repositoryFingerprintHash": memi["repositoryFingerprintHash"],
            "skills": sorted(
                memi["selectedSkills"],
                key=lambda entry: (entry["skillId"], entry["contentHash"]),
            ),
        }
        observed_at = max(
            baseline["run"]["timing"]["completedAt"],
            memi["run"]["timing"]["completedAt"],
        )
        core = {
            "schemaVersion": 2,
            "observedAt": observed_at,
            "taskClass": task_id,
            "pair": {
                "taskId": task_id,
                "repeat": repeat,
                "baselineTrialId": baseline_trial_id,
                "memiTrialId": memi_trial_id,
                "baselineRunId": baseline["run"]["runId"],
                "memiRunId": memi["run"]["runId"],
            },
            "route": route,
            "harness": {
                "provider": memi["run"]["harness"]["id"],
                "modelId": memi["run"]["harness"]["modelId"],
                "reasoningEffort": memi["run"]["harness"]["reasoningEffort"],
            },
            "receipts": {
                "baselineEvidenceManifestSha256": baseline["receipt"]["evidenceManifestSha256"],
                "memiEvidenceManifestSha256": memi["receipt"]["evidenceManifestSha256"],
                "baselineRouteSha256": baseline["receipt"].get("routeSha256"),
                "memiRouteSha256": memi["receipt"].get("routeSha256"),
            },
            "quality": {
                "label": protocol["grading"]["label"],
                "qualityEvidence": quality_evidence,
                "qualityEvidenceSha256": quality_sha,
                "medianScoreBaseline": baseline_grade["score"],
                "medianScoreMemi": memi_grade["score"],
                "deltaMemiMinusBaseline": round(memi_grade["score"] - baseline_grade["score"], 4),
                "qualityParity": (
                    memi_grade["score"] >= baseline_grade["score"]
                    and memi_grade["criticalDefectCount"] <= baseline_grade["criticalDefectCount"]
                ),
            },
            "efficiency": {
                "tokenSavingsRatio": round(_savings_ratio(_total_tokens(baseline["run"]), _total_tokens(memi["run"])), 6),
                "latencySavingsRatio": round(_savings_ratio(
                    float(baseline["run"]["timing"]["wallTimeMs"]),
                    float(memi["run"]["timing"]["wallTimeMs"]),
                ), 6),
                "toolCallSavingsRatio": round(_savings_ratio(
                    float(baseline["run"]["tools"]["calls"]),
                    float(memi["run"]["tools"]["calls"]),
                ), 6),
            },
        }
        entries.append({
            **core,
            "eventId": f"fitness-v2:{canonical_sha256(core).removeprefix('sha256:')}",
            "eventSha256": canonical_sha256(core),
        })
    entries.sort(key=lambda entry: (entry["observedAt"], entry["pair"]["taskId"], entry["pair"]["repeat"]))
    return entries


def _build_ingestion_entries(
    *,
    quality_entries: list[dict[str, Any]],
    legacy_results: dict[str, Any],
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for pair in legacy_results.get("pairs", []):
        token_savings = float(pair.get("savingsPercent", {}).get("totalTokens", 0))
        latency_savings = float(pair.get("savingsPercent", {}).get("wallTime", 0))
        baseline_quality = float(pair.get("baseline", {}).get("qualityScore", 0))
        memi_quality = float(pair.get("memi", {}).get("qualityScore", 0))
        if token_savings >= 0 and latency_savings >= 0 and memi_quality >= baseline_quality:
            continue
        entries.append({
            "observedAt": legacy_results["generatedAt"],
            "sourceVersion": "v1",
            "sourceKind": "legacy-workflow-proof",
            "pairId": pair["experimentId"],
            "taskClass": _legacy_task_class(pair["experimentId"]),
            "routeDecision": "legacy-v1",
            "skills": list(pair.get("skillIds", [])),
            "ingestDecision": "record-v1-only-unmatched-negative",
            "storeWriteEligible": False,
            "reason": "legacy v1 evidence does not carry repository fingerprint or content-hash route identity",
        })
    for entry in quality_entries:
        route_decision = entry["route"]["decision"]
        if route_decision == "abstain":
            ingest_decision = "skip-abstain-route"
            store_write = False
            reason = "route abstained; preserve chronology but do not write an exact-route fitness event"
        else:
            ingest_decision = "record-v2-quality-evidence"
            store_write = True
            reason = "exact-route v2 evidence is complete and hash-verified"
        entries.append({
            "observedAt": entry["observedAt"],
            "sourceVersion": "v2",
            "sourceKind": "v15-confirmatory",
            "pairId": entry["eventId"],
            "taskClass": entry["taskClass"],
            "routeDecision": route_decision,
            "skills": entry["route"]["skills"],
            "ingestDecision": ingest_decision,
            "storeWriteEligible": store_write,
            "reason": reason,
            "qualityEvidenceSha256": entry["quality"]["qualityEvidenceSha256"],
            "eventSha256": entry["eventSha256"],
        })
    entries.sort(key=lambda entry: (entry["observedAt"], entry["taskClass"], entry["pairId"]))
    for index, entry in enumerate(entries, start=1):
        entry["sequence"] = index
    return entries


def _legacy_task_class(experiment_id: str) -> str:
    return re.sub(r"-v\d+$", "", experiment_id)


def _total_tokens(run: dict[str, Any]) -> float:
    usage = run["usage"]
    return float(usage["inputTokens"] + usage["outputTokens"] + usage["reasoningTokens"])


def _savings_ratio(baseline: float, memi: float) -> float:
    if baseline <= 0:
        return 0.0
    return 1 - (memi / baseline)
