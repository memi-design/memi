<p align="center">
  <img src="https://raw.githubusercontent.com/memi-design/memi/main/assets/memi-brand-banner.png" alt="Memi — the design layer for agentic AI." width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@memi-design/cli"><img src="https://img.shields.io/npm/v/@memi-design/cli?color=bd3f63&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@memi-design/cli"><img src="https://img.shields.io/npm/dw/@memi-design/cli?color=171718&label=weekly%20downloads" alt="weekly npm downloads"></a>
  <a href="https://github.com/memi-design/memi/actions/workflows/ci.yml"><img src="https://github.com/memi-design/memi/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/memi-design/memi/stargazers"><img src="https://img.shields.io/github/stars/memi-design/memi?style=social" alt="GitHub stars"></a>
  <a href="https://github.com/memi-design/memi/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-171718.svg" alt="MIT license"></a>
</p>

# Memi

**Design CI for coding agents.**

Memi is the **read-only design engineering audit and skill layer for coding agents**. It gives Codex, Claude Code, Cursor, Grok Build, and MCP clients file-anchored UI evidence before merge.

The first pass reads the product you already have, identifies accessibility, hierarchy, state, responsive, motion, and token risks, then reruns the same deterministic check after a scoped fix. Your code remains the source of truth.

**Supported today:** Node 20, 22, and 24 on macOS, Linux, and Windows. Figma and [Studio](https://memoire.cv/download) are optional companions.

[npm](https://www.npmjs.com/package/@memi-design/cli) · [memoire.cv](https://memoire.cv) · [current versions](https://github.com/memi-design/memi/blob/main/docs/CURRENT_RELEASE.md) · [MCP Registry](https://registry.modelcontextprotocol.io) · [Agent Skills](https://skills.sh/memi-design/memi)

## Quickstart

Run one audit in any frontend repository:

```bash
npx -y @memi-design/cli@latest diagnose . --json --no-write --fail-on none
```

You get normalized finding IDs, confidence, provenance, and `file:line` evidence. **No account, API key, Figma file, global install, or daemon is required.**

Keep the workflow available to your coding agent:

```bash
npx skills add memi-design/memi --skill audit-frontend-design
```

Then ask: “Audit this frontend before editing it. Prioritize the five fixes that will matter most to users.”

| Need | Start with |
| --- | --- |
| Find interface risks before changing UI | `audit-frontend-design` |
| Load compact product-system context | `remember-design-system` |
| Gate pull requests with deterministic evidence | `enforce-design-ci` |
| Build and verify native Apple interfaces | `build-swiftui-interface` |

Compatible with the [shadcn registry](https://ui.shadcn.com/docs/registry/getting-started) and [v0 design systems](https://v0.app/docs/design-systems).

If Memi catches a real interface issue in your project, [star the repository](https://github.com/memi-design/memi) and [share the finding](https://github.com/memi-design/memi/discussions/categories/show-and-tell). That is the most useful signal for deciding what to improve next.

## Evidence at a glance

These are the measured results currently available in the [V15 confirmatory audit](https://github.com/memi-design/memi/tree/main/docs/research/memi-2.7-prospective-study/v15-2.7.3-confirmatory). They describe that study; they are not estimates for your repository.

| Measured record | What it means | Boundary |
| --- | --- | --- |
| **36 / 36** frozen execution receipts admitted | Every preregistered agent cell had an auditable receipt | Receipt admission, not universal performance |
| **10 complete model-graded matched pairs** | Rendered design-quality comparisons survived the prespecified screen | Model-graded evidence, not independent practitioner review |
| **0** model calls required in deterministic CI enforcement | The pull-request gate can rerun file-anchored checks without an LLM | This describes the CI path, not every optional workflow |

The full study also reports exclusions, failures, and limits. **No superiority, speed, or dollar-savings claim is made.**

**Separate historical release record:** the 2.7 candidate record reported **2,187 / 2,187** tests passed. It is release evidence, not part of V15 and not proof that every project benefits.

## Benchmarks and paper

<p align="center">
  <a href="https://github.com/memi-design/memi/releases/download/v2.7.4/memi-2.7.3-confirmatory-audit.pdf">
    <img src="https://raw.githubusercontent.com/memi-design/memi/main/assets/readme-benchmark.svg" alt="V15 benchmark preview. Blinded quality non-inferiority passed for the scoped Buzzr and Paraform tasks, while 0 of 21 corrected resource tests rejected the null. The study does not establish general superiority, speed, or cost savings." width="100%" />
  </a>
</p>

The graphic is a compact reading guide to the [public technical paper](https://github.com/memi-design/memi/releases/download/v2.7.4/memi-2.7.3-confirmatory-audit.pdf), not a leaderboard. The primary measure was a blinded, model-graded 100-point design-quality rubric. The preregistered question was narrow: could Memi stay within five points of its paired baseline on each renderable task?

| Benchmark result | Exact reading |
| --- | --- |
| Buzzr / Expo: mean **+1.4**, one-sided lower bound **+0.2** | Above the −5 non-inferiority margin; the scoped gate passed. |
| Paraform / web: mean **−0.4**, one-sided lower bound **−3.4** | Still above the −5 margin; the scoped gate passed. |
| Resource estimates: **0 / 21** task-by-resource estimates had a Holm-corrected test reject | No supported claim that Memi is faster, cheaper, or uses fewer tokens. |
| Nate / SwiftUI | Functional and resource receipts are retained, but there is no admitted visual-quality pair. |

**Benchmark contracts are separate from study results.** [InterfaceBench v1](https://github.com/memi-design/memi/blob/main/benchmarks/interfacebench-v1.json) specifies 100 target tasks with 5 pinned seed tasks; it is not an aggregate performance score. [DesignWorkBench v2](https://github.com/memi-design/memi/blob/main/docs/audits/memi-designworkbench-v2-readiness.md) holds 300 task contracts and still requires practitioner calibration before any certification claim.

## What you get

| Evidence layer | What it surfaces |
| --- | --- |
| Accessibility | Labels, focus, contrast, and reduced-motion risks |
| Interface craft | Hierarchy, spacing drift, convention, and responsive behavior |
| Product states | Loading, empty, error, success, and permission-state gaps |
| Design systems | Token drift, raw values, and inconsistent component usage |
| Pull requests | New debt only, SARIF annotations, step summary, and HTML report |

The default workflow is deliberately read-only. Write-capable scaffolds and Figma operations are separate, explicit workflows.

## Prompts that map to real workflows

After installing a skill, paste one of these into Codex, Claude Code, Cursor, or another compatible agent.

| Goal | Copy-paste prompt | Supporting workflow |
| --- | --- | --- |
| Establish a baseline before a UI change | **Audit this frontend before editing it.** Prioritize the five changes with the clearest `file:line` evidence. | `audit-frontend-design` and a read-only `memi diagnose` pass |
| Turn evidence into a small, consistent plan | **Turn the findings into a scoped UI change plan.** Reuse the existing tokens and components; do not edit until the plan is explicit. | `remember-design-system` context for a reviewed implementation plan |
| Protect a pull request from new interface debt | **Set up a deterministic design CI gate for this pull request.** Fail only on newly introduced interface debt and save SARIF plus the HTML report. | `enforce-design-ci` and the GitHub Action workflow |

The first three workflows are evidence, planning, and CI gates. Write-capable scaffolds and Figma actions remain explicit choices.

## Research, stated plainly

The [V15 confirmatory audit](https://github.com/memi-design/memi/blob/main/docs/research/memi-2.7-prospective-study/v15-2.7.3-confirmatory/README.md) is a reproducible release study, not a product claim page.

| What the audit observed | What it does **not** establish |
| --- | --- |
| **36 / 36 frozen receipts admitted** across Buzzr/Expo, Paraform/web, and Nate/SwiftUI | A pooled cross-product performance claim |
| **10 complete model-graded matched pairs**; model grades are not independent practitioner evidence | That Memi is professionally superior overall |
| **Quality non-inferiority passed** for the two graded task families: Buzzr and Paraform | That every interface, platform, or task benefits |
| **0 / 26 secondary tests rejected after Holm correction**; billing records were not collected | Faster, cheaper, or dollar-saving operation |

**No superiority, speed, or dollar-savings claim is made.** The study reports exclusions without imputation and keeps functional, rendered-quality, and resource evidence separate.

Read the [conference-style audit PDF](https://github.com/memi-design/memi/blob/main/docs/research/memi-2.7-prospective-study/v15-2.7.3-confirmatory/memi-2.7.3-confirmatory-audit.pdf), inspect the [protocol and receipts](https://github.com/memi-design/memi/tree/main/docs/research/memi-2.7-prospective-study/v15-2.7.3-confirmatory), or review the [V17 preregistration](https://github.com/memi-design/memi/blob/main/docs/research/memi-2.7-prospective-study/v17-routing-quality/README.md) for the next routing-quality study. The complete [InterfaceBench contract](https://github.com/memi-design/memi/blob/main/benchmarks/interfacebench-v1.json) and [DesignWorkBench v2 readiness report](https://github.com/memi-design/memi/blob/main/docs/audits/memi-designworkbench-v2-readiness.md) remain separate from release evidence.

<details>
<summary><strong>Memi InterfaceBench and historical candidate record</strong></summary>

Memi InterfaceBench is a 100 target tasks specification with 5 pinned seed tasks; it is not a published performance score. The historical 2.7 candidate record reported 2,187/2,187 tests and 70.57% statements coverage. The greater-than-25% claim remains **not verified**. Memi DesignWorkBench v2 holds 300 task contracts and requires practitioner calibration before any certification claim. Inspect the [benchmark contract](https://github.com/memi-design/memi/blob/main/benchmarks/interfacebench-v1.json) and [workflow evidence](https://github.com/memi-design/memi/blob/main/docs/case-studies/memi-2.7-workflow-proof/results.json).

</details>

## How the audit works

1. **Inspect** — build an evidence graph from source, routes, styles, and local design-system files.
2. **Find** — report normalized issues with severity, confidence, provenance, and `file:line`.
3. **Correct** — let a human or coding agent make a scoped change.
4. **Verify** — rerun the same command and compare the evidence.

No LLM is used in the deterministic CI enforcement path.

## Choose your integration

| Surface | Start here | Best for |
| --- | --- | --- |
| One-time CLI audit | `npx -y @memi-design/cli@2.7.4 diagnose . --no-write` | Trying Memi without installing |
| Global CLI | `npm i -g @memi-design/cli` | Daily local use |
| Agent Skill | `npx skills add memi-design/memi --skill audit-frontend-design` | Codex, Claude, Cursor, and compatible agents |
| GitHub Action | `uses: memi-design/memi@8aa4649f412bbcaaf2af4ee209bf79016566f035` | Pull-request design CI |
| MCP server | `memi mcp start --no-figma` | Any MCP client |
| Studio | `brew install --cask memi-design/memi/memi-studio` | Supervised macOS workflows |

## Design CI

Pin the release commit so every pull request runs the same code:

```yaml
name: design
on: [pull_request]

permissions:
  contents: read

jobs:
  memi:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
      - uses: memi-design/memi@8aa4649f412bbcaaf2af4ee209bf79016566f035 # v2.7.4
        with:
          version: "2.7.4"
          report: true
          upload-sarif: true
```

The Action adds code-scanning annotations, a step summary, and a `memi-design-health` artifact. Existing debt can be baselined while new debt fails the gate.

[GitHub Action guide](https://github.com/memi-design/memi/blob/main/docs/GITHUB_ACTION_MARKETPLACE.md) · [CI recipes](https://github.com/memi-design/memi/blob/main/docs/CI_RECIPES.md) · [team rollout](https://github.com/memi-design/memi/blob/main/docs/TEAM_ROLLOUT.md)

## Agent and MCP setup

```bash
memi agent install codex --project .
memi agent install claude-code --project .
memi agent install cursor --project .
memi agent install grok-build --project .
```

```json
{
  "mcpServers": {
    "memoire": {
      "command": "memi",
      "args": ["mcp", "start", "--no-figma"]
    }
  }
}
```

Codex plugin marketplace:

```bash
codex plugin marketplace add memi-design/memi --ref main --sparse .agents/plugins --sparse plugins/memoire
```

[Agent stack guide](docs/AGENT_STACKS.md) · [copy-paste recipes](https://github.com/memi-design/memi/blob/main/docs/AGENT_RECIPES.md) · [full skill router](skills/memoire-design-tooling/SKILL.md)

## Trust and proof

- [Release gates](https://github.com/memi-design/memi/blob/main/docs/RELEASE_GATES.md) — package, provenance, clean-install, MCP, plugin, binary, and public-surface checks.
- [Current release truth](https://github.com/memi-design/memi/blob/main/docs/CURRENT_RELEASE.md) — one source for npm, GitHub, Action, Studio, and website versions.
- [Reproducible case studies](https://github.com/memi-design/memi/tree/main/docs/case-studies) — pinned evidence, abstentions, and paired protocols.
- [Audit reports](https://github.com/memi-design/memi/tree/main/docs/audits) — timestamped findings, evidence gaps, score caps, and owners.
- [Dependency trust ledger](docs/DEPENDENCY_TRUST.md) — direct dependency purpose, dynamic boundaries, and review policy.
- [`llms.txt`](llms.txt) — compact machine-readable product map.

Trust defaults: read-only audit; no npm install-time lifecycle scripts; no source upload or covert telemetry; explicit Figma connection; agent-kit `--dry-run --json`; immutable Action pins; and documented third-party boundaries in [NOTICE](NOTICE).

## Community

- [Ask a question](https://github.com/memi-design/memi/discussions/categories/q-a)
- [Show what Memi found](https://github.com/memi-design/memi/discussions/categories/show-and-tell)
- [Report a bug](https://github.com/memi-design/memi/issues/new?template=bug_report.md)
- [Request a feature](https://github.com/memi-design/memi/issues/new?template=feature_request.md)
- [Contribute](CONTRIBUTING.md)

Useful contributions include reproducible audit fixtures, framework adapters, skill improvements, accessible UI cases, motion checks, and real before/after reports.

## License

Studio interface references and adapted components include Hermes WebUI and the MIT Warp UI framework boundary around `warpui_core` and `warpui`; Warp AGPL application and client code is not copied into Memi.

MIT. See [NOTICE](NOTICE) for optional adapters and complete third-party attribution.
