"""Deterministic, fail-closed report-package assembly for the V15 study."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
from typing import Any, Mapping


class ReportPackageInputError(RuntimeError):
    """Raised when a report claim cannot be supported by the sealed inputs."""


@dataclass(frozen=True)
class CheckMismatch:
    path: Path
    reason: str


@dataclass(frozen=True)
class StudyReportPaths:
    study_root: Path
    evidence_receipts_path: Path
    exclusions_path: Path
    grading_receipts_path: Path
    blinded_grading_path: Path
    analysis_summary_path: Path
    website_audit_path: Path
    quality_evidence_v2_path: Path
    chronological_ingestion_plan_path: Path
    website_audit_tex_path: Path
    remediation_tex_path: Path
    live_release_verification_path: Path
    release_gates_tex_path: Path
    release_status_tex_path: Path
    rendered_audit_ledger_path: Path
    checksum_inventory_path: Path


def study_report_paths(study_root: Path | None = None) -> StudyReportPaths:
    root = (study_root or Path(__file__).resolve().parents[1]).resolve()
    return StudyReportPaths(
        study_root=root,
        evidence_receipts_path=root / "evidence-receipts.json",
        exclusions_path=root / "exclusions.json",
        grading_receipts_path=root / "grading-receipts.json",
        blinded_grading_path=root / "analysis" / "blinded_grading.json",
        analysis_summary_path=root / "generated" / "tables" / "analysis_summary.json",
        website_audit_path=root / "website-audit-before-after.json",
        quality_evidence_v2_path=root / "generated" / "fitness-policy" / "quality-evidence-v2.json",
        chronological_ingestion_plan_path=(
            root / "generated" / "fitness-policy" / "chronological-ingestion-plan.json"
        ),
        website_audit_tex_path=root / "generated" / "tex" / "website-audit-results.tex",
        remediation_tex_path=root / "generated" / "tex" / "remediation-results.tex",
        live_release_verification_path=root / "release-2.7.4-live-verification.json",
        release_gates_tex_path=root / "generated" / "tex" / "release-gates.tex",
        release_status_tex_path=root / "generated" / "tex" / "release-status.tex",
        rendered_audit_ledger_path=root / "rendered-audit-ledger.json",
        checksum_inventory_path=root / "generated" / "report-package-checksums.json",
    )


def build_outputs(paths: StudyReportPaths) -> dict[Path, str]:
    evidence = _load_json(paths.evidence_receipts_path)
    exclusions = _load_json(paths.exclusions_path)
    grading_receipts = _load_json(paths.grading_receipts_path)
    blinded_grading = _load_json(paths.blinded_grading_path)
    analysis_summary = _load_json(paths.analysis_summary_path)
    website_audit = _load_json(paths.website_audit_path)
    quality_evidence = _load_json(paths.quality_evidence_v2_path)
    ingestion_plan = _load_json(paths.chronological_ingestion_plan_path)

    receipt_summary = _validate_receipts(evidence)
    exclusion_entries = _validate_exclusions(exclusions)
    grading_summary = _validate_grading(
        grading_receipts,
        blinded_grading,
        analysis_summary,
        exclusion_entries,
    )
    website_summary = _validate_website_audit(website_audit)
    remediation_summary = _validate_remediation_artifacts(quality_evidence, ingestion_plan)
    live_release_summary = (
        _validate_live_release_verification(_load_json(paths.live_release_verification_path))
        if paths.live_release_verification_path.is_file()
        else None
    )

    ledger = _rendered_audit_ledger(
        paths=paths,
        receipt_summary=receipt_summary,
        exclusion_entries=exclusion_entries,
        grading_summary=grading_summary,
        grading_receipts=grading_receipts,
        blinded_grading=blinded_grading,
    )
    outputs: dict[Path, str] = {
        paths.website_audit_tex_path: _website_audit_tex(website_summary),
        paths.remediation_tex_path: _remediation_tex(remediation_summary),
        paths.release_gates_tex_path: (
            _verified_release_gates_tex(live_release_summary)
            if live_release_summary is not None
            else _pending_release_gates_tex()
        ),
        paths.release_status_tex_path: (
            _verified_release_status_tex()
            if live_release_summary is not None
            else _pending_release_status_tex()
        ),
        paths.rendered_audit_ledger_path: _json_text(ledger),
    }
    outputs[paths.checksum_inventory_path] = _json_text(_checksum_inventory(paths, outputs))
    return outputs


def write_outputs(paths: StudyReportPaths, outputs: Mapping[Path, str]) -> None:
    ordered_paths = sorted(
        (path for path in outputs if path != paths.checksum_inventory_path),
        key=lambda path: path.as_posix(),
    )
    ordered_paths.append(paths.checksum_inventory_path)
    for path in ordered_paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(outputs[path], encoding="utf-8", newline="\n")


def verify_outputs(
    paths: StudyReportPaths,
    expected_outputs: Mapping[Path, str],
) -> list[CheckMismatch]:
    mismatches: list[CheckMismatch] = []
    for path in sorted(expected_outputs, key=lambda item: item.as_posix()):
        if not path.is_file():
            mismatches.append(CheckMismatch(path, "missing"))
            continue
        if path.read_text(encoding="utf-8") != expected_outputs[path]:
            mismatches.append(CheckMismatch(path, "content differs from deterministic rebuild"))

    if paths.checksum_inventory_path.is_file():
        checksum_errors = _verify_checksum_inventory(paths)
        if checksum_errors and not any(
            mismatch.path == paths.checksum_inventory_path for mismatch in mismatches
        ):
            mismatches.append(
                CheckMismatch(
                    paths.checksum_inventory_path,
                    "inventory does not match on-disk report artifacts",
                )
            )
    return sorted(
        mismatches,
        key=lambda mismatch: (
            mismatch.path == paths.checksum_inventory_path,
            mismatch.path.as_posix(),
        ),
    )


def _load_json(path: Path) -> dict[str, Any]:
    if path.is_symlink():
        raise ReportPackageInputError(f"report inputs must not be symlinks: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ReportPackageInputError(f"missing report input: {path}") from error
    except json.JSONDecodeError as error:
        raise ReportPackageInputError(f"invalid JSON report input {path}: {error}") from error
    if not isinstance(payload, dict):
        raise ReportPackageInputError(f"report input must be a JSON object: {path}")
    return payload


def _validate_receipts(payload: Mapping[str, Any]) -> dict[str, Any]:
    expected = payload.get("expectedCells")
    verified = payload.get("verifiedCells")
    failures = payload.get("validationFailures")
    if expected != 36 or verified != 36 or failures != []:
        raise ReportPackageInputError(
            "receipt gate requires 36 of 36 manifest-verified cells with no validation failures"
        )
    digest = _require_sha256(payload.get("evidenceRootDigest"), "evidence root digest")
    return {"expectedCells": expected, "verifiedCells": verified, "evidenceRootDigest": digest}


def _validate_exclusions(payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    entries = payload.get("entries")
    if not isinstance(entries, list) or len(entries) != 14:
        raise ReportPackageInputError("rendered audit requires exactly 14 recorded exclusions")
    normalized: list[dict[str, Any]] = []
    seen_trial_ids: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ReportPackageInputError("rendered exclusion entries must be objects")
        trial_id = entry.get("trialId")
        if not isinstance(trial_id, str) or not trial_id:
            raise ReportPackageInputError("every rendered exclusion requires a trialId")
        if trial_id in seen_trial_ids:
            raise ReportPackageInputError(f"duplicate rendered exclusion for {trial_id}")
        seen_trial_ids.add(trial_id)
        if entry.get("scope") != "rendered-frontend-grading-only":
            raise ReportPackageInputError(f"exclusion {trial_id} has an unsupported scope")
        if not entry.get("functionalOutcomeRetained") or not entry.get("resourceOutcomeRetained"):
            raise ReportPackageInputError(f"exclusion {trial_id} must retain functional/resource outcomes")
        if entry.get("imputed") is not False:
            raise ReportPackageInputError(f"exclusion {trial_id} must remain non-imputed")
        reason_codes = entry.get("reasonCodes")
        if not isinstance(reason_codes, list) or not reason_codes:
            raise ReportPackageInputError(f"exclusion {trial_id} requires reason codes")
        manifest_hash = _require_sha256(
            entry.get("evidenceManifestSha256"),
            f"exclusion evidence manifest hash for {trial_id}",
        )
        normalized.append(
            {
                "id": entry.get("id"),
                "trialId": trial_id,
                "reasonCodes": reason_codes,
                "functionalOutcomeRetained": True,
                "resourceOutcomeRetained": True,
                "imputed": False,
                "evidenceManifestSha256": manifest_hash,
            }
        )
    return sorted(normalized, key=lambda item: item["trialId"])


def _validate_grading(
    receipts: Mapping[str, Any],
    grading: Mapping[str, Any],
    summary: Mapping[str, Any],
    exclusions: list[dict[str, Any]],
) -> dict[str, Any]:
    if receipts.get("gradedTrials") != 22 or receipts.get("excludedTrials") != 14:
        raise ReportPackageInputError("rendered audit requires 22 graded trials and 14 exclusions")
    grader_receipts = receipts.get("graderReceipts")
    if not isinstance(grader_receipts, list) or len(grader_receipts) != 3:
        raise ReportPackageInputError("rendered audit requires three grader receipts")
    for receipt in grader_receipts:
        if (
            not isinstance(receipt, dict)
            or receipt.get("blinded") is not True
            or receipt.get("entries") != 22
        ):
            raise ReportPackageInputError("each blinded grader receipt must cover all 22 graded trials")
        _require_sha256(receipt.get("responseSha256"), "grader response hash")
    _require_sha256(receipts.get("mappingSha256"), "blinding mapping hash")

    entries = grading.get("entries")
    if (
        grading.get("modelGraded") is not True
        or grading.get("independentHumanPractitionerEvidence") is not False
        or grading.get("graderCount") != 3
        or not isinstance(entries, list)
        or len(entries) != 22
    ):
        raise ReportPackageInputError(
            "blinded grading must contain 22 model-graded trials from three graders and no human-evidence claim"
        )
    if summary.get("analysisStatus") != "complete":
        raise ReportPackageInputError("executed analysis summary is not complete")
    preflight = summary.get("receiptPreflight")
    if not isinstance(preflight, dict) or (
        preflight.get("expectedTrials"), preflight.get("presentTrials")
    ) != (36, 36):
        raise ReportPackageInputError("analysis receipt preflight does not admit all 36 trials")
    rows = summary.get("primaryPairRows")
    if not isinstance(rows, list) or len(rows) != 10:
        raise ReportPackageInputError("primary analysis must contain exactly 10 complete graded pairs")
    pair_repeats: dict[str, list[int]] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ReportPackageInputError("primary pair rows must be objects")
        task_id = row.get("task_id")
        repeat = row.get("repeat")
        if not isinstance(task_id, str) or not isinstance(repeat, int):
            raise ReportPackageInputError("primary pair rows require task_id and frozen repeat")
        pair_repeats.setdefault(task_id, []).append(repeat)
    pair_repeats = {key: sorted(value) for key, value in sorted(pair_repeats.items())}
    expected_repeats = {
        "buzzr-tab-unread-badge": [1, 2, 3, 4, 5],
        "paraform-command-menu": [1, 2, 3, 4, 6],
    }
    if pair_repeats != expected_repeats:
        raise ReportPackageInputError(
            f"graded-pair repeat identities do not match the frozen admitted pairs: {pair_repeats}"
        )
    if len(exclusions) != receipts.get("excludedTrials"):
        raise ReportPackageInputError("exclusion and grading ledgers disagree")
    return {
        "gradedTrials": 22,
        "excludedTrials": 14,
        "completeGradedPairs": 10,
        "pairRepeatsByTask": pair_repeats,
    }


def _validate_website_audit(payload: Mapping[str, Any]) -> dict[str, Any]:
    design = payload.get("design")
    controlled = payload.get("controlledStudy")
    if not isinstance(design, dict) or not isinstance(controlled, dict):
        raise ReportPackageInputError("website audit is missing its controlled-study design")
    routes = design.get("routes")
    runs_per_route = design.get("lighthouseRunsPerRoute")
    if routes != ["/", "/components", "/about"] or runs_per_route != 3:
        raise ReportPackageInputError("website audit must cover three registered routes with three runs each")
    before = _website_condition(controlled.get("before"), "before")
    after = _website_condition(controlled.get("after"), "after")
    if before["gateStatus"] != "fail" or before["gateExitCode"] != 1:
        raise ReportPackageInputError("website before gate must reproduce the blocking finding")
    if before["findingIds"] != ["label-content-name-mismatch"] or before["seriousFindings"] != 9:
        raise ReportPackageInputError("website baseline must reproduce the serious label mismatch nine times")
    if after["gateStatus"] != "pass" or after["gateExitCode"] != 0:
        raise ReportPackageInputError("website after gate is not clean")
    if after["findingIds"] or after["seriousFindings"]:
        raise ReportPackageInputError("website after reports retain a blocking accessibility finding")
    if before["playwrightPassed"] != 55 or after["playwrightPassed"] != 55:
        raise ReportPackageInputError("website Playwright light-mode gate must pass 55 of 55 tests")
    return {
        "baselineCommit": design.get("baseline"),
        "afterCommit": design.get("after"),
        "reportCount": 9,
        "playwrightPassed": 55,
        "ledgerSha256": payload.get("ledgerSha256"),
    }


def _website_condition(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ReportPackageInputError(f"website audit is missing the {label} condition")
    lighthouse = value.get("lighthouse")
    playwright = value.get("playwright")
    if not isinstance(lighthouse, dict) or not isinstance(playwright, dict):
        raise ReportPackageInputError(f"website {label} condition is incomplete")
    gate = lighthouse.get("assertionGate")
    reports = lighthouse.get("reports")
    if not isinstance(gate, dict) or not isinstance(reports, list) or len(reports) != 9:
        raise ReportPackageInputError(f"website {label} condition requires nine Lighthouse reports")
    finding_ids: set[str] = set()
    serious_findings = 0
    for report in reports:
        if not isinstance(report, dict):
            raise ReportPackageInputError(f"website {label} report must be an object")
        findings = report.get("accessibilityFindings")
        if not isinstance(findings, list):
            raise ReportPackageInputError(f"website {label} report findings must be a list")
        for finding in findings:
            if not isinstance(finding, dict) or not isinstance(finding.get("id"), str):
                raise ReportPackageInputError(f"website {label} finding is malformed")
            finding_ids.add(finding["id"])
            serious_findings += int(finding.get("impact") == "serious")
    tests = playwright.get("lightModeTests")
    if not isinstance(tests, dict) or tests.get("failed") != 0 or tests.get("total") != 55:
        raise ReportPackageInputError(f"website {label} Playwright gate is not clean")
    if playwright.get("topLevelErrors") != []:
        raise ReportPackageInputError(f"website {label} Playwright run has top-level errors")
    return {
        "gateStatus": gate.get("status"),
        "gateExitCode": gate.get("exitCode"),
        "findingIds": sorted(finding_ids),
        "seriousFindings": serious_findings,
        "playwrightPassed": tests.get("passed"),
    }


def _validate_remediation_artifacts(
    quality: Mapping[str, Any],
    ingestion: Mapping[str, Any],
) -> dict[str, Any]:
    quality_entries = quality.get("entries")
    ingestion_entries = ingestion.get("entries")
    if (
        quality.get("kind") != "memi-fitness-quality-evidence-v2"
        or quality.get("entryCount") != 10
        or not isinstance(quality_entries, list)
        or len(quality_entries) != 10
    ):
        raise ReportPackageInputError("remediation evidence must contain the 10 graded v2 pairs")
    if (
        ingestion.get("kind") != "memi-fitness-chronological-ingestion-plan"
        or ingestion.get("dryRun") is not True
        or ingestion.get("storeWritePlanned") is not False
        or not isinstance(ingestion_entries, list)
        or ingestion.get("entryCount") != len(ingestion_entries)
    ):
        raise ReportPackageInputError("chronological ingestion artifact must remain a no-write dry run")
    return {
        "qualityEntryCount": len(quality_entries),
        "chronologyEntryCount": len(ingestion_entries),
    }


def _rendered_audit_ledger(
    *,
    paths: StudyReportPaths,
    receipt_summary: Mapping[str, Any],
    exclusion_entries: list[dict[str, Any]],
    grading_summary: Mapping[str, Any],
    grading_receipts: Mapping[str, Any],
    blinded_grading: Mapping[str, Any],
) -> dict[str, Any]:
    source_paths = [
        paths.evidence_receipts_path,
        paths.exclusions_path,
        paths.grading_receipts_path,
        paths.blinded_grading_path,
        paths.analysis_summary_path,
    ]
    sources = {
        path.relative_to(paths.study_root).as_posix(): {
            "bytes": path.stat().st_size,
            "sha256": _sha256_bytes(path.read_bytes()),
        }
        for path in source_paths
    }
    grader_receipt_rows = [
        {
            "graderId": receipt["graderId"],
            "model": receipt.get("model"),
            "blinded": receipt["blinded"],
            "entries": receipt["entries"],
            "responseSha256": receipt["responseSha256"],
        }
        for receipt in grading_receipts["graderReceipts"]
    ]
    return {
        "schemaVersion": "memoire.v15.rendered-audit-ledger.v1",
        "studyId": blinded_grading.get("studyId"),
        "receiptAudit": receipt_summary,
        "renderedAudit": {
            **grading_summary,
            "exclusions": exclusion_entries,
            "functionalAndResourceOutcomesRetained": True,
            "imputationUsed": False,
        },
        "grading": {
            "modelGraded": True,
            "independentHumanPractitionerEvidence": False,
            "graderCount": 3,
            "mappingSha256": grading_receipts["mappingSha256"],
            "graderReceipts": grader_receipt_rows,
        },
        "captureLimitations": [
            "Buzzr visual evidence is a testing-library renderer tree, not Expo Simulator or native pixel proof.",
            "Paraform's registered mobile breakpoint blocks the desktop workspace, so phone captures show the desktop-only placeholder rather than the command-menu workspace.",
        ],
        "claimBoundary": {
            "qualityLabel": "model-graded; not independent human practitioner evidence",
            "superiorityClaimAuthorized": False,
            "dollarSavingsClaimAuthorized": False,
        },
        "sourceArtifacts": sources,
    }


def _website_audit_tex(summary: Mapping[str, Any]) -> str:
    after_short = _tex(str(summary["afterCommit"])[:7])
    return (
        "% Generated deterministically from website-audit-before-after.json; do not edit.\n"
        "A clean-checkout controlled audit compared baseline \\texttt{"
        f"{_tex(summary['baselineCommit'])}"
        "} with remediation commit \\texttt{"
        f"{after_short}"
        "}. Before remediation, all nine of nine Lighthouse reports reproduced the "
        "\\texttt{label-content-name-mismatch} finding at \\emph{serious} impact, and "
        "the unchanged blocking assertion gate exited 1. The footer accessible name was "
        "corrected to include its visible text. After remediation, all nine of nine reports "
        "contained no blocking accessibility finding and the unchanged blocking gate passed "
        "with exit 0.\n\n"
        f"The controlled Chromium light-mode suite passed {summary['playwrightPassed']} of "
        f"{summary['playwrightPassed']} tests both before and after, with no unexpected or "
        "top-level errors. The selected Playwright axe rules passed in both conditions; the "
        "experimental Lighthouse rule was outside that frozen axe selection. Performance "
        "variation across the local runs is not treated as a causal product claim, and local "
        "Astro evidence is not deployment proof.\n"
    )


def _remediation_tex(summary: Mapping[str, Any]) -> str:
    return (
        "% Generated deterministically from sealed remediation artifacts; do not edit.\n"
        "The reviewed 2.7.4 engineering chain implements exact route identity (task class, "
        "repository fingerprint, provider, model, effort, skill ID, and skill content hash), "
        "immutable blinded-quality evidence v2, fail-closed legacy-v1 handling, chronological "
        "no-look-ahead replay, immediate regression suppression, three-later-pair prospective "
        "recovery, corrupt/duplicate event rejection, and repository-only fallback for "
        "suppressed routes. The hardening chain is anchored by commits \\texttt{8cfd3498} "
        "through \\texttt{dfd98328}; this source-level statement does not establish a "
        "published release.\n\n"
        f"The sealed dry-run artifacts contain {summary['qualityEntryCount']} complete "
        "model-graded v2 quality pairs and "
        f"{summary['chronologyEntryCount']} chronological ingestion events. "
        "\\texttt{storeWritePlanned} is false: these report artifacts validate deterministic "
        "policy inputs and chronology without mutating a production fitness store. Public "
        "release channels and final cross-platform package bytes remain subject to the "
        "separate fail-closed release gate.\n\n"
        "At reviewed tip \\texttt{dfd98328}, the local full suite passed 2,241 tests across "
        "310 files; typecheck and build passed. The replay harness additionally pins frozen "
        "source and engine digests, rejects path and symlink escapes, and caps combined "
        "subprocess output at 10 MiB with process-group termination. The final security "
        "review reported no actionable findings. These are local engineering checks, not "
        "public-channel proof. "
        "The residual trust boundary is explicit: same-owner local artifacts lack external "
        "signatures, and the append lock relies on normal local-filesystem atomicity; weakly "
        "consistent NFS is out of scope.\n"
    )


def _pending_release_gates_tex() -> str:
    channels = [
        "npm trusted-publisher OIDC and exact packed bytes",
        "fresh Node 20/22/24 install and invocation",
        "GitHub tag, release assets, and checksums",
        "GitHub Action v2",
        "Homebrew formula and installed CLI",
        "GHCR image digest and invocation",
        "MCP Registry metadata and package resolution",
        "website PDF and checksum parity",
        "public gate with failures: [] and parityEligible: true",
    ]
    rows = "\n".join(f"{_tex(channel)} & PENDING \\\\" for channel in channels)
    return (
        "% Generated fail-closed: no final live 2.7.4 verification artifact was supplied.\n"
        "\\begin{center}\n"
        "\\fbox{\\begin{minipage}{0.92\\linewidth}\n"
        "\\small\\textbf{PENDING LIVE VERIFICATION.} Memi 2.7.4 publication and channel "
        "parity are not verified. Local commits, dry-run policy artifacts, and tests do not "
        "satisfy this gate.\n"
        "\\end{minipage}}\n"
        "\\end{center}\n"
        "\\begin{tabularx}{\\columnwidth}{@{}Xl@{}}\n"
        "\\toprule\nChannel evidence & State \\\\\n\\midrule\n"
        f"{rows}\n"
        "\\bottomrule\n\\end{tabularx}\n"
        "\\renewcommand{\\ReleaseGateStatus}{PENDING LIVE VERIFICATION --- no final "
        "2.7.4 public-channel ledger has been admitted.}\n"
    )


_LIVE_RELEASE_CHANNELS = {
    "npm": "npm trusted-publisher OIDC and exact packed bytes",
    "node-installs": "fresh Node 20/22/24 install and invocation",
    "github-release": "GitHub tag, release assets, and checksums",
    "github-action": "GitHub Action v2",
    "homebrew": "Homebrew formula and installed CLI",
    "ghcr": "GHCR image digest and invocation",
    "mcp-registry": "MCP Registry metadata and package resolution",
    "website-pdf": "website PDF and checksum parity",
    "public-gate": "public gate with failures: [] and parityEligible: true",
}


def _validate_live_release_verification(payload: Mapping[str, Any]) -> dict[str, Any]:
    if payload.get("schemaVersion") != "memoire.release-live-verification.v1":
        raise ReportPackageInputError("live release ledger schemaVersion is invalid")
    if payload.get("releaseVersion") != "2.7.4" or payload.get("tag") != "v2.7.4":
        raise ReportPackageInputError("live release ledger must identify Memi 2.7.4 and tag v2.7.4")
    if payload.get("sourceCommit") != "8aa4649f412bbcaaf2af4ee209bf79016566f035":
        raise ReportPackageInputError("live release ledger source commit is not the published candidate")
    verified_at = payload.get("verifiedAt")
    if not isinstance(verified_at, str) or not verified_at.endswith("Z"):
        raise ReportPackageInputError("live release ledger verifiedAt must be an ISO UTC timestamp")
    try:
        datetime.fromisoformat(verified_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise ReportPackageInputError(
            "live release ledger verifiedAt must be an ISO UTC timestamp"
        ) from error

    channels = payload.get("channels")
    if not isinstance(channels, list):
        raise ReportPackageInputError("live release ledger channels must be an array")
    by_id: dict[str, dict[str, Any]] = {}
    for channel in channels:
        if not isinstance(channel, dict) or not isinstance(channel.get("id"), str):
            raise ReportPackageInputError("every live release channel must be an object with an id")
        channel_id = channel["id"]
        if channel_id in by_id:
            raise ReportPackageInputError("every required live release channel must appear exactly once")
        by_id[channel_id] = channel
    if set(by_id) != set(_LIVE_RELEASE_CHANNELS):
        raise ReportPackageInputError("every required live release channel must appear exactly once")

    normalized: dict[str, dict[str, Any]] = {}
    for channel_id in _LIVE_RELEASE_CHANNELS:
        channel = by_id[channel_id]
        expected_mode = "detached-post-build" if channel_id == "website-pdf" else "direct"
        allowed_statuses = {"verified", "detached"} if channel_id == "website-pdf" else {"verified"}
        if channel.get("status") not in allowed_statuses:
            raise ReportPackageInputError(f"live release channel {channel_id} is not verified")
        if channel.get("version") != "2.7.4":
            raise ReportPackageInputError(f"live release channel {channel_id} has the wrong version")
        if channel.get("verificationMode") != expected_mode:
            raise ReportPackageInputError(
                f"live release channel {channel_id} has the wrong verification mode"
            )
        digest = _require_sha256(
            channel.get("evidenceSha256"),
            f"live release channel {channel_id} evidence hash",
        )
        urls = channel.get("evidenceUrls")
        if (
            not isinstance(urls, list)
            or not urls
            or any(not isinstance(url, str) or not url.startswith("https://") for url in urls)
        ):
            raise ReportPackageInputError(
                f"live release channel {channel_id} requires HTTPS evidence URLs"
            )
        normalized[channel_id] = {
            "status": channel["status"],
            "evidenceSha256": digest,
            "evidenceUrls": list(urls),
            "verificationMode": expected_mode,
        }

    public_gate = payload.get("publicGate")
    if not isinstance(public_gate, dict):
        raise ReportPackageInputError("live release ledger public gate is missing")
    if public_gate.get("failures") != [] or public_gate.get("parityEligible") is not True:
        raise ReportPackageInputError(
            "live release ledger public gate requires failures: [] and parityEligible: true"
        )
    public_gate_digest = _require_sha256(
        public_gate.get("evidenceSha256"),
        "live release public gate evidence hash",
    )
    return {
        "verifiedAt": verified_at,
        "channels": normalized,
        "publicGateEvidenceSha256": public_gate_digest,
    }


def _verified_release_gates_tex(summary: Mapping[str, Any]) -> str:
    rows = []
    for channel_id, label in _LIVE_RELEASE_CHANNELS.items():
        state = "DETACHED LEDGER" if channel_id == "website-pdf" else "VERIFIED"
        rows.append(f"{_tex(label)} & {state} \\")
    return (
        "% Generated from release-2.7.4-live-verification.json; do not edit.\n"
        "\\begin{center}\n"
        "\\fbox{\\begin{minipage}{0.92\\linewidth}\n"
        "\\small\\textbf{PUBLIC SOFTWARE CHANNELS VERIFIED.} Memi 2.7.4 resolves "
        "to the published source commit across every non-self-referential public channel. "
        "The checksum of this PDF is necessarily established by the detached post-build "
        "ledger attached to the release, not by a self-hash embedded in the PDF.\n"
        "\\end{minipage}}\n"
        "\\end{center}\n"
        "\\begin{tabularx}{\\columnwidth}{@{}Xl@{}}\n"
        "\\toprule\nChannel evidence & State \\\\\n\\midrule\n"
        + "\n".join(rows)
        + "\n\\bottomrule\n\\end{tabularx}\n"
        f"\\textit{{Ledger admitted at {_tex(summary['verifiedAt'])}.}}\n"
        "\\renewcommand{\\ReleaseGateStatus}{PUBLIC SOFTWARE CHANNELS VERIFIED --- "
        "the final PDF checksum is recorded in the detached post-build release ledger.}\n"
    )


def _pending_release_status_tex() -> str:
    return (
        "% Generated fail-closed: no final live 2.7.4 verification artifact was supplied.\n"
        "\\renewcommand{\\ReleaseGateStatus}{PENDING LIVE VERIFICATION --- no final "
        "2.7.4 public-channel ledger has been admitted.}\n"
    )


def _verified_release_status_tex() -> str:
    return (
        "% Generated from the admitted live 2.7.4 verification ledger.\n"
        "\\renewcommand{\\ReleaseGateStatus}{PUBLIC SOFTWARE CHANNELS VERIFIED --- "
        "the final PDF checksum is recorded in the detached post-build release ledger.}\n"
    )


def _checksum_inventory(
    paths: StudyReportPaths,
    virtual_outputs: Mapping[Path, str],
) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    for path in sorted(paths.study_root.rglob("*"), key=lambda item: item.as_posix()):
        if path.is_symlink():
            raise ReportPackageInputError(f"report package must not contain symlinks: {path}")
        if not path.is_file() or _checksum_excluded(paths, path):
            continue
        data = (
            virtual_outputs[path].encode("utf-8")
            if path in virtual_outputs
            else path.read_bytes()
        )
        entries.append(
            {
                "path": path.relative_to(paths.study_root).as_posix(),
                "bytes": len(data),
                "sha256": _sha256_bytes(data),
            }
        )
    for path, content in virtual_outputs.items():
        if path.exists() or _checksum_excluded(paths, path):
            continue
        data = content.encode("utf-8")
        entries.append(
            {
                "path": path.relative_to(paths.study_root).as_posix(),
                "bytes": len(data),
                "sha256": _sha256_bytes(data),
            }
        )
    entries.sort(key=lambda entry: entry["path"])
    return {
        "schemaVersion": "memoire.report-package-checksums.v1",
        "algorithm": "sha256",
        "root": ".",
        "excluded": ["**/*.pdf", "generated/report-package-checksums.json"],
        "entryCount": len(entries),
        "entries": entries,
    }


def _checksum_excluded(paths: StudyReportPaths, path: Path) -> bool:
    return (
        path == paths.checksum_inventory_path
        or path.suffix.lower() == ".pdf"
        or path.suffix == ".pyc"
        or "__pycache__" in path.parts
        or path.name in {".DS_Store"}
    )


def _verify_checksum_inventory(paths: StudyReportPaths) -> list[str]:
    try:
        manifest = json.loads(paths.checksum_inventory_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ["checksum inventory is unreadable"]
    errors: list[str] = []
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        return ["checksum entries are missing"]
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            errors.append("malformed checksum entry")
            continue
        relative_path = PurePosixPath(entry["path"])
        if (
            relative_path.is_absolute()
            or ".." in relative_path.parts
            or "\\" in entry["path"]
        ):
            errors.append(f"unsafe checksum path {entry['path']}")
            continue
        path = paths.study_root.joinpath(*relative_path.parts)
        if not path.is_file():
            errors.append(f"missing {entry['path']}")
            continue
        data = path.read_bytes()
        if entry.get("bytes") != len(data) or entry.get("sha256") != _sha256_bytes(data):
            errors.append(f"hash mismatch {entry['path']}")
    return errors


def _require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise ReportPackageInputError(f"{label} is missing")
    digest = value.removeprefix("sha256:")
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise ReportPackageInputError(f"{label} is not a lowercase SHA-256 digest")
    return f"sha256:{digest}"


def _sha256_bytes(data: bytes) -> str:
    return "sha256:" + sha256(data).hexdigest()


def _json_text(payload: Mapping[str, Any]) -> str:
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


def _tex(value: Any) -> str:
    text = str(value)
    replacements = {
        "\\": r"\\textbackslash{}",
        "&": r"\\&",
        "%": r"\\%",
        "$": r"\\$",
        "#": r"\\#",
        "_": r"\\_",
        "{": r"\\{",
        "}": r"\\}",
    }
    return "".join(replacements.get(character, character) for character in text)
