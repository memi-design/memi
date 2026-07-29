# DoriOS design-intelligence efficiency case

- Revision: `18698932e45878a3eab1f5b114dfa5f9c2f58744`
- Surface: web, Tauri, native, offline, map, and visualization UI sources
- Quality: baseline 100/100; Memi 100/100
- Token savings: 60.1%
- Latency savings: 28.2%
- Tool-call savings: 30.8%
- Result: passed the 25% threshold on all measured efficiency dimensions

DoriOS is the strongest current fit for Memi. Its supported UI evidence is
distributed across multiple frameworks and presentation surfaces, so the
bounded source map removed substantial discovery work. Data assets were
excluded from UI evidence.

This single case does not establish an aggregate release claim. See
[the consolidated study](../memi-2.7-six-repo/README.md).
