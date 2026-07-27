# Historical Site and GitHub Handoff

This file is retained as the earlier `v2.5` site handoff snapshot.

Do not use it as the current website release checklist. Current release truth lives in:

- [release-manifest.json](../release-manifest.json)
- [CURRENT_RELEASE.md](./CURRENT_RELEASE.md)
- [RELEASE_GATES.md](./RELEASE_GATES.md)
- [current audit](./audits/memi-design-engineering-audit-2026-07-26.md)

These are the external-surface updates for the v2.5 agent-design-CI Product Hunt recovery launch.

## GitHub Repo Metadata

- Description: `Agent design CI for Codex, Claude, Cursor, Grok, and MCP clients: compact design briefs, deterministic UI audits, token checks, and spec-first file scaffolds before agents edit UI.`
- Topics: `ai-workbench`, `product-design`, `codex`, `claude-code`, `mcp-server`, `figma`, `figjam`, `design-system`, `design-memory`, `tailwind-audit`, `shadcn`, `ui-quality`

## Homepage Hero

- Heading: `memi is agent design CI for AI coding agents.`
- Subhead: `Run Codex, Claude, Cursor, Grok, and MCP clients with compact design briefs, deterministic UI audits, token checks, and spec-first file scaffolds.`
- Primary CTA: `https://www.npmjs.com/package/@memi-design/cli`
- Secondary CTA: `https://www.npmjs.com/package/@memi-design/cli`
- Proof line after npm publish: `Open source · Apple-signed by Humyn LLC · Studio 2.4.0 · npm latest 2.5.0`

## Product Hunt Surface

- Product: `memi`
- Tagline: `Agent design CI for AI coding agents`
- Description: `Agent design CI for Codex, Claude, Cursor, Grok, and MCP clients: compact design briefs, deterministic UI audits, token checks, and spec-first file scaffolds.`
- CTA: `https://www.memoire.cv`

## Docs Landing

- Lead with Studio setup and download.
- Put CLI/MCP setup directly below as the engine path:

```bash
npm i -g @memi-design/cli
memi diagnose
memi ux audit --json
memi craft audit --json
memi mcp start --no-figma
```

- Keep shadcn registry, Notes, simulation, and advanced agents below the first product story.

## Release Checklist

- Published `@memi-design/cli@2.5.0`.
- Verify `npm run check:public-release`.
- Published `server.json` to the MCP Registry as `io.github.sarveshsea/memi@2.5.0`.
- Created GitHub tag/release `v2.5.0`.
- Confirm the homepage shows Studio `2.4.0`, Homebrew cask `2.4.0`, and npm `2.5.0`.
- Confirm no first-fold public install path points to deprecated package or repo names.
