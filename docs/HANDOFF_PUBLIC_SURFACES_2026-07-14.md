# Historical Memi v2.5 Public Surface Handoff

This dated handoff is retained as historical evidence and its local paths are
not current operating instructions. Use [CURRENT_RELEASE.md](./CURRENT_RELEASE.md)
and [RELEASE_GATES.md](./RELEASE_GATES.md) for present release work.

Updated: 2026-07-14

## Source Of Truth

- Package repo: `/Users/sarveshchidambaram/Documents/Codex/2026-07-08/memi-public-sync/memi`
- Website repo: `/Users/sarveshchidambaram/Documents/Codex/2026-07-08/memi-public-sync/memoire-web`
- Stale archived checkout: `/Users/sarveshchidambaram/Desktop/Projects/Other/ark` resolves to an older `2.3.1` branch. Do not use it for release work unless deliberately cherry-picking.
- Older v1 checkout: `/Volumes/ExtremeSSD/Projects/_archive/Desktop-Projects-20260512/Memoire/memi`. Do not use for v2.5 release work.

## Current Public Facts

- npm package: `@memi-design/cli`
- Current public npm version before v2.5 publish: `2.4.1`
- v2.5 local target: `2.5.0`
- npm downloads as of 2026-07-14: about `750/week` and `2,049/month`; the 10x checkpoint is `7,500+/week` from the current baseline, and the long-term target is `1,000,000/week`.
- GitHub repo: `https://github.com/sarveshsea/memi`
- MCP Registry name: `io.github.sarveshsea/memi`
- MCP Registry public state before v2.5 publish: active at `2.4.1`
- Public site: `https://www.memoire.cv`
- Codex plugin page target: `https://www.memoire.cv/codex-plugin`
- Codex Marketplace state: submitted/queued previously; must be rechecked after the text-only plugin and v2.5 manifest changes.
- Product Hunt status: another update launch was rejected as not sufficiently major. Treat this as a public proof and positioning failure, not proof that the npm/MCP product is weak.

## What v2.5 Changes

- Lead with agent design CI: compact preflight, deterministic audits, spec-first scaffolds, MCP tools, and Action gate.
- Add `memi scaffold component|page` for dry-run Atomic Design file plans.
- Add MCP `scaffold_agent_design_files`, approval-gated with `approved=true` for writes.
- Add compact design-agent briefs with `--detail compact`.
- Keep Studio/macOS as a companion proof surface for supervised Codex and Claude Code runs.

## Public Surfaces To Keep In Sync

| Surface | Expected v2.5 state |
| --- | --- |
| npm | `@memi-design/cli@2.5.0` |
| GitHub release | `v2.5.0` with release notes and all binary assets if binaries are cut |
| MCP Registry | `io.github.sarveshsea/memi@2.5.0` |
| `server.json` | version and npm package version `2.5.0` |
| MCPB | `.dist/memi-2.5.0.mcpb` |
| Codex plugin | `plugins/memoire/.codex-plugin/plugin.json` at `2.5.0`, text-only assets |
| Claude plugin | `plugins/memi-claude/.claude-plugin/plugin.json` at `2.5.0` |
| GitHub Action | `action.yml` default `version: "2.5.0"` |
| README and `llms.txt` | mention compact briefs, `memi scaffold`, and `scaffold_agent_design_files` |
| Website | homepage and docs must say agent design CI and expose `/codex-plugin`, `/mcp`, `/skills`, `/design-ci`, `/product-hunt-update` |
| Product Hunt | explain the jump from v1 Product Hunt launch to v2.5 agent design CI |

## Known Public Gaps Before Relaunch

- The live website had been Studio-first and under-explained npm/MCP/Codex.
- `/codex-plugin` previously returned 404 even though docs and plugin manifests linked to it.
- `npm run check:public-release` previously failed because the live site docs/changelog did not mention the current CLI release.
- Some launch docs still carried older `2.4.0` or Studio-first copy; v2.5 work must keep those cleaned.
- Homebrew Studio cask may still lag the Studio release and should not be used as proof for the npm/MCP release unless updated.

## Handoff Prompt

```text
You are taking over Memi/Memoire public launch recovery. Work from:
- Package repo: /Users/sarveshchidambaram/Documents/Codex/2026-07-08/memi-public-sync/memi
- Website repo: /Users/sarveshchidambaram/Documents/Codex/2026-07-08/memi-public-sync/memoire-web

Goal: ship Memi v2.5.0 as an agent design CI release that Product Hunt, npm users, MCP users, and Codex Marketplace reviewers can understand immediately.

Current public facts:
- npm package @memi-design/cli is live at 2.4.1 until v2.5.0 is published.
- npm downloads are pre-growth: about 750/week and 2,049/month as of 2026-07-14.
- GitHub release v2.4.1 has darwin-arm64, darwin-x64, linux-x64, win-x64, and SHA256SUMS assets.
- MCP Registry is active for io.github.sarveshsea/memi at 2.4.1 until v2.5.0 is published.
- Codex Marketplace submission exists but must be rechecked after the binary-asset fix and v2.5 manifest update.
- Public site must lead with agent design CI and must not 404 at /codex-plugin.

Do not relaunch Product Hunt until:
- memoire.cv has first-class pages for /codex-plugin, /mcp, /skills, /design-ci, and /product-hunt-update.
- npm, GitHub release notes, MCP registry, Codex plugin manifest, Claude plugin manifest, mcpb manifest, action.yml, README, docs, and site all agree on v2.5.0.
- public release gate passes after deploy.
- Product Hunt copy explains the jump from the old v1 launch to v2.5.0 clearly.
```

## Verification Commands

Package repo:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run check:release
npm run smoke:mcp
npm run smoke:codex-plugin
SKIP_SITE_SMOKE=1 SKIP_INSTALL_SMOKE=1 npm run check:public-release
node scripts/growth-status.mjs --json
npm pack --dry-run --json
```

Website repo:

```bash
npm test
npm run build
for path in / /codex-plugin /mcp /skills /design-ci /product-hunt-update; do curl -I "http://localhost:4321$path"; done
```

After publish/deploy:

```bash
npm view @memi-design/cli version mcpName --json
curl -L https://www.memoire.cv/codex-plugin
npm run check:public-release
```
