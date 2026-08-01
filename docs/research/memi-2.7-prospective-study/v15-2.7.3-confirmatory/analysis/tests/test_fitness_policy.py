from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from analysis.fitness_policy import (
    CheckMismatch,
    StudyFitnessPaths,
    build_outputs,
    canonical_sha256,
    verify_outputs,
    write_outputs,
)


class FitnessPolicyArtifactsTests(unittest.TestCase):
    def test_build_outputs_emits_hash_verified_v2_pairs_and_dry_run_ingestion_plan(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = _write_fixture(root)

            quality_evidence, ingestion_plan = build_outputs(paths)

            self.assertEqual(quality_evidence["kind"], "memi-fitness-quality-evidence-v2")
            self.assertEqual(quality_evidence["entryCount"], 2)
            self.assertEqual(
                [entry["pair"]["taskId"] for entry in quality_evidence["entries"]],
                ["buzzr-tab-unread-badge", "nate-options-reduce-motion"],
            )

            buzzr_entry = quality_evidence["entries"][0]
            self.assertEqual(buzzr_entry["schemaVersion"], 2)
            self.assertEqual(buzzr_entry["route"]["decision"], "single")
            self.assertEqual(
                buzzr_entry["route"]["skills"],
                [{"skillId": "atomic-design", "contentHash": f"sha256:{'a' * 64}"}],
            )
            self.assertTrue(buzzr_entry["quality"]["qualityParity"])
            self.assertEqual(
                buzzr_entry["quality"]["qualityEvidenceSha256"],
                canonical_sha256(buzzr_entry["quality"]["qualityEvidence"]),
            )

            nate_entry = quality_evidence["entries"][1]
            self.assertEqual(nate_entry["route"]["decision"], "abstain")
            self.assertEqual(nate_entry["route"]["skills"], [])
            self.assertFalse(nate_entry["quality"]["qualityParity"])

            self.assertEqual(
                [entry["ingestDecision"] for entry in ingestion_plan["entries"]],
                [
                    "record-v1-only-unmatched-negative",
                    "record-v2-quality-evidence",
                    "skip-abstain-route",
                ],
            )
            self.assertEqual(ingestion_plan["dryRun"], True)
            self.assertEqual(ingestion_plan["storeWritePlanned"], False)
            self.assertFalse(ingestion_plan["entries"][0]["storeWriteEligible"])
            self.assertFalse(ingestion_plan["entries"][-1]["storeWriteEligible"])

    def test_verify_outputs_passes_for_fresh_writes_and_fails_when_stale(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = _write_fixture(root)

            expected_quality, expected_plan = build_outputs(paths)
            write_outputs(paths, expected_quality, expected_plan)
            self.assertEqual(verify_outputs(paths, expected_quality, expected_plan), [])

            payload = json.loads(paths.quality_evidence_v2_path.read_text(encoding="utf-8"))
            payload["entries"][0]["quality"]["medianScoreMemi"] = 999
            paths.quality_evidence_v2_path.write_text(
                json.dumps(payload, indent=2) + "\n",
                encoding="utf-8",
            )

            mismatches = verify_outputs(paths, expected_quality, expected_plan)
            self.assertEqual(
                mismatches,
                [CheckMismatch(paths.quality_evidence_v2_path, "content differs from deterministic rebuild")],
            )

    def test_build_outputs_rejects_missing_blinded_trial_for_an_accepted_pair(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = _write_fixture(root, omit_trial_ids={"trial-buzzr-memi"})

            with self.assertRaisesRegex(
                RuntimeError,
                "missing blinded grading entries for accepted trials: trial-buzzr-memi",
            ):
                build_outputs(paths)


def _write_fixture(root: Path, omit_trial_ids: set[str] | None = None) -> StudyFitnessPaths:
    omit_trial_ids = omit_trial_ids or set()
    study_root = root / "study"
    analysis_root = study_root / "analysis"
    generated_root = study_root / "generated" / "fitness-policy"
    runs_root = root / "runs"
    analysis_root.mkdir(parents=True)
    generated_root.mkdir(parents=True)
    runs_root.mkdir()

    protocol = {
        "protocolId": "study-v15",
        "grading": {"label": "model-graded"},
    }
    rubric = {
        "dimensions": [
            {"id": "task-interaction-correctness"},
            {"id": "accessibility"},
        ],
        "graderRules": {"graderCount": 3},
    }
    exclusions = {"schemaVersion": 1, "entries": []}

    legacy_results = {
        "schemaVersion": 1,
        "generatedAt": "2026-07-29T21:44:57.657Z",
        "pairs": [
            {
                "case": "Buzzr",
                "experimentId": "buzzr-tab-unread-badge-v2",
                "revision": "7583ab4",
                "skillIds": ["react-native-gen"],
                "baselineRunId": "legacy-buzzr-baseline",
                "memiRunId": "legacy-buzzr-memi",
                "baseline": {"qualityScore": 100},
                "memi": {"qualityScore": 100},
                "savingsPercent": {
                    "wallTime": -49.06,
                    "totalTokens": -98.33,
                    "toolCalls": -25.0,
                },
            }
        ],
    }

    receipt_entries = [
        _write_run(
            runs_root,
            trial_id="trial-buzzr-baseline",
            run_id="run-buzzr-baseline",
            task_id="buzzr-tab-unread-badge",
            repeat=1,
            condition="baseline",
            completed_at="2026-08-01T08:00:00.000Z",
            repository_hash=f"sha256:{'1' * 64}",
            route_payload=None,
            input_tokens=1000,
            wall_time_ms=2000,
            tool_calls=8,
        ),
        _write_run(
            runs_root,
            trial_id="trial-buzzr-memi",
            run_id="run-buzzr-memi",
            task_id="buzzr-tab-unread-badge",
            repeat=1,
            condition="memi",
            completed_at="2026-08-01T08:05:00.000Z",
            repository_hash=f"sha256:{'1' * 64}",
            route_payload={
                "route": {
                    "schemaVersion": 2,
                    "routerVersion": "skill-router-v2",
                    "decision": "single",
                    "repositoryFingerprintHash": f"sha256:{'1' * 64}",
                    "selected": [
                        {
                            "id": "atomic-design",
                            "contentHash": f"sha256:{'a' * 64}",
                        }
                    ],
                }
            },
            input_tokens=700,
            wall_time_ms=1400,
            tool_calls=5,
        ),
        _write_run(
            runs_root,
            trial_id="trial-nate-baseline",
            run_id="run-nate-baseline",
            task_id="nate-options-reduce-motion",
            repeat=1,
            condition="baseline",
            completed_at="2026-08-01T09:00:00.000Z",
            repository_hash=f"sha256:{'2' * 64}",
            route_payload=None,
            input_tokens=1100,
            wall_time_ms=2500,
            tool_calls=9,
        ),
        _write_run(
            runs_root,
            trial_id="trial-nate-memi",
            run_id="run-nate-memi",
            task_id="nate-options-reduce-motion",
            repeat=1,
            condition="memi",
            completed_at="2026-08-01T09:05:00.000Z",
            repository_hash=f"sha256:{'2' * 64}",
            route_payload={
                "route": {
                    "schemaVersion": 2,
                    "routerVersion": "skill-router-v2",
                    "decision": "abstain",
                    "repositoryFingerprintHash": f"sha256:{'2' * 64}",
                    "selected": [],
                }
            },
            input_tokens=900,
            wall_time_ms=2200,
            tool_calls=11,
        ),
    ]

    grading_entries = [
        _grading_entry(
            "trial-buzzr-baseline",
            scores=[80, 81, 82],
            critical_counts=[0, 0, 0],
        ),
        _grading_entry(
            "trial-buzzr-memi",
            scores=[84, 85, 86],
            critical_counts=[0, 0, 0],
        ),
        _grading_entry(
            "trial-nate-baseline",
            scores=[90, 91, 92],
            critical_counts=[0, 0, 0],
        ),
        _grading_entry(
            "trial-nate-memi",
            scores=[86, 87, 88],
            critical_counts=[1, 1, 1],
        ),
    ]
    grading_entries = [
        entry for entry in grading_entries if entry["trialId"] not in omit_trial_ids
    ]

    (study_root / "protocol.json").write_text(json.dumps(protocol, indent=2) + "\n", encoding="utf-8")
    (study_root / "rubric.json").write_text(json.dumps(rubric, indent=2) + "\n", encoding="utf-8")
    (study_root / "exclusions.json").write_text(json.dumps(exclusions, indent=2) + "\n", encoding="utf-8")
    (study_root / "evidence-receipts.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "entries": receipt_entries,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (analysis_root / "blinded_grading.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "studyId": "study-v15",
                "entries": grading_entries,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (study_root / "legacy-workflow-proof-results.json").write_text(
        json.dumps(legacy_results, indent=2) + "\n",
        encoding="utf-8",
    )

    return StudyFitnessPaths(
        study_root=study_root,
        analysis_root=analysis_root,
        generated_root=generated_root,
        evidence_receipts_path=study_root / "evidence-receipts.json",
        blinded_grading_path=analysis_root / "blinded_grading.json",
        protocol_path=study_root / "protocol.json",
        rubric_path=study_root / "rubric.json",
        exclusions_path=study_root / "exclusions.json",
        evidence_runs_root=runs_root,
        legacy_workflow_results_path=study_root / "legacy-workflow-proof-results.json",
        quality_evidence_v2_path=generated_root / "quality-evidence-v2.json",
        chronological_ingestion_plan_path=generated_root / "chronological-ingestion-plan.json",
    )


def _write_run(
    runs_root: Path,
    *,
    trial_id: str,
    run_id: str,
    task_id: str,
    repeat: int,
    condition: str,
    completed_at: str,
    repository_hash: str,
    route_payload: dict | None,
    input_tokens: int,
    wall_time_ms: int,
    tool_calls: int,
) -> dict:
    run_dir = runs_root / run_id
    run_dir.mkdir()
    route_envelope = {"condition": condition, "route": route_payload}
    route_path = run_dir / "route.json"
    route_path.write_text(json.dumps(route_envelope, indent=2) + "\n", encoding="utf-8")
    route_sha = f"sha256:{canonical_sha256(route_envelope).removeprefix('sha256:')}"
    manifest_sha = f"sha256:{repeat:064x}"
    run_payload = {
        "schemaVersion": 1,
        "runId": run_id,
        "experimentId": "study-v15",
        "suiteId": "suite-v15",
        "taskId": task_id,
        "repeat": repeat,
        "condition": condition,
        "repository": {
            "pathHash": repository_hash,
            "revision": f"{task_id}-revision",
            "dirty": False,
        },
        "harness": {
            "id": "codex",
            "modelId": "gpt-5.6-luna",
            "reasoningEffort": "low",
        },
        "timing": {
            "startedAt": completed_at,
            "completedAt": completed_at,
            "wallTimeMs": wall_time_ms,
            "toolTimeMs": 1,
        },
        "usage": {
            "inputTokens": input_tokens,
            "cachedInputTokens": 0,
            "outputTokens": 100,
            "reasoningTokens": 20,
            "estimatedCostUsd": None,
        },
        "tools": {
            "calls": tool_calls,
            "outputBytes": 10,
            "errors": 0,
            "retries": 0,
        },
        "outcome": {
            "accepted": True,
            "testsPassed": True,
            "qualityScore": 100,
            "defects": 0,
            "humanInterventions": 0,
        },
        "evidenceRefs": [],
        "prospective": {
            "planHash": f"sha256:{'b' * 64}",
            "freezeHash": f"sha256:{'c' * 64}",
            "candidateArtifactSha256": f"sha256:{'d' * 64}",
            "taskManifestSha256": f"sha256:{'e' * 64}",
            "evidenceManifestSha256": manifest_sha,
            "trialId": trial_id,
            "sequence": repeat,
        },
    }
    (run_dir / "run.json").write_text(json.dumps(run_payload, indent=2) + "\n", encoding="utf-8")
    return {
        "trialId": trial_id,
        "sequence": repeat,
        "runId": run_id,
        "taskId": task_id,
        "repeat": repeat,
        "condition": condition,
        "accepted": True,
        "testsPassed": True,
        "completedAt": completed_at,
        "evidenceManifestSha256": manifest_sha,
        "routeSha256": route_sha,
    }


def _grading_entry(trial_id: str, *, scores: list[int], critical_counts: list[int]) -> dict:
    ratings = []
    for index, score in enumerate(scores):
        ratings.append(
            {
                "graderId": f"grader-{index + 1}",
                "blinded": True,
                "receiptRef": f"receipt://{trial_id}/{index + 1}",
                "score": score,
                "dimensions": {
                    "task-interaction-correctness": score / 2,
                    "accessibility": score / 2,
                },
                "criticalDefects": [f"defect-{index}"] * critical_counts[index],
            }
        )
    return {"trialId": trial_id, "ratings": ratings}


if __name__ == "__main__":
    unittest.main()
