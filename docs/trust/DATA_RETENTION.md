# Trust Core data retention

## Default behavior

Locked is the default profile. It may read repository content required for the
selected deterministic command, but it does not write project or home state,
contact a remote service, emit telemetry, or persist source content. Locked
receipts go to stdout and contain metadata only.

Allowed receipt fields are limited to tool version, source commit, command,
profile, effective capability names, rule IDs, counts, cryptographic hashes,
duration, and schema version. Source excerpts, prompts, credentials, arbitrary
environment values, and absolute private paths are prohibited.

## Data locations

| Location | Purpose | Profile requirement | Retention owner |
| --- | --- | --- | --- |
| stdout/stderr | Human output or metadata-only JSON | All profiles | Calling process or redirected destination |
| Project `.memi/` | Explicit receipts and Trust Core local state | `local`, or an allowed connected project write | Repository owner |
| Home `~/.memoire/` | Legacy configuration, plugin pairing, or explicitly enabled integration state | Connected plus home-write grant | Machine owner |
| User-selected output | Export explicitly requested by the operator | Matching write capability and bounded path | Operator |
| Provider or integration | Data sent during a connected command | Matching per-run grant and external approval | External provider under its own policy |

Legacy `.memoire/` project directories are not part of the 2.8 local write
allowlist. An upgrade may read them only for compatibility and must not overwrite
or delete them without an explicit migration and recovery step.

## Retention rules

- No capability grant is stored for a future invocation.
- No secret is written into a receipt, log, crash message, or diagnostic report.
- Metadata hashes must not be reversible encodings of source content.
- Interrupted writes use a bounded temporary file inside the authorized output
  directory and either complete atomically or leave the prior artifact intact.
- Memi does not set an employer's retention period. Teams must apply their own
  repository, log, backup, and provider policies to any explicitly saved output.
- Deleting Memi does not delete generated source or user-created specifications.

Review [uninstall and recovery](UNINSTALL_RECOVERY.md) before removing local or
home state.
