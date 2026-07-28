# Package Positioning

Memoire v2 should be judged like a mature developer package, not a demo repo. The public surface needs to make the package easy to understand, easy to install, easy to trust, and easy to recommend.

## Category

**Memi is the read-only design engineering audit and skill layer for coding agents.**

Adjacent categories:

- Design-system memory for coding agents.
- Design CI for shadcn/Tailwind apps.
- UX audit and UI evidence for agentic frontend work.
- shadcn registry generation from real apps.
- MCP server for design-system context.
- Research-backed product design and FigJam handoff.

## Primary audience

| Audience | Pain | memi promise |
| --- | --- | --- |
| Product engineers | Agents break visual systems while editing UI. | Run memi first so agents know tokens, components, and UX risks. |
| Product designers | Agent runs lose research and design context. | Preserve research, specs, Figma context, and run receipts. |
| Design system owners | Registries, tokens, Figma, and code drift apart. | Extract, validate, publish, and reinstall system memory. |
| Agent stack builders | Each agent needs a different context format. | Install skills and MCP config for Codex, Claude Code, Cursor, Hermes, OpenCode, OpenClaw, ECC-style stacks, and generic MCP clients. |
| Design engineers | They need a small repo that proves the workflow before wiring it into production. | Use `memi-design/design-sandbox` as the memi-ready public proof workspace. |

## Message hierarchy

1. **One-line promise**: Memi is the read-only design engineering audit and skill layer for coding agents.
2. **Five-minute proof**: `memi diagnose`, `memi ux audit`, `memi craft audit`, `memi tokens`, `memi shadcn export`.
3. **Agent-native distribution**: universal Agent Skills, MCP, Codex plugin, Hermes, OpenClaw, OpenCode, Claude Code, Cursor.
4. **Deep workflow**: user research, UX traps, Atomic Design specs, Figma/FigJam, registry publish.
5. **Trust**: no install-time scripts, explicit Figma plugin install, dry-run agent kit writes, release gates.

## High-download package bar

The package should keep these properties before every public push:

- Root README opens with the category, promise, install command, and first-run proof.
- npm README is shorter than the full docs and does not bury the primary CTA.
- `package.json` keywords match real search intent.
- The package tarball includes the docs users need offline.
- The root README links to deeper docs instead of duplicating every advanced workflow.
- First commands work without Figma, paid accounts, or desktop app setup.
- Every agent install path has a dry-run or safe inspection path.
- The MCP server starts in a Figma-independent mode for registries and crawlers.
- Release gates verify package metadata, README terms, skill packaging, MCP smoke, Codex plugin smoke, npm pack contents, and production audit.
- Growth docs describe distribution loops and current public truth.

## Distribution loops

| Loop | Why it matters | Asset |
| --- | --- | --- |
| npm search | Developers discover CLI tools through package pages and install snippets. | Root README, package keywords, public release gate. |
| Agent Skills | Skill-first users install local instructions without hand-copying prompts. | `skills/memoire-design-tooling/SKILL.md`. |
| MCP Registry | MCP clients need stable stdio startup and package metadata. | `server.json`, `memi mcp start --no-figma`. |
| Codex marketplace | Codex users can install the plugin from `/plugins`. | `.agents/plugins` and `plugins/memoire`. |
| shadcn/v0 registry | Frontend teams need visible outputs, not only audits. | `memi shadcn export`, example registries. |
| Research design | Product teams need design decisions tied to evidence. | `memi research design`, Scenario Lab, Mermaid Jam export. |
| Studio | Designers need a supervised workbench for Codex and Claude Code. | `memi studio web|tui|logs|run` and macOS app. |
| Public proof repos | Users trust runnable repositories more than claims. | `memi-design/design-sandbox` and future shadcn/Tailwind examples. |

## Package structure target

```text
README.md                       npm-grade landing page
docs/README.md                  docs map
docs/INTERFACE_UNDERSTANDING.md core workflow protocol
docs/AGENT_STACKS.md            agent/ECC/Hermes/Codex stack guide
docs/GROWTH_TO_1M_NPM.md        operating plan
docs/RELEASE_GATES.md           release proof
docs/PUBLIC_REPOS.md            public proof repos and hashtags
skills/memoire-design-tooling/  standard Agent Skills package
agent-kits/                     native install templates
plugins/memoire/                Codex plugin
server.json                     MCP Registry descriptor
examples/                       installable registry proof
```

## What not to do

- Do not lead with every feature at once.
- Do not make Figma mandatory for the first proof.
- Do not bury `npm i -g @memi-design/cli`.
- Do not claim agent support without a real install path.
- Do not let Studio positioning replace the npm engine story.
- Do not publish while npm auth, worktree state, package contents, or public release checks are unresolved.

## Weekly operating rhythm

1. Check public truth with `npm view`, `npm run growth:status`, and `npm run check:public-release` after publish.
2. Compare README search terms with docs and package keywords.
3. Run one clean install proof from a temp directory.
4. Add one new external adoption path: example registry, agent stack note, MCP client recipe, short demo, or issue response.
5. Remove one source of confusion: stale naming, duplicate docs, broken link, unsupported claim, or unverified screenshot.
