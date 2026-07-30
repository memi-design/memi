# Practitioner calibration runbook

This runbook is the human evidence boundary for Memi DesignWorkBench v2. It
does not permit generated identities, synthetic ratings, undisclosed conflicts,
or Memi grading its own artifacts as practitioner evidence.

## Council requirements

Each of the 15 tracks requires:

- at least four qualified working practitioners
- at least two practitioners who are external to Memi
- documented role qualification and relevant portfolio or employment evidence
- informed consent covering benchmark participation and evidence retention
- disclosure of conflicts with Memi, benchmark authors, and artifact authors

One practitioner may qualify for multiple tracks, but qualification must be
recorded separately for every track.

## Artifact assignment

Each practitioner completes at least five artifacts in every track for which
they qualify. Assignments must:

- use the frozen task revision and its verified fixture receipt
- prevent access to private and holdout material outside the assigned run
- record start, completion, interruption, and tool-use events
- preserve editable source, runtime output, and handoff artifacts
- hash the final artifact bundle before grading begins

Practice tasks and public development tasks cannot be counted as private or
holdout evidence.

## Blinded grading

Every artifact receives at least two independent ratings. Graders receive the
task contract, rubric, acceptance evidence, and anonymized artifact bundle.
They must not receive the author identity, model/provider condition, Memi
condition, another grader's score, or aggregate results.

Each rating records:

- grader identity and qualification reference
- artifact hash
- dimension scores and written rationale
- acceptance decision and evidence level
- blinded-review receipt
- grading start and completion times

Score disagreements above eight points require a third independent
adjudication. The original ratings remain immutable.

## Reliability and release thresholds

- interval-scale Krippendorff alpha of at least 0.80 overall
- alpha of at least 0.67 for every track
- no missing consent, qualification, artifact hash, or blinded receipt
- no track hidden by an overall average
- no synthetic record accepted as calibration evidence

The release remains blocked when any threshold fails.

## Fixture promotion

A task fixture can receive a verified receipt only after an independent
reviewer confirms:

1. Source assets reproduce the task without unavailable dependencies.
2. Source references and license or permission are recorded.
3. Private and holdout assets are not exposed through public paths.
4. Every source artifact hash matches the receipt.
5. Required runtime and expected artifact kinds are complete.
6. The handoff reopens on a clean environment.

The first fixture-production pass should complete the 60 public development
tasks before private and holdout material is collected.

## Current activation state

- verified task fixtures: 0/300
- verified runner profiles: 3/8
- qualified practitioners: 0
- calibrated tracks: 0/15

The remaining runner profiles are iOS or visionOS simulator, Expo device,
Android emulator, editable Figma artifact, and spatial/XR runtime. A tool being
installed does not clear a runner. Each runner needs all four artifacts defined
by its benchmark contract.
