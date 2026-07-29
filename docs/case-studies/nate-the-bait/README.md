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

## Paired efficiency experiment

`tasks.json` defines three repository-specific tasks. Generate the randomized
18-trial plan with:

```sh
memi benchmark plan docs/case-studies/nate-the-bait/tasks.json \
  --suite nate-the-bait-2.7 \
  --experiment memi-2.7-nate \
  --repeats 3 \
  --seed 270 \
  --out /tmp/nate-the-bait-benchmark-plan.json \
  --json
```

Run every trial on the same clean revision, harness, model, and reasoning
setting. Record both baseline and Memi runs with `memi benchmark record`, then
evaluate them with:

```sh
memi benchmark report \
  --suite nate-the-bait-2.7 \
  --minimum-pairs 5 \
  --bootstrap-samples 2000 \
  --seed 270 \
  --target 0.25 \
  --out /tmp/nate-the-bait-efficiency-report.json \
  --json
```

The current report is `insufficient_evidence`: zero paired agent runs have been
recorded. No token, cost, latency, or quality saving is claimed.
