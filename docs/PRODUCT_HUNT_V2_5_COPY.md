# Historical Product Hunt v2.5 Update Copy

This file is retained as historical launch copy. Do not use it as current
release guidance. Use [CURRENT_RELEASE.md](./CURRENT_RELEASE.md).

Use this after npm `2.5.0`, MCP Registry `2.5.0`, Codex Marketplace status, and the website proof pages are live.

## Major Update Answer

```text
Yes. The original memi launch was a v1 product-design workbench. v2.5 is now an agent design CI layer for AI coding agents.

What changed:
- memi is an npm CLI, MCP server, Codex plugin, Claude/Cursor/Grok-compatible agent kit, and GitHub Action, not just a macOS app.
- Agents can run deterministic UI diagnosis, UX tenet audits, interface-craft audits, Tailwind token extraction, and shadcn registry export before editing UI.
- v2.5 adds compact design-agent briefs and spec-first file scaffolds, so agents can preview Atomic Design component/page files before writing.
- The MCP server exposes approval-gated tools like scaffold_agent_design_files, plus design-system memory, token, shadcn, research, and audit tools.
- The GitHub Action can gate PRs with SARIF annotations and no LLM in enforcement.
- The macOS Studio is now the companion workbench for supervised Codex and Claude Code runs with receipts and Figma/FigJam handoff.

This is a major change in product surface, install path, and audience: from a standalone workbench to infrastructure agents install before serious frontend work.
```

## Tagline

```text
Agent design CI for AI coding agents
```

## Short Description

```text
memi gives Codex, Claude, Cursor, Grok, and MCP clients design-system memory before they edit UI: deterministic UX audits, Tailwind token extraction, shadcn registry context, compact design-agent briefs, and spec-first file scaffolds.
```

## Maker Comment

```text
I rebuilt memi around the problem I kept hitting with coding agents: they can change UI quickly, but they usually start without enough interface context.

v2.5 makes memi an agent design CI layer:

npm i -g @memi-design/cli
memi agent brief . --detail compact --json
memi diagnose . --json
memi ux audit . --json
memi craft audit . --json
memi scaffold component EvidenceCard --level organism --json
memi mcp start --no-figma

The new scaffold flow is spec-first. Agents preview an Atomic Design component or page plan before writing. The MCP write path is approval-gated, and code generation still runs through memi's quality gates.

The macOS app still exists, but the bigger change is distribution: npm, MCP Registry, Codex plugin, Claude/Cursor/Grok agent kits, shadcn-compatible registries, and a GitHub Action that gates PRs without using an LLM for enforcement.

The goal is simple: before an agent changes product UI, it should know the tokens, components, UX risks, route structure, and file-creation plan.
```

## Proof Links

- npm: `https://www.npmjs.com/package/@memi-design/cli`
- GitHub: `https://github.com/sarveshsea/memi`
- MCP Registry: `io.github.sarveshsea/memi`
- Codex plugin page: `https://www.memoire.cv/codex-plugin`
- Runnable proof repo: `https://github.com/sarveshsea/design-sandbox`
