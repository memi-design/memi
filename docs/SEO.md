# SEO Handoff

Use this copy on the website repo, GitHub metadata, npm README sections, launch pages, examples, and directory submissions. The conversion URL is the npm package page until the website is fully synced with the v2 story.

## Primary search phrase

`Memi is the read-only design engineering audit and skill layer for coding agents.`

## Secondary search phrases

- `Design-system memory for coding agents`
- `UX audit for AI agents`
- `Tailwind token extraction`
- `shadcn registry generator`
- `shadcn registry marketplace`
- `installable shadcn design systems`
- `v0 design system registry`
- `MCP server for design systems`
- `Agent Skills design tooling`
- `Codex design-system plugin`
- `Hermes design tooling`
- `ECC UI audit workflow`
- `research-backed design specs`
- `Figma FigJam agent handoff`
- `design sandbox for AI agents`
- `design engineering sandbox`

## Title tags

- Homepage: `memi - Read-only design engineering audits for coding agents`
- npm/docs: `memi docs - Design-system memory for AI coding agents`
- Components: `shadcn registry marketplace - memi`
- Codex plugin: `memi Codex plugin - Design-system memory before frontend edits`
- Launch page: `memi - Read-only design engineering audit and skill layer`

## Meta descriptions

- Homepage: `Memi is the read-only design engineering audit and skill layer for coding agents: file-anchored UI findings, design-system memory, focused skills, MCP tools, and deterministic CI gates.`
- Docs: `Install memi, run diagnose and UX audits, extract Tailwind tokens, export shadcn registries, and install agent kits for Codex, Claude Code, Cursor, Hermes, OpenClaw, OpenCode, and Agent Skills.`
- Components: `Explore installable shadcn/Tailwind design systems for SaaS, docs, dashboards, landing pages, auth, AI chat, ecommerce, and tweakcn-inspired themes.`
- Codex plugin: `Install memi in Codex to audit UI quality, inspect Tailwind tokens, use shadcn registry context, and ground frontend edits in design-system evidence.`
- Launch page: `Memi audits product UI before coding agents edit it, then routes the work through focused design-engineering skills.`
- Design sandbox: `Clone a memi-ready Next.js, Tailwind, shadcn, MCP, and Agent Skills sandbox for design-to-code exploration.`

## OpenGraph

- `og:title`: `memi - Read-only design engineering audits for coding agents`
- `og:description`: `Run UX audits, extract Tailwind tokens, export shadcn registries, and give Codex, Claude Code, Cursor, Hermes, OpenClaw, OpenCode, and MCP clients design-system memory.`
- `og:url`: `https://www.npmjs.com/package/@memi-design/cli`
- `og:type`: `website`
- `og:image`: `https://raw.githubusercontent.com/sarveshsea/memi/main/assets/theme-workflow-demo.svg`

## Twitter Card

- `twitter:card`: `summary_large_image`
- `twitter:title`: `memi - Read-only design engineering audits for coding agents`
- `twitter:description`: `Design-system memory, UX audit evidence, Tailwind tokens, shadcn registries, MCP tools, Agent Skills, and research-backed specs before agents edit UI.`
- `twitter:image`: `https://raw.githubusercontent.com/sarveshsea/memi/main/assets/theme-workflow-demo.svg`

## JSON-LD

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "memi",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "macOS, Linux, Windows",
  "description": "Memi is the read-only design engineering audit and skill layer for coding agents: file-anchored UI findings, design-system memory, MCP tools, and deterministic CI gates.",
  "softwareVersion": "2.6.2",
  "url": "https://www.npmjs.com/package/@memi-design/cli",
  "codeRepository": "https://github.com/sarveshsea/memi",
  "programmingLanguage": "TypeScript",
  "keywords": [
    "interface-understanding",
    "design-system-memory",
    "ux-audit",
    "tailwind-token-extraction",
    "shadcn-registry",
    "shadcn-registry-generator",
    "v0-design-system-registry",
    "mcp-server",
    "agent-skills",
    "codex-plugin",
    "hermes",
    "user-research",
    "figma-to-code",
    "figjam"
  ],
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  }
}
```

## Website acceptance criteria

- The first screen says `Memi is the read-only design engineering audit and skill layer for coding agents.`
- The primary command block starts with `npm i -g @memi-design/cli`.
- The first proof path works without Figma: `memi diagnose`, `memi ux audit --json`, `memi craft audit --json`, `memi tokens --from ./src --report`, `memi shadcn export --out public/r`.
- Agent setup links include `npx skills add sarveshsea/memi --skill memoire-design-tooling`.
- Public proof links include `https://github.com/sarveshsea/design-sandbox`.
- MCP setup includes `memi mcp start --no-figma`.
- `/components` renders `examples/marketplace-catalog.v1.json`; if that fails, it falls back to `examples/featured-registries.json`.
- Footer links use `@memi-design/cli`, not legacy package names.
- Product Hunt and Studio pages can mention the macOS workbench, but the package/docs story stays engine-first.

## Sitemap priorities

- `/` priority `1.0`, changefreq `weekly`
- `/docs` priority `0.8`, changefreq `weekly`
- `/codex-plugin` priority `0.8`, changefreq `weekly`
- `/components` priority `0.9`, changefreq `daily` once the registry index is stable
- `/components/starter-saas`, `/components/docs-blog`, `/components/dashboard`, `/components/landing-page`, `/components/auth-flow`, `/components/ai-chat`, `/components/ecommerce` priority `0.8`, changefreq `weekly`
- `/components/starter`, `/components/tweakcn-vercel`, `/components/tweakcn-supabase`, `/components/tweakcn-linear` priority `0.7`, changefreq `weekly`
