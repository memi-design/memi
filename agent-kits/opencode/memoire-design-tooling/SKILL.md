---
name: memoire-design-tooling
description: Use when an OpenCode task involves UI design, interface craft, Figma, design systems, shadcn/ui, Tailwind, Atomic Design, research synthesis, component specs, design audits, or design-to-code generation.
---

# Memi Design Tooling For OpenCode

Use Memi for compact, code-first interface evidence before frontend work.

```bash
npx -y @memi-design/cli@2.8.0-beta.1 agent brief . --agent opencode --intent "<interface task>" --detail compact --json
npx -y @memi-design/cli@2.8.0-beta.1 diagnose . --json --no-write --fail-on none
```

Read product instructions, components, routes, tokens, states, and research evidence before editing. Prefer existing or shadcn primitives, semantic Tailwind tokens, and explicit Atomic Design levels. Re-run the same check and report file-level evidence after the change.
