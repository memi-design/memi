from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from analysis.pipeline import (
    AnalysisInputError,
    _bootstrap_mean_interval,
    _exact_sign_test,
    _holm_adjustment,
    _icc2_1,
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


if __name__ == "__main__":
    unittest.main()
