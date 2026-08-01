from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


SHA256_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")
MANIFEST_PLACEHOLDER = f"sha256:{'0' * 64}"
V2_DECISION = "record-v2-quality-evidence"
V1_NEGATIVE_DECISION = "record-v1-automation-only-negative"
WRITE_DECISIONS = {V2_DECISION, V1_NEGATIVE_DECISION}


class BacktestInputError(RuntimeError):
    """Raised when source evidence or engine output breaks the frozen contract."""


@dataclass(frozen=True)
class WriteEntry:
    sequence: int
    source_version: str
    source_entry: dict[str, Any]
    quality_entry: dict[str, Any] | None

    @property
    def pair(self) -> dict[str, Any]:
        source = self.quality_entry if self.source_version == "v2" else self.source_entry
        if source is None or not isinstance(source.get("pair"), dict):
            raise BacktestInputError(f"sequence {self.sequence} is missing pair identity")
        return source["pair"]

    @property
    def route(self) -> dict[str, Any]:
        source = self.quality_entry if self.source_version == "v2" else self.source_entry
        if source is None or not isinstance(source.get("route"), dict):
            raise BacktestInputError(f"sequence {self.sequence} is missing route identity")
        return source["route"]

    @property
    def harness(self) -> dict[str, Any]:
        source = self.quality_entry if self.source_version == "v2" else self.source_entry
        if source is None or not isinstance(source.get("harness"), dict):
            raise BacktestInputError(f"sequence {self.sequence} is missing harness identity")
        return source["harness"]


@dataclass(frozen=True)
class BacktestInputs:
    chronology: tuple[dict[str, Any], ...]
    write_entries: tuple[WriteEntry, ...]
    rubric_version: str


@dataclass(frozen=True)
class BacktestPaths:
    study_root: Path
    engine_cli: Path
    source_store_root: Path
    source_runs_root: Path

    @property
    def fitness_root(self) -> Path:
        return self.study_root / "generated" / "fitness-policy"

    @property
    def source_store_path(self) -> Path:
        return self.source_store_root / ".memoire" / "efficiency" / "runs.jsonl"

    @property
    def figure_path(self) -> Path:
        return self.study_root / "generated" / "figures" / "fitness_backtest.png"

    @property
    def results_tex_path(self) -> Path:
        return self.study_root / "generated" / "tex" / "fitness-backtest-results.tex"

    @property
    def interpretation_tex_path(self) -> Path:
        return self.study_root / "generated" / "tex" / "backtest-figure-interpretation.tex"


def default_backtest_paths(
    study_root: Path | None = None,
    engine_cli: Path | None = None,
    source_store_root: Path | None = None,
    source_runs_root: Path | None = None,
) -> BacktestPaths:
    root = (study_root or Path(__file__).resolve().parent.parent).resolve()
    evidence_root = Path(
        "/Volumes/ExtremeSSD/Projects/_evidence/memi-2.7-v15-2.7.3-confirmatory"
    )
    return BacktestPaths(
        study_root=root,
        engine_cli=(engine_cli or Path(
            "/Volumes/ExtremeSSD/Projects/_worktrees/memi-2.7.4-engine/dist/index.js"
        )).resolve(),
        source_store_root=(source_store_root or evidence_root / "store").resolve(),
        source_runs_root=(source_runs_root or evidence_root / "runs").resolve(),
    )


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def file_sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def engine_canonical_sha256(value: Any) -> str:
    """Match the engine's schema-ordered JSON.stringify evidence hashing."""
    return "sha256:" + hashlib.sha256(_engine_canonical_json(value).encode("utf-8")).hexdigest()


def load_backtest_inputs(
    ingestion_plan_path: Path,
    quality_evidence_path: Path,
    rubric_path: Path,
) -> BacktestInputs:
    plan = _read_json(ingestion_plan_path)
    quality = _read_json(quality_evidence_path)
    rubric = _read_json(rubric_path)
    chronology = plan.get("entries")
    quality_entries = quality.get("entries")
    if plan.get("kind") != "memi-fitness-chronological-ingestion-plan":
        raise BacktestInputError("unexpected chronological ingestion plan kind")
    if quality.get("kind") != "memi-fitness-quality-evidence-v2":
        raise BacktestInputError("unexpected quality evidence kind")
    if not isinstance(chronology, list) or len(chronology) != plan.get("entryCount"):
        raise BacktestInputError("chronological ingestion plan count mismatch")
    if not isinstance(quality_entries, list) or len(quality_entries) != quality.get("entryCount"):
        raise BacktestInputError("quality evidence count mismatch")
    if [entry.get("sequence") for entry in chronology] != list(range(1, len(chronology) + 1)):
        raise BacktestInputError("chronological sequence is not contiguous")
    if [entry.get("observedAt") for entry in chronology] != sorted(
        entry.get("observedAt") for entry in chronology
    ):
        raise BacktestInputError("chronological ingestion plan is not time ordered")

    quality_by_id = {entry.get("eventId"): entry for entry in quality_entries}
    writes: list[WriteEntry] = []
    for entry in chronology:
        decision = entry.get("ingestDecision")
        eligible = entry.get("storeWriteEligible") is True
        if eligible != (decision in WRITE_DECISIONS):
            raise BacktestInputError(
                f"sequence {entry.get('sequence')} store-write eligibility is inconsistent"
            )
        if not eligible:
            continue
        source_version = str(entry.get("sourceVersion"))
        quality_entry = quality_by_id.get(entry.get("pairId")) if source_version == "v2" else None
        if source_version == "v2" and quality_entry is None:
            raise BacktestInputError(
                f"sequence {entry.get('sequence')} has no matching v2 quality entry"
            )
        write = WriteEntry(
            sequence=int(entry["sequence"]),
            source_version=source_version,
            source_entry=entry,
            quality_entry=quality_entry,
        )
        _validate_write_identity(write)
        writes.append(write)

    if len(writes) != 12 or sum(entry.source_version == "v2" for entry in writes) != 10:
        raise BacktestInputError("expected exactly ten v2 and two v1 store writes")
    if len(quality_by_id) != 10:
        raise BacktestInputError("expected exactly ten v2 quality evidence entries")
    rubric_version = rubric.get("rubricVersion")
    if not isinstance(rubric_version, str) or not rubric_version:
        raise BacktestInputError("rubric version is missing")
    return BacktestInputs(tuple(chronology), tuple(writes), rubric_version)


def build_engine_quality_evidence(
    quality_entry: dict[str, Any] | None,
    rubric_version: str,
) -> dict[str, Any]:
    if quality_entry is None:
        raise BacktestInputError("v2 command is missing quality evidence")
    pair = quality_entry["pair"]
    source = quality_entry["quality"]["qualityEvidence"]
    payload = {
        "pair": {
            "baselineRunId": pair["baselineRunId"],
            "memiRunId": pair["memiRunId"],
        },
        "rubricVersion": rubric_version,
        "blinded": True,
        "graderCount": int(source["graderCount"]),
        "baseline": {
            "score": float(source["baseline"]["score"]),
            "criticalDefects": int(source["baseline"]["criticalDefectCount"]),
        },
        "memi": {
            "score": float(source["memi"]["score"]),
            "criticalDefects": int(source["memi"]["criticalDefectCount"]),
        },
    }
    return {**payload, "evidenceSha256": engine_canonical_sha256(payload)}


def expected_replay_counts(chronology: Sequence[dict[str, Any]]) -> list[int]:
    count = 0
    result: list[int] = []
    for entry in chronology:
        if entry.get("storeWriteEligible") is True:
            count += 1
        result.append(count)
    return result


def validate_cli_event(command: WriteEntry, event: dict[str, Any]) -> None:
    pair = command.pair
    route = command.route
    expected_skills = sorted(
        route["skills"], key=lambda item: (item["skillId"], item["contentHash"])
    )
    actual_skills = sorted(
        event.get("skills", []), key=lambda item: (item.get("skillId", ""), item.get("contentHash", ""))
    )
    checks = [
        (event.get("createdAt") == command.source_entry["observedAt"], "pair availability timestamp"),
        (event.get("taskClass") == command.source_entry["taskClass"], "task class"),
        (
            event.get("repositoryFingerprintHash") == route["repositoryFingerprintHash"],
            "repository fingerprint",
        ),
        (event.get("harness") == command.harness, "harness identity"),
        (
            event.get("pair")
            == {
                "baselineRunId": pair["baselineRunId"],
                "memiRunId": pair["memiRunId"],
            },
            "run pair identity",
        ),
        (actual_skills == expected_skills, "skill identity"),
        (event.get("schemaVersion") == int(command.source_version.removeprefix("v")), "schema version"),
    ]
    for valid, label in checks:
        if not valid:
            raise BacktestInputError(f"sequence {command.sequence} {label} mismatch")
    if command.source_version == "v1" and event.get("qualityParity") is not False:
        raise BacktestInputError(f"sequence {command.sequence} v1 negative is not harmful")
    if command.source_version == "v2":
        expected_quality = build_engine_quality_evidence(command.quality_entry, "memi-design-quality-v1")
        if event.get("qualityEvidence") != expected_quality:
            raise BacktestInputError(f"sequence {command.sequence} engine quality evidence mismatch")
        prospective = event.get("prospective")
        if not isinstance(prospective, dict) or (
            prospective.get("baselineTrialId") != pair["baselineTrialId"]
            or prospective.get("memiTrialId") != pair["memiTrialId"]
        ):
            raise BacktestInputError(f"sequence {command.sequence} prospective trial pair mismatch")


def summarize_backtest(
    backtest: dict[str, Any],
    chronology: Sequence[dict[str, Any]],
) -> dict[str, Any]:
    writes = sum(entry.get("storeWriteEligible") is True for entry in chronology)
    if backtest.get("eventsAvailable") != writes or backtest.get("eventsReplayed") != writes:
        raise BacktestInputError("final backtest event count mismatch")
    route_rows: list[dict[str, Any]] = []
    for route in backtest.get("routes", []):
        identity = route["identity"]
        skills = identity["skills"]
        if len(skills) != 1:
            raise BacktestInputError("V15 exact route must contain one skill")
        timeline = route["timeline"]
        suppressions = [row for row in timeline if row["stateAfter"] == "suppressed"]
        route_rows.append({
            "routeKey": route["routeKey"],
            "taskClass": identity["taskClass"],
            "repositoryFingerprintHash": identity["repositoryFingerprintHash"],
            "provider": identity["harness"]["provider"],
            "modelId": identity["harness"]["modelId"],
            "reasoningEffort": identity["harness"]["reasoningEffort"],
            "skillId": skills[0]["skillId"],
            "skillContentHash": skills[0]["contentHash"],
            "matchingEvents": len(timeline),
            "finalDecision": route["finalDecision"],
            "finalState": route["finalState"],
            "suppressedAt": suppressions[0]["createdAt"] if suppressions else None,
            "latestReasons": timeline[-1]["reasonsAfter"] if timeline else [],
        })
    route_rows.sort(key=lambda row: (row["taskClass"], row["skillId"]))
    expected = {
        ("buzzr-tab-unread-badge", "atomic-design"),
        ("paraform-command-menu", "design-extract"),
    }
    actual = {(row["taskClass"], row["skillId"]) for row in route_rows}
    if actual != expected:
        raise BacktestInputError(f"unexpected exact routes in final backtest: {sorted(actual)}")
    return {
        "schemaVersion": 1,
        "kind": "memi-v15-fitness-backtest-summary",
        "chronologyCount": len(chronology),
        "storeWriteCount": writes,
        "chronologyOnlyCount": len(chronology) - writes,
        "routeCount": len(route_rows),
        "suppressedRouteCount": sum(row["finalState"] == "suppressed" for row in route_rows),
        "recoveredRouteCount": sum(row["finalState"] == "recovered" for row in route_rows),
        "routes": route_rows,
    }


def render_backtest_artifacts(
    summary: dict[str, Any],
    figure_path: Path,
    results_tex_path: Path,
    interpretation_tex_path: Path,
) -> None:
    figure_path.parent.mkdir(parents=True, exist_ok=True)
    results_tex_path.parent.mkdir(parents=True, exist_ok=True)
    labels = ["Buzzr / atomic-design", "Paraform / design-extract"]
    routes = summary["routes"]
    states = [1 if route["finalState"] == "suppressed" else 0 for route in routes]
    fig, axis = plt.subplots(figsize=(8.2, 3.2), dpi=160)
    colors = ["#b42318" if state else "#067647" for state in states]
    axis.barh(labels, [1, 1], color=colors, height=0.48)
    axis.set_xlim(0, 1)
    axis.set_xticks([])
    axis.set_title("V15 exact-route state after chronological replay", loc="left", weight="bold")
    axis.set_xlabel("12 eligible pair events replayed; 7 rows retained as chronology-only")
    for index, route in enumerate(routes):
        axis.text(
            0.5,
            index,
            f"{route['finalState']} · {route['finalDecision']} · {route['matchingEvents']} events",
            ha="center",
            va="center",
            color="white",
            weight="bold",
            fontsize=9,
        )
    for spine in axis.spines.values():
        spine.set_visible(False)
    fig.tight_layout()
    fig.savefig(
        figure_path,
        format="png",
        dpi=160,
        metadata={"Software": "Memi V15 deterministic fitness backtest"},
    )
    plt.close(fig)

    route_text = " ".join(
        f"\\texttt{{{_tex(route['taskClass'])}/{_tex(route['skillId'])}}} finishes "
        f"\\texttt{{{_tex(route['finalState'])}}} with "
        f"\\texttt{{{_tex(route['finalDecision'])}}} discovery after "
        f"{route['matchingEvents']} exact-route events."
        for route in routes
    )
    results_tex_path.write_text(
        "The engine replayed 12 store-write-eligible events in pair-complete timestamp order: "
        "10 blinded-quality v2 events and two automation-only negative v1 events. "
        f"{route_text} No route recovered. The six Nate rows and one legacy row remain "
        "chronology-only and created no engine route.\n",
        encoding="utf-8",
    )
    transitions = "; ".join(
        f"{route['taskClass']}/{route['skillId']} first entered suppression at "
        f"{route['suppressedAt']}"
        for route in routes
    )
    interpretation_tex_path.write_text(
        f"{_tex(transitions)}. Both final exact routes therefore use repository-only discovery. "
        "Nate abstained in all six repeats, so there is no Nate exact route and no suppression "
        "claim for Nate; those observations are retained only in the chronology ledger.\n",
        encoding="utf-8",
    )


def execute_backtest(paths: BacktestPaths, scratch_root: Path | None = None) -> dict[str, Any]:
    inputs = load_backtest_inputs(
        paths.fitness_root / "chronological-ingestion-plan.json",
        paths.fitness_root / "quality-evidence-v2.json",
        paths.study_root / "rubric.json",
    )
    if not paths.engine_cli.is_file():
        raise BacktestInputError(f"engine CLI is missing: {paths.engine_cli}")
    if not paths.source_store_path.is_file() or not paths.source_runs_root.is_dir():
        raise BacktestInputError("canonical V15 source store/evidence root is missing")
    owned_temp = scratch_root is None
    temporary = tempfile.TemporaryDirectory(prefix="memi-v15-fitness-backtest-") if owned_temp else None
    isolated_root = Path(temporary.name) if temporary else scratch_root.resolve()
    try:
        if isolated_root.exists() and any(isolated_root.iterdir()):
            raise BacktestInputError(f"isolated root must be empty: {isolated_root}")
        isolated_root.mkdir(parents=True, exist_ok=True)
        source_before = _source_digest(paths, inputs.write_entries)
        isolated_store, isolated_runs, copy_receipts = _copy_isolated_evidence(
            paths, inputs.write_entries, isolated_root
        )
        quality_root = isolated_root / "quality-cli"
        quality_root.mkdir(mode=0o700)
        generated_quality: dict[str, dict[str, Any]] = {}
        command_receipts: list[dict[str, Any]] = []
        events: list[dict[str, Any]] = []
        for command in inputs.write_entries:
            pair = command.pair
            argv = [
                "node",
                str(paths.engine_cli),
                "benchmark",
                "fitness-record",
                "--baseline",
                pair["baselineRunId"],
                "--memi",
                pair["memiRunId"],
                "--route",
                str(isolated_runs / pair["memiRunId"] / "skill-route.json"),
                "--task-class",
                command.source_entry["taskClass"],
                "--store-root",
                str(isolated_store),
                "--json",
            ]
            quality_payload = None
            quality_name = None
            if command.source_version == "v2":
                quality_payload = build_engine_quality_evidence(
                    command.quality_entry, inputs.rubric_version
                )
                quality_name = _quality_filename(command)
                quality_path = quality_root / quality_name
                _write_json(quality_path, quality_payload, mode=0o600)
                generated_quality[quality_name] = quality_payload
                argv[-1:-1] = ["--quality-evidence", str(quality_path)]
            payload, receipt = _run_json_command(argv, isolated_root)
            event = payload.get("event")
            if not isinstance(event, dict):
                raise BacktestInputError(f"sequence {command.sequence} CLI returned no event")
            validate_cli_event(command, event)
            events.append(event)
            command_receipts.append({
                "sequence": command.sequence,
                "sourceVersion": command.source_version,
                "ingestDecision": command.source_entry["ingestDecision"],
                "observedAt": command.source_entry["observedAt"],
                "qualityFile": quality_name,
                "sourceQualityEvidenceSha256": (
                    command.quality_entry["quality"]["qualityEvidenceSha256"]
                    if command.quality_entry else None
                ),
                "engineQualityEvidenceSha256": (
                    quality_payload["evidenceSha256"] if quality_payload else None
                ),
                "eventId": event["eventId"],
                **receipt,
            })

        store_path = isolated_store / ".memoire" / "efficiency" / "skill-fitness.jsonl"
        stored_events = _read_jsonl(store_path)
        if stored_events != events:
            raise BacktestInputError("fitness store order/content differs from CLI receipts")
        snapshots: list[dict[str, Any]] = []
        expected_counts = expected_replay_counts(inputs.chronology)
        for entry, expected_count in zip(inputs.chronology, expected_counts, strict=True):
            payload, receipt = _run_json_command([
                "node",
                str(paths.engine_cli),
                "benchmark",
                "fitness-backtest",
                "--store-root",
                str(isolated_store),
                "--as-of",
                entry["observedAt"],
                "--json",
            ], isolated_root)
            backtest = payload["backtest"]
            if backtest["eventsAvailable"] != 12 or backtest["eventsReplayed"] != expected_count:
                raise BacktestInputError(
                    f"as-of sequence {entry['sequence']} replayed {backtest['eventsReplayed']} "
                    f"events; expected {expected_count}"
                )
            snapshots.append({
                "sequence": entry["sequence"],
                "asOf": entry["observedAt"],
                "ingestDecision": entry["ingestDecision"],
                "storeWriteEligible": entry["storeWriteEligible"],
                "expectedEventsReplayed": expected_count,
                "backtest": backtest,
                "command": receipt,
            })
        final_payload, final_receipt = _run_json_command([
            "node",
            str(paths.engine_cli),
            "benchmark",
            "fitness-backtest",
            "--store-root",
            str(isolated_store),
            "--json",
        ], isolated_root)
        final_backtest = final_payload["backtest"]
        summary = summarize_backtest(final_backtest, inputs.chronology)
        source_after = _source_digest(paths, inputs.write_entries)
        if source_after != source_before:
            raise BacktestInputError("canonical raw V15 store/evidence changed during isolated execution")
        return {
            "inputs": inputs,
            "generatedQuality": generated_quality,
            "commandReceipts": command_receipts,
            "copyReceipts": copy_receipts,
            "storeEvents": stored_events,
            "snapshots": snapshots,
            "finalBacktest": final_backtest,
            "finalCommand": final_receipt,
            "summary": summary,
            "sourceDigest": source_before,
        }
    finally:
        if temporary is not None:
            temporary.cleanup()


def write_execution_artifacts(paths: BacktestPaths, result: dict[str, Any]) -> None:
    paths.fitness_root.mkdir(parents=True, exist_ok=True)
    quality_root = paths.fitness_root / "quality-cli"
    quality_root.mkdir(parents=True, exist_ok=True)
    expected_quality_names = set(result["generatedQuality"])
    for existing in quality_root.glob("*.json"):
        if existing.name not in expected_quality_names:
            existing.unlink()
    for name, payload in sorted(result["generatedQuality"].items()):
        _write_json(quality_root / name, payload)
    receipts = {
        "schemaVersion": 1,
        "kind": "memi-v15-fitness-backtest-command-receipts",
        "engineCliSha256": file_sha256(paths.engine_cli),
        "sourceDigest": result["sourceDigest"],
        "copyReceipts": result["copyReceipts"],
        "recordCommands": result["commandReceipts"],
        "finalBacktestCommand": result["finalCommand"],
    }
    _write_json(paths.fitness_root / "backtest-command-receipts.json", receipts)
    _write_json(paths.fitness_root / "fitness-backtest.json", result["finalBacktest"])
    _write_json(paths.fitness_root / "fitness-backtest-as-of.json", {
        "schemaVersion": 1,
        "kind": "memi-v15-fitness-backtest-as-of-snapshots",
        "snapshotCount": len(result["snapshots"]),
        "snapshots": result["snapshots"],
    })
    _write_json(paths.fitness_root / "fitness-backtest-summary.json", result["summary"])
    store_path = paths.fitness_root / "fitness-store.jsonl"
    store_path.write_text(
        "".join(json.dumps(event, separators=(",", ":")) + "\n" for event in result["storeEvents"]),
        encoding="utf-8",
    )
    render_backtest_artifacts(
        result["summary"],
        paths.figure_path,
        paths.results_tex_path,
        paths.interpretation_tex_path,
    )


def execution_artifact_paths(paths: BacktestPaths) -> tuple[Path, ...]:
    quality = tuple(sorted((paths.fitness_root / "quality-cli").glob("*.json")))
    return (
        *quality,
        paths.fitness_root / "backtest-command-receipts.json",
        paths.fitness_root / "fitness-backtest.json",
        paths.fitness_root / "fitness-backtest-as-of.json",
        paths.fitness_root / "fitness-backtest-summary.json",
        paths.fitness_root / "fitness-store.jsonl",
        paths.figure_path,
        paths.results_tex_path,
        paths.interpretation_tex_path,
    )


def _validate_write_identity(command: WriteEntry) -> None:
    source = command.quality_entry if command.source_version == "v2" else command.source_entry
    assert source is not None
    if source["taskClass"] != command.source_entry["taskClass"]:
        raise BacktestInputError(f"sequence {command.sequence} task class mismatch")
    if source["observedAt"] != command.source_entry["observedAt"]:
        raise BacktestInputError(f"sequence {command.sequence} observation timestamp mismatch")
    if source["route"]["decision"] != "single" or not source["route"]["skills"]:
        raise BacktestInputError(f"sequence {command.sequence} is not an exact non-abstain route")
    if command.source_version == "v2":
        if command.source_entry["pairId"] != source["eventId"]:
            raise BacktestInputError(f"sequence {command.sequence} source event id mismatch")
        if command.source_entry["qualityEvidenceSha256"] != source["quality"]["qualityEvidenceSha256"]:
            raise BacktestInputError(f"sequence {command.sequence} source quality hash mismatch")
        if canonical_sha256(source["quality"]["qualityEvidence"]) != source["quality"]["qualityEvidenceSha256"]:
            raise BacktestInputError(f"sequence {command.sequence} rich quality payload hash mismatch")


def _copy_isolated_evidence(
    paths: BacktestPaths,
    commands: Sequence[WriteEntry],
    isolated_root: Path,
) -> tuple[Path, Path, list[dict[str, Any]]]:
    source_runs = _read_jsonl(paths.source_store_path)
    source_by_id = {run["runId"]: run for run in source_runs}
    selected_ids = sorted({run_id for command in commands for run_id in (
        command.pair["baselineRunId"], command.pair["memiRunId"]
    )})
    if len(source_by_id) != 36 or len(selected_ids) != 24:
        raise BacktestInputError("expected 36 canonical runs and 24 selected pair members")
    isolated_store = isolated_root / "store"
    isolated_runs = isolated_root / "evidence" / "runs"
    store_dir = isolated_store / ".memoire" / "efficiency"
    store_dir.mkdir(parents=True, mode=0o700)
    isolated_runs.mkdir(parents=True, mode=0o700)
    rebased_runs: list[dict[str, Any]] = []
    receipts: list[dict[str, Any]] = []
    for run_id in selected_ids:
        if run_id not in source_by_id:
            raise BacktestInputError(f"run is missing from canonical store: {run_id}")
        source_dir = paths.source_runs_root / run_id
        target_dir = isolated_runs / run_id
        shutil.copytree(source_dir, target_dir, symlinks=False)
        run = json.loads(json.dumps(source_by_id[run_id]))
        rebased_refs: list[str] = []
        for reference in run["evidenceRefs"]:
            if not isinstance(reference, str) or ":" in reference and not reference.startswith("/"):
                rebased_refs.append(reference)
                continue
            candidate = Path(reference)
            if candidate.parent != source_dir:
                raise BacktestInputError(f"run {run_id} evidence reference escapes its run directory")
            rebased_refs.append(str(target_dir / candidate.name))
        run["evidenceRefs"] = rebased_refs
        old_manifest = run["prospective"]["evidenceManifestSha256"]
        run["prospective"]["evidenceManifestSha256"] = MANIFEST_PLACEHOLDER
        _write_json(target_dir / "run.json", run, mode=0o600)
        original_manifest = _read_json(source_dir / "evidence-manifest.json")
        artifact_names = sorted(file["name"] for file in original_manifest["files"])
        manifest_files = []
        for name in artifact_names:
            artifact_path = target_dir / name
            digest = _hash_manifest_artifact(artifact_path, name)
            manifest_files.append({
                "name": name,
                "bytes": artifact_path.stat().st_size,
                "sha256": digest,
            })
        manifest_content = {
            "schemaVersion": 1,
            "trialId": run["prospective"]["trialId"],
            "files": manifest_files,
        }
        new_manifest = canonical_sha256(manifest_content)
        _write_json(target_dir / "evidence-manifest.json", {
            **manifest_content,
            "manifestSha256": new_manifest,
        }, mode=0o600)
        run["prospective"]["evidenceManifestSha256"] = new_manifest
        _write_json(target_dir / "run.json", run, mode=0o600)
        if _hash_manifest_artifact(target_dir / "run.json", "run.json") != next(
            file["sha256"] for file in manifest_files if file["name"] == "run.json"
        ):
            raise BacktestInputError(f"resealed run hash drift for {run_id}")
        rebased_runs.append(run)
        receipts.append({
            "runId": run_id,
            "canonicalManifestSha256": old_manifest,
            "canonicalRunSha256": file_sha256(source_dir / "run.json"),
            "isolatedCopyResealed": True,
            "evidenceReferencesRebased": True,
        })
    store_path = store_dir / "runs.jsonl"
    store_path.write_text(
        "".join(json.dumps(run, separators=(",", ":")) + "\n" for run in rebased_runs),
        encoding="utf-8",
    )
    os.chmod(store_path, 0o600)
    return isolated_store, isolated_runs, receipts


def _source_digest(paths: BacktestPaths, commands: Sequence[WriteEntry]) -> str:
    run_ids = sorted({run_id for command in commands for run_id in (
        command.pair["baselineRunId"], command.pair["memiRunId"]
    )})
    files = {"store": file_sha256(paths.source_store_path)}
    for run_id in run_ids:
        for name in ("run.json", "evidence-manifest.json", "route.json", "skill-route.json"):
            candidate = paths.source_runs_root / run_id / name
            if candidate.is_file():
                files[f"{run_id}/{name}"] = file_sha256(candidate)
    return canonical_sha256(files)


def _hash_manifest_artifact(path: Path, name: str) -> str:
    if name != "run.json":
        return file_sha256(path)
    text = path.read_text(encoding="utf-8")
    replaced, count = re.subn(
        r'("evidenceManifestSha256"\s*:\s*)"sha256:[a-f0-9]{64}"',
        rf'\1"{MANIFEST_PLACEHOLDER}"',
        text,
    )
    if count != 1:
        raise BacktestInputError("run.json must contain one evidenceManifestSha256")
    return "sha256:" + hashlib.sha256(replaced.encode("utf-8")).hexdigest()


def _run_json_command(argv: list[str], isolated_root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    completed = subprocess.run(argv, text=True, capture_output=True, check=False)
    normalized_argv = [argument.replace(str(isolated_root), "$ISOLATED_ROOT") for argument in argv]
    stdout = completed.stdout.replace(str(isolated_root), "$ISOLATED_ROOT")
    stderr = completed.stderr.replace(str(isolated_root), "$ISOLATED_ROOT")
    receipt = {
        "argv": normalized_argv,
        "exitCode": completed.returncode,
        "stdoutSha256": "sha256:" + hashlib.sha256(stdout.encode("utf-8")).hexdigest(),
        "stderrSha256": "sha256:" + hashlib.sha256(stderr.encode("utf-8")).hexdigest(),
        "stderr": stderr,
    }
    if completed.returncode != 0:
        raise BacktestInputError(
            f"engine command failed ({completed.returncode}): {' '.join(normalized_argv)}\n{stderr}"
        )
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise BacktestInputError(f"engine command emitted invalid JSON: {error}") from error
    return _normalize_paths(payload, isolated_root), receipt


def _normalize_paths(value: Any, isolated_root: Path) -> Any:
    if isinstance(value, str):
        return value.replace(str(isolated_root), "$ISOLATED_ROOT")
    if isinstance(value, list):
        return [_normalize_paths(item, isolated_root) for item in value]
    if isinstance(value, dict):
        return {key: _normalize_paths(item, isolated_root) for key, item in value.items()}
    return value


def _quality_filename(command: WriteEntry) -> str:
    pair = command.pair
    return f"{command.sequence:02d}-{pair['taskId']}-r{pair['repeat']}.json"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BacktestInputError(f"cannot read JSON input {path}: {error}") from error
    if not isinstance(value, dict):
        raise BacktestInputError(f"JSON input must be an object: {path}")
    return value


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        values = [json.loads(line) for line in lines if line.strip()]
    except (OSError, json.JSONDecodeError) as error:
        raise BacktestInputError(f"cannot read JSONL input {path}: {error}") from error
    if not all(isinstance(value, dict) for value in values):
        raise BacktestInputError(f"JSONL rows must be objects: {path}")
    return values


def _write_json(path: Path, payload: Any, mode: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if mode is not None:
        os.chmod(path, mode)


def _tex(value: Any) -> str:
    text = str(value)
    for source, replacement in [
        ("\\", r"\textbackslash{}"),
        ("_", r"\_"),
        ("%", r"\%"),
        ("&", r"\&"),
        ("#", r"\#"),
    ]:
        text = text.replace(source, replacement)
    return text


def _engine_canonical_json(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return "null"
        if value == 0:
            return "0"
        if value.is_integer():
            return str(int(value))
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(_engine_canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(str(key), ensure_ascii=False) + ":" + _engine_canonical_json(value[key])
            for key in value
        ) + "}"
    raise BacktestInputError(f"unsupported canonical JSON value: {type(value).__name__}")
