# Public Repos And Distribution Surfaces

memi v2 needs public proof repos, not only package claims. Use this file to keep npm, GitHub, MCP, Agent Skills, Codex plugin, and example repos aligned.

For the dated 2.8 Trust Core compatibility boundary, including repositories that
remain independently gated, see the [organization compatibility
inventory](trust/ORG_COMPATIBILITY.md).

## Primary repos

| Repo | Role | Public promise |
| --- | --- | --- |
| [`memi-design/memi`](https://github.com/memi-design/memi) | Engine, CLI, MCP server, Agent Skills, Codex plugin, examples, release gates | Memi is the design layer for agentic AI. |
| [`memi-design/design-sandbox`](https://github.com/memi-design/design-sandbox) | Proof workspace | memi-ready Next.js, Tailwind, shadcn, MCP, and Agent Skills sandbox for design-to-code exploration. |
| [`memi-design/memi-studio`](https://github.com/memi-design/memi-studio) | macOS workbench | Supervised Codex and Claude Code runs with project memory, receipts, artifacts, and Figma/FigJam handoff. |
| [`sarveshsea/memoire-agent-skills`](https://github.com/sarveshsea/memoire-agent-skills) | Skill mirror | Mirror-ready Hermes/OpenClaw skill packages generated from the npm engine. |
| [`memi-design/design-skills`](https://github.com/memi-design/design-skills) | Design Skills and Community Notes | Mémoire's complete design-skill corpus plus licensed, attributed adaptations for Agent Skills and the Notes marketplace. |
| [`memi-design/audit-frontend-design`](https://github.com/memi-design/audit-frontend-design) | Focused Agent Skill | One-command, evidence-backed frontend design audits. |
| [`memi-design/remember-design-system`](https://github.com/memi-design/remember-design-system) | Focused Agent Skill | Compact repository design-system context before agents edit UI. |
| [`memi-design/enforce-design-ci`](https://github.com/memi-design/enforce-design-ci) | Focused Agent Skill | Deterministic design regression gates for pull requests. |
| [`memi-design/chatbot`](https://github.com/memi-design/chatbot) | Maintained proof fork | Vercel Chatbot with a committed Memi policy, Agent Skill, GitHub Action, and measured 88/100 baseline. |

## GitHub descriptions

`memi-design/memi`:

```text
Memi is the design layer for agentic AI.
```

`memi-design/design-sandbox`:

```text
memi-ready Next.js, Tailwind, shadcn, MCP, and Agent Skills sandbox for interface understanding and design-to-code exploration.
```

`memi-design/memi-studio`:

```text
Agent design CI for Codex, Claude, Cursor, Grok, and MCP clients: compact design briefs, UI audits, token checks, and spec-first scaffolds.
```

`memi-design/design-skills`:

```text
Practical design judgment for AI coding agents: 78 installable skills for craft, research, generation, Figma, and Mémoire workflows.
```

Use these topics on `memi-design/design-skills`:

```text
agent-skills
design-engineering
design-systems
ui-design
ux-design
figma
animation
typography
accessibility
ai-coding-agents
memoire
```

## Topics

Use these topics on `memi-design/memi`:

```text
interface-understanding
design-systems
ai-coding-agents
shadcn-registry
tailwindcss
mcp-server
agent-skills
codex-plugin
ux-audit
figma-to-code
design-engineering
design-tokens
```

Use these topics on `memi-design/design-sandbox`:

```text
interface-understanding
design-systems
ai-coding-agents
shadcn
tailwindcss
mcp
agent-skills
codex
claude-code
ux-audit
figma-to-code
design-engineering
nextjs
```

## Public hashtags

```text
#InterfaceUnderstanding #DesignSystems #AICodingAgents #shadcn #TailwindCSS #MCP #AgentSkills #Codex #ClaudeCode #UXAudit #FigmaToCode #DesignEngineering
```

## Proof commands

For `memi-design/memi`:

```bash
npm i -g @memi-design/cli
memi diagnose
memi ux audit --json
memi craft audit --json
memi tokens --from ./src --report
memi shadcn export --out public/r
memi agent install universal --project .
memi mcp start --no-figma
```

For `memi-design/design-sandbox`:

```bash
pnpm install
pnpm memi:agent
pnpm memi:diagnose
pnpm memi:ux
pnpm memi:tokens
pnpm verify
```

## Architecture and cost positioning

- Start code-first; Figma is optional.
- Keep MCP local by default with `memi mcp start --no-figma`.
- Keep first-run proof free of model calls: diagnosis, UX audit, token extraction, registry export, and no-hex checks can run locally.
- Treat agent model usage, Figma API calls, browser automation, video generation, and extra packages as explicit upgrades.
- Use `memi agent install --dry-run --json` before writing skill or MCP files in public repos.

## Compatibility package story

| Surface | Package or file | Why it matters |
| --- | --- | --- |
| npm | `@memi-design/cli` | Main install and binary. |
| MCP | `server.json` + `memi mcp start --no-figma` | Registry-safe design tools. |
| Agent Skills | `skills/memoire-design-tooling/SKILL.md` | Standard skill ecosystem install. |
| Codex plugin | `plugins/memoire` | `/plugins` install path and MCP wiring. |
| Hermes/OpenClaw | `agent-kits/mirror` | Mirror-ready skill packages. |
| Design sandbox | `.agents/skills`, `.mcp.json`, `memoire.agent.yaml` | Public repo that proves integration. |
| Community Notes | `notes/<note-name>/note.json` | Reviewed downloadable Notes catalog at `/notes/community/catalog.v1.json`. |
| GitHub Action | `memi-design/memi@ee3f3f00731a7a08c7616d4dfb14440165a86354` | Immutable action commit for v2.6.2 with pinned third-party actions, SARIF, and design-health artifacts. |
| shadcn registry | `https://memoire.cv/r/design-ci.json` | Installs the workflow and recommended policy with `npx shadcn add`. |

## Live interoperability proposals

These issue-first proposals follow each upstream repository's contribution policy:

- [`southleft/design-systems-mcp#12`](https://github.com/southleft/design-systems-mcp/issues/12): compact category manifest for deterministic MCP clients.
- [`onlook-dev/onlook#3128`](https://github.com/onlook-dev/onlook/issues/3128): local project design context for external coding agents.
- [`CopilotKit/CopilotKit#5991`](https://github.com/CopilotKit/CopilotKit/issues/5991): document MCP Apps versus non-mutating context servers.

Do not open implementation pull requests until maintainers confirm the proposed surface. The Memi-side design-systems adapter and `design_systems_context` MCP tool are already implemented and tested.

## Next public repo targets

Add memi proof links where they are natural and honest:

- Design-system starter repos that already use shadcn/Tailwind.
- Internal-tool templates.
- AI chat UI templates.
- Dashboard/admin templates.
- Product-design agent examples.
- MCP client examples.
- Agent Skills directories.

Do not spam unrelated repos. Each link should include a runnable command and a reason memi improves the local design workflow.

## 10x seeding queue

Start with surfaces we control, then move outward only when the target accepts installable tools, registries, MCP servers, skills, or templates.

| Priority | Surface | Action | Proof to include |
| --- | --- | --- | --- |
| P0 | `memoire.cv` | Keep docs, changelog, footer, downloads, and `/notes/community/catalog.v1.json` synchronized with npm and Studio. | `npm run check:public-release` |
| P0 | `memi-design/design-sandbox` | Refresh the sandbox so it proves the 2.3 mandate loop, not only older diagnose/token commands. | `pnpm memi:agent && pnpm verify` |
| P0 | `sarveshsea/memoire-community-notes` | Keep the five starter Notes published and linked from the website catalog. | `npm run check:community-notes && npm run build:community-notes-catalog` |
| P1 | MCP Registry and MCP directories | Submit or refresh `io.github.memi-design/memi` as the local design-system MCP server for coding agents. | `memi mcp start --no-figma` |
| P1 | Agent Skills directories | Submit `memoire-design-tooling` as the design-system memory skill for Codex, Claude Code, Cursor, and OpenCode. | `npx skills add memi-design/memi --skill memoire-design-tooling` |
| P1 | shadcn registry directories | Add memi as a registry-quality and design-audit companion for GitHub registries. | `memi shadcn export --out public/r` |
| P2 | AI UI templates | Add memi to templates that already ship Tailwind/shadcn agent interfaces. | `memi craft audit --json` |
| P2 | Dashboard/admin templates | Add memi as a CI design gate where token drift and visual regressions matter. | `memi ci` |
| P2 | Product-design agent examples | Add memi Studio plus CLI proof for project memory, receipts, and Figma/FigJam handoff. | `memi report --badge` |

Good external candidates are directories and repos already organized around these categories:

- MCP Registry and community MCP server directories.
- shadcn open registry index and registry-template examples.
- Agent Skills directories and `npx skills` ecosystem repos.
- Awesome shadcn, AI UI, dashboard, and agent UI template lists.

Each submission should include one sentence of positioning, one install command, one proof command, and one link to a public artifact. If that cannot be done, skip the target.
