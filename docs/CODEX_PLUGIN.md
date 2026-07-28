# memi Codex Plugin

memi is available to Codex in two public install paths: a Git-backed Codex marketplace for plugin discovery, and an npm-native installer for users who already have `memi`.

Public page: https://www.memoire.cv/codex-plugin

## Git-backed Codex marketplace

```bash
codex plugin marketplace add memi-design/memi --ref main --sparse .agents/plugins --sparse plugins/memoire
```

Then open `/plugins` in Codex and install memi from the marketplace list.

This sparse checkout exposes only the marketplace metadata and the plugin package:

- `.agents/plugins/marketplace.json`
- `plugins/memoire/.codex-plugin/plugin.json`
- `plugins/memoire/.mcp.json`
- `plugins/memoire/skills/memoire-design-tooling/SKILL.md`

## npm-native Codex plugin install

```bash
npm i -g @memi-design/cli
memi agent install codex-plugin
```

This installs the same plugin into `~/plugins/memoire` and writes `~/.agents/plugins/marketplace.json`.

## What Codex gets

- The `memoire-design-tooling` skill for UI design, Figma, design systems, Tailwind, shadcn/ui, Atomic Design, research synthesis, specs, audits, and design-to-code work.
- MCP wiring for `memi mcp start --no-figma`, which keeps the default plugin path safe for headless discovery.
- Optional Figma support through `memi connect` or REST env vars such as `FIGMA_TOKEN` and `FIGMA_FILE_KEY`.

## Store readiness

- Privacy policy: https://www.memoire.cv/privacy
- Terms of service: https://www.memoire.cv/terms
- Plugin metadata: `plugins/memoire/.codex-plugin/plugin.json`
- Smoke test: `npm run smoke:codex-plugin`
