# Focused Skill Exports

`scripts/export-focused-skills.mjs` creates standalone Agent Skill repositories/packages from the three focused skills shipped by Memi:

- `audit-frontend-design`
- `enforce-design-ci`
- `remember-design-system`

The source of record remains `skills/<skill>/SKILL.md`. The exporter is a release utility, so it does not change the source skills, `package.json`, plugin mirrors, or agent-kit mirrors.

## Export

From the Memi repository root:

```bash
node scripts/export-focused-skills.mjs --out-root dist/focused-skills
```

Each selected skill is written to its own directory:

```text
dist/focused-skills/<skill>/
  SKILL.md
  README.md
  SOURCE.json
  package.json
  LICENSE
```

The output directory is created when missing. On an existing output root, only directories for the selected skills are replaced; unrelated directories are preserved. The output root must not be the source root or a directory inside it.

## Install

The generated README includes the Agent Skills install command:

```bash
npx skills add memi-design/memi --skill audit-frontend-design
```

For a focused skill published in another repository, provide that repository at export time:

```bash
node scripts/export-focused-skills.mjs \
  --skills audit-frontend-design \
  --install-repository example/audit-frontend-design
```

`package.json` is intentionally minimal and marked private to prevent accidental npm publication of a generated directory. It provides package identity, version, license, repository metadata, and the exact files included in the export. Each export also carries Memi's MIT `LICENSE`, so a focused repository remains correctly licensed when separated from the monorepo.

## Provenance

`SOURCE.json` is stable, machine-readable provenance for the exported skill. It records:

- the skill name and source path;
- the source repository and `main` ref;
- the Memi package version used for the export;
- the exporter path; and
- whether an optional Memi enhancement appendix was included.

No current timestamp, machine path, random identifier, or git working-tree state is written. Running the exporter twice from the same source and options produces byte-identical files.

## Optional Memi Enhancements

The base export copies the canonical `SKILL.md` unchanged:

```bash
node scripts/export-focused-skills.mjs --no-memi-enhancement
```

To append a clearly marked `## Optional Memi enhancements` section, use:

```bash
node scripts/export-focused-skills.mjs --include-memi-enhancement
```

The appendix describes Memi commands as optional evidence tooling and explicitly keeps equivalent local tooling valid. This keeps a focused skill useful in repositories that do not use Memi while still making the Memi path easy to discover.

## Release Checks

Before publishing an exported directory, verify:

1. `SKILL.md` has matching `name` and non-empty `description` frontmatter plus a non-empty body.
2. `README.md` contains a working `npx skills add` command and links to provenance.
3. `SOURCE.json` points to the intended source repository and path.
4. `package.json` lists the four distributable files (`SKILL.md`, `README.md`, `SOURCE.json`, and `LICENSE`); the manifest itself is not included in its own `files` list.
5. A second export with the same inputs is byte-identical.

Use `--skills a,b,c` to export a subset. Unknown skills, missing or malformed source files, invalid repository values, invalid versions, and unsafe output roots fail before any selected output directory is replaced.
