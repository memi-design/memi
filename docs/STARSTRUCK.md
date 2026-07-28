# Historical Starstruck And Distribution Plan

This file is retained as the early-July distribution snapshot.

Do not use it as the current release or growth source of truth. Current planning lives in:

- [CURRENT_RELEASE.md](./CURRENT_RELEASE.md)
- [METRICS.md](./METRICS.md)
- [current audit](./audits/memi-design-engineering-audit-2026-07-26.md)
- [100-point closure plan](./audits/memi-100-closure-plan-2026-07-26.md)

Goal: keep GitHub growth tied to useful memi distribution. The base Starstruck tier was crossed when `sarveshsea/memi` had `17` stars on 2026-07-08; the repository now lives at `memi-design/memi`. The next honest target is sustained npm activation, then the `128` star tier.

## Current Reality

| Surface | Status | Meaning |
| --- | --- | --- |
| GitHub stars | `17` | Starstruck base tier crossed; next visible tier is `128` |
| GitHub description | Updated | `Interface understanding and design-system memory for AI coding agents.` |
| npm release target | `2.5.0` | Local release candidate; npm latest remains `2.4.1` until publish |
| npm downloads | `783` weekly, `1,306` monthly | Latest complete npm windows ending 2026-07-05 |
| 10x npm checkpoint | `7,830` weekly, `13,060` monthly | First growth target from the 2026-07-08 baseline |
| Official MCP Registry | Ready for 2.5.0 refresh | Publish after npm latest is `2.5.0`; current live registry is `2.4.1` |
| `memoire.cv` | Ready for 2.5.0 sync | Public release gate should pass after npm publish and web deploy |
| Open shadcn PRs | `2` | `bytefer/awesome-shadcn-ui#18` plus the fresh `birobirobiro/awesome-shadcn-ui#538` refresh |
| Open MCP PRs | `5` | TensorBlock, YuzeHao2023, MobinX, punkpeye refresh, and toolsdk refresh remain open |

## Star CTA

Use one ask everywhere:

```text
If this saves you from rebuilding the same shadcn/Tailwind system again, star the repo so more frontend teams can find it:
https://github.com/memi-design/memi
```

Do not ask for fake stars, star swaps, or bot engagement. The ask must sit after a demo, install command, or useful directory submission.

## First Move: Seed Proof Repos

After npm publish and MCP Registry refresh, use `io.github.sarveshsea/memi@2.5.0` as the trust link for directory refreshes and proof repos.

Recheck before directory follow-up:

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.sarveshsea/memi"
```

Why this matters: the official registry is a trust anchor for downstream MCP directories and aggregators. Submit or refresh every MCP directory with the same npm/GitHub links.

## Directory Targets

| Priority | Target | Why it matters | Route | Status |
| --- | --- | --- | --- | --- |
| P0 | Official MCP Registry | Trust anchor for downstream MCP aggregators | `mcp-publisher publish server.json` | Ready for 2.5.0 after npm publish |
| P0 | MCP.Directory | Direct MCP discovery surface | `https://mcp.directory/submit` | Ready to refresh with registry proof |
| P0 | Glama | Already indexes Memoire | Claim/update listing after registry refresh | Ready after npm publish |
| P0 | Smithery | Distribution, analytics, and config UI for MCP servers | `https://smithery.ai/servers/sarveshsea/memi` | Public URL release is live against `https://www.memoire.cv/api/mcp` with five remote-safe tools, typed schemas, and optional agent configuration |
| P0 | PulseMCP | MCP discovery and server popularity tracking | Confirm auto-index after official registry | Ready |
| P0 | mcp.so | Large MCP marketplace surface | Submit/refresh after official registry | Submitted: https://github.com/chatmcp/mcpso/issues/1#issuecomment-4920418945 |
| P1 | Agent Skills directories | Agent-native install discovery | `npx skills add memi-design/memi --skill memoire-design-tooling` | Ready |
| P1 | shadcn registry directories | Registry generator audience | PR with `memi shadcn export --out public/r` proof | Raw registry proof live in `design-sandbox`; PR refresh opened |
| P2 | Product Hunt | One-time launch spike | Launch after registry and proof repo are current | Draft only |
| P2 | Show HN | Developer credibility | Post practical demo, not hype | Draft only |
| P2 | Reddit `r/mcp` | Direct MCP audience | Practical setup/demo | Draft only |
| P2 | Reddit `r/shadcn` | Direct registry audience | Registry export demo | Draft only |

## GitHub PR Targets

| Priority | Repo | Stars at audit | Fit | Status |
| --- | --- | ---: | --- | --- |
| P0 | `punkpeye/awesome-mcp-servers` | `85k+` | Largest MCP list | Old entry merged; refresh open: https://github.com/punkpeye/awesome-mcp-servers/pull/9678 |
| P0 | `TensorBlock/awesome-mcp-servers` | `639` | MCP list with developer utility category | Open, requested docs mirror fixed: https://github.com/TensorBlock/awesome-mcp-servers/pull/455 |
| P0 | `YuzeHao2023/Awesome-MCP-Servers` | `1041` | MCP list with development tools category | Open: https://github.com/YuzeHao2023/Awesome-MCP-Servers/pull/208 |
| P0 | `MobinX/awesome-mcp-list` | `878` | Concise MCP list with developer tools category | Open: https://github.com/MobinX/awesome-mcp-list/pull/241 |
| P0 | `toolsdk-ai/toolsdk-mcp-registry` | `169` | Structured MCP registry JSON | Old entry merged; refresh open: https://github.com/toolsdk-ai/toolsdk-mcp-registry/pull/391 |
| P1 | `bytefer/awesome-shadcn-ui` | `683` | shadcn ecosystem list | Open: https://github.com/bytefer/awesome-shadcn-ui/pull/18 |
| P1 | `birobirobiro/awesome-shadcn-ui` | `19k+` | Largest shadcn ecosystem list | Old entry merged; refresh open: https://github.com/birobirobiro/awesome-shadcn-ui/pull/538 |
| P1 | `appcypher/awesome-mcp-servers` | `5492` | MCP list with development tools category | Branch pushed, PR creation blocked by base permissions: https://github.com/appcypher/awesome-mcp-servers/compare/main...sarveshsea:awesome-mcp-servers-2:add-memoire-design-ci |
| P1 | `wong2/awesome-mcp-servers` | `4005` | MCP list with community servers category | Branch pushed, PR creation blocked by base permissions: https://github.com/wong2/awesome-mcp-servers/compare/main...sarveshsea:awesome-mcp-servers-1:add-memoire-design-ci |
| P2 | `react-figma/awesome-figma` | `430` | Figma/dev integration list | Wait until Figma positioning is not competing with code-first wedge |
| P2 | `klaufel/awesome-design-systems` | `843` | Developer-focused design systems list | Wait until website proof page is healthy |
| P2 | `gztchan/awesome-design` | `17k+` | Broad design resources | Do not submit unless there is a polished public article/demo |
| P2 | `RGB-Team/shadcn-registries` | `49` | shadcn registry directory | Wait for stable public registry URL |

## Launch Sequence For 10x Downloads

1. Refresh MCP.Directory, Glama, and PulseMCP with the same v2 copy after npm latest and the official MCP Registry both show `2.5.0`; Smithery is already live.
2. Keep `memi-design/design-sandbox` as the public proof repo; `pnpm verify` proves memi agent install, diagnose, UX audit, token extraction, MCP config, and shadcn registry output.
3. Follow up on open PRs only with new proof: official registry link, security hardening, demo video, or maintainer-requested fixes.
4. Ship one 60-second terminal demo: install, `memi diagnose`, `memi ux audit --json`, `memi shadcn export`, `memi mcp start --no-figma`.
5. Post the demo to X, Show HN, `r/mcp`, and `r/shadcn` with the GitHub star CTA.
6. Recheck npm downloads and stars weekly in `docs/METRICS.md`.

## Demo Script

```bash
npm i -g @memi-design/cli
memi diagnose --no-write
memi ux audit --json
memi tokens --from ./src --report
memi shadcn export --out public/r
memi mcp start --no-figma
```

Narrative:

```text
Most AI UI tools help create the first draft. memi is for the app after that: diagnose the messy shadcn/Tailwind codebase, extract the token system, export a shadcn-native registry, and give Claude Code/Cursor/Codex the same design-system context through MCP.
```

## Follow-Up Rules

- Follow up on a PR only when there is new proof: official registry URL, npm patch, demo video, or CI fix.
- Do not ping maintainers repeatedly for achievements.
- Do not submit to broad design lists until the public website and registry examples are healthy.
- If a directory rejects memi as too broad, narrow the listing to the MCP server or shadcn registry export workflow.

## Sources

- Official MCP Registry publish flow: https://modelcontextprotocol.io/registry/quickstart
- MCP npm package verification: https://modelcontextprotocol.io/registry/package-types
- MCP.Directory submit form: https://mcp.directory/submit
- Smithery publish flow: https://smithery.ai/docs/build/publish
- shadcn registry directory requirements: https://ui.shadcn.com/docs/registry/registry-index
- v0 design-system registry workflow: https://v0.app/docs/design-systems
