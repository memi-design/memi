# Supported platforms and sandbox contract

Support is a release-evidence claim, not an inference from TypeScript compiling.
Each candidate must be tested from the packed npm artifact and, where applicable,
from the exact downloadable bundle.

## Required npm matrix

| Operating system | Node 20 | Node 22 | Node 24 | Required evidence |
| --- | --- | --- | --- | --- |
| macOS | Required | Required | Required | Clean install, full tests, packed-artifact E2E |
| Ubuntu Linux | Required | Required | Required | Clean install, full tests, packed-artifact E2E |
| Windows | Required | Required | Required | Clean install, full tests, packed-artifact E2E |

## Required offline bundles

| Target | 2.8 stable requirement |
| --- | --- |
| macOS arm64 | Signed bundle, checksum, SBOM, no first-run download |
| macOS x64 | Signed bundle, checksum, SBOM, no first-run download |
| Linux x64 | Signed bundle, checksum, SBOM, no first-run download |
| Linux arm64 | Signed bundle, checksum, SBOM, no first-run download |
| Windows x64 | Signed bundle, checksum, SBOM, no first-run download |

The 2.7.9 source tree has binary targets for macOS arm64/x64, Linux x64, and
Windows x64. Linux arm64 and the complete Trust Core bundle contents remain
required 2.8 work until their exact artifacts pass the release gates.

## Sandbox acceptance

The packed artifact must pass on Linux amd64 and arm64 as a non-root user with:

- a read-only repository;
- a read-only home directory;
- `--network none`;
- no available child-process execution for the locked diagnosis path; and
- no preinstalled optional browser, model, Figma, or canvas integration.

`memi --version` must start cold within one second and locked diagnosis of the
standard fixture within five seconds on the release runners. The npm tarball is
limited to 1.5 MB packed, 3 MB unpacked, and 100 files; the default installation
is limited to 60 MB.

Performance budgets are enforced only on native release runners. The Linux
arm64 QEMU job runs the same networkless, read-only behavioral suite with a
bounded 30-second command watchdog, reports its measured timings as
`performanceMode: conformance`, and does not use emulation overhead as product
latency evidence. Native Linux arm64 release evidence must still satisfy the
published startup budgets before that platform is marked verified.

No platform is listed as verified until the release record names its runner,
Node or bundle runtime, artifact digest, profile, date, and passing receipt.
Receipt containment evidence must include the deterministic parent-symlink swap
regression on every supported operating system. Because Node does not expose one
portable directory-handle-relative create API across this matrix, the candidate
must prove that receipt bytes are written only after exclusive open, post-open
containment, and pathname-to-handle identity validation on each platform.
