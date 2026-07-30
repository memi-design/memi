#!/usr/bin/env python3
"""Build the reproducible Memi 2.7 release evidence report."""

from __future__ import annotations

import hashlib
import json
import math
import shutil
from pathlib import Path
from statistics import median

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OUTPUT = ROOT / "output" / "pdf"
PDF_PATH = OUTPUT / "memi-2.7-release-evidence.pdf"
VERSIONED_PDF_PATH = HERE / "memi-2.7-release-evidence.pdf"
ANALYSIS_PATH = HERE / "analysis.json"

SIX_PATH = ROOT / "docs/case-studies/memi-2.7-six-repo/results.json"
WORKFLOW_PATH = ROOT / "docs/case-studies/memi-2.7-workflow-proof/results.json"
TOOLS_PATH = ROOT / "docs/case-studies/memi-2.7-workflow-proof/tool-call-analysis.json"
READINESS_PATH = ROOT / "docs/audits/memi-designworkbench-v2-readiness.json"

SIX_EXAMPLE_LABELS = [
    "Example 1",
    "Example 2",
    "Example 3",
    "Example 4",
    "Example 5",
    "Example 6",
]
WORKFLOW_EXAMPLE_LABELS = [
    "Example 3",
    "Example 2",
    "Example 1",
    "Example 5",
    "Example 7",
]

PAGE_W, PAGE_H = letter
MARGIN = 48
RUBY = HexColor("#e5385d")
INK = HexColor("#16171a")
MUTED = HexColor("#636873")
LIGHT = HexColor("#f2f3f5")
MID = HexColor("#d9dce1")
GREEN = HexColor("#15845d")
AMBER = HexColor("#b87503")
RED = HexColor("#bd304b")
BLUE = HexColor("#3469c7")
WHITE = HexColor("#ffffff")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pct(value: float, digits: int = 1) -> str:
    return f"{value * 100:.{digits}f}%"


def wilson(successes: int, total: int, z: float = 1.96) -> list[float]:
    if total == 0:
        return [0.0, 0.0]
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    radius = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator
    return [center - radius, center + radius]


def weighted_savings(rows: list[dict], baseline_key: str, memi_key: str) -> float:
    baseline = sum(float(row["baseline"][baseline_key]) for row in rows)
    memi = sum(float(row["memi"][memi_key]) for row in rows)
    return (baseline - memi) / baseline


def workflow_total(row: dict, condition: str) -> int:
    source = row[condition]
    return source["inputTokens"] + source["outputTokens"] + source["reasoningTokens"]


def build_analysis() -> dict:
    six = load_json(SIX_PATH)
    workflow = load_json(WORKFLOW_PATH)
    tools = load_json(TOOLS_PATH)
    readiness = load_json(READINESS_PATH)

    six_token = [row["savings"]["tokens"] for row in six["cases"]]
    six_latency = [row["savings"]["latency"] for row in six["cases"]]
    workflow_token = [row["savingsPercent"]["totalTokens"] / 100 for row in workflow["pairs"]]
    workflow_latency = [row["savingsPercent"]["wallTime"] / 100 for row in workflow["pairs"]]

    workflow_baseline_tokens = sum(workflow_total(row, "baseline") for row in workflow["pairs"])
    workflow_memi_tokens = sum(workflow_total(row, "memi") for row in workflow["pairs"])

    six_token_wins = sum(value > 0 for value in six_token)
    six_latency_wins = sum(value > 0 for value in six_latency)
    workflow_token_wins = sum(value > 0 for value in workflow_token)
    workflow_latency_wins = sum(value > 0 for value in workflow_latency)

    return {
        "schemaVersion": 1,
        "reportDate": "2026-07-29",
        "decision": {
            "packageRelease": "conditionally_ready_after_green_release_checks",
            "universal25PercentClaim": "blocked",
            "practitionerCertification": "blocked",
            "comparativeHarnessPerformance": "unmeasured",
        },
        "sixRepo": {
            "pairs": len(six["cases"]),
            "meanTokenSavings": six["aggregate"]["tokenSavings"]["mean"],
            "tokenSavings95": [
                six["aggregate"]["tokenSavings"]["lower95"],
                six["aggregate"]["tokenSavings"]["upper95"],
            ],
            "medianTokenSavings": median(six_token),
            "weightedTokenSavings": weighted_savings(six["cases"], "tokens", "tokens"),
            "tokenWins": six_token_wins,
            "tokenWin95": wilson(six_token_wins, len(six_token)),
            "meanLatencySavings": six["aggregate"]["latencySavings"]["mean"],
            "medianLatencySavings": median(six_latency),
            "latencyWins": six_latency_wins,
            "latencyWin95": wilson(six_latency_wins, len(six_latency)),
        },
        "workflow": {
            "pairs": len(workflow["pairs"]),
            "meanTokenSavings": workflow["aggregate"]["totalTokenSavings"]["mean"],
            "tokenSavings95": [
                workflow["aggregate"]["totalTokenSavings"]["lower95"],
                workflow["aggregate"]["totalTokenSavings"]["upper95"],
            ],
            "medianTokenSavings": median(workflow_token),
            "weightedTokenSavings": (workflow_baseline_tokens - workflow_memi_tokens)
            / workflow_baseline_tokens,
            "tokenWins": workflow_token_wins,
            "tokenWin95": wilson(workflow_token_wins, len(workflow_token)),
            "meanLatencySavings": workflow["aggregate"]["latencySavings"]["mean"],
            "latencySavings95": [
                workflow["aggregate"]["latencySavings"]["lower95"],
                workflow["aggregate"]["latencySavings"]["upper95"],
            ],
            "medianLatencySavings": median(workflow_latency),
            "latencyWins": workflow_latency_wins,
            "latencyWin95": wilson(workflow_latency_wins, len(workflow_latency)),
        },
        "buzzrCalibration": tools["outcomes"],
        "designWorkBench": {
            "tracks": readiness["readiness"]["completed"]["tracks"],
            "taskContracts": readiness["readiness"]["completed"]["taskContracts"],
            "preparedFixtures": readiness["readiness"]["prepared"]["fixtures"],
            "verifiedFixtures": readiness["readiness"]["verified"]["fixtures"],
            "verifiedRunners": readiness["readiness"]["verified"]["runners"],
            "requiredRunners": readiness["readiness"]["completed"]["runnerContracts"],
            "practitioners": readiness["readiness"]["verified"]["practitioners"],
            "releaseReady": readiness["readiness"]["releaseReady"],
        },
        "sourceSha256": {
            str(path.relative_to(ROOT)): sha256(path)
            for path in [SIX_PATH, WORKFLOW_PATH, TOOLS_PATH, READINESS_PATH]
        },
    }


class Report:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.c = canvas.Canvas(str(path), pagesize=letter, pageCompression=1)
        self.c.setTitle("Memi 2.7 Release Evidence")
        self.c.setAuthor("Memi Design")
        self.c.setSubject(
            "Paired workflow evidence, release gates, benchmark limitations, and harness comparison"
        )
        self.page = 0

    def new_page(self, title: str | None = None, kicker: str | None = None) -> None:
        if self.page:
            self.c.showPage()
        self.page += 1
        self.c.setFillColor(WHITE)
        self.c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        if title:
            if kicker:
                self.text(kicker.upper(), MARGIN, PAGE_H - 45, 8, RUBY, "Helvetica-Bold")
            self.text(title, MARGIN, PAGE_H - 70, 22, INK, "Helvetica-Bold")
            self.line(MARGIN, PAGE_H - 82, PAGE_W - MARGIN, PAGE_H - 82, MID)
        self.text(f"MEMI 2.7 RELEASE EVIDENCE  |  {self.page}", PAGE_W - MARGIN, 25, 7, MUTED, "Helvetica", align="right")

    def text(
        self,
        value: str,
        x: float,
        y: float,
        size: float = 10,
        color=INK,
        font: str = "Helvetica",
        align: str = "left",
    ) -> None:
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        if align == "right":
            self.c.drawRightString(x, y, value)
        elif align == "center":
            self.c.drawCentredString(x, y, value)
        else:
            self.c.drawString(x, y, value)

    def line(self, x1: float, y1: float, x2: float, y2: float, color=MID, width: float = 1) -> None:
        self.c.setStrokeColor(color)
        self.c.setLineWidth(width)
        self.c.line(x1, y1, x2, y2)

    def wrap(
        self,
        value: str,
        x: float,
        y: float,
        width: float,
        size: float = 9.5,
        leading: float = 13,
        color=INK,
        font: str = "Helvetica",
        max_lines: int | None = None,
    ) -> float:
        words = value.split()
        lines: list[str] = []
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if stringWidth(candidate, font, size) <= width:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
        if max_lines:
            lines = lines[:max_lines]
        for index, line in enumerate(lines):
            self.text(line, x, y - index * leading, size, color, font)
        return y - len(lines) * leading

    def pill(self, label: str, x: float, y: float, color) -> float:
        width = stringWidth(label, "Helvetica-Bold", 8) + 16
        self.c.setFillColor(color)
        self.c.roundRect(x, y - 11, width, 18, 9, fill=1, stroke=0)
        self.text(label, x + 8, y - 5, 8, WHITE, "Helvetica-Bold")
        return width

    def metric(self, x: float, y: float, width: float, value: str, label: str, color=INK) -> None:
        self.c.setFillColor(LIGHT)
        self.c.roundRect(x, y - 58, width, 58, 8, fill=1, stroke=0)
        self.text(value, x + 12, y - 25, 18, color, "Helvetica-Bold")
        self.text(label, x + 12, y - 43, 8, MUTED, "Helvetica")

    def bullet(self, value: str, x: float, y: float, width: float, color=INK) -> float:
        self.c.setFillColor(RUBY)
        self.c.circle(x + 3, y - 3, 2.2, fill=1, stroke=0)
        return self.wrap(value, x + 13, y, width - 13, 9.5, 13, color)

    def bar_chart(
        self,
        rows: list[dict],
        x: float,
        y: float,
        width: float,
        height: float,
        series: list[tuple[str, str, object]],
        domain: tuple[float, float],
    ) -> None:
        label_w = 100
        plot_x = x + label_w
        plot_w = width - label_w - 26
        minimum, maximum = domain
        zero_x = plot_x + (0 - minimum) / (maximum - minimum) * plot_w
        self.line(zero_x, y - height, zero_x, y, MUTED, 0.8)
        for tick in [minimum, 0, maximum]:
            tick_x = plot_x + (tick - minimum) / (maximum - minimum) * plot_w
            self.text(f"{tick:+.0f}%", tick_x, y - height - 15, 7, MUTED, "Helvetica", "center")
        row_h = height / max(1, len(rows))
        bar_h = min(8, (row_h - 5) / len(series))
        for row_index, row in enumerate(rows):
            row_y = y - row_index * row_h - 11
            self.text(row["label"], x, row_y - 1, 8, INK, "Helvetica")
            for series_index, (key, _, color) in enumerate(series):
                value = float(row[key])
                value_x = plot_x + (value - minimum) / (maximum - minimum) * plot_w
                left = min(zero_x, value_x)
                bar_width = max(1, abs(value_x - zero_x))
                bar_y = row_y - series_index * (bar_h + 3)
                self.c.setFillColor(color)
                self.c.rect(left, bar_y - bar_h + 2, bar_width, bar_h, fill=1, stroke=0)
                text_x = value_x + (4 if value >= 0 else -4)
                self.text(f"{value:+.1f}", text_x, bar_y - bar_h + 2, 6.5, color, "Helvetica-Bold", "left" if value >= 0 else "right")
        legend_x = x
        for _, label, color in series:
            self.c.setFillColor(color)
            self.c.rect(legend_x, y + 10, 8, 8, fill=1, stroke=0)
            self.text(label, legend_x + 12, y + 10, 7.5, MUTED)
            legend_x += stringWidth(label, "Helvetica", 7.5) + 34

    def close(self) -> None:
        self.c.save()


def build_report(analysis: dict) -> None:
    six = load_json(SIX_PATH)
    workflow = load_json(WORKFLOW_PATH)
    tools = load_json(TOOLS_PATH)
    readiness = analysis["designWorkBench"]
    report = Report(PDF_PATH)

    report.new_page()
    report.text("Memi 2.7", MARGIN, PAGE_H - 80, 10, RUBY, "Helvetica-Bold")
    report.text("Release evidence", MARGIN, PAGE_H - 122, 34, INK, "Helvetica-Bold")
    report.wrap(
        "What improved, what failed, what the traces support, and what remains unproven.",
        MARGIN, PAGE_H - 150, 430, 14, 20, MUTED,
    )
    report.pill("TECHNICAL REPORT", MARGIN, PAGE_H - 210, INK)
    report.pill("29 JUL 2026", MARGIN + 124, PAGE_H - 210, RUBY)
    report.metric(MARGIN, PAGE_H - 270, 150, "19.9%", "six-repo mean token savings", GREEN)
    report.metric(MARGIN + 164, PAGE_H - 270, 150, "0.6%", "long-workflow mean token savings", AMBER)
    report.metric(MARGIN + 328, PAGE_H - 270, 150, "4 / 5", "long workflows with fewer tokens", GREEN)
    y = PAGE_H - 365
    report.text("Release conclusion", MARGIN, y, 13, INK, "Helvetica-Bold")
    y = report.wrap(
        "Ship 2.7 as a product release only after the package, security, test, build, and clean-install checks are green. Do not ship a universal 25% efficiency claim or a senior-practitioner quality claim.",
        MARGIN, y - 24, 500, 11, 16, INK,
    )
    y -= 20
    y = report.bullet("Observed evidence is promising but heterogeneous: four of six pilot tasks and four of five long workflows used fewer tokens with Memi.", MARGIN, y, 500)
    y = report.bullet("The long-workflow mean is 0.6%, with a 95% bootstrap interval from -51.2% to 37.3%. It does not establish a universal benefit.", MARGIN, y - 8, 500)
    y = report.bullet("One Router v2 Example 2 calibration improved tokens by 14.2% and wall time by 25.1%, but one pair is calibration evidence, not a release claim.", MARGIN, y - 8, 500)
    report.text("Prepared from immutable paired traces and public source documentation.", MARGIN, 72, 8, MUTED)

    report.new_page("The claim firewall", "Release decision")
    report.metric(MARGIN, PAGE_H - 120, 155, "READY*", "package release", GREEN)
    report.metric(MARGIN + 169, PAGE_H - 120, 155, "BLOCKED", ">25% universal claim", RED)
    report.metric(MARGIN + 338, PAGE_H - 120, 155, "BLOCKED", "practitioner certification", RED)
    y = PAGE_H - 205
    report.text("* Conditional on all release checks passing at the publish commit.", MARGIN, y, 8, MUTED)
    y -= 36
    report.text("Why the old gate was wrong", MARGIN, y, 13, INK, "Helvetica-Bold")
    y = report.wrap(
        "The package gate required DesignWorkBench practitioner proof. That made a 300-task, externally calibrated research program a prerequisite for distributing the CLI. The corrected architecture keeps benchmark integrity and readiness artifacts in the package gate, but moves blinded practitioner readiness to a distinct certification gate.",
        MARGIN, y - 22, 500, 10, 14,
    )
    y -= 22
    stages = [
        ("Package", "tests, build, audit, manifests, install", GREEN),
        ("Efficiency", "paired traces, intervals, negative cases", AMBER),
        ("Certification", "blinded senior-practitioner calibration", RED),
    ]
    for index, (title, body, color) in enumerate(stages):
        bx = MARGIN + index * 170
        report.c.setFillColor(LIGHT)
        report.c.roundRect(bx, y - 112, 154, 105, 8, fill=1, stroke=0)
        report.c.setFillColor(color)
        report.c.rect(bx, y - 14, 154, 7, fill=1, stroke=0)
        report.text(title, bx + 12, y - 37, 11, INK, "Helvetica-Bold")
        report.wrap(body, bx + 12, y - 58, 130, 8.5, 12, MUTED)
    report.text("DesignWorkBench status", MARGIN, 190, 13, INK, "Helvetica-Bold")
    report.metric(MARGIN, 165, 105, str(readiness["taskContracts"]), "task contracts", BLUE)
    report.metric(MARGIN + 118, 165, 105, str(readiness["preparedFixtures"]), "prepared fixtures", BLUE)
    report.metric(MARGIN + 236, 165, 105, str(readiness["verifiedFixtures"]), "verified fixtures", RED)
    report.metric(MARGIN + 354, 165, 105, str(readiness["practitioners"]), "practitioners", RED)

    report.new_page("Six-repository observed pilot", "With vs without Memi")
    rows = [
        {
            "label": label,
            "tokens": row["savings"]["tokens"] * 100,
            "latency": row["savings"]["latency"] * 100,
        }
        for label, row in zip(SIX_EXAMPLE_LABELS, six["cases"], strict=True)
    ]
    report.bar_chart(rows, MARGIN, PAGE_H - 135, 510, 285, [
        ("tokens", "Total tokens", RUBY),
        ("latency", "Wall time", BLUE),
    ], (-30, 70))
    y = 300
    a = analysis["sixRepo"]
    report.metric(MARGIN, y, 150, pct(a["meanTokenSavings"]), "mean token savings", GREEN)
    report.metric(MARGIN + 164, y, 150, pct(a["medianTokenSavings"]), "median token savings", GREEN)
    report.metric(MARGIN + 328, y, 150, f'{a["tokenWins"]} / {a["pairs"]}', "token win count", GREEN)
    report.wrap(
        f'The mean token interval is {pct(a["tokenSavings95"][0])} to {pct(a["tokenSavings95"][1])}. The interval crosses zero. Weighted token savings are {pct(a["weightedTokenSavings"])}; this aggregate is dominated by larger traces and must not replace the paired task analysis.',
        MARGIN, 210, 500, 9.5, 14,
    )
    report.wrap(
        "Direction: positive bars mean Memi used less. Negative cases are retained. The pilot is useful for finding routing failures, not for declaring a population-wide effect.",
        MARGIN, 145, 500, 9.5, 14, MUTED,
    )

    report.new_page("Canonical multi-minute workflows", "With vs without Memi")
    rows = [
        {
            "label": label,
            "tokens": row["savingsPercent"]["totalTokens"],
            "latency": row["savingsPercent"]["wallTime"],
        }
        for label, row in zip(WORKFLOW_EXAMPLE_LABELS, workflow["pairs"], strict=True)
    ]
    report.bar_chart(rows, MARGIN, PAGE_H - 135, 510, 260, [
        ("tokens", "Total tokens", RUBY),
        ("latency", "Wall time", BLUE),
    ], (-110, 70))
    a = analysis["workflow"]
    report.metric(MARGIN, 320, 150, pct(a["meanTokenSavings"]), "mean token savings", AMBER)
    report.metric(MARGIN + 164, 320, 150, pct(a["medianTokenSavings"]), "median token savings", GREEN)
    report.metric(MARGIN + 328, 320, 150, f'{a["tokenWins"]} / {a["pairs"]}', "token win count", GREEN)
    report.wrap(
        f'Token mean 95% interval: {pct(a["tokenSavings95"][0])} to {pct(a["tokenSavings95"][1])}. Latency mean: {pct(a["meanLatencySavings"])} with interval {pct(a["latencySavings95"][0])} to {pct(a["latencySavings95"][1])}. The median is positive because one large Example 2 regression pulls the arithmetic mean down.',
        MARGIN, 230, 500, 9.5, 14,
    )
    report.wrap(
        "This is exactly why Memi needs risk-aware routing and abstention: routing a relevant skill is not automatically beneficial. The router must be allowed to inject less, stack only complementary evidence, or abstain when prior content-addressed fitness is weak.",
        MARGIN, 155, 500, 9.5, 14, INK,
    )

    report.new_page("Error anatomy and Router v2", "What changed")
    outcome = analysis["buzzrCalibration"]
    report.metric(MARGIN, PAGE_H - 120, 150, pct(outcome["totalTokenSavings"]), "Example 2 token savings", GREEN)
    report.metric(MARGIN + 164, PAGE_H - 120, 150, pct(outcome["wallTimeSavings"]), "Example 2 wall savings", GREEN)
    report.metric(MARGIN + 328, PAGE_H - 120, 150, f'{outcome["baselineRetries"]} → {outcome["memiRetries"]}', "retries", GREEN)
    categories = ["search", "read", "verification", "status"]
    x0, y0 = MARGIN, PAGE_H - 260
    max_value = max(
        max(tools["profiles"][condition]["categories"][category] for category in categories)
        for condition in ["baseline", "memi"]
    )
    for index, category in enumerate(categories):
        y = y0 - index * 48
        report.text(category.title(), x0, y + 4, 9, INK)
        for series_index, (condition, color) in enumerate([("baseline", MID), ("memi", RUBY)]):
            value = tools["profiles"][condition]["categories"][category]
            bar_y = y - series_index * 13
            report.c.setFillColor(color)
            report.c.rect(x0 + 90, bar_y, value / max_value * 300, 9, fill=1, stroke=0)
            report.text(str(value), x0 + 400, bar_y + 1, 8, color, "Helvetica-Bold")
    report.text("Baseline", 410, y0 + 30, 8, MUTED)
    report.text("Memi", 475, y0 + 30, 8, RUBY, "Helvetica-Bold")
    y = 285
    report.text("Observed failure mechanism", MARGIN, y, 13, INK, "Helvetica-Bold")
    y = report.bullet("The first routed run broadened discovery and verification beyond the task contract.", MARGIN, y - 24, 500)
    y = report.bullet("Router v2 reduced injected context to 1,429 bytes and made the task manifest plus closest repository evidence authoritative.", MARGIN, y - 8, 500)
    y = report.bullet("The calibrated run made more narrow discovery calls but fewer verification calls, fewer retries, fewer tokens, and finished faster.", MARGIN, y - 8, 500)
    report.wrap(
        "This calibration is one pair. It validates the mechanism and justifies further repeated trials; it does not prove a general effect.",
        MARGIN, 120, 500, 9.5, 14, RED, "Helvetica-Bold",
    )

    report.new_page("Quality without fake perfection", "Measurement correction")
    report.text("Historical field", MARGIN, PAGE_H - 125, 11, MUTED, "Helvetica-Bold")
    report.text("accepted = qualityScore 100", MARGIN, PAGE_H - 152, 20, RED, "Helvetica-Bold")
    report.wrap(
        "The canonical workflow runner awarded 100 whenever automated build and rendered-flow verification passed. That is a valid acceptance result, but it is not a professional design-quality judgment.",
        MARGIN, PAGE_H - 184, 500, 10, 15,
    )
    report.text("2.7 correction", MARGIN, PAGE_H - 270, 11, MUTED, "Helvetica-Bold")
    report.text("automated evidence ceiling = 80", MARGIN, PAGE_H - 297, 20, GREEN, "Helvetica-Bold")
    report.wrap(
        "New workflow records label the evidence source as automated_acceptance and cap the score at 80. Scores above that ceiling require blinded practitioner rubrics with reliability evidence. Historical immutable records remain unchanged and are relabeled in interpretation.",
        MARGIN, PAGE_H - 329, 500, 10, 15,
    )
    report.text("Quality evidence ladder", MARGIN, 365, 13, INK, "Helvetica-Bold")
    ladder = [
        ("0–39", "invalid or broken artifact", RED),
        ("40–59", "partial automated contract", AMBER),
        ("60–80", "automated acceptance evidence", BLUE),
        ("81–100", "calibrated practitioner evidence only", GREEN),
    ]
    for index, (score, label, color) in enumerate(ladder):
        y = 325 - index * 52
        report.c.setFillColor(LIGHT)
        report.c.roundRect(MARGIN, y - 27, 480, 38, 6, fill=1, stroke=0)
        report.text(score, MARGIN + 12, y - 12, 12, color, "Helvetica-Bold")
        report.text(label, MARGIN + 90, y - 11, 9.5, INK)

    report.new_page("Harness landscape", "Capabilities, not a fake race")
    headers = ["Capability", "Memi 2.7", "Superpowers", "ECC", "Skills CLI"]
    rows = [
        ["Repository fingerprint routing", "Built in", "Not documented", "Partial profiles", "Distribution only"],
        ["Progressive disclosure", "Budgeted", "Composable skills", "Context controls", "Installs skills"],
        ["Content-addressed fitness", "Built in", "Not documented", "Instinct learning", "Not documented"],
        ["Paired cost/latency traces", "Built in", "Eval harness", "Evals documented", "Not documented"],
        ["Design-specific benchmark", "15 tracks", "Not documented", "Not documented", "Not documented"],
        ["Cross-agent distribution", "Skills + MCP", "Many harnesses", "Many harnesses", "Core strength"],
    ]
    col_widths = [155, 84, 90, 84, 85]
    start_x, start_y = MARGIN, PAGE_H - 125
    x = start_x
    for index, header in enumerate(headers):
        report.c.setFillColor(INK)
        report.c.rect(x, start_y, col_widths[index], 30, fill=1, stroke=0)
        report.text(header, x + 6, start_y + 10, 7.5, WHITE, "Helvetica-Bold")
        x += col_widths[index]
    for row_index, row in enumerate(rows):
        y = start_y - (row_index + 1) * 43
        x = start_x
        for col_index, value in enumerate(row):
            report.c.setFillColor(LIGHT if row_index % 2 == 0 else WHITE)
            report.c.rect(x, y, col_widths[col_index], 43, fill=1, stroke=0)
            report.wrap(value, x + 6, y + 27, col_widths[col_index] - 12, 7.2, 9, INK, "Helvetica-Bold" if col_index == 0 else "Helvetica", 3)
            x += col_widths[col_index]
    report.wrap(
        "Interpretation is limited to public documentation inspected on 29 July 2026. “Not documented” does not mean a capability cannot exist. No cross-harness speed, cost, or quality ranking is reported because equivalent paired executions have not been run.",
        MARGIN, 300, 500, 9, 13, MUTED,
    )
    report.text("What is genuinely differentiated", MARGIN, 225, 13, INK, "Helvetica-Bold")
    y = report.bullet("A claim firewall that separates software release, efficiency evidence, and practitioner certification.", MARGIN, 198, 500)
    y = report.bullet("Content-addressed fitness receipts that can promote, observe, quarantine, or ultimately abstain by skill revision.", MARGIN, y - 8, 500)
    report.bullet("Design-task traces that preserve negative cases, tool profiles, fixture integrity, and provider failure evidence.", MARGIN, y - 8, 500)

    report.new_page("Tonight’s release gate", "Execution order")
    steps = [
        ("1", "Freeze the publish commit", "No metric or artifact may refer to a different tree."),
        ("2", "Run package release checks", "Manifest, runtime schema, benchmarks, readiness artifact, audit scorecard."),
        ("3", "Run engineering checks", "Strict types, full tests, build, production dependency audit."),
        ("4", "Verify distribution", "npm pack, clean-home install, CLI smoke, MCP stdio smoke."),
        ("5", "Publish package", "Publish 2.7.0 only if steps 1–4 are green and npm auth succeeds."),
        ("6", "Verify public parity", "Registry version, tarball hash, install, GitHub tag/release, docs."),
        ("7", "Keep certification blocked", "Do not promote the >25% or senior-quality claim."),
    ]
    y = PAGE_H - 125
    for number, title, body in steps:
        report.c.setFillColor(RUBY)
        report.c.circle(MARGIN + 12, y - 4, 12, fill=1, stroke=0)
        report.text(number, MARGIN + 12, y - 8, 9, WHITE, "Helvetica-Bold", "center")
        report.text(title, MARGIN + 38, y, 10, INK, "Helvetica-Bold")
        report.wrap(body, MARGIN + 38, y - 17, 450, 8.5, 12, MUTED)
        y -= 72
    report.wrap(
        "Public wording: Memi gives coding agents repository-specific design intelligence. Every efficiency claim is accompanied by a reproducible trace showing where tokens, time, retries, and errors changed.",
        MARGIN, 100, 500, 10, 14, INK, "Helvetica-Bold",
    )

    report.new_page("2.7.0 release execution record", "Observed 30 July 2026")
    release_rows = [
        ("npm + provenance", "PASS", "2.7.0 is latest; signature, SLSA attestation, SBOM, and release record verified."),
        ("GitHub release", "PASS", "Immutable v2.7.0 tag and release bind source commit 00be64b9."),
        ("Native binaries", "PASS", "macOS arm64/x64, Linux x64, and Windows x64 built and smoke-tested."),
        ("Checksums + container", "PASS", "SHA256SUMS verified; immutable and latest GHCR images published."),
        ("Action v2 channel", "PASS", "Floating v2 alias moved to the reviewed v2.7.0 source commit."),
        ("MCP Registry", "BLOCKED", "Registry OIDC permits io.github.memi-design/*, but 2.7.0 declares io.github.sarveshsea/memi."),
        ("Studio + website parity", "PARTIAL", "Pinned Studio 2.5.0 assets verified; website artifact is 404 and docs/changelog remain stale."),
    ]
    y = PAGE_H - 120
    for surface, status, evidence in release_rows:
        color = GREEN if status == "PASS" else RED if status == "BLOCKED" else AMBER
        report.text(surface, MARGIN, y, 9.5, INK, "Helvetica-Bold")
        report.text(status, MARGIN + 155, y, 8.5, color, "Helvetica-Bold")
        report.wrap(evidence, MARGIN + 225, y + 3, 310, 7.8, 10.5, MUTED, max_lines=3)
        report.c.setStrokeColor(LIGHT)
        report.c.line(MARGIN, y - 18, PAGE_W - MARGIN, y - 18)
        y -= 58
    report.text("Failures converted into release controls", MARGIN, y - 2, 12, INK, "Helvetica-Bold")
    y -= 28
    incident_lines = [
        "Windows path duplication (D:\\D:\\...) → fileURLToPath conversion plus a tag-scoped immutable-release repair test.",
        "Private GHCR inspection before login → authentication reordered ahead of immutable image verification.",
        "Workflow token could not move v2 across workflow-file changes → exact source SHA verified, then alias moved through authenticated Git transport.",
        "MCP namespace 403 remains fail-closed → public parity and MCP claims remain blocked rather than rewritten after npm publication.",
    ]
    for line in incident_lines:
        y = report.bullet(line, MARGIN, y, 500)
        y -= 8
    report.wrap(
        "Release publication and practitioner certification remain separate. The package is published; the >25% universal efficiency claim, cross-harness performance ranking, and senior-practitioner quality claim remain unapproved.",
        MARGIN, 92, 500, 9.5, 13.5, RED, "Helvetica-Bold",
    )

    report.new_page("Methodology, limitations, and sources", "Appendix")
    report.text("Method", MARGIN, PAGE_H - 120, 12, INK, "Helvetica-Bold")
    y = report.wrap(
        "Paired baseline and Memi runs use the same repository revision, task, model, effort, fixtures, and independent verification contract. Positive savings mean Memi used less. Arithmetic means, medians, weighted totals, bootstrap intervals from the committed source reports, and Wilson win-rate intervals are reported separately.",
        MARGIN, PAGE_H - 142, 500, 8.8, 12.5,
    )
    report.text("Limitations", MARGIN, y - 16, 12, INK, "Helvetica-Bold")
    y = report.wrap(
        "Samples are small and heterogeneous. Canonical workflows have one pair each. Subscription traces do not expose defensible billed USD. Historical 100 values are automated acceptance, not practitioner quality. Claude performance is unclaimed because live authentication failed. Competitor performance is unmeasured.",
        MARGIN, y - 38, 500, 8.8, 12.5,
    )
    report.text("Primary sources", MARGIN, y - 16, 12, INK, "Helvetica-Bold")
    source_lines = [
        "docs/case-studies/memi-2.7-six-repo/results.json",
        "docs/case-studies/memi-2.7-workflow-proof/results.json",
        "docs/case-studies/memi-2.7-workflow-proof/tool-call-analysis.json",
        "docs/audits/memi-designworkbench-v2-readiness.json",
        "github.com/obra/superpowers",
        "github.com/affaan-m/ECC",
        "github.com/vercel-labs/skills",
        "agentskills.io/specification",
        "agentskills.io/skill-creation/best-practices",
        "modelcontextprotocol.io/specification/2025-11-25/server/tools",
    ]
    y -= 48
    for source in source_lines:
        report.text(source, MARGIN + 10, y, 7.7, MUTED, "Courier")
        y -= 16
    report.text("Evidence commitments", MARGIN, y - 5, 12, INK, "Helvetica-Bold")
    y -= 28
    for path, digest in analysis["sourceSha256"].items():
        report.text(path, MARGIN, y, 6.8, MUTED, "Courier")
        report.text(digest[:24] + "…", PAGE_W - MARGIN, y, 6.8, MUTED, "Courier", "right")
        y -= 14

    report.close()


def main() -> None:
    analysis = build_analysis()
    ANALYSIS_PATH.write_text(json.dumps(analysis, indent=2) + "\n")
    build_report(analysis)
    shutil.copyfile(PDF_PATH, VERSIONED_PDF_PATH)
    print(json.dumps({
        "analysis": str(ANALYSIS_PATH),
        "pdf": str(PDF_PATH),
        "versionedPdf": str(VERSIONED_PDF_PATH),
        "pdfSha256": sha256(PDF_PATH),
    }, indent=2))


if __name__ == "__main__":
    main()
