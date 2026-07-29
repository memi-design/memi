# Nate the Bait native iOS validation

## Scope

- Repository revision: `9cde918e309d74943457ad6def8a9c14db7ea01b`
- Product: native Swift 6, SwiftUI, and SpriteKit iOS game
- Memi candidate: `2.7.0`
- Repository writes: none; temporary benchmark and Xcode artifacts live outside
  the checkout

## Reproduce the static audit

```sh
npx -y @memi-design/cli@2.7.0 diagnose . \
  --json --no-write --fail-on none
```

The local candidate scanned 211 Swift files in 0.36 seconds. It reported one
high-confidence finding: 14 motion locations across six SwiftUI files lacked a
directly detected reduced-motion gate. It did not score rendered visual quality.
The report labeled SwiftUI coverage partial, set the overall confidence to
0.13, and named simulator and accessibility verification as missing evidence.

This abstention is part of the result. Static source cannot prove a native
screen’s rendered hierarchy, motion fallback, VoiceOver flow, or frame rate.

## Reproduce the Apple brief

```sh
npx -y @memi-design/cli@2.7.0 ios brief \
  --platform ios \
  --detail compact \
  --intent "Validate Nate the Bait without changing the app" \
  --json
```

The brief routes the work through SwiftUI design engineering, Swift Testing,
and Xcode build reliability. It requires project discovery, the selected
scheme and destination, exact build and test commands, reduced-motion behavior,
and a final evidence handoff.

## Native result

The `NateTheBait` scheme built for the `Nate QA iPhone 17` iOS 26.5 simulator
in 17.334 seconds with zero build warnings or errors.

The full unit and UI suite reached a terminal failure after approximately
16 minutes 49 seconds. The result summary reported 976 passed tests, 7 failed
UI tests, and 0 skipped tests. The failures included
`testReduceMotionGameplayAndCriticalSurfacesPassAccessibilityAudit`, plus
animated-skin, persistence, collision, results-navigation, and touch-steering
flows. The complete `.xcresult` remains machine-local evidence; this case is a
failed app-validation result, not a Memi release pass.

## Paired efficiency result

The isolated revision-matched pair completed at 100/100 quality in both
conditions:

- Baseline: 682,967 counted tokens, 138.577 seconds, 12 tools.
- Memi: 534,976 counted tokens, 157.449 seconds, 10 tools.
- Savings: 21.7% tokens and 16.7% tools.
- Regression: Memi was 13.6% slower.

The original baseline grade did not recognize standard relative GitHub
`#Lx-Ly` anchors. Its raw trace and failed grade were preserved. An immutable
`source-citations-v2` amendment regraded the same response at 31 valid
citations, zero invalid citations, and 100/100 without rerunning the model or
changing performance metrics.

Nate does not support a greater-than-25% efficiency claim. See
[the consolidated six-repository study](../memi-2.7-six-repo/README.md).
