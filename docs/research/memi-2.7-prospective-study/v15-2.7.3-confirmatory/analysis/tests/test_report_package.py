from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path

from analysis.report_package import (
    ReportPackageInputError,
    build_outputs,
    _verify_checksum_inventory,
    study_report_paths,
    verify_outputs,
    write_outputs,
)


class ReportPackageTests(unittest.TestCase):
    def test_build_outputs_derives_factual_tex_and_audit_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = _write_fixture(root)

            outputs = build_outputs(paths)

            website_tex = outputs[paths.website_audit_tex_path]
            self.assertIn("label-content-name-mismatch", website_tex)
            self.assertIn("serious", website_tex)
            self.assertIn("nine of nine", website_tex)
            self.assertIn("55 of 55", website_tex)
            self.assertIn("unchanged blocking gate passed", website_tex)

            remediation_tex = outputs[paths.remediation_tex_path]
            self.assertIn("exact route identity", remediation_tex)
            self.assertIn("immutable blinded-quality evidence", remediation_tex)
            self.assertIn("chronological", remediation_tex)
            self.assertIn("repository-only", remediation_tex)
            self.assertIn("2,241 tests across 310 files", remediation_tex)
            self.assertIn("8aa4649f", remediation_tex)
            self.assertIn("b1b8b7ef", remediation_tex)
            self.assertIn("a7261456", remediation_tex)
            self.assertIn("ca45f11f", remediation_tex)
            self.assertIn("nine Linux, macOS, and Windows", remediation_tex)
            self.assertIn("frozen source and engine digests", remediation_tex)
            self.assertIn("10 MiB", remediation_tex)
            self.assertIn("typecheck and build passed", remediation_tex)
            self.assertIn("no actionable findings", remediation_tex)
            self.assertIn("same-owner", remediation_tex)
            self.assertIn("weakly consistent NFS", remediation_tex)

            release_tex = outputs[paths.release_gates_tex_path]
            self.assertIn("PENDING LIVE VERIFICATION", release_tex)
            self.assertIn("npm trusted-publisher OIDC", release_tex)
            self.assertIn("public gate", release_tex)
            self.assertNotIn("Release verified", release_tex)
            self.assertIn(
                "PENDING LIVE VERIFICATION",
                outputs[paths.release_status_tex_path],
            )

            ledger = json.loads(outputs[paths.rendered_audit_ledger_path])
            self.assertEqual(ledger["receiptAudit"]["verifiedCells"], 36)
            self.assertEqual(ledger["renderedAudit"]["excludedTrials"], 14)
            self.assertEqual(ledger["renderedAudit"]["gradedTrials"], 22)
            self.assertEqual(ledger["renderedAudit"]["completeGradedPairs"], 10)
            self.assertEqual(
                ledger["renderedAudit"]["pairRepeatsByTask"],
                {
                    "buzzr-tab-unread-badge": [1, 2, 3, 4, 5],
                    "paraform-command-menu": [1, 2, 3, 4, 6],
                },
            )
            self.assertTrue(ledger["grading"]["modelGraded"])
            self.assertFalse(ledger["grading"]["independentHumanPractitionerEvidence"])
            self.assertEqual(len(ledger["grading"]["graderReceipts"]), 3)
            self.assertIn("not Expo Simulator", ledger["captureLimitations"][0])
            self.assertIn("mobile breakpoint", ledger["captureLimitations"][1])
            self.assertEqual(
                ledger["sourceArtifacts"]["evidence-receipts.json"]["sha256"],
                "sha256:" + sha256(paths.evidence_receipts_path.read_bytes()).hexdigest(),
            )

    def test_build_outputs_admits_complete_live_release_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            _write_json(paths.live_release_verification_path, _live_release_fixture())

            outputs = build_outputs(paths)
            release_tex = outputs[paths.release_gates_tex_path]
            release_status = outputs[paths.release_status_tex_path]

            self.assertIn("PUBLIC SOFTWARE CHANNELS VERIFIED", release_tex)
            self.assertIn("npm trusted-publisher OIDC", release_tex)
            self.assertIn("VERIFIED", release_tex)
            self.assertIn("DETACHED LEDGER", release_tex)
            self.assertNotIn("PENDING LIVE VERIFICATION", release_tex)
            self.assertIn("exact packed bytes & VERIFIED \\\\", release_tex)
            self.assertIn("checksum parity & DETACHED LEDGER \\\\", release_tex)
            self.assertIn("PUBLIC SOFTWARE CHANNELS VERIFIED", release_status)
            self.assertIn("detached", release_status.lower())

    def test_build_outputs_rejects_failed_public_release_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            payload = _live_release_fixture()
            payload["publicGate"]["failures"] = ["website mismatch"]
            _write_json(paths.live_release_verification_path, payload)

            with self.assertRaisesRegex(ReportPackageInputError, r"failures: \[\]"):
                build_outputs(paths)

    def test_build_outputs_rejects_duplicate_live_release_channels(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            payload = _live_release_fixture()
            payload["channels"][-1]["id"] = payload["channels"][0]["id"]
            _write_json(paths.live_release_verification_path, payload)

            with self.assertRaisesRegex(ReportPackageInputError, "exactly once"):
                build_outputs(paths)

    def test_build_outputs_fails_closed_on_incomplete_receipts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            payload = json.loads(paths.evidence_receipts_path.read_text(encoding="utf-8"))
            payload["verifiedCells"] = 35
            _write_json(paths.evidence_receipts_path, payload)

            with self.assertRaisesRegex(ReportPackageInputError, "36 of 36"):
                build_outputs(paths)

    def test_build_outputs_fails_closed_on_rendered_count_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            payload = json.loads(paths.grading_receipts_path.read_text(encoding="utf-8"))
            payload["gradedTrials"] = 21
            _write_json(paths.grading_receipts_path, payload)

            with self.assertRaisesRegex(ReportPackageInputError, "22 graded trials"):
                build_outputs(paths)

    def test_website_tex_fails_closed_when_after_gate_is_not_clean(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            payload = json.loads(paths.website_audit_path.read_text(encoding="utf-8"))
            payload["controlledStudy"]["after"]["lighthouse"]["assertionGate"]["status"] = "fail"
            _write_json(paths.website_audit_path, payload)

            with self.assertRaisesRegex(ReportPackageInputError, "website after gate"):
                build_outputs(paths)

    def test_checksum_inventory_is_sorted_and_excludes_pdf_and_self_hash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = _write_fixture(root)
            (root / "memi-2.7.3-confirmatory-audit.pdf").write_bytes(b"not-final")
            paths.checksum_inventory_path.write_text("stale self hash\n", encoding="utf-8")

            outputs = build_outputs(paths)
            write_outputs(paths, outputs)
            first = paths.checksum_inventory_path.read_bytes()
            manifest = json.loads(first)
            inventory_paths = [entry["path"] for entry in manifest["entries"]]

            self.assertEqual(inventory_paths, sorted(inventory_paths))
            self.assertNotIn("memi-2.7.3-confirmatory-audit.pdf", inventory_paths)
            self.assertNotIn("generated/report-package-checksums.json", inventory_paths)
            self.assertEqual(
                manifest["excluded"],
                ["**/*.pdf", "generated/report-package-checksums.json"],
            )

            second_outputs = build_outputs(paths)
            write_outputs(paths, second_outputs)
            self.assertEqual(first, paths.checksum_inventory_path.read_bytes())

    def test_verify_outputs_detects_stale_generated_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            outputs = build_outputs(paths)
            write_outputs(paths, outputs)
            self.assertEqual(verify_outputs(paths, build_outputs(paths)), [])

            paths.website_audit_tex_path.write_text("stale\n", encoding="utf-8")
            mismatches = verify_outputs(paths, build_outputs(paths))
            self.assertEqual(len(mismatches), 2)
            self.assertEqual(mismatches[0].path, paths.website_audit_tex_path)
            self.assertEqual(mismatches[1].path, paths.checksum_inventory_path)

    def test_checksum_verification_rejects_path_escape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary_root = Path(directory)
            paths = _write_fixture(temporary_root / "report")
            outputs = build_outputs(paths)
            write_outputs(paths, outputs)
            outside = temporary_root / "outside.txt"
            outside.write_text("outside\n", encoding="utf-8")
            manifest = json.loads(paths.checksum_inventory_path.read_text(encoding="utf-8"))
            manifest["entries"][0] = {
                "path": "../outside.txt",
                "bytes": outside.stat().st_size,
                "sha256": "sha256:" + sha256(outside.read_bytes()).hexdigest(),
            }
            _write_json(paths.checksum_inventory_path, manifest)

            self.assertEqual(
                _verify_checksum_inventory(paths),
                ["unsafe checksum path ../outside.txt"],
            )

    def test_cli_build_and_check_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = _write_fixture(root)
            script = Path(__file__).parents[2] / "build-report-package.py"

            built = subprocess.run(
                [sys.executable, str(script), "--study-root", str(root)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(built.returncode, 0, built.stderr)
            self.assertIn("pending live release verification", built.stdout)

            checked = subprocess.run(
                [sys.executable, str(script), "--study-root", str(root), "--check"],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(checked.returncode, 0, checked.stderr)
            self.assertIn("current and deterministic", checked.stdout)

            _write_json(paths.live_release_verification_path, _live_release_fixture())
            live_built = subprocess.run(
                [sys.executable, str(script), "--study-root", str(root)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(live_built.returncode, 0, live_built.stderr)
            self.assertIn("public software channels verified", live_built.stdout.lower())
            self.assertNotIn("pending live release verification", live_built.stdout.lower())


def _write_fixture(root: Path) -> object:
    analysis_root = root / "analysis"
    tables_root = root / "generated" / "tables"
    fitness_root = root / "generated" / "fitness-policy"
    analysis_root.mkdir(parents=True)
    tables_root.mkdir(parents=True)
    fitness_root.mkdir(parents=True)

    exclusions = [
        {
            "id": f"V15-EXC-{index:03d}",
            "trialId": trial_id,
            "scope": "rendered-frontend-grading-only",
            "reasonCodes": ["fixture-exclusion"],
            "functionalOutcomeRetained": True,
            "resourceOutcomeRetained": True,
            "imputed": False,
            "evidenceManifestSha256": f"sha256:{index:064x}",
        }
        for index, trial_id in enumerate(
            [
                "study:buzzr-tab-unread-badge:r6:memi",
                *[
                    f"study:nate-options-reduce-motion:r{repeat}:{condition}"
                    for repeat in range(1, 7)
                    for condition in ("baseline", "memi")
                ],
                "study:paraform-command-menu:r5:baseline",
            ],
            start=1,
        )
    ]
    primary_pairs = [
        {
            "task_id": task_id,
            "repeat": repeat,
            "baseline_trial_id": f"study:{task_id}:r{repeat}:baseline",
            "memi_trial_id": f"study:{task_id}:r{repeat}:memi",
        }
        for task_id, repeats in (
            ("buzzr-tab-unread-badge", [1, 2, 3, 4, 5]),
            ("paraform-command-menu", [1, 2, 3, 4, 6]),
        )
        for repeat in repeats
    ]

    _write_json(
        root / "evidence-receipts.json",
        {
            "schemaVersion": 1,
            "expectedCells": 36,
            "verifiedCells": 36,
            "validationFailures": [],
            "evidenceRootDigest": f"sha256:{'a' * 64}",
        },
    )
    _write_json(root / "exclusions.json", {"schemaVersion": 1, "entries": exclusions})
    _write_json(
        root / "grading-receipts.json",
        {
            "schemaVersion": 1,
            "gradedTrials": 22,
            "excludedTrials": 14,
            "mappingSha256": f"sha256:{'b' * 64}",
            "graderReceipts": [
                {
                    "graderId": grader_id,
                    "model": "codex-blinded-model-grader",
                    "responseSha256": f"sha256:{digit * 64}",
                    "blinded": True,
                    "entries": 22,
                }
                for grader_id, digit in (("grader-a", "c"), ("grader-b", "d"), ("grader-c", "e"))
            ],
        },
    )
    _write_json(
        analysis_root / "blinded_grading.json",
        {
            "schemaVersion": 1,
            "studyId": "study",
            "graderCount": 3,
            "modelGraded": True,
            "independentHumanPractitionerEvidence": False,
            "entries": [{"trialId": f"graded-{index}", "ratings": []} for index in range(22)],
        },
    )
    _write_json(
        tables_root / "analysis_summary.json",
        {
            "analysisStatus": "complete",
            "receiptPreflight": {"expectedTrials": 36, "presentTrials": 36},
            "primaryPairRows": primary_pairs,
            "primarySummary": [
                {"task_id": "buzzr-tab-unread-badge", "graded_pairs": 5, "noninferior": True},
                {"task_id": "paraform-command-menu", "graded_pairs": 5, "noninferior": True},
            ],
        },
    )
    _write_json(
        root / "website-audit-before-after.json",
        {
            "schemaVersion": "memoire.website-audit.before-after.v1",
            "ledgerSha256": f"{'f' * 64}",
            "design": {
                "baseline": "f231a5a",
                "after": "bc131bf598e93c5c0688c35d91e863311114045f",
                "routes": ["/", "/components", "/about"],
                "lighthouseRunsPerRoute": 3,
                "execution": "serial",
            },
            "controlledStudy": {
                "before": _website_condition("before", gate_status="fail", gate_code=1, finding=True),
                "after": _website_condition("after", gate_status="pass", gate_code=0, finding=False),
            },
        },
    )
    _write_json(
        fitness_root / "quality-evidence-v2.json",
        {"kind": "memi-fitness-quality-evidence-v2", "entryCount": 10, "entries": [{}] * 10},
    )
    _write_json(
        fitness_root / "chronological-ingestion-plan.json",
        {
            "kind": "memi-fitness-chronological-ingestion-plan",
            "dryRun": True,
            "storeWritePlanned": False,
            "entryCount": 11,
            "entries": [{}] * 11,
        },
    )
    (root / "main.tex").write_text("report source\n", encoding="utf-8")
    (root / "report-hooks.tex").write_text("hooks\n", encoding="utf-8")
    (root / "README.md").write_text("fixture\n", encoding="utf-8")
    return study_report_paths(root)


def _website_condition(name: str, *, gate_status: str, gate_code: int, finding: bool) -> dict[str, object]:
    finding_payload = (
        [{"id": "label-content-name-mismatch", "impact": "serious"}]
        if finding
        else []
    )
    return {
        "name": name,
        "build": {"fileCount": 446, "footerMismatchAriaPresent": finding},
        "lighthouse": {
            "assertionGate": {
                "status": gate_status,
                "exitCode": gate_code,
                "blockingFindingIds": ["label-content-name-mismatch"] if finding else [],
            },
            "reports": [
                {"route": route, "accessibilityFindings": finding_payload}
                for route in ("/", "/components", "/about")
                for _ in range(3)
            ],
        },
        "playwright": {
            "lightModeTests": {"total": 55, "passed": 55, "failed": 0, "skipped": 0},
            "stats": {"unexpected": 0},
            "topLevelErrors": [],
        },
    }


def _live_release_fixture() -> dict[str, object]:
    channel_ids = [
        "npm",
        "node-installs",
        "github-release",
        "github-action",
        "homebrew",
        "ghcr",
        "mcp-registry",
        "website-pdf",
        "public-gate",
    ]
    channels = [
        {
            "id": channel_id,
            "status": "detached" if channel_id == "website-pdf" else "verified",
            "version": "2.7.4",
            "evidenceSha256": f"sha256:{index:064x}",
            "evidenceUrls": [f"https://example.invalid/evidence/{channel_id}"],
            "verificationMode": (
                "detached-post-build" if channel_id == "website-pdf" else "direct"
            ),
        }
        for index, channel_id in enumerate(channel_ids, start=1)
    ]
    return {
        "schemaVersion": "memoire.release-live-verification.v1",
        "releaseVersion": "2.7.4",
        "sourceCommit": "8aa4649f412bbcaaf2af4ee209bf79016566f035",
        "tag": "v2.7.4",
        "verifiedAt": "2026-08-01T14:00:00Z",
        "channels": channels,
        "publicGate": {
            "failures": [],
            "parityEligible": True,
            "evidenceSha256": f"sha256:{'f' * 64}",
        },
    }


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
