#!/usr/bin/env python3
"""Generate LaTeX macros and plot data from committed Memi evidence.

The manuscript deliberately keeps prose and interpretation in LaTeX while
deriving every reported benchmark number from the same JSON artifacts used by
the release brief. Generated files are deterministic and safe to commit.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from statistics import mean, median


ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
GENERATED = HERE / "generated"

SIX_REPO = ROOT / "docs/case-studies/memi-2.7-six-repo/results.json"
WORKFLOW = ROOT / "docs/case-studies/memi-2.7-workflow-proof/results.json"
TOOLS = ROOT / "docs/case-studies/memi-2.7-workflow-proof/tool-call-analysis.json"
READINESS = ROOT / "docs/audits/memi-designworkbench-v2-readiness.json"
RELEASE = ROOT / "release-manifest.json"
CHANGELOG = ROOT / "CHANGELOG.md"


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pct(value: float, digits: int = 2) -> str:
    return f"{value * 100:.{digits}f}"


def workflow_tokens(row: dict, condition: str) -> int:
    run = row[condition]
    return run["inputTokens"] + run["outputTokens"] + run["reasoningTokens"]


def write_csv(path: Path, headers: list[str], rows: list[list[object]]) -> None:
    lines = [",".join(headers)]
    lines.extend(",".join(str(value) for value in row) for row in rows)
    path.write_text("\n".join(lines) + "\n")


def main() -> None:
    GENERATED.mkdir(parents=True, exist_ok=True)
    six = load(SIX_REPO)
    workflow = load(WORKFLOW)
    tools = load(TOOLS)
    readiness = load(READINESS)["readiness"]
    release = load(RELEASE)

    six_tokens = [case["savings"]["tokens"] for case in six["cases"]]
    six_latency = [case["savings"]["latency"] for case in six["cases"]]
    workflow_tokens_savings = [
        pair["savingsPercent"]["totalTokens"] / 100 for pair in workflow["pairs"]
    ]
    workflow_latency = [
        pair["savingsPercent"]["wallTime"] / 100 for pair in workflow["pairs"]
    ]
    workflow_baseline_tokens = sum(
        workflow_tokens(pair, "baseline") for pair in workflow["pairs"]
    )
    workflow_memi_tokens = sum(
        workflow_tokens(pair, "memi") for pair in workflow["pairs"]
    )
    workflow_weighted = (
        workflow_baseline_tokens - workflow_memi_tokens
    ) / workflow_baseline_tokens

    macros = {
        "PaperDate": "30 July 2026",
        "EngineVersion": release["releaseGroups"]["engine"]["version"],
        "EngineSourceCommit": release["releaseGroups"]["engine"]["sourceCommit"],
        "SixRepoPairs": len(six["cases"]),
        "SixRepoMeanTokens": pct(mean(six_tokens)),
        "SixRepoMedianTokens": pct(median(six_tokens)),
        "SixRepoWeightedTokens": pct(
            (
                sum(case["baseline"]["tokens"] for case in six["cases"])
                - sum(case["memi"]["tokens"] for case in six["cases"])
            )
            / sum(case["baseline"]["tokens"] for case in six["cases"])
        ),
        "SixRepoTokenLower": pct(six["aggregate"]["tokenSavings"]["lower95"]),
        "SixRepoTokenUpper": pct(six["aggregate"]["tokenSavings"]["upper95"]),
        "SixRepoMeanLatency": pct(mean(six_latency)),
        "SixRepoTokenWins": sum(value > 0 for value in six_tokens),
        "WorkflowPairs": len(workflow["pairs"]),
        "WorkflowMeanTokens": pct(mean(workflow_tokens_savings)),
        "WorkflowMedianTokens": pct(median(workflow_tokens_savings)),
        "WorkflowWeightedTokens": pct(workflow_weighted),
        "WorkflowTokenLower": pct(
            workflow["aggregate"]["totalTokenSavings"]["lower95"]
        ),
        "WorkflowTokenUpper": pct(
            workflow["aggregate"]["totalTokenSavings"]["upper95"]
        ),
        "WorkflowMeanLatency": pct(mean(workflow_latency)),
        "WorkflowLatencyLower": pct(
            workflow["aggregate"]["latencySavings"]["lower95"]
        ),
        "WorkflowLatencyUpper": pct(
            workflow["aggregate"]["latencySavings"]["upper95"]
        ),
        "WorkflowTokenWins": sum(value > 0 for value in workflow_tokens_savings),
        "BuzzrCalibrationTokens": pct(tools["outcomes"]["totalTokenSavings"]),
        "BuzzrCalibrationWall": pct(tools["outcomes"]["wallTimeSavings"]),
        "BuzzrCalibrationToolCalls": pct(tools["outcomes"]["toolCallSavings"]),
        "BuzzrBaselineRetries": tools["outcomes"]["baselineRetries"],
        "BuzzrMemiRetries": tools["outcomes"]["memiRetries"],
        "BenchmarkTracks": readiness["completed"]["tracks"],
        "BenchmarkTaskContracts": readiness["completed"]["taskContracts"],
        "BenchmarkPreparedFixtures": readiness["prepared"]["fixtures"],
        "BenchmarkVerifiedFixtures": readiness["verified"]["fixtures"],
        "BenchmarkVerifiedRunners": readiness["verified"]["runners"],
        "BenchmarkRequiredRunners": readiness["completed"]["runnerContracts"],
        "BenchmarkPractitioners": readiness["verified"]["practitioners"],
        "FinalTestFiles": 300,
        "FinalTests": 2154,
        "PackageCompressedBytes": 570048,
        "PackageCompressedKiB": "556.7",
        "PackageUnpackedBytes": 2019418,
        "PackageUnpackedMiB": "1.93",
        "PackageFileCount": 54,
    }
    macro_lines = [
        "% Generated by generate_paper_assets.py. Do not edit by hand."
    ]
    macro_lines.extend(
        f"\\newcommand{{\\{name}}}{{{value}}}" for name, value in macros.items()
    )
    (GENERATED / "metrics.tex").write_text("\n".join(macro_lines) + "\n")

    six_labels = {
        "nate-the-bait": "Nate",
        "buzzr": "Buzzr",
        "doriios": "DoriOS",
        "nyra": "Nyra",
        "paraform": "Paraform",
        "nyra-landing": "NyraLanding",
    }
    write_csv(
        GENERATED / "six_repo.csv",
        ["case", "tokens", "latency", "tools"],
        [
            [
                six_labels[case["id"]],
                round(case["savings"]["tokens"] * 100, 2),
                round(case["savings"]["latency"] * 100, 2),
                round(case["savings"]["tools"] * 100, 2),
            ]
            for case in six["cases"]
        ],
    )

    workflow_labels = {
        "DoriOS": "DoriOS",
        "Buzzr": "Buzzr",
        "Nate the Bait": "Nate",
        "Paraform": "Paraform",
        "dorii public site": "DoriiWeb",
    }
    write_csv(
        GENERATED / "workflow.csv",
        ["case", "tokens", "latency", "tools"],
        [
            [
                workflow_labels[pair["case"]],
                pair["savingsPercent"]["totalTokens"],
                pair["savingsPercent"]["wallTime"],
                pair["savingsPercent"]["toolCalls"],
            ]
            for pair in workflow["pairs"]
        ],
    )

    write_csv(
        GENERATED / "tool_profile.csv",
        ["category", "baseline", "memi"],
        [
            [
                category,
                tools["profiles"]["baseline"]["categories"][category],
                tools["profiles"]["memi"]["categories"][category],
            ]
            for category in ["search", "read", "verification", "status"]
        ],
    )

    # Values come from versioned changelog and audit records cited in the paper.
    write_csv(
        GENERATED / "test_growth.csv",
        ["version", "tests", "files"],
        [
            ["2.0", 1572, 205],
            ["2.6.1", 1718, 0],
            ["2.6.4", 1945, 268],
            ["2.7", 2154, 300],
        ],
    )

    sources = [SIX_REPO, WORKFLOW, TOOLS, READINESS, RELEASE, CHANGELOG]
    digest_lines = [
        "% Generated evidence commitments.",
        "\\begin{tabularx}{\\textwidth}{@{}X>{\\ttfamily\\tiny\\raggedright\\arraybackslash}p{0.49\\textwidth}@{}}",
        "\\toprule",
        "Artifact & SHA-256 \\\\",
        "\\midrule",
    ]
    for source in sources:
        relative = source.relative_to(ROOT).as_posix()
        digest_lines.append(f"\\nolinkurl{{{relative}}} & {sha256(source)} \\\\")
    digest_lines.extend(["\\bottomrule", "\\end{tabularx}"])
    (GENERATED / "source_hashes.tex").write_text("\n".join(digest_lines) + "\n")

    print(
        json.dumps(
            {
                "generated": [
                    str(path.relative_to(ROOT))
                    for path in sorted(GENERATED.iterdir())
                ],
                "sources": {
                    str(path.relative_to(ROOT)): sha256(path) for path in sources
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
