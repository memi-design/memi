# Historical Growth To 1M Weekly NPM Downloads

This file is retained as a historical growth brainstorm from the `v2.5`
transition. Do not use it as the current growth contract. Use
[CURRENT_RELEASE.md](./CURRENT_RELEASE.md), [METRICS.md](./METRICS.md), and the
[current audit](./audits/memi-design-engineering-audit-2026-07-26.md).

Updated: 2026-07-09

## North Star

Get `@memi-design/cli` to 1,000,000 weekly npm downloads by making memi the default package agents install before serious frontend work.

The category is **interface understanding for AI coding agents**: design-system memory, UX audit evidence, user research context, shadcn registry output, and MCP/skills distribution for the product stack.

## Current truth

- Source package release candidate is `@memi-design/cli@2.5.0`.
- Public npm latest remains `2.4.1` until the one-line npm publish command is run.
- npm downloads for the latest complete windows: 46 last-day downloads for 2026-07-05, 783 last-week downloads for 2026-06-29 through 2026-07-05, and 1,306 last-month downloads for 2026-06-06 through 2026-07-05.
- The next 10x checkpoint is 7,830 weekly downloads and 13,060 monthly downloads.
- MCP name is `io.github.sarveshsea/memi`.
- Codex plugin install path is `codex plugin marketplace add sarveshsea/memi --ref main --sparse .agents/plugins --sparse plugins/memoire`.
- Standard Agent Skills install path is `npx skills add sarveshsea/memi --skill memoire-design-tooling`.
- The v2 package story must lead with code-first proof, not Studio-only positioning.
- `memoire.cv` must stay synchronized with npm, Studio, MCP, changelog, and community Notes before any distribution push.
- `sarveshsea/design-sandbox` is the primary public proof repo for memi v2 integration.

Run the live check:

```bash
node scripts/growth-status.mjs --json
npm view @memi-design/cli version dist-tags.latest mcpName --json
```

## Product posture

The package must be understandable in one screen:

```bash
npm i -g @memi-design/cli
memi diagnose
memi ux audit --json
memi craft audit --json
memi tokens --from ./src --report
memi shadcn export --out public/r
```

That is the conversion loop. Everything else should be a follow-on surface:

- Agent kits: `memi agent install --dry-run --json`.
- MCP: `memi mcp start --no-figma`.
- Research: `memi research design --write-specs --mermaid-jam`.
- Studio: supervised Codex and Claude Code workbench using the same engine.
- Figma: optional source of tokens, screenshots, and component context.

## Growth loops

1. **Release correctness**

Keep npm, `server.json`, `memoire.cv`, the community Notes catalog, and the changelog synchronized. Run `npm run check:public-release` after each web deploy and before every new distribution push.

2. **Search wedge**

Use the same phrases across npm, GitHub, docs, and launch posts:

- `interface understanding for AI coding agents`
- `Design-system memory for coding agents`
- `shadcn registry generator`
- `Tailwind token extraction`
- `UX audit for AI agents`
- `MCP server for design systems`
- `Agent Skills design tooling`
- `Codex design-system plugin`
- `Hermes design tooling`
- `ECC UI audit workflow`

3. **Agent-native adoption**

Make every agent stack installable and explainable:

- Universal Agent Skills and `npx skills add`.
- ECC / AGENTS.md workflow guidance.
- Hermes skill package.
- OpenClaw workspace skill.
- Claude Code and Cursor MCP config.
- Codex skill and plugin.
- OpenCode workspace skill.
- Generic MCP clients.

4. **Seeded proof repos and directories**

Seed memi only where the reader can run a command and see value:

- `sarveshsea/design-sandbox`: keep `pnpm verify` proving memi agent install, diagnose, UX audit, token extraction, and shadcn registry output.
- `sarveshsea/memoire-community-notes`: publish the five starter community Notes and keep `/notes/community/catalog.v1.json` non-empty.
- `sarveshsea/memi-studio`: link Studio releases back to the CLI engine, MCP server, and design-audit route.
- MCP Registry and MCP directories: list `io.github.sarveshsea/memi` as the local design-system MCP server for coding agents.
- Agent Skills directories: submit `memoire-design-tooling` with `npx skills add sarveshsea/memi --skill memoire-design-tooling`.
- shadcn registry surfaces: seed examples that show `memi shadcn export --out public/r` and compatible GitHub registry install paths.
- AI UI and dashboard templates: add memi as a design-quality gate where the template already uses Tailwind or shadcn.

5. **Visible outputs**

Ship proof that users can see:

- App-quality reports.
- UX audit reports.
- Token extraction reports.
- shadcn registry JSON.
- Example registry screenshots.
- FigJam-ready Mermaid source.
- Studio run receipts and artifacts.
- `design-sandbox` as a runnable public workspace showing MCP, Agent Skills, shadcn, Tailwind, UX audit, and verification together.

6. **Trust and security**

Keep the package boring where trust matters:

- No npm lifecycle scripts.
- Figma plugin install is explicit.
- Agent kit writes have dry-run JSON.
- MCP has a no-Figma startup path.
- Release gates include production audit and package contents.
- NOTICE and licensing boundaries remain clear.

## Milestone ladder

| Milestone | What must be true |
| --- | --- |
| 1,000 weekly downloads | v2 is published; npm README is clear; clean install smoke passes; first-run commands work. |
| 7,830 weekly downloads | 10x from the 2026-07-08 weekly baseline; MCP Registry, Codex marketplace, Agent Skills, and shadcn examples all agree on the v2 story. |
| 10,000 weekly downloads | At least ten external repos or directories include runnable memi proof, and the public release gate passes after every web deploy. |
| 100,000 weekly downloads | Templates, example registries, agent recipes, and docs are discoverable from npm and GitHub without needing Studio. |
| 1,000,000 weekly downloads | Downstream agents, templates, registries, and design-system docs install `@memi-design/cli` as infrastructure. |

## Weekly scorecard

Track:

- npm weekly downloads for `@memi-design/cli`.
- npm latest version and README phrase.
- GitHub stars, forks, issues, and external links.
- MCP Registry status.
- Agent Skills install success.
- Codex marketplace install success.
- design-sandbox install and `pnpm verify` success.
- Clean temp install smoke success.
- Number of working example registries.
- Number of external docs, templates, or agents pointing to memi.

## Keep the app tidy

Studio should demonstrate the engine and make agent work calmer. It should not replace the npm package story.

- Default story: interface understanding for AI coding agents.
- Default commands: diagnose, UX audit, tokens, shadcn export.
- Default advanced path: agent install, MCP, research design.
- Default Studio path: run Codex or Claude Code with memory, receipts, artifacts, and Figma/FigJam handoff.
