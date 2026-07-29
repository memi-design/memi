# Buzzr design-intelligence efficiency case

- Revision: `7583ab4788e5f3554c479ce886d9d75e8eefb0ba`
- Surface: real Expo and React Native iOS application source
- Quality: baseline 100/100; Memi 100/100
- Token savings: -3.7%
- Latency savings: 13.4%
- Tool-call savings: 0.0%
- Result: regression on tokens; no verified efficiency win

The task mapped actual theme, typography, layout, screen, navigation, button,
card, tab-bar, and feature component sources. It did not use App Store
advertising images as design-system evidence.

The generic web analyzer currently misrepresents this React Native repository
as a web ruleset. The new routing policy therefore abstains from expanded
context until a React Native-specific analyzer is available.

See [the consolidated study](../memi-2.7-six-repo/README.md).
