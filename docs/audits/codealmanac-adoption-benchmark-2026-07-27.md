# CodeAlmanac Adoption Benchmark

Date: 2026-07-27
Scope: public GitHub, npm, PyPI, Hacker News, Reddit, LinkedIn, repository structure, and README conversion path.

## Executive finding

CodeAlmanac is not outperforming Memi on npm. Its npm package is retired and recorded 23 downloads in the latest complete week. Memi recorded 697 downloads in the same npm window.

CodeAlmanac is outperforming Memi on public attention:

| Public signal | CodeAlmanac | Memi |
| --- | ---: | ---: |
| GitHub stars | 709 | 28 |
| GitHub forks | 65 | 4 |
| Public contributors | 5 | 1 |
| Supported package channel | PyPI | npm |
| Latest weekly package downloads | 630 PyPI badge | 697 npm API |
| Visible community launch | HN, Reddit, LinkedIn, YC | Mostly release and directory work |

Sources:

- [CodeAlmanac repository](https://github.com/AlmanacCode/codealmanac)
- [Memi repository](https://github.com/sarveshsea/memi)
- [CodeAlmanac PyPI project](https://pypi.org/project/codealmanac/)
- [Memi npm package](https://www.npmjs.com/package/@memi-design/cli)
- [npm download API](https://api.npmjs.org/downloads/point/last-week/%40memi-design%2Fcli)
- [CodeAlmanac Show HN](https://news.ycombinator.com/item?id=48995181)

The gap is therefore a GitHub discovery and social-proof gap, not evidence that Memi lacks package activity.

## What CodeAlmanac does well

### 1. One memorable job

Its opening line is easy to repeat:

> A living wiki for your codebase, maintained by AI coding agents.

The product has one noun, one audience, and one recurring behavior. The README does not ask a new visitor to understand a CLI, MCP server, skill catalog, Studio, Figma bridge, registry generator, and research engine before seeing the core value.

### 2. The first screen carries the conversion path

The repository opens with:

- A full-width product hero.
- Package, download, star, community, social, accelerator, and license badges.
- A one-sentence category definition.
- One paragraph describing the problem.
- A two-command quickstart.
- An explicit platform and runtime boundary.

The remainder of the README is long, but the decision can be made before the detailed reference begins.

### 3. Coordinated distribution

The project did not wait for GitHub search to discover it.

- A [Show HN launch](https://news.ycombinator.com/item?id=48995181) reached 60 points and 21 comments.
- An earlier Show HN created another launch surface.
- Problem-led posts appeared in `r/codex`, `r/ClaudeCode`, `r/AutonomousCoding`, `r/SideProject`, and adjacent communities.
- LinkedIn posts used concrete agent-work examples and team or event context, not generic release notes.
- The three core contributors amplified the same product from different personal networks.
- The public [YC S26 association](https://github.com/AlmanacCode/codealmanac/blob/main/README.md) adds immediate legitimacy and distribution.
- External directories and agent-industry newsletters repeated the story.

This is a launch system, not a README trick.

### 4. Repeated problem stories

The strongest posts begin with a recognizable failure:

- The agent knows the code but not why it looks that way.
- Old decisions and gotchas are trapped in conversations.
- Every session pays the same rediscovery cost.

Each post uses a slightly different example for the audience. The project link arrives after the reader understands the problem.

### 5. Constrained trust story

CodeAlmanac says what is supported today and what is not. Local Markdown, Git review, macOS, supported runners, and local automation are described directly. Constraints make the product easier to trust.

## Where Memi was losing conversion

Before this benchmark, the Memi README:

- Used a small logo where a proof artifact should be.
- Presented many valid product surfaces before establishing one repeatable job.
- Made Grok, MCP, Agent Skills, Studio, Figma, shadcn, Apple workflows, research, and registries compete for the same first screen.
- Hid real download activity because it had no weekly-download badge.
- Gave people little reason or prompt to star after receiving value.
- Sent social copy toward the Studio workbench even though the current primary story is the read-only audit.
- Had a strong release and directory engine but no current platform-specific launch kit.

## Changes adopted

The new README:

- Leads with an original proof graphic, including a subtle dither treatment.
- Uses one first-run command.
- States the supported platforms and trust boundary immediately.
- Exposes npm weekly downloads, CI, stars, and license badges.
- Explains four steps: inspect, find, correct, verify.
- Moves deeper surfaces into one integration table.
- Adds a value-contingent star and show-and-tell request.
- Keeps Studio as a companion.
- Reduces the main README from 385 to fewer than 300 lines.

## Growth model

### Stars

Stars are earned when a visitor:

1. Recognizes a painful interface-agent problem.
2. Sees a credible visual or runnable proof.
3. Gets a result quickly.
4. Understands that the project is maintained.
5. Receives a direct, non-coercive request to star if the result helped.

The highest-leverage channels are:

- One strong Show HN, after the public website and proof repo are current.
- Audience-specific Reddit posts with distinct examples and active replies.
- Personal LinkedIn posts showing a real `file:line` finding and correction.
- Weekly public case studies from external repositories.
- Useful integrations contributed to relevant agent and frontend projects.

### npm downloads

npm downloads grow through legitimate repeated execution:

- `npx` trials from documentation and tutorials.
- A pinned Action in active repositories.
- Agent skills that invoke the CLI only when evidence is required.
- Starter templates that run Memi in verification.
- CI integrations and framework recipes.
- Repeat audits after interface changes.

Release-day verification traffic is not retained adoption. The scorecard must separate release windows from non-release baselines.

## Fork and reply policy

Mass-forking projects or dropping promotional replies will reduce trust and may trigger moderation.

Fork only when Memi adds a runnable, maintained integration:

- Preserve the upstream license and attribution.
- Keep the upstream product minimally changed.
- Add a pinned read-only workflow and evidence report.
- Explain that the fork demonstrates Memi integration and does not imply partnership.
- Offer the recipe upstream through an issue before opening a pull request.

Reply to a public thread only when the answer is useful without the Memi link. Disclose maintainer affiliation when linking the project.

## Eight-week targets

- 100 GitHub stars, then 250.
- 10 verified external repository integrations.
- 100 successful first audits.
- 25 repeat audits within 7 to 21 days.
- Four non-release weeks at least 25% above the kickoff median.
- At least one case study with a public before, correction, and verified rerun.

The north star remains verified adoption. Stars and downloads are distribution signals, not substitutes for repeat use.
