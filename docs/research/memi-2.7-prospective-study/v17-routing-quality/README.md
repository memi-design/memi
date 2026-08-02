# V17 Routing-Quality Study — Preregistration

**Status:** preregistered protocol; agent-quality data have not been collected.

This study evaluates whether Mémoire's bounded skill-routing changes improve
route selection and downstream task outcomes. The code-level results below are
not evidence that an agent produces better design work, uses fewer tokens, or
costs less.

## What the current code evidence establishes

The local regression suite admits the safe pattern forms `exact:`, `prefix:`,
`suffix:`, `contains:`, `glob:`, and `oneOf:`. Legacy literal forms are
translated deterministically; executable regular-expression syntax is rejected
before matching. The suite also verifies that comments, strings, and template
literals cannot create repository-import evidence, and that a 10,000-note
catalog produces the same routing receipt on two consecutive evaluations.

These are deterministic implementation checks. They do not measure model
quality, acceptance rate, wall-clock savings, token consumption, or dollars.

## Research questions

1. Does repository-aware safe routing improve correct route selection relative
   to repository-only discovery and the legacy bounded-pattern router?
2. Does it improve paired functional acceptance and blinded design-quality
   scores without increasing critical defects?
3. Does it change input, output, reasoning-token, tool-call, retry, provider
   failure, and wall-time distributions?
4. Does its abstention behavior prevent unsafe or unsupported route promotion?

## Frozen design before execution

The executable parameters belong in `protocol.json`. Before the first run, the
study operator must replace every `PENDING` value with a pinned candidate
artifact, task fixture revision, model/effort, seed, collector version, and
receipt root, then SHA-256 the completed protocol. No results may be admitted
until that freeze hash and all cell receipts exist.

Use matched baseline/Mémoire pairs. Randomize order within each task, run
serially where a native simulator is involved, and use clean clones and
isolated verification. Route selection is evaluated independently from task
quality: the route scorer never reads outcome labels.

## Analysis and claim gates

- Route precision, recall, and abstention correctness are reported per task
  family with Wilson intervals.
- Functional acceptance and critical defects are paired binary outcomes.
- Blinded three-rater design quality is the primary product outcome; report
  rater medians and disagreement.
- Token, time, tool-call, and retry values are descriptive until every paired
  receipt has retained provider usage and billing artifacts. Do not infer USD
  savings without those artifacts.
- Apply Holm correction to prespecified secondary outcomes. Pool heterogeneous
  fixtures only descriptively.
- A superiority claim requires the prespecified paired quality gate to pass.
  Otherwise the paper reports the observed estimate and uncertainty only.

## Current deterministic safety corpus

`adversarial-pattern-corpus.json` lists syntax that must be rejected before
matching, including nested repetition, ambiguous alternation, backreferences,
lookbehind, character classes, and wildcard regex forms. The test suite also
uses a 10,000-note catalog with a 3-second CI budget for two complete,
deterministic selections. This is a regression budget, not a latency benchmark
for a production agent session.

## Falsification criteria

The routing change is not adopted for default execution if any of the
following occurs: an executable pattern is admitted; a repository fingerprint
changes because of comment/string-only content; equivalent inputs produce a
different receipt; a route promotes from stale or non-exact evidence; or the
preregistered paired quality gate fails.
