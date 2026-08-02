---
name: memoire-design-tooling
description: Use when a Grok Build task involves UI design, interface understanding, Figma, design systems, shadcn/ui, Tailwind, UX audits, Atomic Design, component specs, MCP, or design-to-code generation.
---

# Memi Design Tooling For Grok Build

Give Grok repository-specific interface evidence before broad frontend changes. The first audit requires no global install, daemon, Figma connection, or account.

## Start

```bash
npx -y @memi-design/cli@2.7.5 agent brief . --agent grok-build --intent "<interface task>" --detail compact --json
npx -y @memi-design/cli@2.7.5 diagnose . --json --no-write --fail-on none
```

When the repository already uses the installed Grok kit, verify MCP with `grok mcp doctor memoire`. Use [REFERENCES.md](REFERENCES.md) only when the task needs deeper craft guidance.

Read local instructions and existing components first. Reuse shadcn primitives and semantic tokens, keep Atomic Design levels explicit, and verify the rendered route when visual behavior matters. Finish with commands, files, evidence, and remaining risks.
