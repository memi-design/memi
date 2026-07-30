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

The generated task bank is not itself practitioner proof. A task remains
`contract_defined` until its authentic source material, expected artifact
contract, deterministic fixtures, legal provenance, and required runtime have
been independently verified.

## Commands

```sh
npm run build:designwork-bench
npm run check:designwork-bench
npm run build:designwork-readiness
npm run check:designwork-readiness
npm run check:designwork-release
```

`check:designwork-release` fails until all fixtures and runners are verified,
practitioner calibration passes, and private plus holdout results exist.

Synthetic practitioner scores are prohibited. Unit-test fixtures may exercise
the mathematics, but cannot be imported as calibration evidence.
