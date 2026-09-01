# Known limitations

## Candidate status

- The public stable CLI remains 2.7.9. Trust Core 2.8 documentation describes a
  candidate contract until an exact beta artifact and evidence set are published.
- The managed Codex Deep Security Scan is pending because this host does not provide a managed filesystem permission profile.
- A beta may disclose that pending scan. Stable and employer-safe claims require
  a completed independent scan with no unresolved critical or high findings.
- `TRUST_CORE_BETA_PENDING_DESIGNWORKBENCH_EVIDENCE` means the
  `reviewed-candidate-audit` and `swiftui-rendered-rerun` receipts remain stale.
  This named exception applies only to the 2.8.0-beta.1 candidate; stable remains
  blocked until both receipts are refreshed.
- Existing 2.7.9 binaries and npm artifacts must not be described as locked by
  default merely because the 2.8 source branch adds that behavior.

## Boundary limitations

- Execution policy reduces Memi's authority; it cannot secure a compromised OS,
  runtime, package manager, browser profile, model provider, or Figma account.
- Network denial inside Memi is not a host firewall. Release E2E therefore also
  tests the artifact with networking disabled outside the process.
- Metadata-only output can still reveal counts, rule identifiers, timing, and
  hashes. Employers must decide whether that metadata is acceptable.
- Content read for a locked deterministic command exists in process memory while
  the command runs. Locked prohibits persistence and egress, not the read needed
  to perform the requested local analysis.
- Optional integrations expand the boundary and require separate dependencies,
  capabilities, destinations, credentials, and employer review.
- The legacy uninstall script is destructive and is not the Trust Core
  preserve-first uninstall path.

## Product and organization limitations

- Memi Canvas and Memi Studio remain independently gated.
- A passing CLI gate does not certify Homebrew, GHCR, MCP Registry, website,
  focused-skill, sandbox, fork, Canvas, or Studio artifacts.
- Public organization inventory cannot disclose or certify private repositories.
- Employer authorization is external evidence; Memi cannot infer it from a flag,
  repository name, email domain, or license.

Report a limitation as resolved only when the release record points to the exact
artifact and independent evidence that closes it.
