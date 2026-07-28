# memi Agent Skills

Mirror-ready `SKILL.md` packages for `sarveshsea/memoire-agent-skills`. Copy this folder into that repo to make memi discoverable to Hermes agents, OpenClaw bots, ClawHub users, and any agent runtime that understands local `SKILL.md` folders. The npm package also ships a root `skills/memoire-design-tooling/SKILL.md` for `npx skills add memi-design/memi --skill memoire-design-tooling`.

memi gives agents a local interface-understanding layer: warmed daemon context, `memoire.agent.yaml` suite recipes, Figma bridge context, project memory, user research notes, UX tenets and traps, interface craft critique, Atomic Design specs, shadcn/ui codegen, Tailwind token diagnostics, and evidence-backed UI audits.

## Install

```bash
npm i -g @memi-design/cli
memi suite init --project .
memi daemon start --project . --port auto
memi daemon status --json
memi diagnose .
memi ux audit . --json
memi craft audit . --json
memi tokens --from ./src --report
memi shadcn export --out public/r

# Universal Agent Skills package
memi agent install universal --project .

# Hermes local skill
memi agent install hermes

# OpenClaw workspace skill
memi agent install openclaw --project .

# Figma-independent MCP inspection path for registries and agents
memi mcp start --no-figma
```

## Direct skill locations

```bash
# Hermes
~/.hermes/skills/memoire/memoire-design-tooling/SKILL.md

# OpenClaw
<workspace>/skills/memoire/memoire-design-tooling/SKILL.md
```

## Included skills

- `hermes/memoire-design-tooling/SKILL.md`
- `openclaw/memoire-design-tooling/SKILL.md`

## Why this matters

- Hermes can load `memoire-design-tooling` as a native skill when users ask for UI design, Figma, shadcn/ui, Tailwind, design-system audits, or research synthesis.
- OpenClaw can discover the workspace skill from `skills/memoire/memoire-design-tooling/SKILL.md`, including metadata that requires the `memi` binary and points users to npm installation.
- ECC-style `AGENTS.md` repos can use the universal `.agents/skills` target as the UI audit and design-evidence rule before frontend changes.
- `memoire.agent.yaml` gives agents a shared YAML contract for memory sources, harnesses, skills, and product-team recipes.
- The shared daemon warms markdown/YAML knowledge, project memory, harness metadata, MCP tools, and agent-kit install plans once per workspace.
- ClawHub/Hermes listing pages can point to this repo while the npm package remains the canonical installer for all agent targets.

## Source

This mirror is generated from `@memi-design/cli`. Keep the npm package as the source of truth, then copy this folder into `sarveshsea/memoire-agent-skills` for external agent-skill discovery.
