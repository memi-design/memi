# Memi organization compatibility inventory

Observed from the GitHub organization on 2026-08-31. This is a routing inventory,
not proof that every repository passed Trust Core. Private repositories are not
listed in this public document and require an owner-maintained internal review.

Memi Canvas and Memi Studio remain independently gated.

| Public repository | Trust Core relationship | 2.8 disposition |
| --- | --- | --- |
| [`memi-design/memi`](https://github.com/memi-design/memi) | CLI, MCP, skills, action, release evidence | Core scope; exact artifact must pass all gates |
| [`memi-design/memi-studio`](https://github.com/memi-design/memi-studio) | Native macOS workbench consuming engine/runtime surfaces | Independent release and security gate; not certified by CLI beta |
| [`memi-design/memi-canvas`](https://github.com/memi-design/memi-canvas) | Local-first canvas workbench marked WIP | Independent gate; no production or employer-safe claim |
| [`memi-design/homebrew-memi`](https://github.com/memi-design/homebrew-memi) | CLI and Studio distribution | Promote only after formula/cask digest and fresh-install verification |
| [`memi-design/design-skills`](https://github.com/memi-design/design-skills) | Governed skills and downloadable Notes | Content/license/archive audit required; CLI gate does not certify every skill |
| [`memi-design/design-sandbox`](https://github.com/memi-design/design-sandbox) | Public compatibility canary | Must test the packed locked artifact offline before claiming compatibility |
| [`memi-design/audit-frontend-design`](https://github.com/memi-design/audit-frontend-design) | Focused skill | Validate bundled/exported copy and source attribution independently |
| [`memi-design/remember-design-system`](https://github.com/memi-design/remember-design-system) | Focused skill | Validate bundled/exported copy and source attribution independently |
| [`memi-design/enforce-design-ci`](https://github.com/memi-design/enforce-design-ci) | Focused skill and CI surface | Verify immutable action refs and locked behavior independently |
| [`memi-design/mermaid-jam`](https://github.com/memi-design/mermaid-jam) | Local FigJam integration | Separate plugin, network, input-validation, and release gate |
| [`memi-design/chatbot`](https://github.com/memi-design/chatbot) | Maintained proof fork | Compatibility evidence only; not a core release blocker |
| [`memi-design/ripple-image-transitions`](https://github.com/memi-design/ripple-image-transitions) | Maintained proof fork | Compatibility evidence only; preserve upstream/license boundary |
| [`memi-design/.github`](https://github.com/memi-design/.github) | Organization profile and community health | Governance/docs consistency check; no executable certification |

## Compatibility receipt

Each sibling check records repository, immutable commit, Memi artifact digest,
platform/runtime, profile, command, result, and date. Use `unsupported`, `WIP`,
or `not tested` instead of treating absence of a failure as success.

The CLI beta is not blocked by a sibling unless that repository publishes the
same capability or release claim. It is blocked from making an organization-wide
claim until every named surface has its own compatible receipt.
