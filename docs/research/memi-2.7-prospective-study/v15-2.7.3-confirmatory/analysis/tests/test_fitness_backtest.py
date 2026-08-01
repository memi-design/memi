from __future__ import annotations

import json
import signal
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

from analysis.fitness_backtest import (
    BacktestInputError,
    bounded_positive_repeat,
    build_engine_quality_evidence,
    canonical_sha256,
    default_backtest_paths,
    engine_canonical_sha256,
    artifact_set_mismatches,
    ensure_safe_output_path,
    expected_replay_counts,
    execute_backtest,
    load_backtest_inputs,
    run_capped_command,
    render_backtest_artifacts,
    summarize_backtest,
    validate_snapshot_prefix,
    validate_frozen_provenance,
    validate_cli_event,
    verify_source_manifest,
    _kill_process_group,
    _read_json,
    _read_jsonl,
    _run_json_command,
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

    def test_source_manifest_is_authenticated_before_resealing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_root = Path(directory) / "safe-run"
            run_root.mkdir()
            artifact = run_root / "artifact.json"
            artifact.write_text('{"x":1}\n', encoding="utf-8")
            run = {
                "runId": "safe-run",
                "prospective": {
                    "trialId": "study:task:r1:baseline",
                    "evidenceManifestSha256": "",
                },
            }
            (run_root / "run.json").write_text(json.dumps(run), encoding="utf-8")
            files = [
                {
                    "name": "artifact.json",
                    "bytes": artifact.stat().st_size,
                    "sha256": "sha256:" + __import__("hashlib").sha256(artifact.read_bytes()).hexdigest(),
                }
            ]
            content = {"schemaVersion": 1, "trialId": "study:task:r1:baseline", "files": files}
            manifest_hash = canonical_sha256(content)
            run["prospective"]["evidenceManifestSha256"] = manifest_hash
            (run_root / "run.json").write_text(json.dumps(run), encoding="utf-8")
            (run_root / "evidence-manifest.json").write_text(
                json.dumps({**content, "manifestSha256": manifest_hash}), encoding="utf-8"
            )

            verify_source_manifest(run_root, run)
            artifact.write_text('{"x":2}\n', encoding="utf-8")
            with self.assertRaisesRegex(BacktestInputError, "artifact hash mismatch"):
                verify_source_manifest(run_root, run)

    def test_snapshot_validation_rejects_future_event_substitution_at_same_count(self) -> None:
        events = [
            {"eventId": "fitness:first", "taskClass": "task-a", "createdAt": "2026-08-01T01:00:00.000Z"},
            {"eventId": "fitness:future", "taskClass": "task-a", "createdAt": "2026-08-01T03:00:00.000Z"},
        ]
        correct = {
            "eventsAvailable": 2,
            "eventsReplayed": 1,
            "routes": [{"identity": {"taskClass": "task-a"}, "timeline": [
                {"eventId": "fitness:first", "createdAt": "2026-08-01T01:00:00.000Z"}
            ]}],
        }
        validate_snapshot_prefix(correct, events[:1], "2026-08-01T02:00:00.000Z", 2)
        substituted = json.loads(json.dumps(correct))
        substituted["routes"][0]["timeline"][0] = {
            "eventId": "fitness:future",
            "createdAt": "2026-08-01T03:00:00.000Z",
        }
        with self.assertRaisesRegex(BacktestInputError, "event prefix"):
            validate_snapshot_prefix(substituted, events[:1], "2026-08-01T02:00:00.000Z", 2)

    def test_artifact_comparison_rejects_unexpected_files(self) -> None:
        self.assertEqual(artifact_set_mismatches({"a": b"same"}, {"a": b"same"}), [])
        self.assertEqual(
            artifact_set_mismatches({"a": b"same", "obsolete": b"old"}, {"a": b"same"}),
            ["unexpected:obsolete"],
        )

    def test_output_guard_rejects_symlink_ancestors(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            outside = root / "outside"
            outside.mkdir()
            (root / "generated").symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(BacktestInputError, "symlink"):
                ensure_safe_output_path(root / "generated" / "artifact.json", root)

    @unittest.skipUnless(
        Path("/Volumes/ExtremeSSD/Projects/_worktrees/memi-2.7.4-engine/dist/index.js").is_file()
        and Path("/Volumes/ExtremeSSD/Projects/_evidence/memi-2.7-v15-2.7.3-confirmatory/store").is_dir(),
        "requires the sealed V15 evidence and rebuilt 2.7.4 CLI",
    )
    def test_real_cli_execution_authenticates_copy_and_exact_cutoff_prefixes(self) -> None:
        result = execute_backtest(default_backtest_paths(study_root=STUDY_ROOT))

        self.assertEqual(len(result["commandReceipts"]), 12)
        self.assertEqual(len(result["snapshots"]), 19)
        self.assertEqual([row["exitCode"] for row in result["commandReceipts"]], [0] * 12)
        self.assertEqual(result["finalBacktest"]["eventsReplayed"], 12)
        self.assertEqual(
            [snapshot["backtest"]["eventsReplayed"] for snapshot in result["snapshots"]],
            [0, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 12, 12],
        )

    def test_repeat_is_a_bounded_positive_integer_before_filename_construction(self) -> None:
        self.assertEqual(bounded_positive_repeat(6), 6)
        for invalid in (0, -1, 1001, "../outside", True):
            with self.subTest(invalid=invalid):
                with self.assertRaisesRegex(BacktestInputError, "repeat"):
                    bounded_positive_repeat(invalid)

    def test_frozen_provenance_rejects_source_or_engine_substitution(self) -> None:
        frozen = {
            "schemaVersion": 1,
            "kind": "memi-v15-fitness-backtest-frozen-provenance",
            "engineCliSha256": f"sha256:{'a' * 64}",
            "sourceDigest": f"sha256:{'b' * 64}",
        }
        validate_frozen_provenance(
            frozen,
            engine_sha256=f"sha256:{'a' * 64}",
            source_digest=f"sha256:{'b' * 64}",
        )
        with self.assertRaisesRegex(BacktestInputError, "engine CLI digest"):
            validate_frozen_provenance(
                frozen,
                engine_sha256=f"sha256:{'c' * 64}",
                source_digest=f"sha256:{'b' * 64}",
            )
        with self.assertRaisesRegex(BacktestInputError, "source-root digest"):
            validate_frozen_provenance(
                frozen,
                engine_sha256=f"sha256:{'a' * 64}",
                source_digest=f"sha256:{'c' * 64}",
            )

    def test_capped_command_kills_output_flood_before_buffering_past_limit(self) -> None:
        with self.assertRaisesRegex(BacktestInputError, "output exceeded"):
            run_capped_command(
                [sys.executable, "-c", "import sys; sys.stdout.write('x' * 10000); sys.stdout.flush()"],
                timeout_seconds=5,
                max_output_bytes=128,
            )

    def test_deeply_nested_engine_json_fails_as_a_bounded_input_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(BacktestInputError, "nesting"):
                _run_json_command(
                    [
                        sys.executable,
                        "-c",
                        "print('{\"child\":' * 150 + '{}' + '}' * 150)",
                    ],
                    Path(directory),
                )

    def test_deeply_nested_study_and_store_json_fail_as_bounded_input_errors(self) -> None:
        deeply_nested = '{"child":' * 150 + '{}' + '}' * 150
        recursion_bomb = '{"child":' * 2000 + '{}' + '}' * 2000
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            study_path = root / "study.json"
            store_path = root / "runs.jsonl"
            study_path.write_text(deeply_nested, encoding="utf-8")
            store_path.write_text(recursion_bomb + "\n", encoding="utf-8")

            with self.assertRaisesRegex(BacktestInputError, "nesting"):
                _read_json(study_path)
            with self.assertRaisesRegex(BacktestInputError, "cannot read JSONL input"):
                _read_jsonl(store_path)

    def test_process_group_kill_is_attempted_after_leader_exit_and_leader_is_reaped(self) -> None:
        class ExitedLeader:
            pid = 12345

            def __init__(self) -> None:
                self.wait_calls = 0

            def poll(self) -> int:
                return 0

            def wait(self, timeout: int) -> int:
                self.wait_calls += 1
                return 0

            def kill(self) -> None:
                self.fail("leader fallback kill should not be needed")

        process = ExitedLeader()
        with patch("analysis.fitness_backtest.os.killpg") as killpg:
            _kill_process_group(process)  # type: ignore[arg-type]

        killpg.assert_called_once_with(process.pid, signal.SIGKILL)
        self.assertEqual(process.wait_calls, 1)


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
