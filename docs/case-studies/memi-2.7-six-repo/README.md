# Memi 2.7 six-repository efficiency study

## Decision

Memi 2.7 is not approved for release by this study.

Six revision-matched baseline/Memi pairs completed with identical model,
reasoning, task, quality rubric, and read-only constraints. Both conditions
passed the corrected evidence grader at 100%. The measured efficiency claim was
not verified:

- Mean token savings: 19.92%; 95% bootstrap interval -0.23% to 40.07%.
- Mean latency savings: 0.50%; 95% bootstrap interval -11.72% to 14.55%.
- Mean tool-call savings: -17.89%; 95% bootstrap interval -80.56% to 22.50%.
- USD cost: unassessed. The Codex subscription trace did not expose a
  defensible per-run dollar cost.

The preregistered gate requires the lower 95% confidence bounds for tokens and
latency to exceed 25%, with no quality regression. This result fails the token
and latency requirements.

## Per-repository results

Positive percentages mean Memi used less. Negative percentages mean a
regression.

| Repository | Pinned revision | Token savings | Latency savings | Tool savings | Quality |
|---|---|---:|---:|---:|---:|
| Nate the Bait | `9cde918e309d74943457ad6def8a9c14db7ea01b` | 21.7% | -13.6% | 16.7% | 100 / 100 |
| Buzzr | `7583ab4788e5f3554c479ce886d9d75e8eefb0ba` | -3.7% | 13.4% | 0.0% | 100 / 100 |
| DoriOS | `18698932e45878a3eab1f5b114dfa5f9c2f58744` | 60.1% | 28.2% | 30.8% | 100 / 100 |
| Nyra | `071aca808d9a58317ae78eb687a781977f5a9754` | -18.7% | -16.7% | -16.7% | 100 / 100 |
| Paraform | `0bbcacfc71fb3d383f66b20b5e2babd5f3063a1b` | 33.3% | -14.3% | 28.6% | 100 / 100 |
| Nyra Landing | `bbf77999046f695ff1144f9e7096db29b89a2c7c` | 26.8% | 6.0% | -166.7% | 100 / 100 |

Only DoriOS cleared 25% on tokens, latency, and tools. DoriOS is also the
clearest high-ambiguity case: a large repository spanning web, Tauri, native,
offline, and visualization surfaces. Memi regressed on Nyra and increased
tokens on Buzzr. Paraform saved tokens and tools but took longer. Nyra Landing
saved tokens but expanded tool usage from 9 to 24.

## Protocol

- Codex CLI `0.145.0`
- Model `gpt-5.6-sol`
- Reasoning effort `medium`
- One pair per repository
- Alternating order across repositories
- Clean detached worktrees at the revisions above
- Read-only sandbox and no repository writes
- Isolated `HOME` and `CODEX_HOME`
- No user-installed skills, plugins, or subagents
- Identical task, topic coverage, citation requirement, gap disclosure, and
  verification-command requirement across conditions
- Memi condition difference: one local
  `diagnose --agent-context --no-write` preflight
- Counted tokens: input + output + reasoning
- Quality: repository-valid file/line citations, required topics, explicit
  unresolved gaps, and reproducible verification commands
- Bootstrap samples: 10,000
- Seed: 270
- Minimum pairs: 5
- Required lower confidence bound: 25%

The first Nate baseline used standard relative `#Lx-Ly` anchors. The original
grader recognized only `path:line` links and recorded a false failure. The raw
trace and original grade were preserved. An immutable
`source-citations-v2` amendment regraded the same response at 31 valid
citations, zero invalid citations, and 100/100. No model rerun or metric was
changed.

## Product implications

The v2.7 candidate must not force the same context strategy onto every
repository. The local candidate now emits one of three routing modes:

- `full`: high-ambiguity, supported multi-surface repositories.
- `index-only`: partial native coverage or moderate discovery complexity.
- `abstain`: low discovery complexity or an unsupported analyzer, including
  the current React Native path.

The policy routes DoriOS to full context, Nate and Nyra to compact index-only
context, and Buzzr, Paraform, and Nyra Landing to abstention. This policy is a
change motivated by the study. It is not validated performance evidence yet.
A fresh paired suite must prove it before 2.7 can ship.

## Evidence boundary

Raw JSONL events, responses, grades, amendments, and run records remain private
machine-local evidence until scrubbed for absolute paths and publication. This
document contains only metadata safe for a candidate package. It does not claim
real-dollar cost savings, production adoption, rendered UI quality, or
repository correctness outside the audited design-system task.
