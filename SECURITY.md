# Security Policy

## Supported Versions

Security fixes are shipped for the latest stable `@memi-design/cli` release.
Prereleases are supported only for evaluating the documented candidate and must
not be treated as stable or employer-approved. See [current release
truth](docs/CURRENT_RELEASE.md) and the [Trust Core release
contract](docs/trust/RELEASE_TRUTH.md).

## Reporting a Vulnerability

Report issues privately through a GitHub security advisory. Do not put secrets,
confidential source, or exploit details in a public issue. Include the exact
version, source SHA, artifact digest, platform/runtime, profile, command or MCP
tool, and minimal reproduction. State whether the path requires local project
access, a capability grant, network access, or an untrusted Note/archive.

## System and Scope

This policy covers the `@memi-design/cli` process, its MCP server, packaged
runtime dependencies and assets, execution-policy enforcement, and release
evidence in this repository. Project files, CLI arguments, environment values,
archives, Notes, registry data, Figma/MCP payloads, model output, and remote
responses are untrusted input.

Memi Studio, Memi Canvas, websites, Homebrew/GHCR, downloadable Notes, and
sibling repositories are separate boundaries. Memi Canvas and Memi Studio
remain independently gated.

## Threat Model and Trust Boundaries

The protected assets are repository and host integrity, credentials, confidential
source and prompts, bounded output, and artifact provenance. The important
boundaries are project reads/writes, `.memi/` containment, home-directory access,
subprocess execution, network/loopback egress, browser and Figma control, dynamic
code installation/loading, and build-to-consumer artifact identity.

See the detailed [threat model](docs/trust/THREAT_MODEL.md) and [egress
map](docs/trust/EGRESS_MAP.md).

## Security Invariants

- Locked is the default profile. `--offline` selects the same profile.
- `locked` grants no network, shell, project-write, home-write, browser, Figma,
  dynamic-install, telemetry, or source-content-persistence capability.
- `local` permits writes only beneath the selected project's real `.memi/`
  directory and denies symlink or traversal escape. It grants no network, shell,
  home write, browser, Figma, dynamic install, or telemetry.
- `connected` still starts with no effective capabilities. Every grant is
  explicit for one invocation and is not persisted.
- Side effects are denied before they start. Denials use
  `MEMI_CAPABILITY_DENIED` and do not disclose private paths, source, prompts, or
  credentials.
- Locked receipts are metadata-only. Saving a receipt requires an explicit
  output path and an allowed project write.
- Update and install flows use exact resolved versions and verified digests.
  Locked mode performs no update check.
- Release claims identify version, source SHA, artifact digest, platform,
  profile, and verification date.

## Reportable Findings and Severity Context

Report a realistic path that violates an invariant, crosses an ungranted
boundary, exposes confidential content, installs or executes unverified code,
escapes an authorized path, bypasses artifact verification, or turns untrusted
input into code execution or availability loss.

Critical or high severity includes reachable arbitrary code execution, secret or
source exfiltration, writes outside the authorized boundary, capability bypass,
or release/provenance substitution with meaningful consumer impact. Lower
severity depends on reachability, required grants, data sensitivity, and whether
the failure is fail-open or fail-closed.

## Out of Scope, Exclusions, and Accepted Risk

No vulnerability class is excluded merely because Memi is a developer tool.
Actions that a connected user explicitly grants are not findings by themselves,
but exceeding the named operation, destination, path, data category, or duration
is reportable. An unsupported platform or unavailable optional integration is a
product limitation when reported accurately; a boundary bypass is not.

The pending managed security scan is disclosed for beta evaluation only. It is
not accepted risk for stable or employer-safe claims.

## Known Limitations and Compensating Controls

The managed Codex Deep Security Scan is pending because this host does not
provide a managed filesystem permission profile. Stable and employer-safe claims
remain blocked until that scan completes with no unresolved critical or high
findings. Host sandboxing and network denial remain required independent checks;
an in-process policy is not a host security boundary.

DualEntry and other internal repositories require written employer approval
before Memi is installed or run. The [employer review
packet](docs/trust/EMPLOYER_REVIEW_PACKET.md) binds approval to an exact artifact
and profile. Additional limitations are tracked in [known
limitations](docs/trust/KNOWN_LIMITATIONS.md).
