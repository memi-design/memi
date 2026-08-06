---
name: verify-interface-accessibility
description: Verify frontend semantics, keyboard and focus behavior, contrast, motion, and native accessibility evidence. Use for accessibility-check, keyboard-focus-verification, or semantic-interface-verification tasks after a runnable target and acceptance contract exist.
---

# Verify Interface Accessibility

Verify the requested surface without changing product source. Separate static findings from rendered or native proof.

## Route Contract

Accept only `accessibility-check`, `keyboard-focus-verification`, or `semantic-interface-verification`. Verify web, Expo, or SwiftUI only when the repository and task contract agree on the platform. This route produces evidence and a pass/fail decision, not an implementation.

## Repository Preconditions

- Require the target route, screen, or component and its critical user journey.
- Require explicit expected states and a runnable verification command for rendered claims.
- Read repository instructions, applicable accessibility policy, and dirty-worktree state.
- Confirm the artifact under test comes from the current revision.

## Required Evidence

Collect source anchors plus fresh artifacts for applicable checks:

- Accessible name, role, value, grouping, heading, landmark, and error association.
- Keyboard reachability, logical focus order, visible focus, focus restoration, and escape behavior.
- Text and non-text contrast, zoom or text scaling, target size, orientation, and reduced motion.
- Loading, empty, error, disabled, and success announcements.
- Web: viewport, Playwright trace or screenshot, and axe result.
- Expo or SwiftUI: simulator identity, accessibility hierarchy, deterministic journey, and screenshot.

Do not treat a screenshot, static scan, or model judgment alone as interaction proof.

## Verification Commands

Run the task-contract commands unchanged. For web, run the focused test journey at every declared viewport and the repository's axe integration. For Expo or SwiftUI, run the named simulator journey and capture its accessibility hierarchy. Run repository-native typecheck or build only when required to admit the artifact. Record exact command, revision, exit status, environment, and content-addressed artifact path.

## Decision

Fail on a critical blocked journey, missing accessible identity, keyboard trap, focus loss, inaccessible error, or required native artifact. Otherwise report each check as pass, fail, or not evaluated; never convert missing evidence into a pass.

## Stop And Fallback

Stop rendered claims when the target cannot launch, the artifact is stale, or required capture is missing. Fall back to a labeled static source review and repository-only discovery. Do not modify source, impute results, suppress a failure, or claim WCAG conformance beyond the executed checks.
