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
            self.assertIn("source-level checks only", remediation_tex)
            self.assertIn("not established", remediation_tex)
            self.assertNotIn("2,241 tests across 310 files", remediation_tex)
            self.assertNotIn("8aa4649f", remediation_tex)
            self.assertNotIn("b1b8b7ef", remediation_tex)
            self.assertNotIn("a7261456", remediation_tex)
            self.assertNotIn("ca45f11f", remediation_tex)
            self.assertNotIn("nine Linux, macOS, and Windows", remediation_tex)
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

            remediation_tex = outputs[paths.remediation_tex_path]
            self.assertIn("2,241 tests across 310 files", remediation_tex)
            self.assertIn("8aa4649f", remediation_tex)
            self.assertIn("b1b8b7ef", remediation_tex)
            self.assertIn("a7261456", remediation_tex)
            self.assertIn("ca45f11f", remediation_tex)
            self.assertIn("nine Linux, macOS, and Windows", remediation_tex)

    def test_build_outputs_rejects_missing_final_verifier(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            payload = _live_release_fixture()
            del payload["publicGate"]["finalVerifier"]
            _write_json(paths.live_release_verification_path, payload)

            with self.assertRaisesRegex(ReportPackageInputError, "final verifier"):
                build_outputs(paths)

    def test_build_outputs_rejects_altered_final_verifier_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            payload = _live_release_fixture()
            payload["publicGate"]["finalVerifier"]["websiteSourceCommit"] = "0" * 40
            _write_json(paths.live_release_verification_path, payload)

            with self.assertRaisesRegex(ReportPackageInputError, "final verifier provenance"):
                build_outputs(paths)

    def test_build_outputs_rejects_altered_public_gate_digest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            payload = _live_release_fixture()
            payload["publicGate"]["evidenceSha256"] = f"sha256:{'1' * 64}"
            _write_json(paths.live_release_verification_path, payload)

            with self.assertRaisesRegex(ReportPackageInputError, "public gate provenance"):
                build_outputs(paths)

    def test_build_outputs_rejects_channel_evidence_digest_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            payload = _live_release_fixture()
            payload["channels"][0]["evidenceSha256"] = f"sha256:{'0' * 64}"
            _write_json(paths.live_release_verification_path, payload)

            with self.assertRaisesRegex(ReportPackageInputError, "channel evidence digest"):
                build_outputs(paths)

    def test_build_outputs_rejects_missing_detached_pdf_hash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            channel_evidence = _release_channel_evidence_fixture()
            website_record = next(
                record for record in channel_evidence["records"] if record["id"] == "website-pdf"
            )
            del website_record["evidence"]["pdfSha256"]
            _write_json(paths.release_channel_evidence_path, channel_evidence)
            _write_json(
                paths.live_release_verification_path,
                _live_release_fixture(channel_evidence),
            )

            with self.assertRaisesRegex(ReportPackageInputError, "website PDF hash"):
                build_outputs(paths)

    def test_build_outputs_rejects_github_website_pdf_hash_disagreement(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            channel_evidence = _release_channel_evidence_fixture()
            github_record = next(
                record
                for record in channel_evidence["records"]
                if record["id"] == "github-release"
            )
            github_record["evidence"]["reportAssetSha256"] = "0" * 64
            _write_json(paths.release_channel_evidence_path, channel_evidence)
            _write_json(
                paths.live_release_verification_path,
                _live_release_fixture(channel_evidence),
            )

            with self.assertRaisesRegex(ReportPackageInputError, "GitHub release PDF hash"):
                build_outputs(paths)

    def test_build_outputs_rejects_duplicate_json_object_keys(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            channel_evidence = _release_channel_evidence_fixture()
            raw = json.dumps(channel_evidence, indent=2, sort_keys=True) + "\n"
            expected_commit = "8aa4649f412bbcaaf2af4ee209bf79016566f035"
            raw = raw.replace(
                f'"sourceCommit": "{expected_commit}"',
                f'"sourceCommit": "{"0" * 40}",\n  "sourceCommit": "{expected_commit}"',
                1,
            )
            paths.release_channel_evidence_path.write_text(raw, encoding="utf-8")
            _write_json(paths.live_release_verification_path, _live_release_fixture())

            with self.assertRaisesRegex(ReportPackageInputError, "duplicate JSON object key"):
                build_outputs(paths)

    def test_build_outputs_rejects_non_finite_json_constants(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            channel_evidence = _release_channel_evidence_fixture()
            channel_evidence["records"][0]["evidence"]["invalid"] = float("nan")
            _write_json(paths.release_channel_evidence_path, channel_evidence)
            _write_json(
                paths.live_release_verification_path,
                _live_release_fixture(channel_evidence),
            )

            with self.assertRaisesRegex(ReportPackageInputError, "non-finite JSON constant"):
                build_outputs(paths)

    def test_build_outputs_rejects_altered_release_provenance_commits(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            payload = _live_release_fixture()
            payload["releaseProvenance"]["parityClearanceCommit"] = "0" * 40
            _write_json(paths.live_release_verification_path, payload)

            with self.assertRaisesRegex(ReportPackageInputError, "release provenance"):
                build_outputs(paths)

    def test_build_outputs_rejects_ledger_timestamp_before_final_verifier(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            payload = _live_release_fixture()
            payload["verifiedAt"] = "2026-08-01T16:45:14Z"
            _write_json(paths.live_release_verification_path, payload)

            with self.assertRaisesRegex(ReportPackageInputError, "verification chronology"):
                build_outputs(paths)

    def test_build_outputs_rejects_final_verifier_before_tooling_merge(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            payload = _live_release_fixture()
            payload["publicGate"]["finalVerifier"]["verifiedAt"] = "2026-08-01T16:07:23Z"
            _write_json(paths.live_release_verification_path, payload)

            with self.assertRaisesRegex(ReportPackageInputError, "verification chronology"):
                build_outputs(paths)

    def test_build_outputs_rejects_unauthenticated_future_verifier_timestamp(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = _write_fixture(Path(directory))
            payload = _live_release_fixture()
            payload["verifiedAt"] = "2099-01-01T00:00:00Z"
            payload["publicGate"]["finalVerifier"]["verifiedAt"] = "2099-01-01T00:00:00Z"
            _write_json(paths.live_release_verification_path, payload)

            with self.assertRaisesRegex(ReportPackageInputError, "verification chronology"):
                build_outputs(paths)

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
                [
                    "**/*.pdf",
                    "**/*.pyc",
                    "**/__pycache__/**",
                    "**/.pytest_cache/**",
                    "**/.DS_Store",
                    "generated/report-package-checksums.json",
                ],
            )

            second_outputs = build_outputs(paths)
            write_outputs(paths, second_outputs)
            self.assertEqual(first, paths.checksum_inventory_path.read_bytes())

    def test_checksum_inventory_declares_and_ignores_cache_residue(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = _write_fixture(root)
            residue = {
                root / "analysis" / ".pytest_cache" / "v" / "cache" / "nodeids": b"volatile\n",
                root / "analysis" / "module.pyc": b"bytecode\n",
                root / "analysis" / "__pycache__" / "module.cpython-313.pyc": b"cache\n",
                root / "analysis" / ".DS_Store": b"finder\n",
            }
            for cache_file, content in residue.items():
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                cache_file.write_bytes(content)

            outputs = build_outputs(paths)
            write_outputs(paths, outputs)
            with_cache = paths.checksum_inventory_path.read_bytes()
            inventory_paths = [
                entry["path"]
                for entry in json.loads(with_cache)["entries"]
            ]
            self.assertFalse(
                any(
                    path.endswith((".pyc", ".DS_Store"))
                    or "/__pycache__/" in path
                    or "/.pytest_cache/" in path
                    for path in inventory_paths
                )
            )

            for cache_file in residue:
                cache_file.unlink()
            outputs_without_cache = build_outputs(paths)
            write_outputs(paths, outputs_without_cache)
            self.assertEqual(with_cache, paths.checksum_inventory_path.read_bytes())

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
    _write_json(
        root / "release-2.7.4-channel-evidence.json",
        _release_channel_evidence_fixture(),
    )
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


def _live_release_fixture(
    channel_evidence: dict[str, object] | None = None,
) -> dict[str, object]:
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
    channel_evidence = channel_evidence or _release_channel_evidence_fixture()
    evidence_by_id = {
        record["id"]: record["evidence"]
        for record in channel_evidence["records"]
    }
    channels = [
        {
            "id": channel_id,
            "status": "detached" if channel_id == "website-pdf" else "verified",
            "version": "2.7.4",
            "evidenceSha256": "sha256:"
            + sha256(
                json.dumps(
                    evidence_by_id[channel_id],
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                ).encode("utf-8")
            ).hexdigest(),
            "evidenceUrls": [f"https://example.invalid/evidence/{channel_id}"],
            "verificationMode": (
                "detached-post-build" if channel_id == "website-pdf" else "direct"
            ),
        }
        for channel_id in channel_ids
    ]
    return {
        "schemaVersion": "memoire.release-live-verification.v1",
        "releaseVersion": "2.7.4",
        "sourceCommit": "8aa4649f412bbcaaf2af4ee209bf79016566f035",
        "tag": "v2.7.4",
        "verifiedAt": "2026-08-01T16:45:15Z",
        "releaseProvenance": {
            "postReleaseEvidenceCommit": "b1b8b7ef57d5df17f676ac160a5b45e23682e2a4",
            "parityClearanceCommit": "a72614562bdc54c11b4beb416987b635740713c5",
        },
        "channels": channels,
        "publicGate": {
            "failures": [],
            "parityEligible": True,
            "evidenceSha256": "sha256:ca45f11fc42ceeb2c7653f0aba6b4b4ff2291b36a4f6b8183bd47d4dd388209a",
            "finalVerifier": {
                "verifiedAt": "2026-08-01T16:45:15Z",
                "status": "passed",
                "failures": [],
                "parityEligible": True,
                "toolingMergeCommit": "09635d81d9fbd281a2b5b3a7fefb55f0156380b3",
                "pullRequest": "https://github.com/memi-design/memi/pull/108",
                "cleanInstallMatrixRun": "https://github.com/memi-design/memi/actions/runs/30707179725",
                "websiteManifestSha256": "1ec702fa4a309158744640a3ae761427fc307436aac7ae0ef4ece40a575232e0",
                "websiteSourceCommit": "dac2dd9cb7f74dec977b4cb4280676b0c6d9d2c9",
            },
        },
    }


def _release_channel_evidence_fixture() -> dict[str, object]:
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
    records = []
    for index, channel_id in enumerate(channel_ids, start=1):
        evidence: dict[str, object] = {"sequence": index, "status": "verified"}
        if channel_id == "github-release":
            evidence = {
                "status": "verified",
                "url": "https://github.com/memi-design/memi/releases/tag/v2.7.4",
                "tag": "v2.7.4",
                "tagPeeledCommit": "8aa4649f412bbcaaf2af4ee209bf79016566f035",
                "reportAssetSha256": "5f178a3a0198c4f8a790d35dc1a2bf463c28e01cb1f495bf862b44c41ddbedb7",
                "reportChecksumAssetSha256": "937d32cf500a4b5c58c67542bd68583570d5639ab1b052f27035f0aa472d8627",
            }
        elif channel_id == "website-pdf":
            evidence = {
                "status": "detached-post-build",
                "artifactUrl": "https://www.memoire.cv/release/memi-release.json",
                "pdfUrl": "https://www.memoire.cv/research/memi-2.7.3-confirmatory-audit.pdf",
                "releaseUrl": "https://github.com/memi-design/memi/releases/tag/v2.7.4",
                "releaseAssetUrl": "https://github.com/memi-design/memi/releases/download/v2.7.4/memi-2.7.3-confirmatory-audit.pdf",
                "checksumAssetUrl": "https://github.com/memi-design/memi/releases/download/v2.7.4/memi-2.7.3-confirmatory-audit.pdf.sha256",
                "websiteSourceCommit": "e2a7d1dfe7a5c9e9a50f2bf585ce97f119c5ff44",
                "productionDeploymentId": "dpl_9K2P9sDq8Y7Es77qTd1WJxbzFF5M",
                "productionDeploymentUrl": "https://memoire-4mpu85ofv-sarveshseas-projects.vercel.app",
                "verifiedAt": "2026-08-01T17:14:05Z",
                "pdfBytes": 560146,
                "pdfSha256": "5f178a3a0198c4f8a790d35dc1a2bf463c28e01cb1f495bf862b44c41ddbedb7",
                "checksumAssetSha256": "937d32cf500a4b5c58c67542bd68583570d5639ab1b052f27035f0aa472d8627",
            }
        records.append({"id": channel_id, "evidence": evidence})
    return {
        "schemaVersion": "memoire.release-channel-evidence.v1",
        "releaseVersion": "2.7.4",
        "sourceCommit": "8aa4649f412bbcaaf2af4ee209bf79016566f035",
        "canonicalization": "UTF-8 JSON with lexicographically sorted keys and compact separators",
        "records": records,
    }


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
