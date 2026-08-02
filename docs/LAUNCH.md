# Historical memi Product Hunt Launch Pack

This file is retained as historical `v2.5` launch copy.

Do not use it as the current release source of truth. Current release truth lives in:

- [README.md](../README.md)
- [CURRENT_RELEASE.md](./CURRENT_RELEASE.md)
- [RELEASE_GATES.md](./RELEASE_GATES.md)
- [METRICS.md](./METRICS.md)
- [100-point closure plan](./audits/memi-100-closure-plan-2026-07-26.md)

Use one message everywhere for the current `2.5.x` launch:

> memi is agent design CI for AI coding agents. Run Codex, Claude, Cursor, Grok, and MCP clients with compact design briefs, deterministic UI audits, token checks, and spec-first file scaffolds.

Primary CTA: <https://www.memoire.cv>

## Launch Baseline

- Product Hunt story: agent design CI first, with Studio as the companion workbench proof.
- Release target: `@memi-design/cli@2.5.0`.
- Studio download: `memi-studio v2.4.0` signed macOS companion app from GitHub Releases.
- Homebrew: `brew install --cask memi-design/memi/memi-studio`.
- MCP Registry: `io.github.memi-design/memi`.
- Codex plugin: `codex plugin marketplace add memi-design/memi --ref main --sparse .agents/plugins --sparse plugins/memoire`.
- Public proof repo: `https://github.com/memi-design/design-sandbox`.

## Product Hunt Copy

Name:

```text
memi
```

Tagline:

```text
Agent design CI for AI coding agents
```

Description:

```text
Agent design CI for Codex, Claude, Cursor, Grok, and MCP clients: compact design briefs, deterministic UI audits, Tailwind token extraction, shadcn registry context, and spec-first file scaffolds before agents edit UI.
```

Maker comment:

```text
I built memi because product-design agent runs kept losing the thread: the code agent had one context, Figma had another, project decisions lived in markdown, and useful output disappeared into chat history.

memi v2.5 is now an agent design CI layer for running Codex, Claude, Cursor, Grok, and MCP clients with the product system already attached: compact design briefs, design tokens, specs, research, audits, scaffold plans, Figma/FigJam handoff, run receipts, logs, and artifacts.

The npm package is still the engine underneath:
npm i -g @memi-design/cli
memi diagnose
memi ux audit --json
memi craft audit --json
memi mcp start --no-figma

Try the proof repo:
git clone https://github.com/memi-design/design-sandbox.git
cd design-sandbox
pnpm install
pnpm memi:diagnose
pnpm memi:ux
pnpm verify

Today’s launch is the agent design CI story: before an AI coding agent edits UI, it should know the product system, see the risks, and show the file-creation plan.
```

## Social Posts

### Main Launch

```text
Launching memi today.

It is an agent design CI layer for AI coding agents: compact design briefs, deterministic UI audits, token checks, MCP tools, and spec-first scaffolds before Codex, Claude, Cursor, or Grok edits UI.

Download:
https://www.memoire.cv
```

### Engine Underneath

```text
memi Studio is the workbench.
@memi-design/cli is the engine underneath.

npm i -g @memi-design/cli
memi diagnose
memi ux audit --json
memi craft audit --json
memi mcp start --no-figma

The goal: agents start from the product system, not a blank prompt.

Proof repo:
https://github.com/memi-design/design-sandbox
```

### Codex / Claude

```text
Codex and Claude Code are powerful, but product-design work needs receipts:

- what context was loaded
- what files changed
- what design memory was used
- what artifacts came out
- what should be preserved

That is the surface memi Studio gives you.
```

### Figma / FigJam

```text
Figma stays contextual in memi.

Connect it when the run needs design source, pull tokens/components/screenshots, and export local Mermaid or FigJam-ready planning source before external sync.

The handoff remains inspectable.
```

## Competitive Positioning

- Prompt-to-UI tools help create the first pass.
- Coding agents help modify the product.
- memi is for supervised product-design agent work: memory, receipts, artifacts, Figma context, and reusable design-system evidence.

## Launch Checklist

- [ ] Publish `@memi-design/cli@2.5.0`.
- [ ] Verify npm install smoke with `npm run check:public-release`.
- [ ] Republish `server.json` to the MCP Registry after auth refresh.
- [ ] Create GitHub tag/release `v2.5.0`.
- [x] Push and verify `memi-design/design-sandbox`.
- [ ] Confirm homepage shows npm latest `2.5.0`, Studio `2.4.0`, and the macOS download after publish.
- [ ] Submit Product Hunt with the exact name, tagline, description, and CTA above.
- [ ] Post the main launch thread and one engine-underneath reply.
