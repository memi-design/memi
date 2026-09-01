# Memi Trust Core

This directory is the review surface for the `@memi-design/cli` 2.8 Trust Core
candidate. It defines the intended security boundary and the evidence required
before a release claim. It does not certify an unpublished build.

## Current status

| Item | Status on 2026-08-31 |
| --- | --- |
| Public CLI | 2.7.9 remains the published stable release. |
| 2.8 Trust Core | Candidate work; not yet published or approved for internal use. |
| Default execution profile | `locked` is the 2.8 contract. Locked is the default profile. |
| Managed security scan | Pending on a host with a managed filesystem permission profile. |
| Studio and Canvas | Separate products with separate release and security gates. |

Verified claims are bound to version, source SHA, artifact digest, platform, profile, and verification date.
A result from one build, operating system, or profile must not be generalized to another.

DualEntry and other internal repositories require written employer approval before Memi is installed or run.
Approval must name the exact artifact and profile; an open-source license or a
passing public test suite is not approval.

Memi Canvas and Memi Studio remain independently gated.

## Profile contract

| Profile | Network | Shell | Writes | Integrations |
| --- | --- | --- | --- | --- |
| `locked` | Denied | Denied | Denied | Browser, Figma, installs, updates, telemetry, and source persistence denied. |
| `local` | Denied | Denied | Only beneath the real project `.memi/` directory | Remote and home-directory integrations denied. |
| `connected` | Denied unless granted for that invocation | Denied unless granted for that invocation | Denied unless the matching capability is granted | Every integration requires an explicit, repeatable `--allow` grant. |

`--offline` is an alias for `--profile locked`. A denied operation returns the
structured error code `MEMI_CAPABILITY_DENIED` and identifies the command and
required capability. Grants are not saved for later invocations.

## Review map

- [Threat model](THREAT_MODEL.md)
- [Egress map](EGRESS_MAP.md)
- [Data retention](DATA_RETENTION.md)
- [Uninstall and recovery](UNINSTALL_RECOVERY.md)
- [Dependency and license review](DEPENDENCY_LICENSE_REVIEW.md)
- [Supported platforms](SUPPORTED_PLATFORMS.md)
- [Employer review packet](EMPLOYER_REVIEW_PACKET.md)
- [Known limitations](KNOWN_LIMITATIONS.md)
- [Release truth](RELEASE_TRUTH.md)
- [Organization compatibility](ORG_COMPATIBILITY.md)

For vulnerability reporting and the scanner boundary, see the repository
[security policy](../../SECURITY.md).
