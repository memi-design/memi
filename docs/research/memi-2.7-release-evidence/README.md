# Memi 2.7 research and release evidence

This folder contains two related but distinct artifacts:

- `memi-2.7-release-evidence.pdf`: the original 10-page release brief.
- `memi-2.7-research-paper.pdf`: the academic-style LaTeX manuscript auditing
  Memi's v2.0–v2.7 evolution, paired benchmark evidence, routing failures,
  quality-measurement corrections, public release incidents, limitations, and
  reproducibility commitments.

Both artifacts separate questions that must not be collapsed into one score:

1. Does the 2.7 package pass its engineering and distribution gates?
2. Does routed repository-specific design context improve measured workflow
   cost or latency on the observed tasks?
3. Has Memi demonstrated senior-practitioner design quality across disciplines?

The package may ship when question 1 is satisfied. Efficiency claims require
question 2 to be supported by paired traces and uncertainty intervals.
Practitioner certification requires question 3 to pass DesignWorkBench v2.

## Rebuild

### Academic paper

Generate source-bound metrics and plot data:

```bash
python3 docs/research/memi-2.7-release-evidence/generate_paper_assets.py
```

Compile the LaTeX manuscript:

```bash
python3 /Users/sarveshchidambaram/.codex/plugins/cache/openai-bundled/latex/0.2.4/scripts/compile_latex.py \
  docs/research/memi-2.7-release-evidence/main.tex \
  --compiler texlive \
  --engine pdflatex
```

The author ORCID is intentionally rendered as `not supplied`. Replace
`\AuthorORCID` in `main.tex` only after the author supplies the real identifier.
Never fabricate an ORCID.

### Release brief

```bash
/Users/sarveshchidambaram/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  docs/research/memi-2.7-release-evidence/generate_report.py
```

Outputs:

- `analysis.json`: derived descriptive statistics and source commitments.
- `output/pdf/memi-2.7-release-evidence.pdf`: reader-facing technical report.
- `docs/research/memi-2.7-release-evidence/memi-2.7-release-evidence.pdf`:
  versioned copy of the same report.
- `generated/`: deterministic LaTeX macros and CSV plot inputs.
- `docs/research/memi-2.7-release-evidence/main.pdf`: compiler output before
  it is copied to the stable research-paper filename.
- `docs/research/memi-2.7-release-evidence/memi-2.7-research-paper.pdf`:
  versioned academic manuscript.
- `output/pdf/memi-2.7-research-paper.pdf`: delivery copy.

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
