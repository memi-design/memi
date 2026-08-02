from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

from analysis.paper_figures import (
    render_backtest_timeline,
    render_claim_decision,
    render_policy_state_machine,
    render_quality_results,
    render_resource_results,
    render_study_design,
)


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class PaperFigureTests(unittest.TestCase):
    def test_claim_decision_figure_makes_claim_boundaries_readable(self) -> None:
        primary = [
            {
                "task_id": "buzzr-tab-unread-badge",
                "graded_pairs": 5,
                "mean_delta": 1.4,
                "noninferiority_lower_95_one_sided": 0.2,
                "noninferior": True,
            },
            {
                "task_id": "paraform-command-menu",
                "graded_pairs": 5,
                "mean_delta": -0.4,
                "noninferiority_lower_95_one_sided": -3.4,
                "noninferior": True,
            },
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "claim-decision.png"
            render_claim_decision(path, primary, secondary_test_count=21)
            self._assert_png(path)

    def test_study_design_and_policy_diagrams_render_without_mutating_inputs(self) -> None:
        protocol = {
            "design": {
                "fixtures": 3,
                "pairsPerFixture": 6,
                "matchedPairs": 18,
                "agentCells": 36,
            }
        }
        receipts = {"expectedCells": 36, "verifiedCells": 36}
        exclusions = {"entries": [{"scope": "rendered-frontend-grading-only"}] * 14}
        grading = {"gradedTrials": [f"trial-{index}" for index in range(22)]}
        frozen = copy.deepcopy((protocol, receipts, exclusions, grading))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            study_path = root / "study-design.png"
            policy_path = root / "policy.png"
            render_study_design(study_path, protocol, receipts, exclusions, grading)
            render_policy_state_machine(policy_path)
            self._assert_png(study_path)
            self._assert_png(policy_path)

        self.assertEqual((protocol, receipts, exclusions, grading), frozen)

    def test_quality_and_resource_figures_render_from_analysis_rows(self) -> None:
        primary = [
            {
                "task_id": "buzzr-tab-unread-badge",
                "graded_pairs": 5,
                "mean_delta": 1.4,
                "bootstrap_ci_lower_2p5": 0.0,
                "bootstrap_ci_upper_97p5": 2.8,
                "noninferiority_lower_95_one_sided": 0.2,
                "noninferior": True,
            },
            {
                "task_id": "paraform-command-menu",
                "graded_pairs": 5,
                "mean_delta": -0.4,
                "bootstrap_ci_lower_2p5": -4.2,
                "bootstrap_ci_upper_97p5": 2.8,
                "noninferiority_lower_95_one_sided": -3.4,
                "noninferior": True,
            },
        ]
        pairs = [
            {"task_id": "buzzr-tab-unread-badge", "repeat": 1, "delta": 1.0},
            {"task_id": "buzzr-tab-unread-badge", "repeat": 2, "delta": 2.0},
            {"task_id": "paraform-command-menu", "repeat": 1, "delta": -7.0},
            {"task_id": "paraform-command-menu", "repeat": 2, "delta": 2.0},
        ]
        resources = [
            {
                "task_id": task,
                "metric": metric,
                "unit": unit,
                "mean_raw_delta": mean,
                "bootstrap_ci_lower_2p5": lower,
                "bootstrap_ci_upper_97p5": upper,
            }
            for task, mean, lower, upper in (
                ("buzzr-tab-unread-badge", 1000, -2000, 4000),
                ("paraform-command-menu", -500, -3000, 1000),
            )
            for metric, unit in (
                ("input_tokens", "tokens"),
                ("output_tokens", "tokens"),
                ("reasoning_tokens", "tokens"),
                ("wall_time_ms", "milliseconds"),
            )
        ]

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            quality_path = root / "quality.png"
            resource_path = root / "resources.png"
            render_quality_results(quality_path, primary, pairs)
            render_resource_results(resource_path, resources)
            self._assert_png(quality_path)
            self._assert_png(resource_path)

    def test_backtest_timeline_renders_exact_route_transitions_and_abstentions(self) -> None:
        summary = {
            "routes": [
                {
                    "taskClass": "buzzr-tab-unread-badge",
                    "skillId": "atomic-design",
                    "finalState": "suppressed",
                    "finalDecision": "repository-only",
                    "matchingEvents": 2,
                    "timeline": [
                        {
                            "createdAt": "2026-08-01T07:00:00Z",
                            "schemaVersion": 2,
                            "stateAfter": "healthy",
                        },
                        {
                            "createdAt": "2026-08-01T09:00:00Z",
                            "schemaVersion": 2,
                            "stateAfter": "suppressed",
                        },
                    ],
                }
            ]
        }
        chronology = [
            {
                "taskId": "nate-options-reduce-motion",
                "observedAt": "2026-08-01T08:00:00Z",
                "ingestDecision": "abstain-no-exact-route",
            }
        ]

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "backtest.png"
            render_backtest_timeline(path, summary, chronology)
            self._assert_png(path)

    def _assert_png(self, path: Path) -> None:
        payload = path.read_bytes()
        self.assertEqual(payload[:8], PNG_SIGNATURE)
        self.assertGreater(len(payload), 10_000)


if __name__ == "__main__":
    unittest.main()
