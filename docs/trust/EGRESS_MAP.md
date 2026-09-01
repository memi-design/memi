# Trust Core egress map

`locked` and `local` deny network activity. `connected` also denies it until the
current invocation includes the required grant. Loopback connections count as
network activity because they can reach other local processes.

| Surface | Typical destination | Data that may leave the process | Required review | `locked` / `local` |
| --- | --- | --- | --- | --- |
| npm metadata and updates | `registry.npmjs.org` | Package name, version, normal client metadata | Exact requested version, digest, provenance, update capability | Denied; no update check |
| GitHub releases and Notes | `api.github.com`, `github.com`, `raw.githubusercontent.com` | Repository/ref, request metadata; downloaded archive or manifest | Network plus dynamic-install capability where installation follows | Denied |
| Memi website catalogs | `memoire.cv` | Requested catalog or artifact path | Network capability and artifact verification | Denied |
| MCP Registry | `registry.modelcontextprotocol.io` | Server identity and version query | Network capability | Denied |
| Figma REST | `api.figma.com` | File key, token-authenticated request, design payload | Network and Figma capabilities; employer approval for confidential designs | Denied |
| Figma plugin bridge | loopback ports 9223-9232 | Plugin handshake and requested design data | Network and Figma capabilities; authenticated pairing | Denied |
| Model providers | Configured HTTPS endpoint; local providers may use loopback | Prompt and any content explicitly included by the command | Network capability, destination review, data-processing approval | Denied |
| Browser automation | User-selected URL and browser runtime | URL, cookies/profile data available to the chosen browser, interaction data | Browser and network capabilities; optional runtime installed separately | Denied |
| Consumer-resolved optional peer | Local Node package resolution | Host-supplied executable package code enters the process | `host-integration-code`; feature-specific capabilities remain separate | Denied |
| Package or runtime install | npm or another explicitly selected registry | Package/version request and package-manager metadata | Network, shell, and dynamic-install capabilities; exact version only | Denied |
| Publication | npm, GitHub, MCP Registry, GHCR, Homebrew, website | Release artifacts and publishing credentials used by the external tool | Explicit release workflow outside normal diagnosis | Denied |
| Telemetry | None in the locked contract | No event or source payload | A future endpoint requires a documented opt-in and separate grant | Denied |

## Source-content rule

Network permission means egress is technically possible; it is not permission
from an employer or repository owner to transmit source. Commands that can send
prompts, source, screenshots, design payloads, or reports must identify those
fields before execution. Do not use a model, Figma, browser, or publication flow
on an internal repository unless the approval packet explicitly permits the
destination and data category.

## Verification procedure

The release E2E suite must run the packed artifact in a non-root, read-only
container with `--network none`, then run locked diagnosis and doctor commands.
The test fails on any attempted socket, subprocess, home write, or project write.
Connected tests must use local fakes and assert that the side effect is not
observed before its matching grant.
