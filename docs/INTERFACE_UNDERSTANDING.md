# Interface Understanding

Interface understanding is the memi v2 core loop: collect the evidence behind a product UI, turn it into structured design memory, let an agent make a bounded change, then preserve the proof.

Most coding agents can edit React. Fewer can explain the product surface they are editing. memi fills that gap by reading code, routes, screenshots, tokens, specs, Figma context, research, UX traps, interface craft, and registry shape before implementation starts.

## Evidence inputs

| Input | What memi extracts |
| --- | --- |
| Codebase | Tailwind usage, shadcn components, CSS variables, repeated literals, route structure, component targets, dark-mode coverage. |
| Runtime route or URL | Visual hierarchy, screenshot evidence, responsive risks, page-level design language, state continuity issues. |
| Design tokens | Modes, aliases, duplicate values, semantic coverage, scale health, token candidates, Style Dictionary output. |
| Figma | Tokens, component names, frames, screenshots, styles, and design-system references when connected. |
| User research | Themes, personas, hypotheses, journey risks, acceptance criteria, and product evidence links. |
| Agent harnesses | Which tool is running, what memory it received, what artifacts it wrote, and how the run should be verified. |

## The loop

```bash
npm i -g @memi-design/cli

memi agent brief . --intent "Improve this interface" --json
memi diagnose .
memi diagnose http://localhost:3000
memi ux audit . --json
memi craft audit . --json
memi tokens --from ./src --save --report
memi design-doc http://localhost:3000 --spec
memi shadcn export --out public/r
memi suite run design-audit --project . --json
```

1. **Brief**: run `memi agent brief . --intent "<task>" --json` to get the evidence, cost, compatibility, and handoff contract.
2. **Collect**: read code, routes, tokens, existing `.memoire/` state, and AGENTS/README instructions.
3. **Map**: identify Atomic Design levels, shadcn primitives, token sources, route roles, and missing design-system links.
4. **Audit**: score UX tenets, trap risks, accessibility, state feedback, consistency, workflow fit, trust, visual debt, and interface craft.
5. **Plan**: produce a small implementation plan backed by file artifacts, not taste.
6. **Generate or edit**: use specs, shadcn/ui, Tailwind, and existing components before inventing new patterns.
7. **Verify**: rerun diagnostics, project tests, screenshots, or browser checks depending on the change.
8. **Preserve**: save specs, reports, registry output, run receipts, and research decisions for the next agent.

## Public sandbox proof

Use [`memi-design/design-sandbox`](https://github.com/memi-design/design-sandbox) as the reference implementation of this loop in a small Next.js, Tailwind, shadcn, MCP, and Agent Skills workspace:

```bash
git clone https://github.com/memi-design/design-sandbox.git
cd design-sandbox
pnpm install
pnpm memi:diagnose
pnpm memi:ux
pnpm memi:tokens
pnpm verify
```

The sandbox keeps `/sandbox` as the visual target, `.agents/skills` as the cross-agent protocol, `.mcp.json` as the MCP entrypoint, and `memoire.agent.yaml` as the shared recipe contract.

## Interface craft

`memi craft audit` is the design-craft layer for first-class interface polish. It checks:

- Focusing mechanism: the screen has one clear first read and next move.
- Visual weight: contrast, size, density, and placement support priority.
- Typographic hierarchy: type scale and weight create a readable structure.
- Spacing rhythm: groups, edges, and component padding repeat intentionally.
- Color intentionality: colors express role, state, and brand instead of drift.
- Component cohesion: controls, variants, radius, strokes, icons, and states feel like one system.
- Responsive resilience: layouts survive breakpoints, long content, and touch contexts.
- User context care: the UI respects stakes, attention, recovery, and confidence.

Craft findings are stored with critique sections for visual design, interface design, conventions, and user context so an agent can improve polish without relying on taste alone.

## UX tenets and traps

`memi ux audit` is the review layer for product-quality work. It checks:

- Clarity: users can tell what the screen is for.
- Feedback: actions produce visible response and state.
- Control: users can cancel, undo, edit, or recover.
- Consistency: tokens, components, layout, and copy follow the local system.
- Accessibility: contrast, keyboard flow, semantics, and readable hierarchy are respected.
- Error recovery: empty, loading, failure, and partial states are handled.
- Progressive disclosure: advanced controls do not bury the primary task.
- Workflow fit: the UI supports repeated real work, not only a demo path.
- Trust: data, permissions, and automation boundaries are clear.
- State continuity: navigation, filters, drafts, and selections survive expected transitions.

Trap findings are stored with recommendations so an agent can explain why a patch is needed and how to verify it.

## User research to interface changes

```bash
memi research synthesize
memi simulate plan --hypothesis "Evidence links improve product confidence" --json
memi simulate run-matrix --adapter local --hypothesis "Faster setup reduces churn" --json
memi research design --intent "Design an evidence-backed planning board" --json
memi research design --write-specs --mermaid-jam --json
memi mermaid-jam export --from research --json
```

Research-backed design follows a strict path:

1. Synthesize raw research into themes, personas, and risks.
2. Plan a hypothesis with evidence links.
3. Run local or model-swarm scenario checks when useful.
4. Generate a design package first.
5. Write Atomic Design specs only when the package is accepted.
6. Export FigJam-ready source when planning artifacts are needed.
7. Generate code only from accepted specs.

## Agent handoff contract

Every agent using memi should be able to answer:

- What did the design-agent brief require?
- What product context did I read?
- What tokens and components did I find?
- What UX findings drove the change?
- What Atomic Design level does each new component occupy?
- What shadcn/ui primitive or registry item did I reuse?
- What command proves the change?
- What artifact should the next agent read?

Use `memoire.agent.yaml` as the workspace contract for memory sources, harnesses, installed skills, and recipes.

MCP clients can fetch the same preflight contract with `prepare_design_agent_brief` before calling `diagnose_app_quality`, `audit_ux_tenets_traps`, `audit_interface_craft`, `get_shadcn_registry`, or `research.design_package`.

## Artifacts

| Artifact | Purpose |
| --- | --- |
| `.memoire/app-quality/diagnosis.json` | Machine-readable app-quality findings. |
| `.memoire/app-quality/diagnosis.md` | Human-readable diagnosis report. |
| `.memoire/app-quality/ux-audit.json` | UX tenet and trap findings. |
| `.memoire/app-quality/interface-craft.json` | Interface craft critique, dimensions, and opportunities. |
| `.memoire/design-system.json` | Saved token and registry memory. |
| `public/r/registry.json` | shadcn registry index. |
| `public/r/*.json` | Installable shadcn registry items. |
| `.memoire/mermaid-jam/<id>/` | FigJam-ready Mermaid and markdown source. |
| `memoire.agent.yaml` | Agent memory, harness, skill, and recipe contract. |

## Acceptance criteria for serious UI work

- `memi agent brief` ran before broad frontend changes.
- `memi diagnose`, `memi ux audit`, or `memi craft audit` ran before implementation.
- New components declare an Atomic Design level.
- Tailwind and shadcn/ui are preferred over one-off styling systems.
- Token changes are saved or reported.
- Research-backed changes cite the research package or simulation run.
- Final handoff names the artifacts and verification commands.
