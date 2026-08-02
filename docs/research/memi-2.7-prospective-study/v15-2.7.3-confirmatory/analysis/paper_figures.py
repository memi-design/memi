"""Publication figures for the V15 confirmatory paper.

The functions in this module are deliberately pure with respect to their input
objects.  They render evidence-bound diagrams without rewriting the underlying
study records.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch


INK = "#17212B"
MUTED = "#5C6977"
GRID = "#DCE3E8"
BLUE = "#285A84"
BLUE_LIGHT = "#DCEAF4"
ORANGE = "#B85C35"
ORANGE_LIGHT = "#F6E5DC"
OLIVE = "#667A3D"
OLIVE_LIGHT = "#E9EDDD"
NEUTRAL = "#AAB4BD"
PAPER = "#FFFFFF"
TASK_LABELS = {
    "buzzr-tab-unread-badge": "Buzzr / Expo",
    "paraform-command-menu": "Paraform / web",
    "nate-options-reduce-motion": "Nate / SwiftUI",
}
TASK_COLORS = {
    "buzzr-tab-unread-badge": BLUE,
    "paraform-command-menu": ORANGE,
    "nate-options-reduce-motion": OLIVE,
}
PUBLICATION_METADATA = {"Software": "Memi V15 reproducible publication figures"}


def render_claim_decision(
    path: Path,
    primary_rows: list[dict[str, Any]],
    *,
    secondary_test_count: int,
) -> None:
    """Render the claims the study can and cannot support in plain language."""
    task_lines = []
    for row in primary_rows:
        task_lines.append(
            f"{_task_label(str(row['task_id']))}: mean {float(row['mean_delta']):+.1f}; "
            f"decision bound {float(row['noninferiority_lower_95_one_sided']):+.1f}"
        )
    rows = (
        (
            "What was supported",
            "No large design-quality decline on two gradable tasks",
            "\n".join(task_lines) + "\nBoth decision bounds cleared the pre-registered -5-point margin.",
            BLUE_LIGHT,
            BLUE,
        ),
        (
            "What was not supported",
            "Memi is better overall",
            "Only 10 complete quality pairs were available, superiority was not established, and Nate had no admissible visual grade.",
            ORANGE_LIGHT,
            ORANGE,
        ),
        (
            "What was not supported",
            "Memi is faster or cheaper",
            f"No result survived correction across {secondary_test_count} secondary tests, and no billing observations were collected.",
            "#F2F4F6",
            MUTED,
        ),
    )

    with _paper_style():
        fig, axis = plt.subplots(figsize=(11.4, 4.35))
        axis.set_xlim(0, 1)
        axis.set_ylim(0, 1)
        axis.axis("off")
        axis.text(0.02, 0.96, "What the V15 study actually establishes", fontsize=16,
                  fontweight="bold", color=INK, va="top")
        axis.text(0.02, 0.90,
                  "The result is a bounded safety finding, not a general claim that Memi produces better designs.",
                  fontsize=9.5, color=MUTED, va="top")
        for index, (category, headline, detail, fill, edge) in enumerate(rows):
            y = 0.62 - index * 0.25
            _box(axis, 0.02, y, 0.18, 0.17, category, "", fill, edge)
            axis.plot([0.20, 0.20], [y + 0.02, y + 0.15], color=edge, linewidth=2.2)
            axis.text(0.23, y + 0.125, headline, fontsize=11, fontweight="bold", color=INK, va="center")
            axis.text(0.23, y + 0.055, detail, fontsize=8.6, color=MUTED, va="center", linespacing=1.3)
        _save(fig, path)


def render_study_design(
    path: Path,
    protocol: dict[str, Any],
    receipts: dict[str, Any],
    exclusions: dict[str, Any],
    grading: dict[str, Any],
) -> None:
    """Render the prospective study and evidence-admission flow."""
    design = protocol.get("design", {})
    fixtures = int(design.get("fixtures", 0))
    pairs_per_fixture = int(design.get("pairsPerFixture", 0))
    matched_pairs = int(design.get("matchedPairs", 0))
    cells = int(design.get("agentCells", 0))
    verified = int(receipts.get("verifiedCells", 0))
    render_exclusions = sum(
        entry.get("scope") == "rendered-frontend-grading-only"
        for entry in exclusions.get("entries", [])
    )
    graded = len(grading.get("gradedTrials", []))
    complete_quality_pairs = max(0, (graded - 2) // 2)

    with _paper_style():
        fig, axis = plt.subplots(figsize=(11.4, 3.7))
        axis.set_xlim(0, 1)
        axis.set_ylim(0, 1)
        axis.axis("off")

        _box(axis, 0.02, 0.57, 0.18, 0.25, "Frozen protocol",
             f"{fixtures} repositories\n{pairs_per_fixture} matched pairs each",
             BLUE_LIGHT, BLUE)
        _box(axis, 0.25, 0.57, 0.18, 0.25, "Serialized execution",
             f"{matched_pairs} pairs / {cells} cells\nclean clone + pinned revision",
             BLUE_LIGHT, BLUE)
        _box(axis, 0.48, 0.57, 0.18, 0.25, "Receipt admission",
             f"{verified}/{cells} hash-verified\nno imputation",
             BLUE_LIGHT, BLUE)
        _arrow(axis, (0.20, 0.695), (0.25, 0.695), BLUE)
        _arrow(axis, (0.43, 0.695), (0.48, 0.695), BLUE)

        _box(axis, 0.74, 0.66, 0.24, 0.22, "Functional + resource outcomes",
             f"all {verified} admitted cells\n18 matched-pair comparisons",
             OLIVE_LIGHT, OLIVE)
        _box(axis, 0.74, 0.31, 0.24, 0.22, "Blinded design-quality panel",
             f"{graded} graded cells\n{complete_quality_pairs} complete pairs",
             ORANGE_LIGHT, ORANGE)
        _box(axis, 0.48, 0.14, 0.18, 0.20, "Renderability screen",
             f"{render_exclusions} grading-only exclusions\noutcomes otherwise retained",
             "#F2F4F6", MUTED)

        _arrow(axis, (0.66, 0.72), (0.74, 0.77), OLIVE)
        _arrow(axis, (0.57, 0.57), (0.57, 0.34), MUTED)
        _arrow(axis, (0.66, 0.24), (0.74, 0.42), ORANGE)

        axis.text(
            0.02,
            0.95,
            "Prospective matched-pair design and evidence boundary",
            fontsize=14,
            fontweight="bold",
            color=INK,
            va="top",
        )
        axis.text(
            0.02,
            0.90,
            "A renderability exclusion removes only the blinded visual score; it does not erase functional or resource evidence.",
            fontsize=9,
            color=MUTED,
            va="top",
        )
        _save(fig, path)


def render_quality_results(
    path: Path,
    primary_rows: list[dict[str, Any]],
    pair_rows: list[dict[str, Any]],
) -> None:
    """Render a reader-first view of the task-level quality claim boundary."""
    tasks = [str(row["task_id"]) for row in primary_rows]
    all_deltas = [_pair_delta(row) for row in pair_rows]
    lower = min([-5.0, *all_deltas, *(float(row["bootstrap_ci_lower_2p5"]) for row in primary_rows)])
    upper = max([0.0, *all_deltas, *(float(row["bootstrap_ci_upper_97p5"]) for row in primary_rows)])
    padding = max(1.0, (upper - lower) * 0.08)
    x_limits = (lower - padding, upper + padding)

    with _paper_style():
        fig, axis = plt.subplots(figsize=(11.4, 4.7))

        for position, row in enumerate(primary_rows):
            task = str(row["task_id"])
            rows = sorted(
                (pair for pair in pair_rows if str(pair["task_id"]) == task),
                key=lambda pair: int(pair["repeat"]),
            )
            deltas = [_pair_delta(pair) for pair in rows]
            mean = float(row["mean_delta"])
            ci_low = float(row["bootstrap_ci_lower_2p5"])
            ci_high = float(row["bootstrap_ci_upper_97p5"])
            one_sided = float(row["noninferiority_lower_95_one_sided"])
            color = TASK_COLORS.get(task, BLUE)
            jitter = np.linspace(-0.12, 0.12, max(1, len(deltas)))
            axis.scatter(deltas, position + jitter, s=48, color=color, edgecolor=PAPER,
                         linewidth=0.7, zorder=3)
            axis.hlines(position, ci_low, ci_high, color=NEUTRAL, linewidth=5, zorder=1)
            axis.hlines(position, one_sided, mean, color=color, linewidth=5, zorder=2)
            axis.scatter(mean, position, s=86, color=color, edgecolor=PAPER, linewidth=1, zorder=4)
            axis.scatter(one_sided, position, s=56, marker="|", color=INK, linewidth=2.2, zorder=5)
            axis.text(
                x_limits[1],
                position + 0.23,
                f"mean {mean:+.1f}; decision bound {one_sided:+.1f}; n={len(deltas)}",
                ha="right",
                va="bottom",
                fontsize=8.5,
                color=INK,
            )

        _reference_lines(axis, margin=True)
        axis.set_xlim(*x_limits)
        axis.set_yticks(range(len(tasks)), [_task_label(task) for task in tasks])
        axis.set_xlabel("Blinded score difference: Memi minus baseline (0--100 rubric points)")
        axis.grid(axis="x", color=GRID, linewidth=0.7)
        fig.legend(
            handles=[
                Line2D([0], [0], color=NEUTRAL, linewidth=4, label="two-sided 95% bootstrap interval"),
                Line2D([0], [0], marker="|", color=INK, markersize=11, linewidth=0,
                       label="one-sided decision bound"),
                Line2D([0], [0], marker="o", color="none", markerfacecolor=BLUE,
                       markeredgecolor=PAPER, label="individual matched pair"),
            ],
            loc="lower center",
            bbox_to_anchor=(0.52, 0.01),
            frameon=False,
            fontsize=8,
            ncol=3,
        )

        fig.suptitle(
            "Quality result: no large decline observed",
            x=0.06,
            y=0.995,
            ha="left",
            fontsize=14,
            fontweight="bold",
        )
        fig.text(
            0.06,
            0.925,
            "Better performance was not established: this is a narrow non-inferiority finding on two tasks, not a general design-quality win.",
            fontsize=9,
            color=MUTED,
        )
        fig.subplots_adjust(top=0.80, bottom=0.23, left=0.16, right=0.98)
        _save(fig, path, tight=False)


def render_resource_results(path: Path, rows: list[dict[str, Any]]) -> None:
    """Render the four continuous resource outcomes used in the paper."""
    metrics = (
        ("input_tokens", "Input tokens", 1_000.0, "thousands of tokens"),
        ("output_tokens", "Output tokens", 1.0, "tokens"),
        ("reasoning_tokens", "Reasoning tokens", 1.0, "tokens"),
        ("wall_time_ms", "Wall time", 60_000.0, "minutes"),
    )

    with _paper_style():
        fig, axes = plt.subplots(2, 2, figsize=(11.4, 6.7), gridspec_kw={"hspace": 0.53, "wspace": 0.40})
        for axis, (metric, title, divisor, unit) in zip(axes.flat, metrics):
            entries = sorted(
                (row for row in rows if row.get("metric") == metric),
                key=lambda row: _task_sort_key(str(row["task_id"])),
            )
            positions = np.arange(len(entries))
            means = np.asarray([float(row["mean_raw_delta"]) / divisor for row in entries])
            lowers = np.asarray([float(row["bootstrap_ci_lower_2p5"]) / divisor for row in entries])
            uppers = np.asarray([float(row["bootstrap_ci_upper_97p5"]) / divisor for row in entries])
            for index, row in enumerate(entries):
                task = str(row["task_id"])
                color = TASK_COLORS.get(task, BLUE)
                axis.hlines(index, lowers[index], uppers[index], color=NEUTRAL, linewidth=2.2, zorder=1)
                axis.scatter(means[index], index, s=54, color=color, edgecolor=PAPER, linewidth=0.7, zorder=2)
            axis.axvline(0, color=INK, linestyle=(0, (3, 2)), linewidth=1)
            axis.set_yticks(positions, [_task_label(str(row["task_id"])) for row in entries])
            axis.set_xlabel(f"Memi - baseline ({unit}; lower is better)")
            axis.set_title(title, loc="left", fontweight="bold")
            axis.grid(axis="x", color=GRID, linewidth=0.7)
            axis.margins(x=0.08, y=0.25)

        fig.suptitle("Paired resource differences with 95% bootstrap intervals", x=0.06, ha="left", fontsize=14, fontweight="bold")
        fig.text(
            0.06,
            0.94,
            "Six matched pairs per task. Intervals reflect provider-reported usage and serialized wall time, not billing cost.",
            fontsize=9,
            color=MUTED,
        )
        fig.subplots_adjust(top=0.86, bottom=0.10, left=0.17, right=0.98)
        _save(fig, path, tight=False)


def render_policy_state_machine(path: Path) -> None:
    """Render the exact-route, fail-closed fitness policy in reader language."""
    with _paper_style():
        fig, axis = plt.subplots(figsize=(11.4, 4.1))
        axis.set_xlim(0, 1)
        axis.set_ylim(0, 1)
        axis.axis("off")

        _box(axis, 0.02, 0.58, 0.20, 0.23, "Candidate skill",
             "same task, repository, model,\nand skill-content version?", BLUE_LIGHT, BLUE)
        _box(axis, 0.29, 0.58, 0.20, 0.23, "Exact evidence available?",
             "never borrow a result\nfrom another route", "#F2F4F6", MUTED)
        _box(axis, 0.56, 0.67, 0.18, 0.23, "Use the skill",
             "only while its exact\nroute is healthy", BLUE_LIGHT, BLUE)
        _box(axis, 0.79, 0.58, 0.19, 0.23, "Turn it off",
             "a quality or severe efficiency\nregression stops routing", ORANGE_LIGHT, ORANGE)
        _box(axis, 0.29, 0.14, 0.20, 0.22, "Do not inject it",
             "use repository discovery\nwithout a history claim", "#F2F4F6", MUTED)
        _box(axis, 0.56, 0.13, 0.24, 0.23, "Earn it back",
             "three later healthy, exact-match\nprospective pairs", OLIVE_LIGHT, OLIVE)

        _arrow(axis, (0.22, 0.695), (0.29, 0.695), BLUE)
        _arrow(axis, (0.49, 0.73), (0.56, 0.78), BLUE)
        axis.text(0.485, 0.79, "yes", fontsize=8, color=BLUE, ha="center")
        _arrow(axis, (0.39, 0.58), (0.39, 0.36), MUTED)
        axis.text(0.405, 0.47, "no", fontsize=8, color=MUTED)
        _arrow(axis, (0.74, 0.78), (0.79, 0.71), ORANGE)
        axis.text(0.77, 0.84, "harm observed", fontsize=8, color=ORANGE, ha="center")
        _arrow(axis, (0.88, 0.58), (0.78, 0.36), OLIVE)
        axis.text(0.88, 0.43, "new healthy evidence", fontsize=8, color=OLIVE, ha="center")
        _arrow(axis, (0.56, 0.25), (0.49, 0.58), OLIVE, connectionstyle="arc3,rad=-0.25")
        axis.text(0.50, 0.37, "3 good pairs", fontsize=8, color=OLIVE, ha="center")
        _arrow(axis, (0.80, 0.20), (0.91, 0.58), ORANGE, connectionstyle="arc3,rad=0.20")
        axis.text(0.91, 0.34, "new harm resets", fontsize=8, color=ORANGE, ha="center")

        axis.text(0.02, 0.96, "Fail-closed routing: unproven skills do not become defaults", fontsize=14, fontweight="bold", color=INK, va="top")
        axis.text(
            0.02,
            0.91,
            "A route needs exact evidence to run. Harm turns it off immediately; only later exact-match evidence can turn it back on.",
            fontsize=9,
            color=MUTED,
            va="top",
        )
        _save(fig, path)


def render_backtest_timeline(
    path: Path,
    summary: dict[str, Any],
    chronology: list[dict[str, Any]],
) -> None:
    """Render the observed exact-route state changes in chronological order."""
    routes = list(summary.get("routes", []))
    nate_events = [
        entry for entry in chronology
        if entry.get("taskClass") == "nate-options-reduce-motion"
        or entry.get("taskId") == "nate-options-reduce-motion"
    ]
    timestamps = [
        _parse_time(event["createdAt"])
        for route in routes
        for event in route.get("timeline", [])
        if event.get("createdAt")
    ] + [
        _parse_time(event["observedAt"])
        for event in nate_events
        if event.get("observedAt")
    ]
    if not timestamps:
        raise ValueError("backtest timeline has no timestamps")
    start, end = min(timestamps), max(timestamps)
    span = max((end - start).total_seconds(), 60.0)
    pad_days = (span * 0.04) / 86_400

    with _paper_style():
        fig, axis = plt.subplots(figsize=(11.4, 4.5))
        y_positions = {"paraform-command-menu": 2, "buzzr-tab-unread-badge": 1, "nate-options-reduce-motion": 0}

        for route in routes:
            task = str(route["taskClass"])
            y = y_positions.get(task, 0)
            events = sorted(route.get("timeline", []), key=lambda event: event["createdAt"])
            if not events:
                continue
            event_times = [_parse_time(event["createdAt"]) for event in events]
            segment_start = start
            for event, event_time in zip(events, event_times):
                state = str(event.get("stateAfter", "healthy"))
                color = ORANGE if state == "suppressed" else BLUE
                axis.hlines(y, segment_start, event_time, color=NEUTRAL, linewidth=4, zorder=1)
                marker = "s" if int(event.get("schemaVersion", 2)) == 1 else "o"
                axis.scatter(event_time, y, s=66, marker=marker, color=color,
                             edgecolor=PAPER, linewidth=0.8, zorder=3)
                segment_start = event_time
            final_state = str(events[-1].get("stateAfter", route.get("finalState", "healthy")))
            final_color = ORANGE if final_state == "suppressed" else BLUE
            axis.hlines(y, segment_start, end, color=final_color, linewidth=4, zorder=1)
            axis.text(
                mdates.date2num(end) + pad_days,
                y,
                "repository-only" if final_state == "suppressed" else "eligible",
                va="center",
                fontsize=8,
                color=final_color,
                fontweight="bold",
            )

        if nate_events:
            times = [_parse_time(event["observedAt"]) for event in nate_events if event.get("observedAt")]
            axis.hlines(0, start, end, color=NEUTRAL, linewidth=2, linestyle=(0, (2, 2)))
            axis.scatter(times, [0] * len(times), s=54, marker="D", facecolors=PAPER,
                         edgecolors=MUTED, linewidth=1.2, zorder=3)
            axis.text(mdates.date2num(end) + pad_days, 0, "abstain", va="center", fontsize=8,
                      color=MUTED, fontweight="bold")

        axis.set_yticks(
            [2, 1, 0],
            ["Paraform / design-extract", "Buzzr / atomic-design", "Nate / no exact route"],
        )
        axis.set_xlim(mdates.date2num(start) - pad_days, mdates.date2num(end) + 4 * pad_days)
        axis.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
        axis.set_xlabel("Pair-complete time on 1 August 2026 (UTC)")
        axis.grid(axis="x", color=GRID, linewidth=0.7)
        fig.suptitle(
            "Chronological replay of exact-route fitness evidence",
            x=0.20,
            y=0.98,
            ha="left",
            fontsize=14,
            fontweight="bold",
        )
        fig.text(
            0.20,
            0.91,
            "Filled circles: blinded-quality v2; squares: automation-only negative v1; open diamonds: chronology-only abstentions.",
            fontsize=8.5,
            color=MUTED,
        )
        for spine in ("top", "right", "left"):
            axis.spines[spine].set_visible(False)
        axis.tick_params(axis="y", length=0)
        fig.subplots_adjust(top=0.80, bottom=0.20, left=0.20, right=0.88)
        _save(fig, path, tight=False)


def _paper_style():
    return plt.rc_context({
        "font.family": "DejaVu Sans",
        "font.size": 9,
        "axes.labelcolor": INK,
        "axes.edgecolor": INK,
        "axes.titlecolor": INK,
        "xtick.color": MUTED,
        "ytick.color": INK,
        "figure.facecolor": PAPER,
        "axes.facecolor": PAPER,
        "savefig.facecolor": PAPER,
    })


def _save(fig: Any, path: Path, *, tight: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if tight:
        fig.tight_layout()
    fig.savefig(path, dpi=180, metadata=PUBLICATION_METADATA)
    plt.close(fig)


def _box(
    axis: Any,
    x: float,
    y: float,
    width: float,
    height: float,
    title: str,
    detail: str,
    fill: str,
    edge: str,
) -> None:
    patch = FancyBboxPatch(
        (x, y),
        width,
        height,
        boxstyle="round,pad=0.012,rounding_size=0.018",
        linewidth=1.2,
        edgecolor=edge,
        facecolor=fill,
    )
    axis.add_patch(patch)
    axis.text(x + 0.015, y + height - 0.055, title, fontsize=9.5, fontweight="bold", color=INK, va="top")
    axis.text(x + 0.015, y + height - 0.115, detail, fontsize=7.8, color=MUTED, va="top", linespacing=1.25)


def _arrow(
    axis: Any,
    start: tuple[float, float],
    end: tuple[float, float],
    color: str,
    *,
    connectionstyle: str = "arc3,rad=0",
) -> None:
    axis.add_patch(FancyArrowPatch(
        start,
        end,
        arrowstyle="-|>",
        mutation_scale=12,
        linewidth=1.25,
        color=color,
        connectionstyle=connectionstyle,
    ))


def _reference_lines(axis: Any, *, margin: bool) -> None:
    axis.axvline(0, color=INK, linewidth=1, linestyle=(0, (3, 2)), zorder=0)
    if margin:
        axis.axvline(-5, color=ORANGE, linewidth=1.3, linestyle=(0, (5, 2)), zorder=0)


def _pair_delta(row: dict[str, Any]) -> float:
    value = row.get("delta_memi_minus_baseline", row.get("delta"))
    if value is None:
        value = float(row["memi_score"]) - float(row["baseline_score"])
    return float(value)


def _task_label(task: str) -> str:
    return TASK_LABELS.get(task, task.replace("-", " "))


def _task_sort_key(task: str) -> tuple[int, str]:
    order = {
        "buzzr-tab-unread-badge": 0,
        "paraform-command-menu": 1,
        "nate-options-reduce-motion": 2,
    }
    return order.get(task, 99), task


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


__all__ = [
    "render_backtest_timeline",
    "render_claim_decision",
    "render_policy_state_machine",
    "render_quality_results",
    "render_resource_results",
    "render_study_design",
]
