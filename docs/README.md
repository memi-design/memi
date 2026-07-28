# Memoire Docs

Memoire is interface understanding for AI coding agents. It gives agents design-system memory, UX audit evidence, interface craft critique, SwiftUI planning and scaffolding, research context, shadcn registry output, MCP tools, and installable skill packages before they edit a product UI.

Use this docs map to avoid treating the README as a dumping ground. The root README should convert npm visitors; these docs should carry the deeper workflows.

## Fastest proof

```bash
npm i -g @memi-design/cli
memi agent brief . --intent "Improve this interface" --json
memi diagnose
memi ux audit --json
memi craft audit --json
memi tokens --from ./src --report
memi shadcn export --out public/r
memi agent install universal --project .
memi mcp start --no-figma
```

## Core docs

| Doc | Use it for |
| --- | --- |
| [Interface Understanding](./INTERFACE_UNDERSTANDING.md) | Full evidence loop across code, routes, screenshots, tokens, Figma, research, UX audits, and specs. |
| [Agent Stacks](./AGENT_STACKS.md) | ECC-style AGENTS.md workflows, Hermes, OpenClaw, Codex, Claude Code, Cursor, OpenCode, MCP, and Agent Skills installs. |
| [iOS and SwiftUI](./IOS_SWIFT.md) | Apple-platform briefs, safe SwiftUI scaffolds, Liquid Glass availability, and Xcode proof. |
| [Agent Recipes](./AGENT_RECIPES.md) | Copy-paste setup commands and prompts for each agent surface. |
| [Public Repos](./PUBLIC_REPOS.md) | design-sandbox, repo topics, hashtags, and distribution surfaces. |
| [v2 Package Positioning](./V2_PACKAGE_POSITIONING.md) | Category definition, package-quality bar, growth loops, and message hierarchy. |
| [Growth to 1M NPM](./GROWTH_TO_1M_NPM.md) | Operating plan for distribution, metrics, and weekly download growth. |
| [Release Gates](./RELEASE_GATES.md) | Local publish-ready and post-publish checks. |
| [Proof](./PROOF.md) | No-Figma proof examples and evidence artifacts. |
| [Launch](./LAUNCH.md) | Product Hunt and public launch copy. |
| [MCP Registry](./OFFICIAL_MCP_REGISTRY.md) | Registry submission and verification notes. |

## Main workflows

### Existing app to evidence

```bash
memi diagnose .
memi diagnose http://localhost:3000
memi agent brief http://localhost:3000 --intent "Improve this route" --json
memi ux audit . --json
memi craft audit . --json
memi tokens --from ./src --save --report
```

Use this when a team is code-first and not starting in Figma. Memoire extracts Tailwind classes, CSS variables, modes, aliases, repeated literals, shadcn usage, routes, accessibility risk, UX tenets, UI trap signals, and interface craft dimensions.

### Evidence to registry

```bash
memi shadcn doctor
memi shadcn export --out public/r
memi publish --name @you/ds
memi add Button --from @you/ds
```

Use this when the team wants installable shadcn registry files for shadcn, v0, npm, GitHub, static hosting, or downstream AI editors.

### Agent setup

```bash
memi suite init --project .
memi daemon start --project . --port auto
memi agent brief . --intent "Prepare this repo for design-agent work" --json
memi agent install --dry-run --json
memi agent install universal --project .
npx skills add memi-design/memi --skill memoire-design-tooling
```

Use this before Codex, Claude Code, Cursor, OpenCode, Hermes, OpenClaw, or `.agents/skills` compatible agents make broad frontend changes.

### Public proof sandbox

```bash
git clone https://github.com/memi-design/design-sandbox.git
cd design-sandbox
pnpm install
pnpm memi:agent
pnpm memi:diagnose
pnpm memi:ux
pnpm verify
```

Use this when someone asks for a real repo that shows memi, MCP, Agent Skills, shadcn, Tailwind, and UX audits working together.

### Research-backed design

```bash
memi research synthesize
memi simulate plan --hypothesis "Evidence-linked acceptance criteria reduce launch risk" --json
memi research design --intent "Design an evidence-backed planning board" --json
memi research design --write-specs --mermaid-jam --json
```

Use this when product changes should be grounded in interviews, survey data, support notes, competitive research, or scenario simulations.

## Package surfaces

| Surface | Source of truth |
| --- | --- |
| npm package page | [`../README.md`](../README.md) |
| CLI and MCP runtime | `src/`, `dist/`, [`../server.json`](../server.json) |
| Universal Agent Skills package | [`../skills/memoire-design-tooling/SKILL.md`](../skills/memoire-design-tooling/SKILL.md) |
| Agent kit templates | [`../agent-kits`](../agent-kits) |
| Codex plugin | [`../plugins/memoire`](../plugins/memoire) and [Codex plugin docs](./CODEX_PLUGIN.md) |
| Example registries | [`../examples/README.md`](../examples/README.md) |
| Launch and growth operations | [Launch](./LAUNCH.md), [Growth to 1M NPM](./GROWTH_TO_1M_NPM.md), [Metrics](./METRICS.md) |

## Documentation rules

- Keep the root README focused on npm conversion and first-run proof.
- Put agent-specific instructions in [Agent Stacks](./AGENT_STACKS.md) and [Agent Recipes](./AGENT_RECIPES.md).
- Put broad strategy in [v2 Package Positioning](./V2_PACKAGE_POSITIONING.md) and [Growth to 1M NPM](./GROWTH_TO_1M_NPM.md).
- Keep release claims tied to commands in [Release Gates](./RELEASE_GATES.md).
- Prefer commands that run without Figma first; add Figma as an upgrade path, not a prerequisite.
