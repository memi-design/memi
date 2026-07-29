# Design Skills catalog validation

## Scope

- Repository: `memi-design/design-skills`
- Candidate revision: `bb82bd36ce9aa506e3952316eada8e66f343632b`
- Public skills: 94
- Collections: 9

## Reproduce

```sh
npm ci
npm run check
```

The gate validates every skill and Note manifest, syncs generated catalogs,
runs 54 tests, enforces per-file coverage, checks both the legacy 52-prompt
router suite and a catalog-wide 154-prompt suite, and runs the
instruction-quality validator.

Current results:

- Catalog validation: 94/94
- Instruction quality: 94/94
- Catalog-wide routing: 154/154 across two positive prompts for every public
  canonical primary route
- Legacy routing gate: 52/52
- Routing evaluator coverage: 100% lines, 97.82% branches
- Instruction validator coverage: 90.71% lines, 90.19% branches
- npm audit: zero known vulnerabilities

Every public skill now has an explicit trigger-oriented description and a
domain-specific completion contract, fallback, or evidence handoff. Repeated
generic operating contracts are rejected by the validator. Deprecated routers
must remain concise and identify a canonical replacement.

Running `memi diagnose` on this documentation-only repository returns
`unassessed — no supported source files detected` with zero confidence. That is
the correct boundary: the frontend auditor must not invent a UI score for a
Markdown and JSON skill catalog.

## Efficiency experiment

This case proves deterministic catalog and routing quality, not token or time
savings. The six-repository agent-efficiency study is reported separately.
