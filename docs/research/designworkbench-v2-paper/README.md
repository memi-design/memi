# DesignWorkBench v2 research paper

This directory contains the ORCID-ready benchmark-construction paper for
DesignWorkBench v2. The manuscript is separate from the Memi 2.7 evaluation
paper: it documents how the benchmark is constructed, governed, calibrated,
and intended to compare harnesses.

The ORCID field intentionally says `not supplied`. Replace `\AuthorORCID` in
`main.tex` only with a verified author-provided identifier.

Regenerate and compile from the repository root:

```sh
python3 docs/research/designworkbench-v2-paper/generate_paper_assets.py
python3 /path/to/latex-compile/scripts/compile_latex.py \
  docs/research/designworkbench-v2-paper/main.tex \
  --compiler texlive --engine pdflatex
```

`cross-harness-protocol.json` is preregistered but unexecuted. Empty results
are intentional; the paper does not convert capability documentation into a
performance ranking.
