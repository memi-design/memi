# Dependency and license review

This is the release checklist for the artifact consumers install. The existing
[dependency trust ledger](../DEPENDENCY_TRUST.md) records the 2.7.x source
baseline; it is not evidence for an unbuilt 2.8 artifact.

## Required evidence per candidate

- The production dependency tree from the packed artifact, not the development
  checkout.
- A production-only shrinkwrap and clean-install receipt proving build, test,
  browser, TypeScript, and release tooling are absent from the default install.
- CycloneDX SBOM plus its SHA-256 digest.
- Dependency and transitive-license inventory, including package name, exact
  version, license identifier, source URL, and notice requirement.
- `npm audit --omit=dev` output with zero known production vulnerabilities at
  publication time. This is one signal, not a general security guarantee.
- Dynamic-import review showing that absent optional integrations fail with an
  exact, versioned opt-in command and do not install themselves.
- Package file list, lifecycle-script inspection, packed and unpacked sizes,
  file count, and installed footprint.

## Package policy

- `@memi-design/cli` remains MIT licensed; bundled third-party code retains its
  original license and attribution.
- Anthropic, Playwright, native canvas, and similar integration runtimes are
  optional peers rather than default consumer weight.
- Release tooling uses exact versions. Release or runtime instructions must not
  use `npx ...@latest`.
- The published package has no install lifecycle script.
- Optional code is not loaded until its feature is invoked and the active
  execution policy permits the operation.
- Offline bundles include `LICENSE`, third-party notices, the SBOM, checksums,
  and the runtime needed for first use without a dependency download.

## Review disposition

Record every dependency as `required`, `optional integration`, `development
only`, or `remove`. A missing license, nonstandard license, unexplained runtime
dependency, install script, mutable download, or critical/high production
advisory blocks the beta. The final inventory must name the candidate version
and artifact digest; reviewing `package.json` alone is insufficient.
