# Memi 2.7 release evidence

This folder contains the reproducible source for the Memi 2.7 technical release
report. It separates three questions that must not be collapsed into one score:

1. Does the 2.7 package pass its engineering and distribution gates?
2. Does routed repository-specific design context improve measured workflow
   cost or latency on the observed tasks?
3. Has Memi demonstrated senior-practitioner design quality across disciplines?

The package may ship when question 1 is satisfied. Efficiency claims require
question 2 to be supported by paired traces and uncertainty intervals.
Practitioner certification requires question 3 to pass DesignWorkBench v2.

## Rebuild

```bash
/Users/sarveshchidambaram/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  docs/research/memi-2.7-release-evidence/generate_report.py
```

Outputs:

- `analysis.json`: derived descriptive statistics and source commitments.
- `output/pdf/memi-2.7-release-evidence.pdf`: reader-facing technical report.
- `docs/research/memi-2.7-release-evidence/memi-2.7-release-evidence.pdf`:
  versioned copy of the same report.

## Claim policy

- Positive savings mean Memi used less.
- Tool-call count is diagnostic, not a cost metric.
- Subscription traces without provider billing data use total tokens as a
  labeled cost proxy, never as a USD claim.
- Historical `qualityScore: 100` values in the workflow pilot mean automated
  acceptance passed. They are not senior-practitioner quality scores.
- New workflow runs label that evidence `automated_acceptance` and cap it at
  80. Only blinded practitioner rubrics may exceed that automated ceiling.
- Comparative performance against other harnesses is unmeasured until the same
  task, repository revision, model, effort, environment, and acceptance
  contract are run under each harness.

## Primary evidence

- `docs/case-studies/memi-2.7-six-repo/results.json`
- `docs/case-studies/memi-2.7-workflow-proof/results.json`
- `docs/case-studies/memi-2.7-workflow-proof/tool-call-analysis.json`
- `docs/audits/memi-designworkbench-v2-readiness.json`
- `release-manifest.json`

## Public comparison sources

- Superpowers: <https://github.com/obra/superpowers>
- Everything Claude Code: <https://github.com/affaan-m/ECC>
- Vercel Skills CLI: <https://github.com/vercel-labs/skills>
- Agent Skills specification: <https://agentskills.io/specification>
- Agent Skills authoring guidance:
  <https://agentskills.io/skill-creation/best-practices>
- Model Context Protocol tools:
  <https://modelcontextprotocol.io/specification/2025-11-25/server/tools>
