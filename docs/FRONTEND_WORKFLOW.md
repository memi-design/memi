# Frontend engineering with the 2.8 beta

**Published beta:** `2.8.0-beta.2` is available as an exact npm version. The [immutable beta2 npm record](https://github.com/memi-design/memi/blob/main/release-artifacts/npm/2.8.0-beta.2.release.json) binds its exact source and publication evidence. Verify `npx -y @memi-design/cli@2.8.0-beta.2 --version` before using these recipes. Stable remains `2.7.9`. Beta1 records remain historical and do not validate beta2; native and stable qualification remain artifact-specific.

Use `memi --version` to confirm `2.8.0-beta.2` before the recipes below. Stable recipes remain separately pinned to `2.7.9`. Historical beta1 publication evidence remains in its [immutable npm record](https://github.com/memi-design/memi/blob/main/release-artifacts/npm/2.8.0-beta.1.release.json); it does not establish beta2 verification.

Managed independent security scanning and the reviewed-candidate-audit and swiftui-rendered-rerun receipts remain pending for stable. Paper pixel parity is unassessed. Of 158 inventoried CLI paths, 105 remain deferred; broad grants do not enable them. No complete-task dollar or token savings claim is established.

## What changes from 2.7

The 2.8 beta adds a repository-aware evidence step before implementation. An agent can identify actual exports, props, tokens, and stories, associate selected host-supplied design context with an existing component, and see missing or conflicting evidence before editing. The four locked MCP tools expose this read workflow without starting the legacy integration surface. These are beta capabilities; installing npm stable 2.7.9 does not enable them.

The regression suites verify concrete corrections as well as new functionality: diagnosis separates assessed quality from incomplete scans, bounded readers reject unsafe file associations, malformed workflow frames no longer abort otherwise readable logs, and installed-note community validation returns a failing exit code in JSON mode. These checks establish their tested behavior, not whole-product security or successful completion of an arbitrary design task.

The first packed frontend checks used source `2a6d0e44`. That artifact is now historical and superseded for release by subsequent defensive runtime fixes. Keep its receipts intact; use the immutable npm release record for the published package, and fresh checks for any subsequent source changes. The [verification record](trust/FRONTEND_2_8_VERIFICATION.md) separates artifact-bound results from later source tests. Full-source coverage, platform checks, independent review, and publication retain their separate gates.

## Start from the actual repository

With the exact beta `memi` executable available, run inside the consumer repository:

```bash
memi --version
memi agent brief . --frontend --intent "Reuse our navigation components for this sidebar" --max-bytes 16384 --json
memi diagnose . --json --no-write --fail-on none
memi diagnose . --receipt-only --fail-on none
```

The frontend brief reads bounded project inputs without executing repository code. It finds actual React/TypeScript exports and local props, CSS custom properties and scalar DTCG tokens, and CSF story references. Paths are relative to the selected project. It reports incomplete discovery, unresolved props, token modes, aliases, or story associations rather than inventing them. Story IDs inferred from static CSF are not proof that Storybook registered or rendered them. TypeScript path aliases, barrel resolution, inherited external props, and arbitrary dynamic expressions can remain unresolved.

`diagnose --json` is source-bearing working context returned to the harness. `--receipt-only` is a separate metadata-only JSON output, including failures, and does not write reports. A score covers assessed categories only; an unassessed score is `null`, and 100 means no findings in the assessed checks. Scan coverage, unsupported expressions, and omitted files must accompany any quality claim. Static literal classes in `cn`, `clsx`, and `cva` can be checked without executing JavaScript; dynamic expressions remain unknown. File, byte, traversal-entry, and depth limits can make discovery incomplete. Configured exclusions define the eligible scope; an eligible file omitted by a limit or read failure cannot count as successfully scanned.

## Connect Figma or Paper through the harness

Use Codex's configured Figma or Paper connector to read one selected node. Convert its returned data to a small JSON envelope in the consumer project, for example `design/selected-node.json`:

```json
{
  "source": "figma",
  "documentId": "selected-file-id",
  "nodeId": "5:452",
  "mappings": [{
    "path": "src/SideNavTab.tsx",
    "exportName": "SideNavTab",
    "props": {"label": "File", "selected": false},
    "tokens": ["--off-white"]
  }],
  "properties": {"width": 182, "height": 25}
}
```

For Paper, use `"source": "paper"` and its actual document/node IDs. Optional `sourceHash` is the mapped code file's SHA-256; a mismatch marks the mapping stale. Optional `capturedAt` must be a real ISO timestamp and `revision` must come from the source. Omit unavailable values. Do not put commands, verification overrides, assets, credentials, or full vendor responses in this envelope. Inputs accept bounded primitive properties; the schema rejects unknown authority fields and unsafe paths.

```bash
memi agent brief . --frontend --intent "Implement the selected navigation using our existing components" --design-evidence design/selected-node.json --json
```

Evidence is labeled `host-supplied`: Memi validates its structure and checks the code association, but does not authenticate a vendor document. Native Figma Code Connect is optional. A checked-in mapping can provide the association when Code Connect is unavailable; identify that fallback honestly. A valid mapping establishes reuse evidence, not visual parity. Missing required props, missing exports/tokens, and conflicting values must be resolved before implementation.

An envelope mapping produces `mustReuse` guidance in the brief; this read-only operation does not update registry specs. Separately, the generator blocks a registry component spec marked `codeConnect.mapped`, even with `--force`. The harness should import the matched existing component and compose it in a consumer. Memi does not intercept arbitrary edits made by Codex, so verify the resulting diff for duplicate definitions.

## Codex MCP

```bash
memi --profile locked mcp start --no-figma
```

Default tools: `prepare_frontend_brief`, `prepare_design_agent_brief`, `prepare_apple_design_brief`, and `diagnose_app_quality`. Use `prepare_frontend_brief` with `intent`, optional `designEvidence`, and `maxBytes`. The server owns the project root; tool arguments cannot select an unrelated root. Requests support cancellation. The project resource describes the active root and execution policy.

Legacy tools are advertised only when every required capability is explicitly granted. Unsupported CLI paths return structured denial and guidance. The [command inventory](https://github.com/memi-design/memi/blob/main/docs/trust/COMMAND_SUPPORT.json) distinguishes supported effects from deferred paths. Do not broadly grant capabilities merely to obtain a brief. Memi's policy governs Memi; it does not sandbox Codex, Paper, Figma, or the project's browser/test runner.

## Verify the implementation

1. Read the mapped component and relevant stories; reuse its API and semantic tokens.
2. Make the scoped code change and add missing states using the project's conventions.
3. Run the project's typecheck and actual Storybook/browser checks for keyboard interaction, disabled/selected behavior, themes, and required viewports.
4. Rerun deterministic diagnosis and inspect the diff for new duplicate components.
5. Report executed commands, source fingerprints, screenshots, and unresolved checks. The brief's `verification` stays `unassessed`; external test receipts provide separate evidence.

For a reviewable handoff, save a small JSON receipt after the host has run its checks. First capture `scan.fingerprint` from a brief generated around the test run. This fingerprint binds only the files read by Memi's bounded frontend scanner. It does not cover the complete checkout, `.storybook` configuration, package manifests or lockfiles, hidden files, omitted sources, or external dependencies. Record the commit or tree identity and test environment in the external CI artifact if those claims matter. The receipt below is illustrative; replace all values with observed run IDs, times, and results:

```json
{
  "scanFingerprint": "64-character-sha256-from-the-brief",
  "checks": [
    {
      "kind": "storybook",
      "outcome": "passed",
      "runId": "ci-run-123",
      "observedAt": "2026-09-27T12:00:00.000Z",
      "storyRef": "src/SideNavTab.stories.tsx#Selected",
      "artifactPath": "artifacts/storybook-results.json"
    }
  ]
}
```

Supported kinds are `typecheck`, `storybook`, `browser`, and `accessibility`; outcomes are `passed`, `failed`, or `skipped`. Keep artifacts inside the project and reference them with project-relative paths. `runId` and `artifactPath` are pointers for human review, not commands for Memi to execute. Supply the file with `memi agent brief . --frontend --verification-evidence design/verification.json --json`, or pass the same object as `verificationEvidence` to `prepare_frontend_brief`. A receipt gets `association: current-scan` only when its fingerprint matches the current **bounded frontend source scan** and its `storyRef`, if present, resolves to a discovered static story. Changes to scanned files mark old receipts stale; a missing story marks the association unresolved. Config or dependency changes can leave the fingerprint unchanged. Every receipt is marked `host-supplied` with `scope: bounded-frontend-sources`; `checkoutIdentity` and the brief's own verification status remain `unassessed`, even if a host reports a pass. A static story reference does not prove a Storybook runtime registration, interaction, accessibility result, or pixel parity; inspect the linked external artifacts before making those claims.

The repository [frontend fixture](https://github.com/memi-design/memi/tree/main/examples/frontend-workflow) uses real React and Storybook with a synthetic pre-existing component catalog, explicit mappings, and browser tests. Its results apply to that fixture and the pinned tool versions. It is not evidence that an arbitrary user repository passed.

CI report generation intentionally writes source-bearing reports and may invoke Git:

```bash
memi --profile connected --allow project-write --allow source-content-persistence --allow shell ci . --report --json
```

Keep those grants scoped to the reviewed task. Local deterministic brief generation and diagnosis make no model calls. Installation, connector plans, agent tokens, CPU time, and CI still have costs; a smaller payload does not establish cheaper successful development.
