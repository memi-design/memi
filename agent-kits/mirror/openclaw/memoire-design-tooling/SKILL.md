---
name: memoire-design-tooling
description: Use when an OpenClaw workspace task involves UI design, interface craft, Figma, design systems, shadcn/ui, Tailwind, Atomic Design, research synthesis, design audits, component specs, or code generation from design evidence.
version: 2.0.0
author: Sarvesh Chidambaram
license: MIT
metadata: {"openclaw":{"homepage":"https://github.com/memi-design/memi","requires":{"bins":["memi"]},"install":[{"id":"npm","kind":"node","package":"@memi-design/cli","bins":["memi"],"label":"Install memi CLI with npm"}]}}
---

# memi Design Tooling

## Overview
memi gives OpenClaw a local interface-understanding layer: warmed project memory, suite recipes, Figma bridge context, user research memory, UX tenets and traps, interface craft critique, Atomic Design specs, shadcn/ui codegen, Tailwind token checks, and evidence-backed UI audits.

## When to Use
- The task mentions interface design, product flows, design systems, Figma, Tailwind, shadcn/ui, components, accessibility, screenshots, or research synthesis.
- The workspace includes `.memoire/`, component specs, tokens, or a frontend app that needs design-quality improvement.
- The agent needs to install or verify local design tooling before editing UI code.

## Setup
```bash
npm i -g @memi-design/cli
memi suite init --project .
memi daemon start --project . --port auto
memi daemon status --json
memi agent install --dry-run --json
memi agent brief . --agent openclaw --intent "Audit this interface" --json
memi status
memi diagnose .
memi ux audit . --json
memi craft audit . --json
memi tokens --from ./src --report
memi shadcn export --out public/r
memi mcp start --no-figma
memi suite run design-audit --project . --json
memi suite run research-vibe-design --project . --json
memi research design --write-specs --mermaid-jam --json
memi mermaid-jam export --from research --json
```

## Interface Understanding Workflow
1. Verify `memi` exists with `memi status`; install with npm if the binary is missing.
2. Initialize or read `memoire.agent.yaml`; it declares memory sources, harnesses, skills, and recipes for the workspace.
3. Generate an OpenClaw-oriented brief with `memi agent brief . --agent openclaw --intent "<task>" --json`; use its evidence commands and cost controls as the run contract.
4. Prefer the warmed daemon path with `memi daemon start --project . --port auto`, then check `memi daemon status --json`.
5. Inspect `.memoire/`, specs, tokens, design docs, runtime routes, screenshots, research evidence, `memoire.agent.yaml`, and existing agent instructions before choosing an implementation path.
6. For audits, run `memi diagnose .`, `memi ux audit . --json`, `memi craft audit . --json`, `memi audit`, or `memi suite run design-audit --project . --json` and use file-backed findings as evidence.
7. Treat UX Tenets and Traps as the review layer for clarity, feedback, control, consistency, accessibility, error recovery, progressive disclosure, workflow fit, trust, and state continuity.
8. Treat Interface Craft as the polish layer for focusing mechanism, visual hierarchy, spacing rhythm, color intentionality, component cohesion, responsive resilience, and user context.
9. For research-backed vibe design, use `memi research synthesize`, `memi simulate plan`, `memi research design`, `research.design_package`, `research.generate_specs`, and `mermaid_jam.export` before coding the product surface.
10. For generation, create or reuse specs, keep the Atomic Design level explicit, then run `memi generate`.
11. For Figma work, connect through `memi connect` or use the Figma-independent MCP server with `memi mcp start --no-figma`.
12. Keep final output concrete: commands run, design decisions, files changed, remaining risks, and how to verify.

## Safety
Treat third-party skills and generated code as untrusted until reviewed. Do not paste secrets into prompts or logs. Avoid destructive shell commands unless the user explicitly approves them.
