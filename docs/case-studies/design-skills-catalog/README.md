# Design Skills catalog validation

## Scope

- Repository: `memi-design/design-skills`
- Revision: `17ea11abb77dacef61b9ca4ecff26d30d1a02db1`
- Public skills: 94
- Collections: 9

## Reproduce

```sh
npm ci
npm run check
```

The gate validates every skill and Note manifest, syncs generated catalogs,
runs 51 tests, enforces per-file coverage, checks 52 routing prompts, and runs
the instruction-quality validator.

Current results:

- Catalog validation: 94/94
- Instruction quality: 94/94
- Routing benchmark: 52/52
- Instruction validator coverage: 86.86% lines, 88.23% branches
- npm audit: zero known vulnerabilities

Running `memi diagnose` on this documentation-only repository returns
`unassessed — no supported source files detected` with zero confidence. That is
the correct boundary: the frontend auditor must not invent a UI score for a
Markdown and JSON skill catalog.

## Efficiency experiment

Use `tasks.json` with the same paired-run protocol as the Nate case. The current
case proves deterministic catalog quality, not token or time savings.
