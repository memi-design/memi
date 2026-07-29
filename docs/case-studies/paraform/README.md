# Paraform design-intelligence efficiency case

- Revision: `0bbcacfc71fb3d383f66b20b5e2babd5f3063a1b`
- Surface: focused React product design system
- Quality: baseline 100/100; Memi 100/100
- Token savings: 33.3%
- Latency savings: -14.3%
- Tool-call savings: 28.6%
- Result: fewer tokens and tools, but slower end to end

The work corrected a real Memi inventory defect before measurement:
`src/app` feature modules were previously mislabeled as routes, producing
18 routes and zero components. The corrected graph reports zero routes and
24 components.

Paraform is small and centralized enough that full preflight interpretation can
cost more wall time than it removes. The new router abstains by default while
retaining a manual full-context override.

See [the consolidated study](../memi-2.7-six-repo/README.md).
