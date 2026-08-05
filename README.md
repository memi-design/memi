[![MCP Toplist](https://mcptoplist.com/badge/glama%2Fmemi-design%2Fmemi.svg)](https://mcptoplist.com/server/glama%2Fmemi-design%2Fmemi)

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

**The design layer for agentic AI.**

Memi gives coding agents the product context, interface checks, and verification loops they need to ship UI that fits the system already in your repository. Use the CLI and [Memi Studio](https://memoire.cv/download) today; [Memi Canvas](#one-product-layer-three-surfaces) is currently in development. Memi works with Codex, Claude Code, Cursor, MCP clients, and CI.

<p align="center">
  <a href="#quickstart"><strong>Start with your next interface</strong></a> ·
  <a href="https://memoire.cv/download">Get Memi Studio</a> ·
  <a href="#research-and-benchmarks">Read the research</a>
</p>

## Quickstart

Run Memi in any frontend repository. The first result is a grounded brief for the next edit: what the product already does, where the relevant UI lives, and what needs verification.

```bash
npx -y @memi-design/cli@latest diagnose . --json --no-write --fail-on none
```

No account, API key, Figma file, global install, or daemon is required. The result carries normalized finding IDs, confidence, provenance, and `file:line` evidence.

Give the same context to your coding agent:

```bash
npx skills add memi-design/memi --skill audit-frontend-design
```

Then ask:

> Audit this frontend before editing it. Prioritize the five changes that will matter most to users, reuse the existing system, and verify the result after the patch.

If Memi catches a real interface issue in your project, [share the finding](https://github.com/memi-design/memi/discussions/categories/show-and-tell). Real reports are the most useful signal for what to improve next.

## One product layer, three surfaces

| Surface | What it is | Status |
| --- | --- | --- |
| **Memi CLI** | Interface intelligence and deterministic checks for local repositories, agents, and CI. | Available today |
| **Memi Studio** | A macOS workbench for bringing project context, agent workflows, and verification together. | [Available today](https://memoire.cv/download) |
| **Memi Canvas** | A visual workspace for design-system context and controlled agent proposals. | Currently in development |

## See the product

| Memi Studio | Memi Canvas — in development |
| --- | --- |
| <img src="https://raw.githubusercontent.com/memi-design/memi/main/product-hunt-assets/source-captures-v2/studio-real-01-workbench.png" alt="Memi Studio workbench showing a project workspace, prompt, and inspector." width="100%" /> | <img src="https://raw.githubusercontent.com/memi-design/memi/main/assets/product/memi-canvas-workspace.png" alt="Memi Canvas workspace preview showing a design system, proposal run, and verification state." width="100%" /> |
| Bring an agent prompt, project memory, and a verification surface into one workbench. | Preview design-system context, inspect a proposal, and keep a human in the loop. This preview shows an active development build, not a released product guarantee. |

## What Memi adds to an agent workflow

| Before the edit | During the edit | Before merge |
| --- | --- | --- |
| Discover components, tokens, routes, states, and accessibility gaps. | Give the agent a scoped brief that names the system it must preserve. | Rerun deterministic checks and surface new interface debt in CI. |

| Need | Start with |
| --- | --- |
| Find UI risks and product-system context | `audit-frontend-design` |
| Plan a change around existing components and tokens | `remember-design-system` |
| Keep new interface debt out of pull requests | `enforce-design-ci` |
| Build and verify native Apple interfaces | `build-swiftui-interface` |

Compatible with the [shadcn registry](https://ui.shadcn.com/docs/registry/getting-started) and [v0 design systems](https://v0.app/docs/design-systems).

## Evidence at a glance

The [V15 confirmatory audit](https://github.com/memi-design/memi/tree/main/docs/research/memi-2.7-prospective-study/v15-2.7.3-confirmatory) is a public technical disclosure, not a leaderboard. It separates receipt admission, rendered design quality, functional acceptance, and resource observations.

| Measured record | Exact reading |
| --- | --- |
| 36 / 36 frozen receipts admitted | Every preregistered agent cell had an auditable receipt. This is receipt admission, not universal performance. |
| **10 complete model-graded matched pairs** | Rendered design-quality comparisons that survived the prespecified screen. This is model-graded evidence, not independent practitioner review. |
| Buzzr / Expo: mean **+1.4**; Paraform / web: mean **−0.4** | The scoped non-inferiority gate passed on both graded task families. It does not establish general superiority. |
| **0 / 21** corrected task-by-resource tests rejected | The study did not establish a speed, cost, or token-use advantage. |

**Separate historical release record:** the 2.7 candidate record reported **2,187 / 2,187** tests passed. It is release evidence, not part of V15 and not proof that every project benefits.

## Benchmarks and paper

<p align="center">
  <a href="https://github.com/memi-design/memi/releases/download/v2.7.4/memi-2.7.3-confirmatory-audit.pdf">
    <img src="https://raw.githubusercontent.com/memi-design/memi/main/assets/readme-benchmark.svg" alt="V15 benchmark preview: scoped quality non-inferiority passed for two task families; the study makes no general superiority, speed, or cost claim." width="100%" />
  </a>
</p>

Quality non-inferiority passed for the scoped Buzzr and Paraform task families. The full paper reports exclusions, failed paths, and limitations without imputation. **No superiority, speed, or dollar-savings claim is made.** Read the [conference-style audit PDF](https://github.com/memi-design/memi/blob/main/docs/research/memi-2.7-prospective-study/v15-2.7.3-confirmatory/memi-2.7.3-confirmatory-audit.pdf), inspect the [protocol and receipts](https://github.com/memi-design/memi/tree/main/docs/research/memi-2.7-prospective-study/v15-2.7.3-confirmatory), or review the [V17 preregistration](https://github.com/memi-design/memi/blob/main/docs/research/memi-2.7-prospective-study/v17-routing-quality/README.md).

**Memi InterfaceBench v1** is a 100 target tasks specification with 5 pinned seed tasks; it is not an aggregate performance score. The historical candidate record reported 2,187/2,187 tests and 70.57% statements coverage. The greater-than-25% claim remains **not verified**. Inspect the [benchmark contract](https://github.com/memi-design/memi/blob/main/benchmarks/interfacebench-v1.json) and [workflow evidence](https://github.com/memi-design/memi/blob/main/docs/case-studies/memi-2.7-workflow-proof/results.json).

**Memi DesignWorkBench v2** holds 300 task contracts and requires practitioner calibration before any certification claim.

## Prompts that map to real workflows

| Goal | Copy-paste prompt | Supporting workflow |
| --- | --- | --- |
| Establish a baseline before a UI change | **Audit this frontend before editing it.** Prioritize the five changes with the clearest `file:line` evidence. | `audit-frontend-design` |
| Turn evidence into a scoped plan | **Turn the findings into a scoped UI change plan.** Reuse existing components and tokens before editing. | `remember-design-system` |
| Protect a pull request | **Set up a deterministic design CI gate for this pull request.** Fail only on newly introduced interface debt and save SARIF plus the HTML report. | `enforce-design-ci` |

## Research, stated plainly

The research is disclosure material, not a product leaderboard. It keeps functional, rendered-quality, and resource evidence separate so a result cannot be made to say more than the study supports.

## Choose your integration

| Surface | Start here | Best for |
| --- | --- | --- |
| One-time CLI run | `npx -y @memi-design/cli@2.7.7 diagnose . --no-write` | Trying Memi without installing |
| Global CLI | `npm i -g @memi-design/cli` | Daily local use |
| Agent Skill | `npx skills add memi-design/memi --skill audit-frontend-design` | Codex, Claude Code, Cursor, and compatible agents |
| GitHub Action | `uses: memi-design/memi@74fc6ce8c66182b4aa06e1250cb169da8b1fc54c` | Pull-request design CI |
| MCP server | `memi mcp start --no-figma` | Any MCP client |
| Studio | `brew install --cask memi-design/memi/memi-studio` | Supervised macOS workflows |

### GitHub Action

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
      - uses: memi-design/memi@74fc6ce8c66182b4aa06e1250cb169da8b1fc54c # v2.7.7
        with:
          version: "2.7.7"
          report: true
          upload-sarif: true
```

The Action adds code-scanning annotations, a step summary, and a `memi-design-health` artifact. Existing debt can be baselined while newly introduced debt fails the gate.

[GitHub Action guide](https://github.com/memi-design/memi/blob/main/docs/GITHUB_ACTION_MARKETPLACE.md) · [CI recipes](https://github.com/memi-design/memi/blob/main/docs/CI_RECIPES.md) · [current versions](https://github.com/memi-design/memi/blob/main/docs/CURRENT_RELEASE.md)

### Agent and MCP setup

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
- [Current release truth](https://github.com/memi-design/memi/blob/main/docs/CURRENT_RELEASE.md) — the public versions for CLI, Studio, and website.
- [Reproducible case studies](https://github.com/memi-design/memi/tree/main/docs/case-studies) — pinned evidence, abstentions, and paired protocols.
- [Dependency trust ledger](docs/DEPENDENCY_TRUST.md) — direct dependency purpose, dynamic boundaries, and review policy.
- [`llms.txt`](llms.txt) — compact machine-readable product map.

Memi has no npm install-time lifecycle scripts, no source upload or covert telemetry, explicit Figma connection, agent-kit `--dry-run --json`, immutable Action pins, and documented third-party boundaries in [NOTICE](NOTICE).

## Community

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and pull-request guidance. Bugs and feature requests belong in [issues](https://github.com/memi-design/memi/issues); questions and real project reports belong in [Discussions](https://github.com/memi-design/memi/discussions).

Useful contributions include reproducible audit fixtures, framework adapters, skill improvements, accessible UI cases, motion checks, and before/after reports.

## License

Studio interface references and adapted components include Hermes WebUI and the MIT Warp UI framework boundary around `warpui_core` and `warpui`; Warp AGPL application and client code is not copied into Memi.

MIT. See [NOTICE](NOTICE) for optional adapters and complete third-party attribution.
