---
name: memoire-design-tooling
description: Use when a Hermes session involves UI design, interface craft, Figma, design systems, shadcn/ui, Tailwind, Atomic Design, research synthesis, component specs, design audits, or code generation from design evidence.
version: 2.7.0
author: Sarvesh Chidambaram
license: MIT
metadata:
  hermes:
    tags: [memoire, design-system, figma, shadcn, tailwind, atomic-design]
    related_skills: [software-development, design, figma]
---

# Memi Design Tooling For Hermes

Collect repository-specific interface evidence before broad UI changes. No global install, daemon, Figma connection, or account is required for code-first work.

## Start

```bash
npx -y @memi-design/cli@2.7.0 agent brief . --agent hermes --intent "<interface task>" --detail compact --json
```

Run only the evidence command needed next:

```bash
npx -y @memi-design/cli@2.7.0 diagnose . --json --no-write --fail-on none
npx -y @memi-design/cli@2.7.0 ux audit . --json --no-write
npx -y @memi-design/cli@2.7.0 tokens --from ./src --report --json
```

Read `memoire.agent.yaml` when present. Reuse existing components and semantic tokens, keep Atomic Design levels explicit, and finish with files changed, evidence followed, checks run, and unresolved assumptions.
