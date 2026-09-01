# Trust Core threat model

## System boundary

Trust Core covers the `@memi-design/cli` executable, its MCP server when started
from that artifact, packaged runtime dependencies, bundled assets, execution
policy, and release evidence. The project repository being inspected is outside
Memi's trust boundary and must be treated as attacker-controlled input.

Memi Studio, Memi Canvas, websites, registries, Homebrew formulae, containers,
and downloadable Notes are separate distribution or execution boundaries. Their
existence does not extend a CLI verification result. Memi Canvas and Memi Studio
remain independently gated.

## Assets to protect

- Repository source, history, configuration, build output, and untracked work.
- Credentials in environment variables, configuration files, keychains, agent
  runtimes, package-manager configuration, and Git remotes.
- Host integrity, including the home directory, executable search path, browser,
  Figma session, and local services.
- Confidential prompts, source excerpts, reports, and receipts.
- Release integrity: version, source SHA, package or bundle digest, provenance,
  SBOM, checksums, and channel metadata.

## Attacker-controlled inputs

- Paths, filenames, symlinks, repositories, archives, JSON, markdown, design
  specs, policies, Notes, registry entries, Figma payloads, MCP input, and CLI
  arguments.
- Remote responses, redirects, downloaded packages, model output, browser
  content, and update metadata.
- Environment values and executables resolved through `PATH` in an untrusted
  shell environment.

## Trust boundaries

1. **CLI to project filesystem.** Reads must be bounded and writes must be
   policy-authorized. In `local`, writes resolve beneath the real `.memi/`
   directory and must reject traversal and symlink escape.
2. **CLI to host.** Home writes, child processes, browsers, dynamic installs,
   and local services are denied unless the active profile and per-run grant
   authorize them.
3. **CLI to network.** DNS, HTTP, WebSocket, model, registry, update, and Figma
   traffic are egress. Loopback is still a network capability.
4. **CLI to optional code.** Optional peers, Notes, generated code, plugins, and
   downloaded archives are untrusted until validated. Loading or executing them
   is a separate capability from reading metadata. Consumer-resolved optional
   peers require the per-run `host-integration-code` grant; that grant does not
   imply permission to install a package, use its network features, or persist
   its output.
5. **Build to user.** A Git tag, npm version, binary name, or passing source test
   is not artifact identity. The consumed bytes must match the recorded digest
   and provenance.

## Required security invariants

- `locked` is selected when no profile is specified and grants no capabilities,
  even if `--allow` flags are also supplied.
- `local` has no network, shell, browser, Figma, dynamic-install, telemetry, or
  home-write capability. Its only write boundary is project `.memi/`.
- `connected` starts with no effective capability. Each grant applies only to
  the current process and cannot be persisted by the CLI.
- Policy checks happen before the side effect, not after a failed attempt.
- Denials are structured as `MEMI_CAPABILITY_DENIED` without private absolute
  paths, credentials, source, or prompt content.
- Locked receipts contain only allowlisted metadata. Persisting any receipt
  requires an explicit path and an allowed project write.
- Receipt creation uses an exclusive, non-following leaf open where the platform
  supports it, then revalidates containment and matches pathname identity to the
  opened file handle before writing any receipt bytes through that same handle.
  The policy root must be a real directory, and nested output parents must
  already exist so recursive creation cannot cross a swapped symlink.
- Archive extraction, path resolution, and output creation reject traversal,
  symlink escape, special files, unsafe entry types, and unbounded input.
- Update and install flows use an exact resolved version and verified digest;
  locked mode performs no update check.
- A 2.7.9 to 2.8 upgrade does not silently overwrite user configuration or
  migrate legacy state without a reviewable recovery path.

## Abuse cases to test

- A command advertised as diagnostic opens a socket, spawns a process, writes a
  cache, or launches a browser before policy evaluation.
- A `.memi/` symlink or `..` path escapes into source, another repository, or the
  home directory.
- A receipt parent or leaf is replaced with a symlink after initial policy
  validation but before the output file is opened.
- A Note or archive uses absolute paths, alternate separators, hard links,
  device files, oversized entries, nested compression, or interrupted writes.
- A receipt, error, log, or crash report includes source, prompts, secrets, or
  absolute private paths.
- A release channel points at bytes that do not match the version's provenance,
  checksum, SBOM, or public gate.

## Non-goals

Trust Core does not make an employer approve a tool, make third-party models
confidential, secure a compromised operating system, or certify sibling
products. It reduces and makes visible the CLI's own authority.
