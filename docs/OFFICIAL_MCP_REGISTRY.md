# Official MCP Registry Publish Guide

Use this after npm latest matches the local memi version.

## Why This Gate Exists

The Official MCP Registry hosts metadata, not package artifacts. For npm packages, it verifies that `server.json` points to a public npm package and that `package.json#mcpName` matches the registry server name.

memi uses:

- MCP server name: `io.github.memi-design/memi`
- npm package: `@memi-design/cli`
- transport: `stdio`
- package arguments: `mcp start --no-figma`
- published record: <https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.memi-design%2Fmemi>

The previous `io.github.sarveshsea/memi` support policy is deprecated, but the
public registry still reports 12 historical versions as `active`, through
`2.7.4`. That observed upstream status is not a support claim. Keep the personal
identifier only in immutable historical evidence and explicit compatibility
records; all current metadata, publishing, and install guidance must use
`io.github.memi-design/memi`.

## Install `mcp-publisher`

macOS/Linux:

```bash
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
sudo mv mcp-publisher /usr/local/bin/
mcp-publisher --help
```

If `sudo` is not available, move the binary into any directory already on `PATH`.

## Publish Sequence

```bash
npm run publish:ready
npm publish --access public
npm view @memi-design/cli version mcpName --json

mcp-publisher login github
mcp-publisher validate server.json
mcp-publisher publish server.json
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.memi-design/memi"
```

CI can publish without a local registry token through the `Publish to MCP Registry` GitHub Actions workflow. It uses GitHub OIDC, validates `server.json`, and refuses to publish until the matching `@memi-design/cli` version exists on npm.

Expected registry result after publish:

```json
{
  "servers": [
    {
      "name": "io.github.memi-design/memi"
    }
  ]
}
```

## Troubleshooting

- `mcp-publisher: command not found`: install the publisher binary above and reopen the terminal.
- `Registry validation failed for package`: publish the matching npm version first and verify `mcpName`.
- `Invalid or expired Registry JWT token`: run `mcp-publisher login github` again.
- `You do not have permission`: GitHub login must be authorized to publish the
  `io.github.memi-design/*` organization namespace.

Smithery has a separate namespace migration. See
[ECOSYSTEM_IDENTITY.md](./ECOSYSTEM_IDENTITY.md) before publishing or linking a
Smithery listing.

Source: https://modelcontextprotocol.io/registry/quickstart
