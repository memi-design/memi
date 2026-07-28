<p align="center">
  <img src="https://raw.githubusercontent.com/sarveshsea/memi/main/assets/authentic-logo.svg" alt="memi" width="80" height="80" />
</p>

<h1 align="center">memi</h1>

<p align="center">
  <strong>Read-only design engineering audits for coding agents.</strong><br/>
  Audit real interfaces, remember their design systems, and stop UI regressions before merge.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@memi-design/cli"><img src="https://img.shields.io/npm/v/@memi-design/cli?color=black" alt="npm"></a>
  <a href="https://github.com/sarveshsea/memi/stargazers"><img src="https://img.shields.io/github/stars/sarveshsea/memi?style=social" alt="stars"></a>
  <a href="https://github.com/sarveshsea/memi/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-black.svg" alt="MIT"></a>
  <a href="https://skills.sh/sarveshsea/memi"><img src="https://skills.sh/b/sarveshsea/memi" alt="skills.sh"></a>
</p>

**Package:** [@memi-design/cli](https://www.npmjs.com/package/@memi-design/cli) · **Homepage:** [memoire.cv](https://memoire.cv) · **MCP Registry:** `io.github.sarveshsea/memi` · **Release truth:** [current versions](docs/CURRENT_RELEASE.md)

Memi is the **read-only design engineering audit and skill layer for coding agents**. Studio is a companion, not the primary activation path.

memi turns a real product codebase into **evidence agents can trust** before they edit UI: tokens, components, routes, screenshots, UX risks, interface craft scores, shadcn registries, research specs, and deterministic CI gates. Works with **Grok Build (Grok 4.5)**, Codex, Claude Code, Cursor, Hermes, OpenCode, OpenClaw, and any MCP client.

Compatibility: [shadcn registry](https://ui.shadcn.com/docs/registry/getting-started) and [v0 design systems](https://v0.app/docs/design-systems).

---

## Try it on a real interface

```bash
npx -y @memi-design/cli@2.6.3 diagnose . --json --no-write --fail-on none
```

That runs a read-only, deterministic audit against the current repository and returns file-anchored evidence. No account, API key, Figma file, global install, or daemon is required.

To make the same workflow available whenever an agent edits UI:

```bash
npx skills add sarveshsea/memi --skill audit-frontend-design
```

Then ask: **"Audit this frontend before editing it. Prioritize the five fixes that will matter most to users."**

The skill runs the pinned CLI only when repository evidence is needed.

### Four focused skills

| Job | Install |
| --- | --- |
| Find accessibility, token, hierarchy, state, and responsive issues | `npx skills add sarveshsea/memi --skill audit-frontend-design` |
| Load compact design-system context before UI work | `npx skills add sarveshsea/memi --skill remember-design-system` |
| Add deterministic design checks to pull requests | `npx skills add sarveshsea/memi --skill enforce-design-ci` |
| Build and verify native SwiftUI interfaces | `npx skills add sarveshsea/memi --skill build-swiftui-interface` |

[Browse the skills on skills.sh](https://skills.sh/sarveshsea/memi) or use the full [`memoire-design-tooling`](skills/memoire-design-tooling/SKILL.md) router for Figma, MCP, research, scaffolding, and registry workflows.

Focused mirror repositories remain available for directory discovery, but `sarveshsea/memi` is the source-of-record install.

Every CI finding cites `file:line` and re-runs identically. No LLM is used in the enforcement path.

Machine-readable index: [`llms.txt`](llms.txt)

---

## For humans — five-minute proof

```bash
npm i -g @memi-design/cli

memi agent brief . --intent "Improve this interface" --detail compact --json
memi diagnose
memi ux audit --json
memi craft audit --json
memi tokens --from ./src --report
memi scaffold component EvidenceCard --level organism --json
memi ios brief --intent "Build an accessible settings screen" --detail compact --json
memi ios scaffold Settings --kind screen --module AppModule --json
memi shadcn export --out public/r
memi agent install universal --project .
memi mcp start --no-figma
```

That loop gives you compact web and Apple-platform briefs, app-quality findings, UX risks, craft critique, extracted tokens, dry-run web and SwiftUI file scaffolds, shadcn registry output, installable Agent Skills, and a Figma-independent MCP server.

Public proof repo: [`sarveshsea/design-sandbox`](https://github.com/sarveshsea/design-sandbox) — Next.js 16 + Tailwind 4 + shadcn wired with MCP, skills, and `memoire.agent.yaml`.

---

## Grok Build (Grok 4.5) — recommended setup

Grok Build is xAI's agentic coding CLI powered by Grok 4.5. memi is the design-memory layer that stops Grok from guessing your tokens, components, and UX constraints.

```bash
npm i -g @memi-design/cli
curl -fsSL https://x.ai/cli/install.sh | bash   # Grok Build

cd your-repo
memi agent install grok-build --project .
grok inspect
grok mcp doctor memoire
memi agent brief . --intent "Audit this UI" --agent grok-build --json
```

What `memi agent install grok-build` writes:

| File | Purpose |
| --- | --- |
| `.grok/config.toml` | Native MCP: `memi mcp start --no-figma` |
| `.grok/skills/memoire-design-tooling/` | Native Grok skill discovery |
| `.agents/skills/memoire-design-tooling/` | Universal / AGENTS.md skill mirror |
| `memoire.agent.yaml` | Suite manifest with design-audit recipes |

For animation taste and design-engineering polish, also install Emil Kowalski's craft skills (`npx skills add emilkowalski/skills`) — memi owns system evidence; those skills own motion/taste decisions.

Manual MCP alternative:

```bash
grok mcp add memoire --scope project -- memi mcp start --no-figma
```

Headless automation:

```bash
grok -p "Run memi diagnose and ux audit, then propose a shadcn-safe patch plan."
```

Grok also loads project `.mcp.json` via compat — `memi agent install claude-code --project .` works as a fallback.

---

## What ships in v2

| Layer | What it does | First command |
| --- | --- | --- |
| App quality | UI debt, state gaps, a11y risk, Tailwind drift, UX traps | `memi diagnose` |
| Design-agent brief | Cost-aware preflight with evidence commands and handoff rules | `memi agent brief . --json` |
| UX audit | UX tenets and trap risks from code, screenshots, or routes | `memi ux audit --json` |
| Interface craft | Visual hierarchy, spacing rhythm, conventions, responsive resilience | `memi craft audit --json` |
| Token memory | CSS variables, Tailwind v4 `@theme`, aliases, scale issues | `memi tokens --from ./src --report` |
| Spec-first file creation | Dry-run Atomic Design component/page scaffolds before writes | `memi scaffold component <Name> --json` |
| Apple platform design | SwiftUI brief plus spec/view/model/preview/test scaffolds | `memi ios brief --json` |
| Registry output | shadcn-native registry for shadcn, v0, npm, GitHub | `memi shadcn export --out public/r` |
| Agent kits | Skills + MCP for Grok Build, Codex, Claude Code, Cursor, Hermes, OpenClaw, OpenCode | `memi agent install --dry-run --json` |
| MCP server | 40+ design tools over stdio for any MCP client | `memi mcp start --no-figma` |
| Research design | Research → Atomic Design specs → FigJam-ready source | `memi research design --write-specs --mermaid-jam` |
| Design CI gate | Deterministic PR gate with SARIF annotations | `memi ci` |

---

## Design CI gate (team mandate)

v2.4 turns memi from an audit you can run into a **gate a team can require**. Every finding cites `file:line` and re-runs identically.

```bash
memi init --team     # policy + baseline + gitignore + agent kit
memi ci              # scan, PR scope, SARIF, step summary — exit 1 on new debt
memi baseline status # accepted debt stays visible while it burns down
memi report --badge  # design-health.html + SVG badge
```

### GitHub Action (Marketplace)

```yaml
name: design
on:
  pull_request:
    branches: [main]

jobs:
  design:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
      - uses: sarveshsea/memi@0f89cbf1b9972c779dbf14cc09f6c91485a1182b # v2.6.3
        with:
          version: "2.6.3"
```

What lands on the PR: **code-scanning annotations** at `file:line`, a **step summary** with score and gate verdict, and a **`memi-design-health` artifact** (HTML + markdown + badge).

Full release checklist: [docs/GITHUB_ACTION_MARKETPLACE.md](docs/GITHUB_ACTION_MARKETPLACE.md) · CI recipes: [docs/CI_RECIPES.md](docs/CI_RECIPES.md) · Team rollout: [docs/TEAM_ROLLOUT.md](docs/TEAM_ROLLOUT.md)

---

## MCP server reference

**Start:** `memi mcp start --no-figma` (Figma-independent; add `memi connect` later for live Figma)

**Registry:** `server.json` → `io.github.sarveshsea/memi` on the [MCP Registry](https://registry.modelcontextprotocol.io)

<details>
<summary><strong>Core MCP tools</strong></summary>

| Tool | Use when |
| --- | --- |
| `prepare_design_agent_brief` | Agent needs a preflight contract before UI edits |
| `scaffold_agent_design_files` | Agent needs an approval-gated spec-first file creation plan |
| `prepare_apple_design_brief` | Agent needs compact SwiftUI, availability, accessibility, and Xcode guidance |
| `scaffold_swiftui_files` | Agent needs a dry-run-first SwiftUI spec, view, model, preview, and test scaffold |
| `diagnose_app_quality` | App-quality graph, file evidence, issue list |
| `audit_ux_tenets_traps` | UX tenet scores and trap risks |
| `audit_interface_craft` | Visual hierarchy, rhythm, conventions, polish |
| `get_tokens` | Design tokens, modes, aliases, drift |
| `get_shadcn_registry` | shadcn registry items and install URLs |
| `plan_ui_fixes` | Prioritized fix plan from diagnosis |
| `design_doc` | Extract design system from a route or URL |
| `generate_code` | React + TypeScript + Tailwind from specs |
| `research_design_package` | Research → design package |
| `simulation_plan` / `simulation_run` | Product scenario simulations |
| `check_bridge_health` | Verify Figma bridge before Figma tools |

Figma tools (`pull_design_system`, `capture_screenshot`, `get_selection`, etc.) require `memi connect` or `memi daemon start`.

</details>

**Cursor / Claude Code config** (also Grok compat):

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

Install automatically: `memi agent install cursor --project .` or `memi agent install claude-code --project .`

---

## Agent stack installs

```bash
memi suite init --project .
memi daemon start --project . --port auto
memi agent brief . --intent "Improve this interface" --json

memi agent install grok-build --project .   # Grok 4.5 Build CLI
memi agent install universal --project .
memi agent install hermes
memi agent install openclaw --project .
memi agent install claude-code --project .
memi agent install cursor --project .
memi agent install codex
memi agent install codex-plugin
memi agent install opencode --project .

npx skills add sarveshsea/memi --skill audit-frontend-design
```

| Stack | Install path | Best for |
| --- | --- | --- |
| **Grok Build** | `.grok/config.toml` + `.grok/skills/` (+ `.agents/skills/` mirror) | Grok 4.5 terminal agent with design MCP |
| Universal Agent Skills | `.agents/skills/{audit-frontend-design,remember-design-system,enforce-design-ci,memoire-design-tooling}/` | ECC / AGENTS.md workflows |
| Hermes | `~/.hermes/skills/memoire/` | Transcript-first product design |
| OpenClaw | `<workspace>/skills/memoire/` | Workspace-local agents |
| Claude Code | `.mcp.json` | Project MCP approval |
| Cursor | `.cursor/mcp.json` | Editor-native MCP |
| Codex plugin | `~/plugins/memoire` | Full Codex plugin + marketplace |
| OpenCode | `.opencode/skills/memoire/` | Local frontend agents |

Public Codex marketplace install:

```bash
codex plugin marketplace add sarveshsea/memi --ref main --sparse .agents/plugins --sparse plugins/memoire
```

Copy-paste workflows: [Agent stack guide](docs/AGENT_STACKS.md) · [Agent recipes](docs/AGENT_RECIPES.md)

---

## shadcn registry workflows

```bash
memi tokens --from ./src --report
memi shadcn export --out public/r
memi publish --name @you/ds
memi add Button --from @you/ds
npx shadcn@latest add https://your-site.com/r/button.json
```

Featured examples: [examples/](examples/README.md) — SaaS, dashboard, auth, AI chat, ecommerce, landing pages.

---

## memi Studio (macOS app)

Native shell in [sarveshsea/memi-studio](https://github.com/sarveshsea/memi-studio). This npm package is the engine it embeds.

```bash
brew install --cask sarveshsea/memi/memi-studio
memi studio web --port 1422
```

---

## What ships in the package

| Path | Why |
| --- | --- |
| `dist/` | CLI + MCP runtime |
| `server.json` | MCP Registry descriptor |
| `skills/*/SKILL.md` | Focused Agent Skills plus the full workflow router |
| `agent-kits/` | Grok Build, Hermes, Codex, Cursor, Claude Code, OpenCode, OpenClaw kits |
| `plugins/memoire/` | Codex plugin bundle |
| `notes/` | Built-in research, agent, and design notes |
| `docs/` | Interface understanding, CI, growth, release gates |
| `action.yml` | GitHub Action for design CI (`sarveshsea/memi@0f89cbf1b9972c779dbf14cc09f6c91485a1182b`) |

---

## Trust defaults

- No npm install-time lifecycle scripts
- Figma plugin install is explicit: `memi setup plugin`
- MCP Figma-independent mode: `memi mcp start --no-figma`
- Agent kit installs support `--dry-run --json` before writing files
- Publish gates: release metadata, tarball size, MCP smoke, skills discovery, npm audit

---

## Docs map

| Doc | When you need it |
| --- | --- |
| [Quickstart](docs/README.md) | Shortest install → proof path |
| [GitHub Action Marketplace](docs/GITHUB_ACTION_MARKETPLACE.md) | Publish `memi design CI` to Marketplace |
| [Team Rollout](docs/TEAM_ROLLOUT.md) | Policy, baseline, CI, debt burn-down |
| [CI Recipes](docs/CI_RECIPES.md) | GitHub Action, SARIF, non-GitHub CI |
| [Agent Stacks](docs/AGENT_STACKS.md) | Grok Build, Codex, Claude Code, Cursor, MCP |
| [Interface Understanding](docs/INTERFACE_UNDERSTANDING.md) | Full evidence loop |
| [Growth to 1M](docs/GROWTH_TO_1M_NPM.md) | npm downloads + GitHub stars strategy |
| [v2 Positioning](docs/V2_PACKAGE_POSITIONING.md) | Category and distribution |
| [Public Repos](docs/PUBLIC_REPOS.md) | Proof repos, topics, hashtags |

---

## Full command reference

<details>
<summary><strong>Core commands</strong></summary>

| Command | What it does |
| --- | --- |
| `memi init --team` | Shared design gate: policy, baseline, gitignore, agent kit |
| `memi ci` | CI design gate: scan, PR scope, baseline, SARIF + summary |
| `memi baseline accept\|status` | Accept existing debt; watch burn-down |
| `memi report --badge` | Design-health artifact + SVG badge |
| `memi diagnose [target]` | UI debt from code, route, or URL |
| `memi ux audit [target]` | UX tenets and trap risks |
| `memi craft audit [target]` | Interface craft dimensions |
| `memi tokens --from <path>` | Extract tokens, modes, aliases, drift |
| `memi shadcn export --out public/r` | Export shadcn registry |
| `memi design-doc <url>` | Design system from route or URL |
| `memi agent install [target]` | Install agent kits (grok-build, cursor, codex, …) |
| `memi mcp start --no-figma` | Start MCP server |
| `memi suite init\|doctor\|run` | `memoire.agent.yaml` and recipes |
| `memi daemon start\|status\|stop` | Warm local runtime context |
| `memi studio web\|tui\|logs\|run` | Studio compatibility surfaces |

</details>

---

## Install without npm

```bash
curl -fsSL https://memoire.cv/install.sh | sh
brew install sarveshsea/memi/memoire
docker run --rm -it -v "$PWD:/work" -w /work ghcr.io/sarveshsea/memi --help
```

## License

Studio interface references and adapted components are documented in [NOTICE](NOTICE). The public reference set includes Hermes WebUI, Hermes Agent, and the MIT Warp UI framework boundary around `warpui_core` and `warpui`; Warp AGPL application/client code is not copied into memi.

MIT. See [NOTICE](NOTICE) for Studio interface references, optional adapters, and attribution notes.
