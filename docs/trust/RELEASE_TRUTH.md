# Trust Core release truth

Verified claims are bound to version, source SHA, artifact digest, platform,
profile, and verification date.

## Status language

| Status | Permitted language | Prohibited inference |
| --- | --- | --- |
| Development | "implemented on a branch" or "test pending" | Installable, verified, beta, stable, or safe for internal use |
| Beta candidate | "candidate; gates in progress" | Published or verified before the artifact exists |
| Published beta | "verified on the named platform/profile subject to listed limitations" | Stable, employer-approved, or organization-wide certification |
| Stable | "all stable gates passed for this exact artifact" | Risk-free, universally safe, or approved by an employer |

Beta `2.8.0-beta.1` may use npm's `next` tag and a GitHub prerelease only after
its local, packed-artifact, dependency, security, bundle, and cross-platform beta
gates pass. npm `latest` remains on 2.7.9 during the beta.

Stable 2.8 requires:

- the frozen release candidate to pass the full matrix without code changes;
- zero unresolved critical or high security findings;
- the managed Deep Security Scan to complete in a supported managed-permission
  environment;
- production dependency audit, license inventory, SBOM, provenance, checksums,
  and performance/package budgets;
- `failures: []` and `parityEligible: true` from the public release gate; and
- independent verification of npm, GitHub Release, MCP Registry, Homebrew, GHCR,
  offline downloads, website metadata, documentation, and fresh installs.

## Evidence record

Each claim record must include:

```json
{
  "version": "2.8.0-beta.1",
  "channel": "next",
  "sourceSha": "<full git sha>",
  "artifact": { "name": "<file or package>", "sha256": "<digest>" },
  "platform": { "os": "<os>", "arch": "<arch>", "runtime": "<version>" },
  "profile": "locked",
  "verifiedAt": "<ISO-8601 timestamp>",
  "receipts": ["<immutable evidence reference>"],
  "limitations": ["<open limitation>"]
}
```

An empty placeholder, branch SHA without artifact digest, source-tree test, or
mutable channel name is not release evidence.

## Rollback truth

Rollback repoints mutable channels such as npm `latest`, Homebrew, GHCR, and
website guidance to the last verified release, expected to be 2.7.9 during the
2.8 beta. Published npm bytes remain immutable: deprecate a bad version and
publish a corrected one rather than replacing its evidence.
