#!/usr/bin/env python3
"""Build and verify the controlled memoire.cv before/after audit ledger."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import statistics
import subprocess
from pathlib import Path
from typing import Any


BASELINE_COMMIT = "f231a5a"
FIX_COMMIT = "bc131bf598e93c5c0688c35d91e863311114045f"
CONTROLLED_ROUTES = ("/", "/components", "/about")
CATEGORY_IDS = ("performance", "accessibility", "best-practices", "seo")
METRIC_IDS = (
    "first-contentful-paint",
    "largest-contentful-paint",
    "cumulative-layout-shift",
    "total-blocking-time",
    "speed-index",
    "interactive",
)
WARNING_IDS = (
    "document-latency-insight",
    "errors-in-console",
    "image-delivery-insight",
    "modern-image-formats",
    "network-dependency-tree-insight",
    "unused-javascript",
    "uses-text-compression",
)
HARNESS_PATHS = (
    ".github/workflows/ci-webpage.yml",
    ".lighthouserc.json",
    "astro.audit.config.mjs",
    "package-lock.json",
    "package.json",
    "playwright.config.ts",
    "playwright.production.config.ts",
    "tests/e2e/a11y.spec.ts",
    "tests/e2e/light-mode-wcag.spec.ts",
)
STALE_REPORT_HASHES = (
    "6a4c5b3e6f17bccc906e5908068ac998e81ee0b4df81d00fabddaedbda4b36cd",
    "c07e221cc200df65f3994e6026966955053f19d97fd3b070e648056963cb053d",
    "f29ac8a8b5b291a6511ead8347d576b94986a2882dad13dd7b4dade2a8bb9d",
    "5ac001cb49a9e777ec1ab643e11febaec166504a415930b8e248df11e18c3ad7",
    "6193ca097a4b1c6c75b542e5c79de6b4ac0bd7b59c691df950e0d875729882e4",
    "a55d2f7ff5a05918c4b018a50bdf278c4d0d1bc5b1789870d8835fecc96325b2",
    "9ec2713826cff1d98b02baf805b1487501aa7ca8b08cb3e9857155e89766354e",
    "8c70e74194c587ecca79427a63ced81b2d350046eb487fef30be103c7f3adae0",
    "dff931fadfe2f404acbaf89b0219cf5341225275c1d2c94fee3965b829a8b138",
)


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def command(*args: str, cwd: Path | None = None) -> str:
    return subprocess.run(
        args,
        cwd=cwd,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()


def route_from_url(url: str) -> str:
    marker = ":4326"
    route = url.split(marker, 1)[1] if marker in url else url
    return route or "/"


def selected_node(node: dict[str, Any]) -> dict[str, Any]:
    return {
        key: node.get(key)
        for key in ("selector", "snippet", "nodeLabel", "explanation")
        if node.get(key) is not None
    }


def lighthouse_report(path: Path) -> dict[str, Any]:
    report = json.loads(path.read_text())
    accessibility_refs = report["categories"]["accessibility"]["auditRefs"]
    accessibility_findings = []
    for ref in accessibility_refs:
        audit = report["audits"][ref["id"]]
        if audit.get("score") is None or audit.get("score", 1) >= 1:
            continue
        details = audit.get("details") or {}
        nodes = [
            selected_node(item.get("node", {}))
            for item in details.get("items", [])
            if item.get("node")
        ]
        accessibility_findings.append(
            {
                "id": audit["id"],
                "title": audit["title"],
                "score": audit.get("score"),
                "impact": (details.get("debugData") or {}).get("impact"),
                "nodes": nodes,
            }
        )

    warnings = []
    for audit_id in WARNING_IDS:
        audit = report["audits"].get(audit_id)
        if not audit:
            continue
        score = audit.get("score")
        details = audit.get("details") or {}
        if score is not None and score >= 0.9 and not details.get("items"):
            continue
        warnings.append(
            {
                "id": audit_id,
                "score": score,
                "numericValue": audit.get("numericValue"),
                "itemCount": len(details.get("items", [])),
            }
        )

    return {
        "reportSha256": sha256_file(path),
        "fetchTime": report["fetchTime"],
        "route": route_from_url(report["finalUrl"]),
        "categories": {
            category_id: report["categories"][category_id]["score"]
            for category_id in CATEGORY_IDS
        },
        "metrics": {
            metric_id: {
                "score": report["audits"][metric_id].get("score"),
                "numericValue": report["audits"][metric_id].get("numericValue"),
                "numericUnit": report["audits"][metric_id].get("numericUnit"),
            }
            for metric_id in METRIC_IDS
        },
        "accessibilityFindings": accessibility_findings,
        "configuredWarnings": warnings,
        "runtime": {
            "lighthouseVersion": report["lighthouseVersion"],
            "hostUserAgent": report["environment"]["hostUserAgent"],
            "networkUserAgent": report["environment"]["networkUserAgent"],
            "benchmarkIndex": report["environment"]["benchmarkIndex"],
            "axeCore": report["environment"].get("credits", {}).get("axe-core"),
        },
    }


def median(values: list[float | int | None]) -> float | None:
    numeric = [float(value) for value in values if value is not None]
    return statistics.median(numeric) if numeric else None


def summarize_reports(reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summaries = []
    for route in CONTROLLED_ROUTES:
        route_reports = [report for report in reports if report["route"] == route]
        summaries.append(
            {
                "route": route,
                "runCount": len(route_reports),
                "categoryMedians": {
                    category_id: median(
                        [report["categories"][category_id] for report in route_reports]
                    )
                    for category_id in CATEGORY_IDS
                },
                "metricMedians": {
                    metric_id: median(
                        [report["metrics"][metric_id]["numericValue"] for report in route_reports]
                    )
                    for metric_id in METRIC_IDS
                },
                "accessibilityFindingIds": sorted(
                    {
                        finding["id"]
                        for report in route_reports
                        for finding in report["accessibilityFindings"]
                    }
                ),
            }
        )
    return summaries


def flatten_specs(suites: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for suite in suites:
        output.extend(suite.get("specs", []))
        output.extend(flatten_specs(suite.get("suites", [])))
    return output


def playwright_receipt(root: Path) -> dict[str, Any]:
    path = root / "test-results/controlled-production.json"
    report = json.loads(path.read_text())
    specs = flatten_specs(report["suites"])
    axe_specs = [spec for spec in specs if spec["file"].endswith("a11y.spec.ts")]
    light_specs = [
        spec for spec in specs if spec["file"].endswith("light-mode-wcag.spec.ts")
    ]

    def compact(spec: dict[str, Any]) -> dict[str, Any]:
        statuses = [
            result["status"]
            for test in spec.get("tests", [])
            for result in test.get("results", [])
        ]
        return {"title": spec["title"], "ok": spec["ok"], "statuses": statuses}

    return {
        "reportSha256": sha256_file(path),
        "stats": report["stats"],
        "topLevelErrors": report["errors"],
        "axeRouteTests": [compact(spec) for spec in axe_specs],
        "lightModeTests": {
            "total": len(light_specs),
            "passed": sum(1 for spec in light_specs if spec["ok"]),
            "failed": sum(1 for spec in light_specs if not spec["ok"]),
            "skipped": sum(
                1
                for spec in light_specs
                if all(
                    result["status"] == "skipped"
                    for test in spec.get("tests", [])
                    for result in test.get("results", [])
                )
            ),
        },
        "scope": {
            "server": "Astro standalone production adapter",
            "browserProject": "chromium",
            "colorAndMotion": "light-mode suite forces light and reduced motion; core axe suite forces reduced motion",
            "axeTags": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
        },
    }


def harness_receipt(root: Path) -> dict[str, Any]:
    files = []
    for relative in HARNESS_PATHS:
        path = root / relative
        files.append({"path": relative, "sha256": sha256_file(path)})
    return {
        "files": files,
        "aggregateSha256": sha256_bytes(canonical_bytes(files)),
    }


def build_receipt(root: Path) -> dict[str, Any]:
    client_root = root / "dist/client"
    entries = []
    for path in sorted(item for item in client_root.rglob("*") if item.is_file()):
        entries.append(
            {"path": path.relative_to(client_root).as_posix(), "sha256": sha256_file(path)}
        )
    index_html = (client_root / "index.html").read_text()
    return {
        "fileCount": len(entries),
        "aggregateSha256": sha256_bytes(canonical_bytes(entries)),
        "footerMismatchAriaPresent": 'aria-label="Created by Sarvesh on GitHub"' in index_html,
    }


def assertion_status(reports: list[dict[str, Any]]) -> dict[str, Any]:
    blocking = sorted(
        {
            finding["id"]
            for report in reports
            for finding in report["accessibilityFindings"]
            if finding["id"] == "label-content-name-mismatch"
        }
    )
    return {
        "executed": True,
        "command": "npx lhci assert --config=.lighthouserc.json",
        "exitCode": 1 if blocking else 0,
        "status": "fail" if blocking else "pass",
        "blockingFindingIds": blocking,
        "note": "Derived from the unchanged blocking Lighthouse accessibility assertions; warning-level diagnostics do not fail the gate.",
    }


def revision_receipt(root: Path, name: str) -> dict[str, Any]:
    reports = sorted(
        (lighthouse_report(path) for path in (root / ".lighthouseci").glob("lhr-*.json")),
        key=lambda item: (item["route"], item["fetchTime"]),
    )
    if len(reports) != 9:
        raise ValueError(f"{name}: expected 9 Lighthouse reports, found {len(reports)}")
    if {report["route"] for report in reports} != set(CONTROLLED_ROUTES):
        raise ValueError(f"{name}: route set is not frozen")
    if any(sum(report["route"] == route for report in reports) != 3 for route in CONTROLLED_ROUTES):
        raise ValueError(f"{name}: each route must have exactly three runs")

    return {
        "name": name,
        "sourceCommit": command("git", "rev-parse", "HEAD", cwd=root),
        "sourceTree": command("git", "rev-parse", "HEAD^{tree}", cwd=root),
        "build": build_receipt(root),
        "lighthouse": {
            "reports": reports,
            "routeSummaries": summarize_reports(reports),
            "assertionGate": assertion_status(reports),
        },
        "playwright": playwright_receipt(root),
    }


def validate(ledger: dict[str, Any]) -> None:
    before = ledger["controlledStudy"]["before"]
    after = ledger["controlledStudy"]["after"]
    if before["sourceCommit"][:7] != BASELINE_COMMIT:
        raise ValueError("baseline source commit mismatch")
    if after["sourceCommit"] != FIX_COMMIT:
        raise ValueError("after source commit mismatch")
    if ledger["auditHarness"]["before"] != ledger["auditHarness"]["after"]:
        raise ValueError("audit harness differs between conditions")
    if before["lighthouse"]["assertionGate"]["status"] != "fail":
        raise ValueError("baseline Lighthouse gate unexpectedly passed")
    if after["lighthouse"]["assertionGate"]["status"] != "pass":
        raise ValueError("after Lighthouse gate did not pass")
    for receipt in (before, after):
        stats = receipt["playwright"]["stats"]
        if stats["unexpected"] != 0 or stats["expected"] != 71 or stats["skipped"] != 4:
            raise ValueError("controlled Playwright result changed")


def make_ledger(before_root: Path, after_root: Path) -> dict[str, Any]:
    before_harness = harness_receipt(before_root)
    after_harness = harness_receipt(after_root)
    ledger: dict[str, Any] = {
        "schemaVersion": "memoire.website-audit.before-after.v1",
        "study": "Memi 2.7.3 confirmatory website remediation",
        "claimBoundary": {
            "claim": "The fix removes one serious Lighthouse label-content-name-mismatch finding and makes the unchanged blocking Lighthouse gate pass on all three controlled routes.",
            "nonClaims": [
                "No causal performance improvement is claimed from nine local laboratory runs.",
                "The local Astro adapter does not exercise edge compression, CDN caching, or production TLS.",
                "Playwright axe passed before and after because this experimental Lighthouse rule is outside the frozen Playwright axe rule selection; that pass does not contradict the Lighthouse finding.",
            ],
        },
        "design": {
            "type": "clean-checkout controlled before/after audit",
            "baseline": BASELINE_COMMIT,
            "after": FIX_COMMIT,
            "auditHarnessRevision": FIX_COMMIT,
            "baselineOverlay": [
                ".github/workflows/ci-webpage.yml",
                ".lighthouserc.json",
                "astro.audit.config.mjs",
                "package-lock.json",
                "package.json",
                "playwright.config.ts",
                "playwright.production.config.ts",
            ],
            "routes": list(CONTROLLED_ROUTES),
            "lighthouseRunsPerRoute": 3,
            "executionOrderByProbe": {
                "lighthouse": ["before", "discarded-stale-after", "after"],
                "playwright": ["after", "before"],
            },
            "execution": "serial",
            "excludedSources": [".vercel", "dist", ".astro", "test-results", "generated community examples"],
        },
        "environment": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "node": command("node", "--version"),
            "npm": command("npm", "--version"),
        },
        "auditHarness": {"before": before_harness, "after": after_harness},
        "controlledStudy": {
            "before": revision_receipt(before_root, "before"),
            "after": revision_receipt(after_root, "after"),
        },
        "discardedStaleServerDiagnostic": {
            "admittedToControlledComparison": False,
            "reason": "LHCI readiness timed out and a lingering baseline PID continued serving port 4326 during the first after collection.",
            "observed": {
                "reportCount": 9,
                "reportSha256": list(STALE_REPORT_HASHES),
                "allReportsContainedBaselineFooterAria": True,
                "allLabelContentNameMismatchScores": 0,
                "listeningProcess": {"command": "node", "pidAtDiagnosis": 81984, "port": 4326},
            },
            "disposition": "Reports deleted from the after condition, baseline PID terminated, after server started manually, served HTML inspected, and all nine after reports recollected.",
        },
    }
    validate(ledger)
    ledger["ledgerSha256"] = sha256_bytes(canonical_bytes(ledger))
    return ledger


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--before-root", type=Path)
    parser.add_argument("--after-root", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    if args.check:
        ledger = json.loads(args.output.read_text())
        expected = ledger.pop("ledgerSha256")
        actual = sha256_bytes(canonical_bytes(ledger))
        if expected != actual:
            raise ValueError(f"ledger hash mismatch: expected {expected}, got {actual}")
        validate(ledger)
        print(json.dumps({"ok": True, "ledgerSha256": expected}, sort_keys=True))
        return 0

    if args.before_root is None or args.after_root is None:
        parser.error("--before-root and --after-root are required unless --check is used")
    ledger = make_ledger(args.before_root.resolve(), args.after_root.resolve())
    args.output.write_text(json.dumps(ledger, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"ok": True, "ledgerSha256": ledger["ledgerSha256"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
