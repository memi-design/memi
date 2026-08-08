---
name: map-design-system
description: Map repository-backed design tokens, components, conventions, and verification commands before a frontend edit. Use for design-system-map, component-map, or token-map tasks when an agent must reuse the existing system instead of inventing one.
---

# Map Design System

Produce a compact, read-only map. Cite repository evidence; do not infer a system from visual taste.

## Route Contract

Accept only `design-system-map`, `component-map`, or `token-map`. Cover web, Expo, or SwiftUI when the repository proves the platform. Return the map as evidence for a later implementation skill; never edit source in this route.

## Repository Preconditions

- Start at a repository root with readable source and a revision identifier.
- Read repository instructions and the task's target surface.
- Require at least one platform signal: manifest, project file, framework dependency, or source import.
- Record the dirty-worktree state. Treat user changes as evidence, never cleanup targets.

## Required Evidence

Collect only task-relevant facts with file paths and line anchors:

1. Framework, package manager, and native verification commands.
2. Semantic tokens for color, type, spacing, radius, elevation, and motion.
3. Reusable primitives and composed components nearest the requested surface.
4. Route, state, breakpoint, theme, and accessibility conventions.
5. Missing or conflicting evidence as explicit unknowns.

Ignore dependencies, build output, generated artifacts, archives, credentials, and unrelated product areas. Prefer `rg --files` and focused `rg -n` queries. Do not load an entire design reference when direct source evidence is sufficient.

## Output

Return a bounded map with: revision; platform; target surface; reusable components; token sources; required states; verification commands; unknowns. Prefer ten evidence entries or fewer. Every recommendation must point to an entry.

## Verification Commands

Verify cited files still exist and rerun the focused searches used to build the map. Report repository-native typecheck, test, lint, or build commands from manifests; do not execute mutating generators or invent commands.

## Stop And Fallback

Stop when the root, platform, target, or evidence source cannot be established. Fall back to repository-only discovery and report the missing proof. Never create replacement tokens, components, or conventions from another repository's evidence.
