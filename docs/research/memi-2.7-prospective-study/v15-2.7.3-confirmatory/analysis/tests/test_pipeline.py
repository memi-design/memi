from __future__ import annotations

import json
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace

from analysis.pipeline import (
    AnalysisInputError,
    TrialGrade,
    TrialRun,
    _bootstrap_mean_interval,
    _canonical_manifest_sha256,
    _exact_sign_test,
    _hash_evidence_artifact,
    _holm_adjustment,
    _icc2_1,
    _leave_one_out_rows,
    _provider_failure_from_events,
    _primary_quality_analysis,
    _secondary_analysis,
    _write_csv,
    _write_outputs,
    preflight_report,
)


class SignTestTests(unittest.TestCase):
    def test_exact_sign_test_counts_positive_negative_and_ties(self) -> None:
        result = _exact_sign_test([3, 2, 0, -1], alternative="greater")
        self.assertEqual(result["positive"], 2)
        self.assertEqual(result["negative"], 1)
        self.assertEqual(result["ties"], 1)
        self.assertAlmostEqual(result["p_value"], 0.5)


class BootstrapTests(unittest.TestCase):
    def test_bootstrap_interval_is_deterministic(self) -> None:
        left = _bootstrap_mean_interval([1.0, 2.0, 3.0], samples=1000, seed=11)
        right = _bootstrap_mean_interval([1.0, 2.0, 3.0], samples=1000, seed=11)
        self.assertEqual(left, right)

    def test_leave_one_out_preserves_frozen_repeat_identity(self) -> None:
        rows = _leave_one_out_rows("task-a", [(1, -3.0), (2, -7.0), (6, 3.0)])

        self.assertEqual([row["omitted_repeat"] for row in rows], [1, 2, 6])


class HolmTests(unittest.TestCase):
    def test_holm_adjustment_is_monotone(self) -> None:
        adjusted = _holm_adjustment([0.01, 0.04, 0.03])
        self.assertEqual(adjusted, [0.03, 0.06, 0.06])


class IccTests(unittest.TestCase):
    def test_icc_returns_none_when_matrix_is_not_estimable(self) -> None:
        self.assertIsNone(_icc2_1([(1.0,), (2.0,)]))


class CsvOutputTests(unittest.TestCase):
    def test_writes_heterogeneous_rows_with_union_of_columns(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rows.csv"
            _write_csv(path, [
                {"family": "primary", "mean_delta": 2.0},
                {"family": "secondary", "metric": "tokens", "median_delta": -1.0},
            ])
            header, first, second = path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(
                header.split(","),
                ["family", "mean_delta", "metric", "median_delta"],
            )
            self.assertEqual(first, "primary,2.0,,")
            self.assertEqual(second, "secondary,,tokens,-1.0")
            self.assertNotIn("\r", path.read_text(encoding="utf-8"))


class ProviderFailureTests(unittest.TestCase):
    def test_provider_failures_are_derived_from_events(self) -> None:
        events = [
            {"type": "workflow.adapter.completed", "exitCode": 1},
            {"type": "workflow.verification.skipped", "reason": "provider-execution-failed", "providerExitCode": 1},
        ]
        self.assertEqual(_provider_failure_from_events(events), 1)

    def test_non_provider_events_do_not_count_as_provider_failures(self) -> None:
        events = [
            {"type": "workflow.adapter.completed", "exitCode": 0},
            {"type": "workflow.verification.completed", "passed": True},
        ]
        self.assertEqual(_provider_failure_from_events(events), 0)


class EvidenceHashTests(unittest.TestCase):
    def test_manifest_hash_uses_canonical_content_without_manifest_field(self) -> None:
        manifest = {
            "schemaVersion": 1,
            "trialId": "trial-1",
            "files": [
                {"name": "events.jsonl", "bytes": 10, "sha256": "sha256:" + "1" * 64},
                {"name": "run.json", "bytes": 20, "sha256": "sha256:" + "2" * 64},
            ],
            "manifestSha256": "sha256:" + "3" * 64,
        }
        expected = "sha256:" + sha256(json.dumps({
            "schemaVersion": 1,
            "trialId": "trial-1",
            "files": manifest["files"],
        }, separators=(",", ":"), sort_keys=True).encode("utf-8")).hexdigest()
        self.assertEqual(_canonical_manifest_sha256(manifest), expected)

    def test_run_hash_zeros_manifest_placeholder_before_hashing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "run.json"
            path.write_text(json.dumps({
                "schemaVersion": 1,
                "prospective": {
                    "evidenceManifestSha256": "sha256:" + "a" * 64,
                },
            }, indent=2) + "\n", encoding="utf-8")
            actual = _hash_evidence_artifact(path, "run.json")
            replaced = path.read_text(encoding="utf-8").replace(
                '"evidenceManifestSha256": "sha256:' + "a" * 64 + '"',
                '"evidenceManifestSha256": "sha256:' + "0" * 64 + '"',
            )
            expected = "sha256:" + sha256(replaced.encode("utf-8")).hexdigest()
            self.assertEqual(actual, expected)


class PreflightTests(unittest.TestCase):
    def test_preflight_reports_missing_evidence_and_grading(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runs_root = root / "runs"
            runs_root.mkdir()
            grading_path = root / "blinded_grading.json"
            report = preflight_report(
                protocol={"protocolId": "study", "design": {"agentCells": 2}},
                freeze={"trials": [{"trialId": "t1"}, {"trialId": "t2"}]},
                exclusions={"entries": []},
                paths=type("Paths", (), {
                    "evidence_runs_root": runs_root,
                    "blinded_grading_path": grading_path,
                })(),
            )
            self.assertEqual(report["presentTrials"], 0)
            self.assertIn("missing blinded grading file", "\n".join(report["errors"]))
            self.assertIn("missing run receipts", "\n".join(report["errors"]))


class AnalysisInputErrorTests(unittest.TestCase):
    def test_analysis_input_error_str_is_preserved(self) -> None:
        message = "Confirmatory analysis blocked"
        self.assertEqual(str(AnalysisInputError(message)), message)


class PrimaryQualityAnalysisTests(unittest.TestCase):
    def setUp(self) -> None:
        self.protocol = {
            "primaryOutcome": {
                "bootstrapSamples": 100,
            },
        }
        self.rubric = {
            "dimensions": [
                {"id": "task-interaction-correctness"},
                {"id": "accessibility"},
            ],
        }

    def test_skips_incomplete_pair_when_missing_sibling_is_explicitly_excluded(self) -> None:
        trial_runs = {
            "task-a:r1:baseline": self._run("task-a:r1:baseline", "task-a", 1, "baseline"),
            "task-a:r1:memi": self._run("task-a:r1:memi", "task-a", 1, "memi"),
            "task-a:r2:baseline": self._run("task-a:r2:baseline", "task-a", 2, "baseline"),
            "task-a:r2:memi": self._run("task-a:r2:memi", "task-a", 2, "memi"),
        }
        trial_grades = {
            "task-a:r1:baseline": self._grade("task-a:r1:baseline", "task-a", 1, "baseline", 80),
            "task-a:r1:memi": self._grade("task-a:r1:memi", "task-a", 1, "memi", 85),
            "task-a:r2:baseline": self._grade("task-a:r2:baseline", "task-a", 2, "baseline", 82),
        }

        pair_rows, primary_summary, _, reliability_rows = _primary_quality_analysis(
            protocol=self.protocol,
            rubric=self.rubric,
            trial_runs=trial_runs,
            trial_grades=trial_grades,
            exclusion_index={"task-a:r2:memi"},
        )

        self.assertEqual(len(pair_rows), 1)
        self.assertEqual(pair_rows[0]["repeat"], 1)
        self.assertEqual(len(primary_summary), 1)
        self.assertEqual(primary_summary[0]["graded_pairs"], 1)
        self.assertEqual(reliability_rows[-1]["task_id"], "all-graded-trials")

    def test_fails_on_incomplete_pair_when_missing_sibling_is_unexplained(self) -> None:
        trial_runs = {
            "task-a:r1:baseline": self._run("task-a:r1:baseline", "task-a", 1, "baseline"),
            "task-a:r1:memi": self._run("task-a:r1:memi", "task-a", 1, "memi"),
        }
        trial_grades = {
            "task-a:r1:baseline": self._grade("task-a:r1:baseline", "task-a", 1, "baseline", 80),
        }

        with self.assertRaisesRegex(AnalysisInputError, "incomplete graded pair for task-a repeat 1"):
            _primary_quality_analysis(
                protocol=self.protocol,
                rubric=self.rubric,
                trial_runs=trial_runs,
                trial_grades=trial_grades,
                exclusion_index=set(),
            )

    def _run(self, trial_id: str, task_id: str, repeat: int, condition: str) -> TrialRun:
        return TrialRun(
            trial_id=trial_id,
            task_id=task_id,
            repeat=repeat,
            condition=condition,
            run_id=f"run-{trial_id}",
            accepted=True,
            tests_passed=True,
            defects=0,
            input_tokens=10,
            output_tokens=1,
            reasoning_tokens=1,
            wall_time_ms=100,
            tool_calls=1,
            retries=0,
            provider_failures=0,
            evidence_manifest_sha256="sha256:test",
            verification_reasons=(),
        )

    def _grade(self, trial_id: str, task_id: str, repeat: int, condition: str, score: float) -> TrialGrade:
        return TrialGrade(
            trial_id=trial_id,
            task_id=task_id,
            repeat=repeat,
            condition=condition,
            score=score,
            dimension_medians={
                "task-interaction-correctness": score / 2,
                "accessibility": score / 2,
            },
            critical_defect_count=0,
            absolute_disagreement=0.0,
            grader_count=3,
            raw_scores=(score, score, score),
        )


class SecondaryAnalysisTests(unittest.TestCase):
    def test_every_task_metric_has_a_deterministic_10000_sample_paired_interval(self) -> None:
        trial_runs = {}
        for repeat, baseline_tokens, memi_tokens in [
            (1, 100, 80),
            (2, 120, 110),
            (3, 90, 95),
        ]:
            baseline = _trial_run(
                trial_id=f"task-a:r{repeat}:baseline",
                repeat=repeat,
                condition="baseline",
                input_tokens=baseline_tokens,
                output_tokens=20 + repeat,
                reasoning_tokens=10 + repeat,
                wall_time_ms=1_000 + repeat * 100,
                tool_calls=10 + repeat,
                retries=repeat % 2,
                provider_failures=0,
                accepted=True,
                defects=repeat % 2,
            )
            memi = _trial_run(
                trial_id=f"task-a:r{repeat}:memi",
                repeat=repeat,
                condition="memi",
                input_tokens=memi_tokens,
                output_tokens=18 + repeat,
                reasoning_tokens=9 + repeat,
                wall_time_ms=900 + repeat * 120,
                tool_calls=9 + repeat,
                retries=0,
                provider_failures=1 if repeat == 3 else 0,
                accepted=repeat != 3,
                defects=0,
            )
            trial_runs[baseline.trial_id] = baseline
            trial_runs[memi.trial_id] = memi

        trial_grades = {}
        for run in trial_runs.values():
            critical_defects = 2 if run.condition == "baseline" else 0
            grade = TrialGrade(
                trial_id=run.trial_id,
                task_id=run.task_id,
                repeat=run.repeat,
                condition=run.condition,
                score=80.0,
                dimension_medians={},
                critical_defect_count=critical_defects,
                absolute_disagreement=0.0,
                grader_count=3,
                raw_scores=(80.0, 80.0, 80.0),
            )
            trial_grades[grade.trial_id] = grade

        first = _secondary_analysis(trial_runs, trial_grades)
        second = _secondary_analysis(trial_runs, trial_grades)

        self.assertEqual(first, second)
        self.assertEqual(len(first), 9)
        self.assertEqual(
            {row["metric"] for row in first},
            {
                "functional_acceptance",
                "critical_defects",
                "input_tokens",
                "output_tokens",
                "reasoning_tokens",
                "wall_time_ms",
                "tool_calls",
                "retries",
                "provider_failures",
            },
        )
        for row in first:
            self.assertEqual(row["bootstrap_samples"], 10_000)
            self.assertLessEqual(row["bootstrap_ci_lower_2p5"], row["mean_raw_delta"])
            self.assertGreaterEqual(row["bootstrap_ci_upper_97p5"], row["mean_raw_delta"])

        critical = next(row for row in first if row["metric"] == "critical_defects")
        self.assertEqual(critical["pairs"], 3)
        self.assertEqual(critical["mean_raw_delta"], -2.0)

    def test_critical_defects_uses_only_complete_blinded_grade_pairs(self) -> None:
        runs = {
            "task-a:r1:baseline": _trial_run("task-a:r1:baseline", 1, "baseline", 10, 1, 1, 10, 1, 0, 0, True, 99),
            "task-a:r1:memi": _trial_run("task-a:r1:memi", 1, "memi", 10, 1, 1, 10, 1, 0, 0, True, 77),
            "task-a:r2:baseline": _trial_run("task-a:r2:baseline", 2, "baseline", 10, 1, 1, 10, 1, 0, 0, True, 55),
            "task-a:r2:memi": _trial_run("task-a:r2:memi", 2, "memi", 10, 1, 1, 10, 1, 0, 0, True, 44),
            "task-b:r1:baseline": _trial_run("task-b:r1:baseline", 1, "baseline", 10, 1, 1, 10, 1, 0, 0, True, 33),
            "task-b:r1:memi": _trial_run("task-b:r1:memi", 1, "memi", 10, 1, 1, 10, 1, 0, 0, True, 22),
        }
        grades = {
            "task-a:r1:baseline": _trial_grade("task-a:r1:baseline", "task-a", 1, "baseline", 2),
            "task-a:r1:memi": _trial_grade("task-a:r1:memi", "task-a", 1, "memi", 1),
        }

        rows = _secondary_analysis(runs, grades)
        critical_rows = [row for row in rows if row["metric"] == "critical_defects"]

        self.assertEqual(len(critical_rows), 1)
        self.assertEqual(critical_rows[0]["task_id"], "task-a")
        self.assertEqual(critical_rows[0]["pairs"], 1)
        self.assertEqual(critical_rows[0]["mean_raw_delta"], -1.0)


class GeneratedArtifactTests(unittest.TestCase):
    def test_writes_deterministic_report_hook_figures_and_supported_tex_fragments(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = SimpleNamespace(
                tables_root=root / "tables",
                figures_root=root / "figures",
                tex_root=root / "tex",
            )
            summary = _synthetic_complete_summary()

            _write_outputs(paths, summary)
            figure_paths = [
                paths.figures_root / "paired_quality_comparisons.png",
                paths.figures_root / "task_resource_intervals.png",
            ]
            first_hashes = [sha256(path.read_bytes()).hexdigest() for path in figure_paths]
            _write_outputs(paths, summary)
            second_hashes = [sha256(path.read_bytes()).hexdigest() for path in figure_paths]

            self.assertEqual(first_hashes, second_hashes)
            for path in figure_paths:
                self.assertTrue(path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
            expected_tex = {
                "report-macros.tex",
                "technical-summary.tex",
                "functional-quality-results.tex",
                "primary-task-summary.tex",
                "quality-figure-interpretation.tex",
                "resource-efficiency-results.tex",
                "resource-figure-interpretation.tex",
            }
            self.assertEqual(
                {path.name for path in paths.tex_root.glob("*.tex")},
                expected_tex,
            )
            macros = (paths.tex_root / "report-macros.tex").read_text(encoding="utf-8")
            self.assertIn(r"\renewcommand{\FreshCellStatus}", macros)
            self.assertIn("36 of 36", macros)
            self.assertNotIn(r"\renewcommand{\ReleaseGateStatus}", macros)
            primary_tex = (paths.tex_root / "primary-task-summary.tex").read_text(
                encoding="utf-8"
            )
            self.assertIn(r"\begin{table}[ht]", primary_tex)
            self.assertIn(r"\resizebox{\columnwidth}{!}", primary_tex)
            self.assertNotIn(r"\begin{table*}", primary_tex)
            self.assertFalse((paths.tex_root / "fitness-backtest-results.tex").exists())
            self.assertFalse((paths.tex_root / "website-audit-results.tex").exists())


def _trial_run(
    trial_id: str,
    repeat: int,
    condition: str,
    input_tokens: int,
    output_tokens: int,
    reasoning_tokens: int,
    wall_time_ms: int,
    tool_calls: int,
    retries: int,
    provider_failures: int,
    accepted: bool,
    defects: int,
) -> TrialRun:
    return TrialRun(
        trial_id=trial_id,
        task_id="task-a",
        repeat=repeat,
        condition=condition,
        run_id=f"run-{trial_id}",
        accepted=accepted,
        tests_passed=accepted,
        defects=defects,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        reasoning_tokens=reasoning_tokens,
        wall_time_ms=wall_time_ms,
        tool_calls=tool_calls,
        retries=retries,
        provider_failures=provider_failures,
        evidence_manifest_sha256="sha256:test",
        verification_reasons=(),
    )


def _trial_grade(
    trial_id: str,
    task_id: str,
    repeat: int,
    condition: str,
    critical_defect_count: int,
) -> TrialGrade:
    return TrialGrade(
        trial_id=trial_id,
        task_id=task_id,
        repeat=repeat,
        condition=condition,
        score=80.0,
        dimension_medians={},
        critical_defect_count=critical_defect_count,
        absolute_disagreement=0.0,
        grader_count=3,
        raw_scores=(80.0, 80.0, 80.0),
    )


def _synthetic_complete_summary() -> dict:
    primary_pairs = [
        {
            "task_id": "task-a",
            "repeat": repeat,
            "baseline_trial_id": f"task-a:r{repeat}:baseline",
            "memi_trial_id": f"task-a:r{repeat}:memi",
            "baseline_score": baseline,
            "memi_score": memi,
            "delta_memi_minus_baseline": memi - baseline,
        }
        for repeat, baseline, memi in [(1, 80, 82), (2, 84, 83), (3, 81, 85)]
    ]
    primary_summary = [{
        "task_id": "task-a",
        "graded_pairs": 3,
        "mean_delta": 1.6667,
        "median_delta": 2.0,
        "sign_test_positive": 2,
        "sign_test_negative": 1,
        "sign_test_ties": 0,
        "sign_test_p_greater": 0.5,
        "bootstrap_ci_lower_2p5": -1.0,
        "bootstrap_ci_upper_97p5": 4.0,
        "noninferiority_lower_95_one_sided": -1.0,
        "noninferiority_margin": -5.0,
        "noninferior": True,
    }]
    secondary = []
    for metric, unit, mean, lower, upper in [
        ("input_tokens", "tokens", -20.0, -35.0, -5.0),
        ("output_tokens", "tokens", -2.0, -4.0, 0.0),
        ("reasoning_tokens", "tokens", -1.0, -2.0, 1.0),
        ("wall_time_ms", "milliseconds", -100.0, -220.0, 20.0),
        ("tool_calls", "calls", -1.0, -2.0, 0.0),
        ("retries", "count", -0.3, -1.0, 0.0),
        ("provider_failures", "count", 0.0, 0.0, 0.0),
    ]:
        secondary.append({
            "task_id": "task-a",
            "metric": metric,
            "unit": unit,
            "pairs": 3,
            "direction": "lower",
            "mean_raw_delta": mean,
            "median_raw_delta": mean,
            "bootstrap_samples": 10_000,
            "bootstrap_ci_lower_2p5": lower,
            "bootstrap_ci_upper_97p5": upper,
            "sign_test_positive": 2,
            "sign_test_negative": 1,
            "sign_test_ties": 0,
            "p_value_raw": 0.5,
            "p_value_holm": 1.0,
            "reject_holm_0p05": False,
        })
    return {
        "studyId": "study-v15",
        "analysisStatus": "complete",
        "bootstrapSamples": 10_000,
        "nonInferiorityMargin": -5.0,
        "receiptPreflight": {"presentTrials": 36, "expectedTrials": 36},
        "primarySummary": primary_summary,
        "primaryPairRows": primary_pairs,
        "leaveOnePairOut": [],
        "secondaryTests": secondary,
        "pooledDescriptives": [],
        "graderReliability": [],
        "deviations": [],
        "exclusions": [],
    }


if __name__ == "__main__":
    unittest.main()
