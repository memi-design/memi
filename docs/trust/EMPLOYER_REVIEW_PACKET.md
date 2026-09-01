# Employer review packet

This packet is for an employer's security, legal, procurement, and engineering
owners. It does not ask an employee to decide company policy.

DualEntry and other internal repositories require written employer approval
before Memi is installed or run.

## Artifact identity

Complete every field from immutable release evidence:

| Field | Required value |
| --- | --- |
| Product | `@memi-design/cli` |
| Version and channel | Exact version; beta or stable |
| Source | Full Git commit SHA and repository URL |
| Artifact | npm integrity/digest or offline-bundle SHA-256 |
| Provenance | Attestation URL and verified subject digest |
| Platform | OS, architecture, Node/runtime version |
| Profile | `locked` unless a narrower exception is approved |
| Verification | Date, workflow run, test receipt, SBOM digest |

Verified claims are bound to version, source SHA, artifact digest, platform,
profile, and verification date.

## Review attachments

- [Threat model](THREAT_MODEL.md) and [egress map](EGRESS_MAP.md)
- [Data retention](DATA_RETENTION.md) and [uninstall/recovery](UNINSTALL_RECOVERY.md)
- [Dependency/license review](DEPENDENCY_LICENSE_REVIEW.md) and candidate SBOM
- [Supported-platform evidence](SUPPORTED_PLATFORMS.md)
- [Known limitations](KNOWN_LIMITATIONS.md) and [release truth](RELEASE_TRUTH.md)
- Public test, audit, provenance, checksum, and release-gate receipts for the
  exact artifact
- Managed Deep Security Scan result when stable or employer-safe use is proposed

## Approval decisions

The owner must explicitly decide:

- whether the exact artifact may be installed at all;
- which repositories and machines are in scope;
- whether `locked` use is permitted and for which deterministic commands;
- whether `.memi/` output may be created under `local`;
- whether any connected capability, destination, or data category is permitted;
- where receipts may be retained and for how long; and
- who owns rollback, incident response, and reapproval after an update.

Do not treat approval for one version, digest, profile, repository, machine, or
date as approval for another. Do not enable `connected` merely because `locked`
was approved.

## Suggested decision record

```text
Decision: approved | denied | approved with conditions
Artifact version:
Source SHA:
Artifact digest:
Platform/runtime:
Allowed profile:
Allowed commands:
Allowed repositories/machines:
Allowed egress destinations and data categories:
Receipt location and retention:
Expiration or re-review trigger:
Approver name/team and date:
Conditions and incident contact:
```

The employee should receive the completed record before installation. An absent,
verbal, ambiguous, or artifact-unbound answer means the tool is not approved.
