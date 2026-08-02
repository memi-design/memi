# Weekly Growth Scorecard

Use this every Friday during the current public-growth window. Record the value, source URL, and one action for the next week.

## Baseline

- Current public release: `@memi-design/cli@2.7.7`
- Public npm latest before v2 publish: `1.1.1`
- Public npm latest before the 2.5 publish command: `2.4.1`
- Latest complete npm window: 697 downloads for 2026-07-18 through 2026-07-24 and 2,787 downloads for 2026-06-25 through 2026-07-24.
- Trend context: the previous seven-day bucket had 348 downloads and the seven days before that had 1,538. The latest week doubled from the prior week, but release and verification activity still need to be excluded before claiming retained adoption.
- Current GitHub baseline: 28 stars and 4 forks.
- Benchmark context: CodeAlmanac has 709 stars and 65 forks, but its retired npm package recorded only 23 downloads in the matching week. Its current PyPI badge showed 630 weekly downloads. Memi's immediate gap is GitHub discovery and social proof, not package activity.
- 10x target from the 2026-07-08 baseline: 7,830 weekly downloads and 13,060 monthly downloads.
- Primary CTA: `https://www.npmjs.com/package/@memi-design/cli`
- Primary story: `Memi is the design layer for agentic AI.`
- Secondary phrase: `File-anchored design QA evidence before coding agents edit UI`
- Core proof: `memi diagnose`, `memi ux audit --json`, `memi craft audit --json`, `memi tokens --from ./src --report`, `memi shadcn export --out public/r`
- Agent proof: `npx skills add memi-design/memi --skill memoire-design-tooling`
- MCP proof: `memi mcp start --no-figma`

## Targets

- Week 1: npm latest remains aligned with `package.json`, the public release gate passes, Agent Skills discovery passes, MCP Registry metadata is refreshed, and active `memoire.cv` docs show the same current release story.
- Week 2: current public copy is still consistent, the first audit path remains runnable, and at least three external guides or proof repos link to runnable memi evidence.
- Week 4: the measured non-release daily baseline is improving toward the `24` median target and at least five verified external integrations are live.
- Week 8: ten verified external integrations are live, one hundred successful first audits are logged, twenty-five repeat audits are verified within 7 to 21 days, and four consecutive non-release weeks meet or exceed the `24` median daily download threshold.

## Scorecard

| Week | npm latest | Weekly downloads | Monthly downloads | GitHub stars | README phrase | Agent Skills install | MCP Registry | Main action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | `1.1.1` | TBD | TBD | TBD | v2 draft | local pass | pending v2 | Publish v2 and run public gates |
| 2026-07-08 | `2.4.1` | `783` | `1306` | `17` | live v2 | local pass | current at `2.4.1` | Seed proof repos and MCP directories |
| 2026-07-18 | `2.6.2` | `354` | `2151` | `29` | design QA skills | 4 published / index catching up | current at `2.6.2` | Convert direct trials and reproducible proof dependencies |
| 2026-07-27 | `2.6.3` | `697` | `2787` | `28` | deterministic audit | 4 published / 7 installs | current at `2.6.3` | Ship focused README and problem-led community launch |
| Week 3 | | | | | | | | |
| Week 4 | | | | | | | | |
| Week 8 | | | | | | | | |

Quick checks:

```bash
npm run growth:status
npm view @memi-design/cli version dist-tags.latest mcpName --json
npm run check:public-release
```

## Source URLs

- npm latest: `https://registry.npmjs.org/%40memi-design%2Fcli`
- npm weekly downloads: `https://api.npmjs.org/downloads/point/last-week/%40memi-design%2Fcli`
- npm monthly downloads: `https://api.npmjs.org/downloads/point/last-month/%40memi-design%2Fcli`
- npm daily range: `https://api.npmjs.org/downloads/range/last-month/%40memi-design%2Fcli`
- GitHub metadata: `https://api.github.com/repos/memi-design/memi`
- npm package page: `https://www.npmjs.com/package/@memi-design/cli`
- Components page: `https://www.memoire.cv/components`
- Codex plugin page: `https://www.memoire.cv/codex-plugin`

## Weekly review questions

- Did npm latest match the repo release?
- Did the first README screen say `the design layer for agentic AI` and present one clear start path?
- Did the first code block still prove value without Figma?
- Did Agent Skills install and MCP startup still work?
- Which post, directory, agent stack, example, or tutorial created the most clicks?
- Which command was the fastest path to activation: `diagnose`, `ux audit`, `craft audit`, `tokens`, `shadcn export`, `agent install`, or `mcp start`?
- What one friction point should be removed before the next post?
