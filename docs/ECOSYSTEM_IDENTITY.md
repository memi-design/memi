# Memi ecosystem identity

This is the current identity contract for Memi 2.7.7 across source, npm, MCP
directories, and compatibility aliases. Version truth remains in
[CURRENT_RELEASE.md](./CURRENT_RELEASE.md); the machine-readable identity and
live-check receipt is
[`release-artifacts/identity/2.7.7.identity.json`](../release-artifacts/identity/2.7.7.identity.json).

## Canonical publisher

| Surface | Canonical identity | Current state |
| --- | --- | --- |
| GitHub | [`memi-design/memi`](https://github.com/memi-design/memi) | Canonical source repository |
| npm | [`@memi-design/cli`](https://www.npmjs.com/package/@memi-design/cli) | 2.7.7 published with provenance |
| Official MCP Registry | [`io.github.memi-design/memi`](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.memi-design%2Fmemi) | 2.7.7 published |
| Smithery | `memi-design/memi` | Migration pending; organization listing is not live |
| Homebrew | [`memi-design/homebrew-memi`](https://github.com/memi-design/homebrew-memi) | Canonical tap |

The legacy Official MCP Registry identity has two deliberately separate states:
Memi policy marks `io.github.sarveshsea/memi` deprecated for new integrations,
while the upstream registry still reports 12 historical versions as `active`,
through `2.7.4`. The observed registry state is evidence, not current ownership
or support policy.

## Smithery migration pending

`memi-design/memi` is the intended Smithery publish target. The package command
uses that qualified name, but a successful command and post-publish API check
are required before the organization listing can be described as live.

`sarveshsea/memi` remains operational only as a deprecated compatibility alias.
It is retained temporarily so existing consumers do not break during migration;
it must not appear as the owner in new install guidance, directory submissions,
or release announcements.

Retire the compatibility alias only after all of these are true:

1. `npm run publish:smithery` succeeds for `memi-design/memi`.
2. `https://api.smithery.ai/servers/memi-design%2Fmemi` returns the organization
   qualified name.
3. The public organization listing loads and exposes the expected Memi tools.
4. Current docs link the organization URL and no supported integration depends
   on the compatibility alias.

## Historical personal URLs

Personal repository and registry URLs remain valid only inside immutable
release receipts, dated audits, research artifacts, and changelog history where
changing the URL would falsify provenance. Current manifests and instructions
use the organization identities above.
