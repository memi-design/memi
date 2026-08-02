# Memi Community Launch Kit

Current release: `@memi-design/cli@2.7.7`
Primary link: <https://github.com/memi-design/memi>
Primary story: Memi is the design layer for agentic AI.

## Rules

- Lead with a real problem or finding, not a feature list.
- Use one primary link per post.
- Adapt the example to the community. Do not cross-post identical copy.
- Answer every substantive comment for the first 48 hours.
- Disclose maintainer affiliation when recommending Memi in someone else's thread.
- Never buy stars, automate engagement, mass-DM maintainers, or fork repositories for visibility alone.
- Measure successful first audits and repeat audits, not only impressions.

## Show HN

Title:

```text
Show HN: Memi - the design layer for coding agents
```

Body:

```text
Coding agents can change a frontend quickly, but they usually start without the
product's design rules. They miss reduced-motion fallbacks, empty states, token
drift, responsive traps, and component conventions that are visible across the
repo but not in one prompt.

I built Memi to give the agent a deterministic preflight:

  npx -y @memi-design/cli@2.7.7 diagnose . --json --no-write --fail-on none

It reads the current repository, writes no source files, and returns normalized
findings with file:line evidence. Run the same command after the fix to verify
the result. There is no account, API key, Figma file, or daemon in the first
path.

The CLI also ships as an Agent Skill, MCP server, and pinned GitHub Action, but
the core job is deliberately narrow: audit the interface before the agent edits
it.

Memi is MIT licensed and supports Node 20/22/24 on macOS, Linux, and Windows.

GitHub: https://github.com/memi-design/memi

I would especially value feedback on false positives, missing frontend states,
and whether the finding evidence is enough to guide a safe agent patch.
```

## Reddit: Codex and Claude Code

Title:

```text
I built a design layer for coding agents
```

Body:

```text
I kept seeing the same failure in frontend agent work: the code change was
technically valid, but it ignored the product's existing tokens, responsive
rules, empty states, or motion accessibility.

Memi runs before the edit and reports the evidence it found:

  npx -y @memi-design/cli@2.7.7 diagnose . --json --no-write --fail-on none

The first path is deterministic and does not modify source. It needs no account, API key,
Figma file, global install, or daemon. Findings cite file:line so the agent can
make a scoped fix and rerun the same check.

There are focused skills for Codex and Claude Code, but I am most interested in
whether the raw audit is useful in real repositories.

GitHub: https://github.com/memi-design/memi

I maintain the project. If you try it, a false positive or missing check is more
useful to me than a generic compliment.
```

## Reddit: frontend and web development

Title:

```text
Open-source CLI for file-anchored UI and design-system audits
```

Body:

```text
I made an MIT-licensed CLI that checks frontend repositories for interface
risks before a human or coding agent starts changing UI.

It looks for accessibility, missing product states, token drift, weak hierarchy,
responsive issues, and motion problems, then reports normalized findings with
file:line evidence.

  npx -y @memi-design/cli@2.7.7 diagnose . --json --no-write --fail-on none

The command inspects the project without modifying source and produces deterministic results. The same engine can run as a pinned
GitHub Action, so accepted debt can stay visible while new debt fails a PR.

GitHub: https://github.com/memi-design/memi

I am the maintainer. I would like feedback from people with large Tailwind or
design-system codebases, especially around false positives.
```

## LinkedIn

```text
Coding agents can make a frontend change in minutes.

But they usually start without the product rules that are spread across the
repository: tokens, reduced-motion behavior, empty states, responsive
conventions, and component boundaries.

I built Memi as the design layer for agentic AI.

npx -y @memi-design/cli@2.7.7 diagnose . --json --no-write --fail-on none

It returns deterministic, file-anchored findings before the agent edits UI.
Then you rerun the same command to verify the correction.

No account. No API key. No Figma file. No daemon.

Memi is open source and works with Codex, Claude Code, Cursor, Grok Build, and
MCP clients.

https://github.com/memi-design/memi

If you work on frontend infrastructure or design systems, I would value a test
against a real repository.
```

## X thread

Post 1:

```text
Coding agents move fast, but they usually start without the product's design rules.

I built Memi: a grounded design brief before the agent edits UI.

npx -y @memi-design/cli@2.7.7 diagnose . --no-write

https://github.com/memi-design/memi
```

Post 2:

```text
Memi checks the repository for accessibility, missing states, token drift,
responsive risks, motion issues, and interface craft problems.

Every finding has a normalized ID and file:line evidence.
```

Post 3:

```text
The first path needs:

- no account
- no API key
- no Figma file
- no global install
- no daemon

Run it, fix one issue, rerun the same command.
```

Post 4:

```text
It also ships as a focused Agent Skill, MCP server, and pinned GitHub Action.

But the job stays simple: audit the interface before the agent edits it.

If it catches something real, share the finding. That is the proof I care about.
```

## GitHub Discussion announcement

Title:

```text
Memi 2.7.7: one grounded command before your agent edits UI
```

Body:

```text
Memi 2.7.7 is published on npm. GitHub release, the v2 Action channel, MCP
Registry, Studio, and website parity are separately verified release gates;
this announcement does not claim they have cleared.

Try the smallest useful path:

  npx -y @memi-design/cli@2.7.7 diagnose . --json --no-write --fail-on none

If it reports a useful finding, share the finding ID, framework, and correction
in Show and Tell. If it misses something important, open a fixture-backed issue.

The current focus is verified adoption: successful first audits, repeat audits,
and public integrations. Release-day download spikes do not count as retention.
```

## Helpful reply pattern

Use this structure in relevant public threads:

1. Answer the person's question without mentioning Memi.
2. Give one concrete command, code example, or diagnostic step.
3. If Memi directly solves the problem, disclose: "I maintain Memi."
4. Link one exact page, not the homepage plus npm plus docs.
5. Ask for a reproducible case or result.

Example:

```text
For this kind of UI regression I would first separate deterministic checks from
the agent's visual judgment. Make the check report the exact file and rule, then
rerun it after the patch so the agent cannot declare success from prose alone.

I maintain Memi, which implements that pattern for frontend design checks:
https://github.com/memi-design/memi

The one-command trial does not modify source. If you have a public reproduction, I would
be happy to test whether the current rule catches it.
```

## Fork policy

Use forks as integration proof, not advertising inventory.

- Fork only a project with a relevant UI, shader, motion, or agent workflow.
- Retain license and attribution.
- Add a pinned Memi workflow and baseline report.
- Keep upstream product code minimally changed.
- Publish before/after evidence and simulator or browser proof.
- State that the fork does not imply partnership.
- Open an upstream issue first. Submit a PR only if maintainers welcome it.

## Tracking

For each post record:

- URL and publication time.
- Audience and framing.
- Qualified repository visits.
- First audits.
- Repeat audits after 7 to 21 days.
- Stars and forks gained in the same window.
- npm non-release baseline change.
- Questions and objections worth turning into documentation.

Do not attribute causality from a download spike alone.
