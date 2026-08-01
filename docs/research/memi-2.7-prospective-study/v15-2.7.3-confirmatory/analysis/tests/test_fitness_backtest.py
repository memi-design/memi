from __future__ import annotations

import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from analysis.fitness_backtest import (
    BacktestInputError,
    build_engine_quality_evidence,
    canonical_sha256,
    engine_canonical_sha256,
    expected_replay_counts,
    load_backtest_inputs,
    render_backtest_artifacts,
    summarize_backtest,
    validate_cli_event,
)


STUDY_ROOT = Path(__file__).resolve().parents[2]
FITNESS_ROOT = STUDY_ROOT / "generated" / "fitness-policy"


class FitnessBacktestTests(unittest.TestCase):
    def test_inputs_preserve_chronology_and_select_only_twelve_exact_route_writes(self) -> None:
        inputs = load_backtest_inputs(
            FITNESS_ROOT / "chronological-ingestion-plan.json",
            FITNESS_ROOT / "quality-evidence-v2.json",
            STUDY_ROOT / "rubric.json",
        )

        self.assertEqual(len(inputs.chronology), 19)
        self.assertEqual(
            Counter(entry["ingestDecision"] for entry in inputs.chronology),
            Counter(
                {
                    "record-v2-quality-evidence": 10,
                    "record-v1-automation-only-negative": 2,
                    "record-v1-abstain-chronology-only": 6,
                    "record-v1-only-unmatched-negative": 1,
                }
            ),
        )
        self.assertEqual(
            [entry.sequence for entry in inputs.write_entries],
            [2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18],
        )
        self.assertEqual(
            expected_replay_counts(inputs.chronology),
            [0, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 12, 12],
        )
        chronology_only = [entry for entry in inputs.chronology if not entry["storeWriteEligible"]]
        self.assertEqual(len(chronology_only), 7)
        self.assertEqual(
            [entry["taskClass"] for entry in chronology_only].count("nate-options-reduce-motion"),
            6,
        )

    def test_v2_translation_is_strict_engine_quality_evidence_with_its_own_hash(self) -> None:
        inputs = load_backtest_inputs(
            FITNESS_ROOT / "chronological-ingestion-plan.json",
            FITNESS_ROOT / "quality-evidence-v2.json",
            STUDY_ROOT / "rubric.json",
        )
        command = inputs.write_entries[0]
        self.assertEqual(command.source_version, "v2")

        payload = build_engine_quality_evidence(command.quality_entry, inputs.rubric_version)
        without_hash = {key: value for key, value in payload.items() if key != "evidenceSha256"}

        self.assertEqual(
            set(payload),
            {
                "pair",
                "rubricVersion",
                "blinded",
                "graderCount",
                "baseline",
                "memi",
                "evidenceSha256",
            },
        )
        self.assertEqual(payload["rubricVersion"], "memi-design-quality-v1")
        self.assertIs(payload["blinded"], True)
        self.assertEqual(payload["graderCount"], 3)
        self.assertEqual(payload["baseline"], {"score": 88.0, "criticalDefects": 0})
        self.assertEqual(payload["memi"], {"score": 89.0, "criticalDefects": 0})
        self.assertEqual(payload["evidenceSha256"], engine_canonical_sha256(without_hash))
        self.assertNotEqual(
            payload["evidenceSha256"],
            command.quality_entry["quality"]["qualityEvidenceSha256"],
        )

    def test_cli_event_validation_requires_pair_availability_and_exact_route_identity(self) -> None:
        inputs = load_backtest_inputs(
            FITNESS_ROOT / "chronological-ingestion-plan.json",
            FITNESS_ROOT / "quality-evidence-v2.json",
            STUDY_ROOT / "rubric.json",
        )
        command = next(entry for entry in inputs.write_entries if entry.sequence == 17)
        event = _event_for(command)

        validate_cli_event(command, event)

        leaked = {**event, "createdAt": "2026-08-01T09:36:00.000Z"}
        with self.assertRaisesRegex(BacktestInputError, "pair availability timestamp"):
            validate_cli_event(command, leaked)

        wrong_route = {**event, "repositoryFingerprintHash": f"sha256:{'0' * 64}"}
        with self.assertRaisesRegex(BacktestInputError, "repository fingerprint"):
            validate_cli_event(command, wrong_route)

        wrong_skill = {
            **event,
            "skills": [{**event["skills"][0], "skillId": "different-skill"}],
        }
        with self.assertRaisesRegex(BacktestInputError, "skill identity"):
            validate_cli_event(command, wrong_skill)

    def test_summary_reports_only_two_suppressed_exact_routes_and_no_nate_claim(self) -> None:
        chronology = json.loads(
            (FITNESS_ROOT / "chronological-ingestion-plan.json").read_text(encoding="utf-8")
        )["entries"]
        backtest = {
            "schemaVersion": 1,
            "asOf": None,
            "eventsAvailable": 12,
            "eventsReplayed": 12,
            "routes": [
                _route("buzzr-tab-unread-badge", "atomic-design", 6),
                _route("paraform-command-menu", "design-extract", 6),
            ],
        }

        summary = summarize_backtest(backtest, chronology)

        self.assertEqual(summary["storeWriteCount"], 12)
        self.assertEqual(summary["chronologyOnlyCount"], 7)
        self.assertEqual(summary["routeCount"], 2)
        self.assertEqual(summary["suppressedRouteCount"], 2)
        self.assertEqual(summary["recoveredRouteCount"], 0)
        self.assertEqual(
            [(route["taskClass"], route["skillId"], route["finalState"]) for route in summary["routes"]],
            [
                ("buzzr-tab-unread-badge", "atomic-design", "suppressed"),
                ("paraform-command-menu", "design-extract", "suppressed"),
            ],
        )
        self.assertNotIn("nate-options-reduce-motion", json.dumps(summary))

    def test_report_artifacts_are_byte_stable_and_state_the_abstain_limitation(self) -> None:
        summary = {
            "storeWriteCount": 12,
            "chronologyOnlyCount": 7,
            "routeCount": 2,
            "suppressedRouteCount": 2,
            "recoveredRouteCount": 0,
            "routes": [
                {
                    "taskClass": "buzzr-tab-unread-badge",
                    "skillId": "atomic-design",
                    "matchingEvents": 6,
                    "finalDecision": "repository-only",
                    "finalState": "suppressed",
                    "suppressedAt": "2026-08-01T09:37:40.379Z",
                },
                {
                    "taskClass": "paraform-command-menu",
                    "skillId": "design-extract",
                    "matchingEvents": 6,
                    "finalDecision": "repository-only",
                    "finalState": "suppressed",
                    "suppressedAt": "2026-08-01T09:17:36.434Z",
                },
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            figure = root / "fitness_backtest.png"
            results = root / "fitness-backtest-results.tex"
            interpretation = root / "backtest-figure-interpretation.tex"

            render_backtest_artifacts(summary, figure, results, interpretation)
            first = (figure.read_bytes(), results.read_bytes(), interpretation.read_bytes())
            render_backtest_artifacts(summary, figure, results, interpretation)
            second = (figure.read_bytes(), results.read_bytes(), interpretation.read_bytes())

            self.assertEqual(first, second)
            self.assertTrue(first[0].startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertIn(b"repository-only", first[1])
            self.assertIn(b"Nate", first[2])
            self.assertIn(b"abstained", first[2])
            self.assertNotIn(b"Nate exact-route suppression", first[2])


def _event_for(command: object) -> dict[str, object]:
    entry = command.source_entry
    pair = entry["pair"]
    return {
        "schemaVersion": 1,
        "eventId": "fitness-v1:test-event",
        "createdAt": entry["observedAt"],
        "routerVersion": "skill-router-v2",
        "repositoryFingerprintHash": entry["route"]["repositoryFingerprintHash"],
        "taskClass": entry["taskClass"],
        "harness": entry["harness"],
        "pair": {
            "baselineRunId": pair["baselineRunId"],
            "memiRunId": pair["memiRunId"],
        },
        "skills": entry["route"]["skills"],
        "tokenSavingsRatio": 0.1,
        "latencySavingsRatio": 0.1,
        "toolCallSavingsRatio": 0.1,
        "qualityParity": False,
    }


def _route(task_class: str, skill_id: str, matching_events: int) -> dict[str, object]:
    return {
        "routeKey": f"sha256:{'a' * 64}",
        "identity": {
            "routerVersion": "skill-router-v2",
            "repositoryFingerprintHash": f"sha256:{'b' * 64}",
            "taskClass": task_class,
            "harness": {
                "provider": "codex",
                "modelId": "gpt-5.6-luna",
                "reasoningEffort": "low",
            },
            "skills": [{"skillId": skill_id, "contentHash": f"sha256:{'c' * 64}"}],
        },
        "finalDecision": "repository-only",
        "finalState": "suppressed",
        "timeline": [
            {
                "eventId": f"fitness-v1:{index}",
                "createdAt": f"2026-08-01T09:{index:02d}:00.000Z",
                "schemaVersion": 1,
                "decisionAfter": "repository-only" if index == matching_events else "allow",
                "stateAfter": "suppressed" if index == matching_events else "healthy",
                "recoveryEventsAfter": 0,
                "reasonsAfter": ["quality-regression"] if index == matching_events else [],
            }
            for index in range(1, matching_events + 1)
        ],
    }


if __name__ == "__main__":
    unittest.main()
