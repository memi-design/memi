# Contributing to Memoire

## Ways to contribute

- **Showcase registries** — add or improve installable examples under `examples/presets/`
- **Quickstart docs** — tighten the publish -> add -> update flow in README and `docs/`
- **Bug reports** — use the bug report template
- **Feature requests** — use the feature request template
- **MCP tool improvements** — add tools, improve descriptions, fix edge cases
- **Notes (skill packs)** — extend Memoire without touching the core
- **Test coverage** — adding more is always welcome
- **Documentation** — README, inline JSDoc, launch copy, or examples

## Showcase registries

The fastest growth contribution is a registry people can install in one command.

```bash
cp -r examples/presets/starter-saas my-design-system
cd my-design-system
# rename in package.json + registry.json
memi publish --name @yourscope/your-ds
npm publish --access public
```

Ship a clear screenshot, a short install command, and a README that explains the vibe in one paragraph.

## Notes (skill packs)

Notes are the easiest contribution. A Note is a folder with a `note.json` manifest and one or more markdown skill files.

```
my-note/
  note.json
  my-note.md
```

`note.json` format:
```json
{
  "name": "my-note",
  "version": "1.0.0",
  "description": "What this note teaches",
  "category": "craft | research | connect | generate",
  "activateOn": ["keyword1", "keyword2"],
  "skills": ["my-note.md"]
}
```

Install and test locally:
```bash
memi notes install ./my-note
memi notes list
```

Share as a GitHub repo and others can install with:
```bash
memi notes install github:you/my-note
```

## Development setup

```bash
git clone https://github.com/memi-design/memi
cd memi
npm install
npm test
npm run build
```

Run a command from source:
```bash
npx tsx src/index.ts doctor
```

## Tests

```bash
npm test               # run the full test suite
npm test -- --watch    # watch mode
```

Tests live alongside source in `src/**/__tests__/`. Each module has its own test file.

## Submitting a PR

1. Fork the repo
2. Create a branch: `feat/my-feature` or `fix/the-bug`
3. Make your change with tests
4. Run `npm test && npm run lint`
5. Open a PR — describe what changed and why

Commits follow conventional commits: `feat:`, `fix:`, `docs:`, `chore:`.

## Release cadence

- **1.0.0 ships with the rebrand.** From here, semver discipline: breaking changes require a major bump, features bump minor, fixes bump patch.
- **Releases ship Tuesdays** unless we're cutting a security fix. Daily commits land on `main`; the Tuesday release tag bundles a week's worth of changes.
- The prepublish gate (`npm run prepublishOnly`) runs `check:release && security:audit && typecheck && test && build` on every publish — keep it green.
- Why this cadence: daily version bumps signal instability and depress installs. One predictable release per week lets users pin and upgrade with confidence.
