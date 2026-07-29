# Nyra design-intelligence efficiency case

- Revision: `071aca808d9a58317ae78eb687a781977f5a9754`
- Surface: patient and clinician product presentation source
- Quality: baseline 100/100; Memi 100/100
- Token savings: -18.7%
- Latency savings: -16.7%
- Tool-call savings: -16.7%
- Result: regression in every measured efficiency dimension

The task mapped design sources only. It made no claim about clinical behavior,
care quality, safety, or backend correctness.

Nyra demonstrates that repository size alone is not a sufficient routing
signal. Canonical care-theme and UI files were already discoverable, while the
generic preflight added context and did not eliminate deep feature inspection.
The new router selects compact index-only mode rather than full context.

See [the consolidated study](../memi-2.7-six-repo/README.md).
