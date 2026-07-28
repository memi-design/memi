# memi skill references and dependencies

Strong dependencies beat weak reinvention. Load these when the task needs more than memi's evidence layer.

## Core memi surfaces

| Surface | Install / URL | Role |
| --- | --- | --- |
| CLI + MCP | `npm i -g @memi-design/cli` · `memi mcp start --no-figma` | Evidence, tokens, audits, 40+ MCP tools |
| Agent kits | `memi agent install grok-build --project .` | `.grok/config.toml` + skills + `memoire.agent.yaml` |
| Universal skills | `npx skills add memi-design/memi --skill memoire-design-tooling` | skills.sh / Agent Skills ecosystem |
| GitHub Action | `uses: memi-design/memi@v2` | Deterministic design CI gate |
| Proof repo | [memi-design/design-sandbox](https://github.com/memi-design/design-sandbox) | Runnable Next.js + Tailwind + shadcn reference |
| Homepage | [memoire.cv](https://memoire.cv) | Product + docs |

## Craft and motion (upstream patterns)

memi owns **product-system memory** (what exists, what is broken, what CI will gate). For animation taste and design-engineering polish, depend on proven upstream skills rather than copying them:

| Package | Install | Use when |
| --- | --- | --- |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) | `npx skills add emilkowalski/skills` | Animation decisions, review-animations, Apple-style motion, design-eng taste |
| [animations.dev](https://animations.dev/) | Course / essays | Deep motion craft behind those skills |

Pattern borrowed (adapted, not copied): focused `SKILL.md` + companion reference file, agent-first install via `npx skills`, clear "when to use" descriptions, and explicit cross-links.

## Grok Build native discovery

Per [xAI skills docs](https://docs.x.ai/build/features/skills-plugins-marketplaces):

- Skills: `./.grok/skills/`, `~/.grok/skills/`, plugins, `[skills] paths`
- MCP: `./.grok/config.toml` (`[mcp_servers.*]`), plus Claude/Cursor `.mcp.json` compat
- Instructions: `AGENTS.md` family + Claude instruction files

## Recommended stack for a design-heavy repo

```bash
npm i -g @memi-design/cli
memi agent install grok-build --project .
npx skills add memi-design/memi --skill memoire-design-tooling
npx skills add emilkowalski/skills
# optional Cursor/Claude MCP mirrors
memi agent install cursor --project .
memi agent install claude-code --project .
```

Order of operations for UI work:

1. **memi brief + diagnose/ux/craft/tokens** — system evidence
2. **emilkowalski craft skills** — motion/taste decisions on the patch
3. **memi ci / Action** — deterministic gate before merge
