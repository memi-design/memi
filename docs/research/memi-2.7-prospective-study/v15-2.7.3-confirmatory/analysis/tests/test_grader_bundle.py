from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from analysis.grader_bundle import build_bundle


class GraderBundleTests(unittest.TestCase):
    def test_randomizes_and_sanitizes_exact_accepted_trials(self) -> None:
        receipts = {
            "entries": [
                {
                    "trialId": "study:task-a:r1:baseline",
                    "runId": "baseline-run",
                    "accepted": True,
                },
                {
                    "trialId": "study:task-a:r1:memi",
                    "runId": "memi-run",
                    "accepted": True,
                },
                {
                    "trialId": "study:task-a:r2:baseline",
                    "runId": "excluded-run",
                    "accepted": True,
                },
            ]
        }
        exclusions = {"entries": [{"trialId": "study:task-a:r2:baseline"}]}
        sources = [
            {
                "taskId": "task-a",
                "captureMode": "browser-screenshot",
                "rows": [
                    {"runId": "baseline-run", "sourceAnonId": "case-01", "evidence": [{"state": "light"}]},
                    {"runId": "memi-run", "sourceAnonId": "case-02", "evidence": [{"state": "dark"}]},
                ],
            }
        ]

        bundle, mapping = build_bundle(receipts, exclusions, sources, seed=2715)

        self.assertEqual(len(bundle["entries"]), 2)
        self.assertEqual(len(mapping["entries"]), 2)
        self.assertEqual({entry["anonId"] for entry in bundle["entries"]}, {"anon-v15-001", "anon-v15-002"})
        self.assertEqual(
            {entry["trialId"] for entry in mapping["entries"]},
            {"study:task-a:r1:baseline", "study:task-a:r1:memi"},
        )
        serialized = json.dumps(bundle)
        self.assertNotIn("baseline-run", serialized)
        self.assertNotIn("memi-run", serialized)
        self.assertNotIn("case-01", serialized)
        self.assertNotIn("case-02", serialized)
        self.assertNotIn('"condition":', serialized)

    def test_rejects_missing_or_duplicate_source_rows(self) -> None:
        receipts = {"entries": [{"trialId": "t1", "runId": "r1", "accepted": True}]}
        exclusions = {"entries": []}
        with self.assertRaisesRegex(RuntimeError, "source coverage mismatch"):
            build_bundle(receipts, exclusions, [], seed=2715)
        duplicate_sources = [
            {"taskId": "task-a", "captureMode": "x", "rows": [
                {"runId": "r1", "sourceAnonId": "a", "evidence": []},
                {"runId": "r1", "sourceAnonId": "b", "evidence": []},
            ]}
        ]
        with self.assertRaisesRegex(RuntimeError, "duplicate source run"):
            build_bundle(receipts, exclusions, duplicate_sources, seed=2715)


if __name__ == "__main__":
    unittest.main()
