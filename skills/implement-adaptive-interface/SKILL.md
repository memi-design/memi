---
name: implement-adaptive-interface
description: Implement responsive layout, adaptive interaction, and complete interface states using repository evidence. Use for responsive-layout, adaptive-interaction, or interface-state-implementation tasks after the target design system and verification contract are known.
---

# Implement Adaptive Interface

Make the smallest evidence-backed change that works across the task's declared sizes, input modes, themes, and states.

## Route Contract

Accept only `responsive-layout`, `adaptive-interaction`, or `interface-state-implementation`. Support web, Expo, and SwiftUI only when repository evidence identifies the platform. Use one implementation skill; compose a second skill only for a distinct verification requirement.

## Repository Preconditions

- Require a target route or component, acceptance criteria, and an existing design-system map.
- Require declared viewport or device classes plus loading, empty, error, and success expectations relevant to the task.
- Read repository instructions, current tests, and dirty-worktree state before editing.
- Reuse mapped components and semantic tokens unless the task explicitly authorizes a new primitive.

## Required Evidence

Preserve paths and line anchors for the reused components, tokens, state owner, breakpoint or adaptive rule, and repository-native checks. Capture the pre-change rendered behavior when a runnable target exists. Record pointer, keyboard, focus, reduced-motion, theme, and orientation requirements only when applicable.

## Implementation

1. Keep content and actions available without relying on one screen size or input mode.
2. Prefer fluid constraints and natural reflow over device-name branches.
3. Preserve semantic control roles, visible focus, logical focus order, and minimum target sizing.
4. Implement required loading, empty, error, disabled, and success states through the existing state owner.
5. Respect reduced motion and avoid motion required to understand state.
6. Run the focused checks once, repair only evidence-bearing failures, then rerun once.

## Verification Commands

Run commands declared by the task contract or repository manifests. For web, prefer focused component tests and Playwright journeys at declared desktop and mobile viewports. For Expo, use the repository's deterministic simulator journey. For SwiftUI, use its scheme-specific build or XCUITest command. Add typecheck, lint, or build only when the repository defines them. Capture command, exit status, and artifact paths.

## Stop And Fallback

Stop before mutation when the target, state owner, design evidence, or acceptance criteria are missing. Stop after two implementation attempts or any critical regression. Fall back to repository-only discovery with a precise missing-evidence report; never broaden scope, fabricate rendered proof, or silently substitute a different platform.
