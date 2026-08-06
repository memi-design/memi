---
name: memoire-design-tooling
description: Use when an OpenClaw workspace task involves UI design, interface craft, Figma, design systems, shadcn/ui, Tailwind, Atomic Design, research synthesis, design audits, component specs, or code generation from design evidence.
version: 2.7.9
author: Sarvesh Chidambaram
license: MIT
metadata: {"openclaw":{"homepage":"https://github.com/memi-design/memi"}}
---

# Memi Design Tooling For OpenClaw

Use Memi as a code-first interface evidence layer before editing frontend files. Figma and long-running local services are optional.

## Start

```bash
npx -y @memi-design/cli@2.7.9 agent brief . --agent openclaw --intent "<interface task>" --detail compact --json
```

For a read-only audit:

```bash
npx -y @memi-design/cli@2.7.9 diagnose . --json --no-write --fail-on none
```

Inspect local instructions, `memoire.agent.yaml`, components, routes, tokens, states, and research evidence before changing code. Use shadcn and local primitives, semantic tokens, explicit Atomic Design levels, and a deterministic verification command. Report concrete files and evidence, not generic taste advice.
