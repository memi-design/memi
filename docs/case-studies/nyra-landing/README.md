# Nyra Landing design-intelligence efficiency case

- Revision: `bbf77999046f695ff1144f9e7096db29b89a2c7c`
- Surface: global styles, CSS modules, brand assets, content, and shared React components
- Quality: baseline 100/100; Memi 100/100
- Token savings: 26.8%
- Latency savings: 6.0%
- Tool-call savings: -166.7%
- Result: modest token/latency benefit with severe tool expansion

The Memi run used 24 tools versus 9 in baseline. A context system that narrows
tokens while prompting more searches is not a successful route. The new policy
abstains on this low-discovery-complexity repository.

See [the consolidated study](../memi-2.7-six-repo/README.md).
