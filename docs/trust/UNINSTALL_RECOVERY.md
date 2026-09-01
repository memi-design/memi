# Uninstall and recovery

Use a preserve-first process. Do not recursively delete a project, home
directory, package-manager prefix, or unresolved environment-variable path.

## Before install or upgrade

1. Record the exact CLI version, source SHA, package or bundle SHA-256, platform,
   profile, and verification date.
2. Inventory existing `.memi/` and legacy `.memoire/` directories without
   changing them.
3. Copy any existing Memi state to a named backup outside the directory that an
   uninstall will target. Verify the copy before continuing.
4. Install into a disposable project or sandbox first. Do not point the first
   run at an employer repository.

An explicit 2.7.9 to 2.8 upgrade must preserve user configuration. The release
E2E gate compares configuration before and after the upgrade and fails on an
unrequested overwrite, deletion, or migration.

## Remove the executable

- npm installation: run `npm uninstall --global @memi-design/cli` using the same
  Node installation and package prefix used to install it.
- Standalone bundle: remove only the exact extracted bundle directory after
  confirming its path and retained backups.
- Homebrew: use the formula or cask name recorded at install time. CLI and Studio
  are separate packages and removing one must not be presented as removing both.

These actions remove executable packaging, not repository output or state.

## Review state separately

- Project Trust Core state: `.memi/`
- Legacy project state: `.memoire/`
- Legacy home/integration state: `~/.memoire/`
- User-created source and specs: remain in their original locations

Archive or move each confirmed state directory to a reviewable backup before
deletion. Never infer a path from an empty `$HOME`, a glob, a symlink, or `/`.

The repository's legacy `scripts/uninstall.mjs` recursively removes both the
current project's `.memoire/` and the home `~/.memoire/` directory. It is not the
Trust Core preserve-first workflow and should not be used for an employer review
until it is brought behind the execution policy and independently tested.

## Recovery

1. Stop Memi processes and retain the failed command, typed error, and metadata
   receipt. Do not retain secrets or source excerpts in the incident record.
2. Reinstall the exact previously approved artifact from its verified digest.
3. Restore state to an empty destination from the verified backup.
4. Run `doctor --json` in locked mode and compare the profile, data locations,
   optional integrations, and artifact identity with the approved record.
5. Escalate any unexplained write, egress, digest mismatch, or configuration
   change before using the repository again.
