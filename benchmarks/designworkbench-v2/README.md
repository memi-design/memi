# Memi DesignWorkBench v2

DesignWorkBench evaluates whether an agent can perform complete professional
design assignments at a level calibrated against working practitioners.
Functional acceptance, professional quality, source trust, and efficiency are
reported separately.

The frozen foundation contains:

- 15 professional tracks
- 300 task contracts
- 60 public development tasks
- 180 private test tasks
- 60 rolling holdout tasks
- 8 runtime and artifact-runner contracts
- discipline-specific rubrics and negative controls

The public development corpus now has 60 deterministic, hash-bound candidate
fixture packs, four for each professional track. These are benchmark-owned
synthetic inputs for development and reproducibility. They are not practitioner
work, independently verified fixtures, private tests, holdouts, or proof of
Memi quality.

The first runtime evidence activation separately verifies three runner profiles
with committed, hash-bound artifacts:

- browser and Playwright runtime, including interaction, accessibility, and trace evidence
- motion rendering, including frame analysis and a reduced-motion output
- artifact validation, including schema, integrity, provenance, and handoff-reopen evidence

The generated task bank is not itself practitioner proof. A task remains
`contract_defined` until its authentic source material, expected artifact
contract, deterministic fixtures, legal provenance, and required runtime have
been independently verified.

## Commands

```sh
npm run build:designwork-bench
npm run check:designwork-bench
npm run build:designwork-evidence
npm run check:designwork-evidence
npm run approve:designwork-fixture -- \
  --candidate benchmarks/designworkbench-v2/evidence/public-fixtures/product-design-01.json \
  --review path/to/independent-review.json
npm run build:designwork-readiness
npm run check:designwork-readiness
npm run check:designwork-release
```

Fixture approval recomputes the candidate hash and requires an independent
reviewer, qualification evidence, an immutable review receipt, and a matching
task/hash decision. Start from
[public-fixture-review-template.json](public-fixture-review-template.json).
Memi authors cannot self-approve these candidates.

`check:designwork-release` fails until all fixtures and runners are verified,
practitioner calibration passes, and private plus holdout results exist.

Synthetic practitioner scores are prohibited. Unit-test fixtures may exercise
the mathematics, but cannot be imported as calibration evidence.

See [PRACTITIONER_CALIBRATION.md](PRACTITIONER_CALIBRATION.md) for the
qualification, consent, blinding, receipt, and adjudication workflow required
to collect real calibration evidence.

See the separate
[benchmark-construction paper](../../docs/research/designworkbench-v2-paper/designworkbench-v2-benchmark-paper.pdf)
for the research rationale, task-bank methodology, threat model, governance,
and the preregistered cross-harness comparison. The comparison is unexecuted;
its empty result cells are intentional.
