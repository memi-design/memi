from __future__ import annotations

import csv
import hashlib
import json
import math
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


BOOTSTRAP_SAMPLES = 10_000
BOOTSTRAP_BASE_SEED = 2715
NONINFERIORITY_MARGIN = -5.0
PROVIDER_FAILURE_REASONS = {"provider-execution-failed", "provider-timeout"}
GRADING_EXCLUSION_SCOPE = "rendered-frontend-grading-only"


class AnalysisInputError(RuntimeError):
    """Raised when frozen confirmatory inputs are incomplete or malformed."""


@dataclass(frozen=True)
class StudyPaths:
    study_root: Path
    analysis_root: Path
    notebook_path: Path
    blinded_grading_path: Path
    generated_root: Path
    tables_root: Path
    figures_root: Path
    evidence_runs_root: Path
    protocol_path: Path
    plan_path: Path
    freeze_path: Path
    rubric_path: Path
    exclusions_path: Path
    deviations_path: Path
    evidence_receipts_path: Path


@dataclass(frozen=True)
class TrialRun:
    trial_id: str
    task_id: str
    repeat: int
    condition: str
    run_id: str
    accepted: bool
    tests_passed: bool
    defects: int
    input_tokens: int
    output_tokens: int
    reasoning_tokens: int
    wall_time_ms: int
    tool_calls: int
    retries: int
    provider_failures: int
    evidence_manifest_sha256: str
    verification_reasons: tuple[str, ...]


@dataclass(frozen=True)
class TrialGrade:
    trial_id: str
    task_id: str
    repeat: int
    condition: str
    score: float
    dimension_medians: dict[str, float]
    critical_defect_count: int
    absolute_disagreement: float
    grader_count: int
    raw_scores: tuple[float, ...]


def study_paths() -> StudyPaths:
    analysis_root = Path(__file__).resolve().parent
    study_root = analysis_root.parent
    generated_root = study_root / "generated"
    return StudyPaths(
        study_root=study_root,
        analysis_root=analysis_root,
        notebook_path=study_root / "analysis.ipynb",
        blinded_grading_path=analysis_root / "blinded_grading.json",
        generated_root=generated_root,
        tables_root=generated_root / "tables",
        figures_root=generated_root / "figures",
        evidence_runs_root=Path("/Volumes/ExtremeSSD/Projects/_evidence/memi-2.7-v15-2.7.3-confirmatory/runs"),
        protocol_path=study_root / "protocol.json",
        plan_path=study_root / "plan.json",
        freeze_path=study_root / "freeze.json",
        rubric_path=study_root / "rubric.json",
        exclusions_path=study_root / "exclusions.json",
        deviations_path=study_root / "deviations.json",
        evidence_receipts_path=study_root / "evidence-receipts.json",
    )


def run_confirmatory_analysis(write_outputs: bool = True) -> dict[str, Any]:
    paths = study_paths()
    protocol = _load_json(paths.protocol_path)
    freeze = _load_json(paths.freeze_path)
    rubric = _load_json(paths.rubric_path)
    exclusions = _load_json(paths.exclusions_path)
    deviations = _load_json(paths.deviations_path)
    receipts = _load_json(paths.evidence_receipts_path)

    preflight = preflight_report(
        protocol=protocol,
        freeze=freeze,
        exclusions=exclusions,
        paths=paths,
    )
    if preflight["errors"]:
        raise AnalysisInputError(_format_preflight_errors(preflight))

    trial_runs = _load_runs(paths.evidence_runs_root)
    exclusion_index = _grade_exclusion_index(exclusions)
    grading = _load_grading(paths.blinded_grading_path, protocol, rubric, exclusion_index, trial_runs)

    primary_rows, primary_summary, loo_rows, reliability_rows = _primary_quality_analysis(
        protocol=protocol,
        rubric=rubric,
        trial_runs=trial_runs,
        trial_grades=grading,
        exclusion_index=exclusion_index,
    )
    secondary_rows = _secondary_analysis(trial_runs)
    pooled_rows = _pooled_descriptives(primary_rows, secondary_rows)

    summary = {
        "studyId": protocol["protocolId"],
        "analysisStatus": "complete",
        "bootstrapSamples": BOOTSTRAP_SAMPLES,
        "nonInferiorityMargin": NONINFERIORITY_MARGIN,
        "primarySummary": primary_summary,
        "primaryPairRows": primary_rows,
        "leaveOnePairOut": loo_rows,
        "secondaryTests": secondary_rows,
        "pooledDescriptives": pooled_rows,
        "graderReliability": reliability_rows,
        "deviations": deviations["entries"],
        "exclusions": exclusions["entries"],
    }

    if write_outputs:
        _write_outputs(paths, summary)

    return summary


def preflight_report(
    protocol: dict[str, Any] | None = None,
    freeze: dict[str, Any] | None = None,
    exclusions: dict[str, Any] | None = None,
    paths: StudyPaths | None = None,
) -> dict[str, Any]:
    paths = paths or study_paths()
    protocol = protocol or _load_json(paths.protocol_path)
    freeze = freeze or _load_json(paths.freeze_path)
    exclusions = exclusions or _load_json(paths.exclusions_path)

    expected_trials = {
        entry["trialId"]: entry
        for entry in freeze["trials"]
    }
    run_files = sorted(paths.evidence_runs_root.glob("*/run.json"))
    present_trial_ids: dict[str, str] = {}
    duplicate_trial_ids: dict[str, list[str]] = {}

    for run_path in run_files:
        payload = _load_json(run_path)
        trial_id = payload["prospective"]["trialId"]
        run_id = payload["runId"]
        if trial_id in present_trial_ids:
            duplicate_trial_ids.setdefault(trial_id, [present_trial_ids[trial_id]]).append(run_id)
        else:
            present_trial_ids[trial_id] = run_id

    missing_trial_ids = sorted(set(expected_trials) - set(present_trial_ids))
    extra_trial_ids = sorted(set(present_trial_ids) - set(expected_trials))
    excluded_grade_only = sorted(_grade_exclusion_index(exclusions))
    grading_exists = paths.blinded_grading_path.exists()

    errors: list[str] = []
    if missing_trial_ids:
        errors.append(
            "missing run receipts for "
            f"{len(missing_trial_ids)} frozen trials under {paths.evidence_runs_root}: "
            + ", ".join(missing_trial_ids)
        )
    if duplicate_trial_ids:
        duplicate_text = ", ".join(
            f"{trial_id} -> {', '.join(run_ids)}"
            for trial_id, run_ids in sorted(duplicate_trial_ids.items())
        )
        errors.append(f"duplicate run receipts detected: {duplicate_text}")
    if extra_trial_ids:
        errors.append(f"unexpected trial ids present in evidence root: {', '.join(extra_trial_ids)}")
    if not grading_exists:
        errors.append(f"missing blinded grading file: {paths.blinded_grading_path}")

    return {
        "protocolId": protocol["protocolId"],
        "expectedCells": protocol["design"]["agentCells"],
        "expectedTrials": len(expected_trials),
        "presentTrials": len(present_trial_ids),
        "missingTrials": missing_trial_ids,
        "duplicateTrials": duplicate_trial_ids,
        "extraTrials": extra_trial_ids,
        "gradeOnlyExclusions": excluded_grade_only,
        "blindedGradingPath": str(paths.blinded_grading_path),
        "blindedGradingPresent": grading_exists,
        "errors": errors,
    }


def _load_runs(runs_root: Path) -> dict[str, TrialRun]:
    runs: dict[str, TrialRun] = {}
    for run_path in sorted(runs_root.glob("*/run.json")):
        payload = _load_json(run_path)
        trial_id = payload["prospective"]["trialId"]
        manifest_path = run_path.with_name("evidence-manifest.json")
        verification_path = run_path.with_name("verification.json")
        manifest = _load_json(manifest_path)
        verification = _load_json(verification_path)
        manifest_sha = _sha256_file(manifest_path)
        if manifest_sha != payload["prospective"]["evidenceManifestSha256"]:
            raise AnalysisInputError(
                f"manifest hash mismatch for {trial_id}: "
                f"{manifest_sha} != {payload['prospective']['evidenceManifestSha256']}"
            )
        if manifest["manifestSha256"] != manifest_sha:
            raise AnalysisInputError(
                f"manifest self-hash mismatch for {trial_id}: {manifest['manifestSha256']} != {manifest_sha}"
            )
        if manifest["trialId"] != trial_id:
            raise AnalysisInputError(
                f"manifest trial id mismatch for {trial_id}: {manifest['trialId']}"
            )
        listed_run = next((entry for entry in manifest["files"] if entry["name"] == "run.json"), None)
        if listed_run is None:
            raise AnalysisInputError(f"run.json missing from evidence manifest for {trial_id}")
        actual_run_sha = _sha256_file(run_path)
        if listed_run["sha256"] != actual_run_sha:
            raise AnalysisInputError(
                f"run.json hash mismatch for {trial_id}: {listed_run['sha256']} != {actual_run_sha}"
            )
        failed_reasons = tuple(
            str(item.get("reason"))
            for item in verification
            if item.get("passed") is False and item.get("reason")
        )
        run = TrialRun(
            trial_id=trial_id,
            task_id=payload["taskId"],
            repeat=int(payload["repeat"]),
            condition=payload["condition"],
            run_id=payload["runId"],
            accepted=bool(payload["outcome"]["accepted"]),
            tests_passed=bool(payload["outcome"]["testsPassed"]),
            defects=int(payload["outcome"]["defects"]),
            input_tokens=int(payload["usage"]["inputTokens"]),
            output_tokens=int(payload["usage"]["outputTokens"]),
            reasoning_tokens=int(payload["usage"]["reasoningTokens"]),
            wall_time_ms=int(payload["timing"]["wallTimeMs"]),
            tool_calls=int(payload["tools"]["calls"]),
            retries=int(payload["tools"]["retries"]),
            provider_failures=int(any(reason in PROVIDER_FAILURE_REASONS for reason in failed_reasons)),
            evidence_manifest_sha256=manifest_sha,
            verification_reasons=failed_reasons,
        )
        if trial_id in runs:
            raise AnalysisInputError(f"duplicate run receipt loaded for {trial_id}")
        runs[trial_id] = run
    return runs


def _load_grading(
    grading_path: Path,
    protocol: dict[str, Any],
    rubric: dict[str, Any],
    exclusion_index: set[str],
    trial_runs: dict[str, TrialRun],
) -> dict[str, TrialGrade]:
    payload = _load_json(grading_path)
    if payload.get("schemaVersion") != 1:
        raise AnalysisInputError(f"unsupported grading schema version in {grading_path}")
    if payload.get("studyId") not in {None, protocol["protocolId"], "memi-2.7-prospective-v15-273-confirmatory"}:
        raise AnalysisInputError(
            f"grading study id mismatch in {grading_path}: {payload.get('studyId')}"
        )
    entries = payload.get("entries")
    if not isinstance(entries, list):
        raise AnalysisInputError(f"grading entries must be an array in {grading_path}")

    required_dimensions = [entry["id"] for entry in rubric["dimensions"]]
    expected_trials = {
        trial_id for trial_id in trial_runs
        if trial_id not in exclusion_index
    }
    grades: dict[str, TrialGrade] = {}
    for entry in entries:
        trial_id = str(entry.get("trialId", "")).strip()
        ratings = entry.get("ratings")
        if not trial_id:
            raise AnalysisInputError(f"grading entry missing trialId in {grading_path}")
        if trial_id in grades:
            raise AnalysisInputError(f"duplicate grading entry for {trial_id} in {grading_path}")
        if not isinstance(ratings, list) or not ratings:
            raise AnalysisInputError(f"grading entry {trial_id} has no ratings in {grading_path}")
        score_values: list[float] = []
        dimension_values: dict[str, list[float]] = {dimension: [] for dimension in required_dimensions}
        critical_defect_counts: list[int] = []
        grader_ids: set[str] = set()
        for rating in ratings:
            grader_id = str(rating.get("graderId", "")).strip()
            if not grader_id:
                raise AnalysisInputError(f"grading entry {trial_id} has a rating without graderId")
            if grader_id in grader_ids:
                raise AnalysisInputError(f"grading entry {trial_id} duplicates graderId {grader_id}")
            grader_ids.add(grader_id)
            if rating.get("blinded") is not True:
                raise AnalysisInputError(f"grading entry {trial_id} has non-blinded rating {grader_id}")
            receipt_ref = str(rating.get("receiptRef", "")).strip()
            if not receipt_ref:
                raise AnalysisInputError(f"grading entry {trial_id} missing receiptRef for {grader_id}")
            score = float(rating.get("score"))
            score_values.append(score)
            dimensions = rating.get("dimensions")
            if not isinstance(dimensions, dict):
                raise AnalysisInputError(f"grading entry {trial_id} missing dimensions for {grader_id}")
            for dimension in required_dimensions:
                if dimension not in dimensions:
                    raise AnalysisInputError(
                        f"grading entry {trial_id} missing dimension {dimension} for {grader_id}"
                    )
                dimension_values[dimension].append(float(dimensions[dimension]))
            critical_defects = rating.get("criticalDefects", [])
            if not isinstance(critical_defects, list):
                raise AnalysisInputError(f"grading entry {trial_id} criticalDefects must be an array")
            critical_defect_counts.append(len(critical_defects))

        if len(score_values) != rubric["graderRules"]["graderCount"]:
            raise AnalysisInputError(
                f"grading entry {trial_id} expected {rubric['graderRules']['graderCount']} ratings, "
                f"found {len(score_values)}"
            )
        if trial_id not in trial_runs:
            raise AnalysisInputError(f"grading entry {trial_id} does not match any immutable run receipt")
        grades[trial_id] = TrialGrade(
            trial_id=trial_id,
            task_id=trial_runs[trial_id].task_id,
            repeat=trial_runs[trial_id].repeat,
            condition=trial_runs[trial_id].condition,
            score=float(statistics.median(score_values)),
            dimension_medians={
                dimension: float(statistics.median(values))
                for dimension, values in dimension_values.items()
            },
            critical_defect_count=int(statistics.median(critical_defect_counts)),
            absolute_disagreement=_absolute_disagreement(score_values),
            grader_count=len(score_values),
            raw_scores=tuple(float(value) for value in score_values),
        )

    missing_grades = sorted(expected_trials - set(grades))
    extra_grades = sorted(set(grades) - expected_trials)
    if missing_grades:
        raise AnalysisInputError(
            f"missing blinded grading entries for {len(missing_grades)} trials: {', '.join(missing_grades)}"
        )
    if extra_grades:
        raise AnalysisInputError(
            f"unexpected blinded grading entries present: {', '.join(extra_grades)}"
        )
    return grades


def _primary_quality_analysis(
    protocol: dict[str, Any],
    rubric: dict[str, Any],
    trial_runs: dict[str, TrialRun],
    trial_grades: dict[str, TrialGrade],
    exclusion_index: set[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    grouped: dict[tuple[str, int], dict[str, TrialGrade]] = {}
    for grade in trial_grades.values():
        grouped.setdefault((grade.task_id, grade.repeat), {})[grade.condition] = grade

    pair_rows: list[dict[str, Any]] = []
    reliability_rows: list[dict[str, Any]] = []
    grouped_scores_by_task: dict[str, list[float]] = {}
    for pair_key, pair in sorted(grouped.items()):
        task_id, repeat = pair_key
        if len(pair) != 2 or "baseline" not in pair or "memi" not in pair:
            raise AnalysisInputError(f"incomplete graded pair for {task_id} repeat {repeat}")
        baseline = pair["baseline"]
        memi = pair["memi"]
        if baseline.trial_id in exclusion_index or memi.trial_id in exclusion_index:
            continue
        delta = memi.score - baseline.score
        pair_rows.append({
            "task_id": task_id,
            "repeat": repeat,
            "baseline_trial_id": baseline.trial_id,
            "memi_trial_id": memi.trial_id,
            "baseline_score": round(baseline.score, 4),
            "memi_score": round(memi.score, 4),
            "delta_memi_minus_baseline": round(delta, 4),
        })
        grouped_scores_by_task.setdefault(task_id, []).append(delta)
        reliability_rows.append({
            "task_id": task_id,
            "repeat": repeat,
            "baseline_absolute_disagreement": round(baseline.absolute_disagreement, 4),
            "memi_absolute_disagreement": round(memi.absolute_disagreement, 4),
            "baseline_grader_count": baseline.grader_count,
            "memi_grader_count": memi.grader_count,
        })

    summary_rows: list[dict[str, Any]] = []
    loo_rows: list[dict[str, Any]] = []
    for task_id, deltas in sorted(grouped_scores_by_task.items()):
        bootstrap = _bootstrap_mean_interval(
            deltas,
            samples=protocol["primaryOutcome"]["bootstrapSamples"],
            seed=_task_seed(task_id),
        )
        sign = _exact_sign_test(deltas, alternative="greater")
        summary_rows.append({
            "task_id": task_id,
            "graded_pairs": len(deltas),
            "mean_delta": round(float(np.mean(deltas)), 4),
            "median_delta": round(float(np.median(deltas)), 4),
            "sign_test_positive": sign["positive"],
            "sign_test_negative": sign["negative"],
            "sign_test_ties": sign["ties"],
            "sign_test_p_greater": round(sign["p_value"], 6),
            "bootstrap_ci_lower_2p5": round(bootstrap["two_sided_lower"], 4),
            "bootstrap_ci_upper_97p5": round(bootstrap["two_sided_upper"], 4),
            "noninferiority_lower_95_one_sided": round(bootstrap["one_sided_lower"], 4),
            "noninferiority_margin": NONINFERIORITY_MARGIN,
            "noninferior": bootstrap["one_sided_lower"] > NONINFERIORITY_MARGIN,
        })
        loo_rows.extend(_leave_one_out_rows(task_id, deltas))

    score_matrix = [
        grade.raw_scores
        for grade in trial_grades.values()
        if grade.trial_id not in exclusion_index
    ]
    icc_value = _icc2_1(score_matrix)
    reliability_rows.append({
        "task_id": "all-graded-trials",
        "repeat": "pooled",
        "baseline_absolute_disagreement": None,
        "memi_absolute_disagreement": None,
        "baseline_grader_count": None,
        "memi_grader_count": None,
        "icc2_1_absolute_agreement": None if icc_value is None else round(icc_value, 6),
    })
    return pair_rows, summary_rows, loo_rows, reliability_rows


def _secondary_analysis(trial_runs: dict[str, TrialRun]) -> list[dict[str, Any]]:
    pair_index: dict[tuple[str, int], dict[str, TrialRun]] = {}
    for run in trial_runs.values():
        pair_index.setdefault((run.task_id, run.repeat), {})[run.condition] = run

    metrics = {
        "functional_acceptance": ("accepted", "higher"),
        "critical_defects": ("defects", "lower"),
        "input_tokens": ("input_tokens", "lower"),
        "output_tokens": ("output_tokens", "lower"),
        "reasoning_tokens": ("reasoning_tokens", "lower"),
        "wall_time_ms": ("wall_time_ms", "lower"),
        "tool_calls": ("tool_calls", "lower"),
        "retries": ("retries", "lower"),
        "provider_failures": ("provider_failures", "lower"),
    }
    rows: list[dict[str, Any]] = []
    pvalue_rows: list[tuple[int, float]] = []
    for task_id in sorted({task_id for task_id, _ in pair_index}):
        task_pairs = [
            pair_index[(task_id, repeat)]
            for repeat in sorted(repeat for other_task, repeat in pair_index if other_task == task_id)
        ]
        for metric_name, (field, direction) in metrics.items():
            deltas: list[float] = []
            for pair in task_pairs:
                if "baseline" not in pair or "memi" not in pair:
                    continue
                baseline = pair["baseline"]
                memi = pair["memi"]
                raw_delta = float(getattr(memi, field)) - float(getattr(baseline, field))
                deltas.append(raw_delta)
            if not deltas:
                continue
            better_deltas = deltas if direction == "higher" else [-value for value in deltas]
            sign = _exact_sign_test(better_deltas, alternative="greater")
            row = {
                "task_id": task_id,
                "metric": metric_name,
                "pairs": len(deltas),
                "direction": direction,
                "mean_raw_delta": round(float(np.mean(deltas)), 4),
                "median_raw_delta": round(float(np.median(deltas)), 4),
                "sign_test_positive": sign["positive"],
                "sign_test_negative": sign["negative"],
                "sign_test_ties": sign["ties"],
                "p_value_raw": sign["p_value"],
            }
            rows.append(row)
            pvalue_rows.append((len(rows) - 1, sign["p_value"]))

    adjusted = _holm_adjustment([pvalue for _, pvalue in pvalue_rows])
    for (row_index, _), adjusted_pvalue in zip(pvalue_rows, adjusted):
        rows[row_index]["p_value_holm"] = round(adjusted_pvalue, 6)
        rows[row_index]["reject_holm_0p05"] = adjusted_pvalue <= 0.05
        rows[row_index]["p_value_raw"] = round(rows[row_index]["p_value_raw"], 6)
    return rows


def _pooled_descriptives(
    primary_rows: list[dict[str, Any]],
    secondary_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    pooled: list[dict[str, Any]] = []
    if primary_rows:
        deltas = [row["delta_memi_minus_baseline"] for row in primary_rows]
        pooled.append({
            "family": "primary_quality",
            "rows": len(deltas),
            "mean_delta": round(float(np.mean(deltas)), 4),
            "median_delta": round(float(np.median(deltas)), 4),
            "min_delta": round(float(np.min(deltas)), 4),
            "max_delta": round(float(np.max(deltas)), 4),
        })
    by_metric: dict[str, list[float]] = {}
    for row in secondary_rows:
        by_metric.setdefault(row["metric"], []).append(float(row["mean_raw_delta"]))
    for metric, values in sorted(by_metric.items()):
        pooled.append({
            "family": "secondary_descriptive",
            "metric": metric,
            "rows": len(values),
            "mean_task_mean_delta": round(float(np.mean(values)), 4),
            "median_task_mean_delta": round(float(np.median(values)), 4),
        })
    return pooled


def _write_outputs(paths: StudyPaths, summary: dict[str, Any]) -> None:
    paths.tables_root.mkdir(parents=True, exist_ok=True)
    paths.figures_root.mkdir(parents=True, exist_ok=True)

    _write_csv(
        paths.tables_root / "primary_pair_level.csv",
        summary["primaryPairRows"],
    )
    _write_csv(
        paths.tables_root / "primary_task_summary.csv",
        summary["primarySummary"],
    )
    _write_csv(
        paths.tables_root / "leave_one_pair_out.csv",
        summary["leaveOnePairOut"],
    )
    _write_csv(
        paths.tables_root / "secondary_task_tests.csv",
        summary["secondaryTests"],
    )
    _write_csv(
        paths.tables_root / "pooled_descriptive.csv",
        summary["pooledDescriptives"],
    )
    _write_csv(
        paths.tables_root / "grader_reliability.csv",
        summary["graderReliability"],
    )
    (paths.tables_root / "analysis_summary.json").write_text(
        json.dumps(summary, indent=2),
        encoding="utf-8",
    )

    if summary["primarySummary"]:
        _plot_primary_deltas(paths.figures_root / "primary_task_mean_deltas.png", summary["primarySummary"])
        _plot_noninferiority_bounds(
            paths.figures_root / "primary_noninferiority_bounds.png",
            summary["primarySummary"],
        )


def _plot_primary_deltas(path: Path, rows: list[dict[str, Any]]) -> None:
    tasks = [row["task_id"] for row in rows]
    means = [row["mean_delta"] for row in rows]
    fig, axis = plt.subplots(figsize=(8, 4.5))
    axis.bar(tasks, means, color=["#234f7d", "#3c7a89", "#5a9367"])
    axis.axhline(0, color="#444444", linewidth=1)
    axis.set_title("Mean paired design-score delta by task")
    axis.set_ylabel("Memi minus baseline")
    axis.set_xlabel("Task")
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)


def _plot_noninferiority_bounds(path: Path, rows: list[dict[str, Any]]) -> None:
    tasks = [row["task_id"] for row in rows]
    means = np.array([row["mean_delta"] for row in rows], dtype=float)
    lowers = np.array([row["noninferiority_lower_95_one_sided"] for row in rows], dtype=float)
    uppers = np.array([row["bootstrap_ci_upper_97p5"] for row in rows], dtype=float)
    y = np.arange(len(tasks))
    fig, axis = plt.subplots(figsize=(8, 4.5))
    axis.errorbar(
        means,
        y,
        xerr=[means - lowers, uppers - means],
        fmt="o",
        color="#234f7d",
        ecolor="#7a8ca1",
        capsize=4,
    )
    axis.axvline(NONINFERIORITY_MARGIN, color="#ad343e", linestyle="--", linewidth=1.5)
    axis.set_yticks(y, tasks)
    axis.set_xlabel("Memi minus baseline")
    axis.set_title("Bootstrap interval with one-sided NI margin")
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _grade_exclusion_index(exclusions: dict[str, Any]) -> set[str]:
    return {
        entry["trialId"]
        for entry in exclusions.get("entries", [])
        if entry.get("scope") == GRADING_EXCLUSION_SCOPE
    }


def _leave_one_out_rows(task_id: str, deltas: list[float]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    base = np.asarray(deltas, dtype=float)
    if len(base) < 2:
        return rows
    for index in range(len(base)):
        reduced = np.delete(base, index)
        bootstrap = _bootstrap_mean_interval(
            reduced.tolist(),
            samples=BOOTSTRAP_SAMPLES,
            seed=_task_seed(f"{task_id}-loo-{index}"),
        )
        rows.append({
            "task_id": task_id,
            "omitted_pair_index": index + 1,
            "remaining_pairs": len(reduced),
            "mean_delta": round(float(np.mean(reduced)), 4),
            "noninferiority_lower_95_one_sided": round(bootstrap["one_sided_lower"], 4),
            "noninferior": bootstrap["one_sided_lower"] > NONINFERIORITY_MARGIN,
        })
    return rows


def _bootstrap_mean_interval(deltas: list[float], samples: int, seed: int) -> dict[str, float]:
    data = np.asarray(deltas, dtype=float)
    if data.size == 0:
        raise AnalysisInputError("bootstrap requested on an empty paired delta set")
    rng = np.random.default_rng(seed)
    indices = rng.integers(0, data.size, size=(samples, data.size))
    resampled = data[indices].mean(axis=1)
    return {
        "two_sided_lower": float(np.quantile(resampled, 0.025)),
        "two_sided_upper": float(np.quantile(resampled, 0.975)),
        "one_sided_lower": float(np.quantile(resampled, 0.05)),
    }


def _exact_sign_test(deltas: list[float], alternative: str = "greater") -> dict[str, Any]:
    positive = sum(delta > 0 for delta in deltas)
    negative = sum(delta < 0 for delta in deltas)
    ties = sum(delta == 0 for delta in deltas)
    trials = positive + negative
    if trials == 0:
        return {"positive": positive, "negative": negative, "ties": ties, "p_value": 1.0}
    if alternative == "greater":
        tail = range(positive, trials + 1)
        p_value = sum(_binomial_pmf(trials, count) for count in tail)
    elif alternative == "less":
        tail = range(0, positive + 1)
        p_value = sum(_binomial_pmf(trials, count) for count in tail)
    else:
        lower_tail = sum(_binomial_pmf(trials, count) for count in range(0, min(positive, negative) + 1))
        p_value = min(1.0, 2 * lower_tail)
    return {
        "positive": positive,
        "negative": negative,
        "ties": ties,
        "p_value": float(p_value),
    }


def _binomial_pmf(trials: int, successes: int) -> float:
    return math.comb(trials, successes) * (0.5 ** trials)


def _holm_adjustment(pvalues: list[float]) -> list[float]:
    if not pvalues:
        return []
    ranked = sorted(enumerate(pvalues), key=lambda item: item[1])
    total = len(ranked)
    adjusted_ranked: list[tuple[int, float]] = []
    running = 0.0
    for position, (index, pvalue) in enumerate(ranked):
        adjusted = min(1.0, (total - position) * pvalue)
        running = max(running, adjusted)
        adjusted_ranked.append((index, running))
    output = [0.0] * total
    for index, value in adjusted_ranked:
        output[index] = value
    return output


def _absolute_disagreement(scores: list[float]) -> float:
    if len(scores) < 2:
        return 0.0
    total = 0.0
    pairs = 0
    for left in range(len(scores)):
        for right in range(left + 1, len(scores)):
            total += abs(scores[left] - scores[right])
            pairs += 1
    return total / pairs


def _icc2_1(score_matrix: list[tuple[float, ...]]) -> float | None:
    if not score_matrix:
        return None
    lengths = {len(row) for row in score_matrix}
    if len(lengths) != 1:
        return None
    raters = lengths.pop()
    if raters < 2 or len(score_matrix) < 2:
        return None
    data = np.asarray(score_matrix, dtype=float)
    n, k = data.shape
    mean_targets = np.mean(data, axis=1, keepdims=True)
    mean_raters = np.mean(data, axis=0, keepdims=True)
    grand_mean = float(np.mean(data))
    ss_targets = float(k * np.sum((mean_targets - grand_mean) ** 2))
    ss_raters = float(n * np.sum((mean_raters - grand_mean) ** 2))
    residual = data - mean_targets - mean_raters + grand_mean
    ss_error = float(np.sum(residual ** 2))
    ms_targets = ss_targets / (n - 1)
    ms_raters = ss_raters / (k - 1)
    ms_error = ss_error / ((n - 1) * (k - 1))
    denominator = ms_targets + (k - 1) * ms_error + (k * (ms_raters - ms_error) / n)
    if denominator == 0:
        return None
    return (ms_targets - ms_error) / denominator


def _task_seed(task_id: str) -> int:
    digest = hashlib.sha256(task_id.encode("utf-8")).digest()
    return BOOTSTRAP_BASE_SEED + int.from_bytes(digest[:4], "big")


def _format_preflight_errors(preflight: dict[str, Any]) -> str:
    return "Confirmatory analysis blocked:\n" + "\n".join(
        f"- {message}" for message in preflight["errors"]
    )


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"
