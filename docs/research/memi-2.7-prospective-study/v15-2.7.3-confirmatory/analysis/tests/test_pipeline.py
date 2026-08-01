from __future__ import annotations

import json
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path

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
    _provider_failure_from_events,
    _primary_quality_analysis,
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


class HolmTests(unittest.TestCase):
    def test_holm_adjustment_is_monotone(self) -> None:
        adjusted = _holm_adjustment([0.01, 0.04, 0.03])
        self.assertEqual(adjusted, [0.03, 0.06, 0.06])


class IccTests(unittest.TestCase):
    def test_icc_returns_none_when_matrix_is_not_estimable(self) -> None:
        self.assertIsNone(_icc2_1([(1.0,), (2.0,)]))


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


if __name__ == "__main__":
    unittest.main()
