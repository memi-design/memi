#!/usr/bin/env node

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "examples", "site-bundle");
const checkedInNotesDir = join(outDir, "notes");
const checkedInCommunityDir = join(checkedInNotesDir, "community");
const notesSnapshotRoot = existsSync(join(checkedInNotesDir, "catalog.v1.json"))
  ? await mkdtemp(join(tmpdir(), "memoire-notes-catalog-"))
  : null;
if (notesSnapshotRoot) await cp(checkedInNotesDir, notesSnapshotRoot, { recursive: true });
const catalog = JSON.parse(await readFile(join(root, "examples", "marketplace-catalog.v1.json"), "utf8"));

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, "items"), { recursive: true });
await mkdir(join(outDir, "screenshots"), { recursive: true });
await mkdir(join(outDir, "assets"), { recursive: true });
await mkdir(join(outDir, "codex-plugin"), { recursive: true });
await mkdir(join(outDir, "privacy"), { recursive: true });
await mkdir(join(outDir, "terms"), { recursive: true });

const bundleCatalog = {
  ...catalog,
  entries: [],
};
const codexPluginUrl = "https://www.memoire.cv/codex-plugin";
const codexPluginInstallCommand = "codex plugin marketplace add memi-design/memi --ref main --sparse .agents/plugins --sparse plugins/memoire";
const privacyUrl = "https://www.memoire.cv/privacy";
const termsUrl = "https://www.memoire.cv/terms";
const sitemapUrls = ["https://www.memoire.cv/components", codexPluginUrl, privacyUrl, termsUrl];
const seoPages = [{
  slug: "codex-plugin",
  title: "Memoire Codex plugin | Design memory for Codex",
  description: "Install Memoire as a Codex plugin with design-system memory, MCP tools, Tailwind and shadcn diagnostics, and Atomic Design guidance.",
  canonicalUrl: codexPluginUrl,
  keywords: [
    "Codex plugin",
    "Codex marketplace",
    "design memory",
    "MCP tools",
    "Tailwind diagnostics",
    "shadcn",
    "Figma",
  ],
  ogImage: "https://www.memoire.cv/plugin/memoire/assets/screenshot-plugin-overview.png",
}, {
  slug: "privacy",
  title: "Memoire privacy policy",
  description: "Privacy policy for Memoire CLI, MCP server, Codex plugin, and design tooling.",
  canonicalUrl: privacyUrl,
  keywords: ["Memoire privacy", "Codex plugin privacy", "MCP privacy"],
  ogImage: "https://www.memoire.cv/plugin/memoire/assets/screenshot-plugin-overview.png",
}, {
  slug: "terms",
  title: "Memoire terms of service",
  description: "Terms of service for Memoire CLI, MCP server, Codex plugin, and design tooling.",
  canonicalUrl: termsUrl,
  keywords: ["Memoire terms", "Codex plugin terms", "MCP terms"],
  ogImage: "https://www.memoire.cv/plugin/memoire/assets/screenshot-plugin-overview.png",
}];
const snippets = [
  "# memi Site Copy Snippets",
  "",
  "Hero: memi is agent design CI for AI coding agents.",
  "Subhead: Run Codex, Claude, Cursor, Grok, and MCP clients with compact design briefs, deterministic UI audits, token checks, and spec-first file scaffolds.",
  "Primary CTA: https://www.npmjs.com/package/@memi-design/cli",
  "Engine CTA: https://www.npmjs.com/package/@memi-design/cli",
  "Codex plugin: https://www.memoire.cv/codex-plugin",
  `Codex marketplace install: ${codexPluginInstallCommand}`,
  "",
  "## Registry Cards",
  "",
];

for (const entry of catalog.entries) {
  const presetRoot = join(root, entry.sourcePath);
  const registry = JSON.parse(await readFile(join(presetRoot, "registry.json"), "utf8"));
  const entryItems = [];
  const screenshotName = basename(entry.screenshotPath);
  if (existsSync(join(root, entry.screenshotPath))) {
    await cp(join(root, entry.screenshotPath), join(outDir, "screenshots", screenshotName));
  }

  await mkdir(join(outDir, "items", entry.slug), { recursive: true });
  for (const component of registry.components) {
    const spec = JSON.parse(await readFile(join(presetRoot, normalize(component.href)), "utf8"));
    const itemName = toItemName(component.name);
    const codePath = component.code?.href ? join(presetRoot, normalize(component.code.href)) : "";
    const content = codePath && existsSync(codePath) ? await readFile(codePath, "utf8") : fallbackComponent(component.name);
    const itemUrl = `https://www.memoire.cv/r/${entry.slug}/${itemName}.json`;
    const item = {
      "$schema": "https://ui.shadcn.com/schema/registry-item.json",
      name: itemName,
      type: shadcnType(component.level),
      title: component.name,
      description: spec.purpose ?? entry.description,
      registryDependencies: (spec.shadcnBase ?? []).map(toItemName),
      files: [{
        path: `registry/${entry.slug}/${itemName}.tsx`,
        type: "registry:component",
        target: targetFor(component.name, component.level),
        content,
      }],
      categories: [entry.category, component.level, ...entry.tags].filter(Boolean),
      meta: {
        memoire: {
          sourcePackage: entry.packageName,
          sourcePath: entry.sourcePath,
          itemRoute: `/r/${entry.slug}/${itemName}.json`,
          registryItemUrl: itemUrl,
          openInV0Url: openInV0Url(itemUrl),
          atomicLevel: component.level,
        },
      },
    };
    await writeFile(join(outDir, "items", entry.slug, `${itemName}.json`), `${JSON.stringify(item, null, 2)}\n`);
    entryItems.push({
      name: component.name,
      itemName,
      registryItemUrl: itemUrl,
      openInV0Url: openInV0Url(itemUrl),
    });
  }

  const pageUrl = `https://www.memoire.cv/components/${entry.slug}`;
  sitemapUrls.push(pageUrl);
  seoPages.push({
    slug: entry.slug,
    title: `${entry.title} shadcn registry | Memoire`,
    description: entry.description,
    canonicalUrl: pageUrl,
    keywords: unique(["shadcn registry", "Tailwind design system", "installable components", ...entry.tags]),
    ogImage: `https://www.memoire.cv/screenshots/${screenshotName}`,
  });
  snippets.push(`- ${entry.title}: ${entry.description}`);
  snippets.push(`  Install: ${entry.installCommand}`);
  snippets.push(`  Open in v0: ${entry.openInV0Url}`);
  snippets.push("");

  bundleCatalog.entries.push({
    ...entry,
    screenshotPath: `screenshots/${screenshotName}`,
    items: entryItems,
  });
}

await writeFile(join(outDir, "catalog.json"), `${JSON.stringify(bundleCatalog, null, 2)}\n`);
await writeFile(join(outDir, "seo.json"), `${JSON.stringify({ pages: seoPages }, null, 2)}\n`);
await writeFile(join(outDir, "sitemap.xml"), renderSitemap(sitemapUrls));
await writeFile(join(outDir, "copy-snippets.md"), snippets.join("\n"));
await cp(join(root, "scripts", "install.sh"), join(outDir, "install.sh"));
await cp(join(root, "scripts", "install.ps1"), join(outDir, "install.ps1"));
await cp(join(root, "assets", "marketplace-catalog.v1.json"), join(outDir, "assets", "marketplace-catalog.v1.json"));
await writeFile(join(outDir, "codex-plugin", "index.html"), renderCodexPluginPage(codexPluginInstallCommand));
await writeFile(join(outDir, "privacy", "index.html"), renderPolicyPage({
  title: "Memoire privacy policy",
  canonicalUrl: privacyUrl,
  body: [
    "Memoire runs locally by default. The CLI, MCP server, and Codex plugin read project files only when a user or agent invokes local commands.",
    "Memoire does not add npm install-time lifecycle scripts to the public package and does not transmit project code to a Memoire-hosted service by default.",
    "External services such as Figma, npm, GitHub, Codex, or MCP clients are used only when the user configures credentials or runs the related command.",
  ],
}));
await writeFile(join(outDir, "terms", "index.html"), renderPolicyPage({
  title: "Memoire terms of service",
  canonicalUrl: termsUrl,
  body: [
    "Memoire is provided under the MIT license as local design memory, UI quality tooling, MCP server support, and Codex plugin packaging.",
    "Users are responsible for reviewing generated code, command output, external service credentials, and design-system changes before publishing or deploying.",
    "The Codex plugin starts Memoire through the Figma-independent MCP path by default; Figma and network-backed workflows require explicit user configuration.",
  ],
}));

if (notesSnapshotRoot) {
  await cp(notesSnapshotRoot, checkedInNotesDir, { recursive: true });
  console.log("preserved checked-in official Notes catalog; run build:notes-catalog to rebuild it from source");
} else {
  const notesResult = spawnSync(process.execPath, [join(root, "scripts", "build-notes-catalog.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (notesResult.status !== 0) process.exit(notesResult.status ?? 1);
}

const communitySourceRoot = resolve(root, process.env.MEMOIRE_COMMUNITY_NOTES_ROOT ?? "../design-skills");
if (existsSync(join(communitySourceRoot, "skills"))) {
  const communityNotesResult = spawnSync(process.execPath, [join(root, "scripts", "build-community-notes-catalog.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (communityNotesResult.status !== 0) process.exit(communityNotesResult.status ?? 1);
} else if (notesSnapshotRoot) {
  console.log("preserved checked-in Design Skills catalog; set MEMOIRE_COMMUNITY_NOTES_ROOT to rebuild it from source");
} else {
  console.error("No checked-in Design Skills catalog or source checkout is available.");
  process.exit(1);
}
if (notesSnapshotRoot) await rm(notesSnapshotRoot, { recursive: true, force: true });

console.log(`wrote ${outDir}`);

function normalize(path) {
  return path.replace(/^\.\//, "");
}

function toItemName(name) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function shadcnType(level) {
  if (level === "organism" || level === "template") return "registry:block";
  if (level === "molecule") return "registry:component";
  return "registry:ui";
}

function targetFor(name, level) {
  const file = `${toItemName(name)}.tsx`;
  if (level === "atom") return `components/ui/${file}`;
  if (level === "molecule") return `components/molecules/${file}`;
  if (level === "organism") return `components/organisms/${file}`;
  return `components/templates/${file}`;
}

function openInV0Url(itemUrl) {
  return `https://v0.dev/chat/api/open?url=${encodeURIComponent(itemUrl)}`;
}

function fallbackComponent(name) {
  return `export function ${name}() {\n  return <div />\n}\n`;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function renderSitemap(urls) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${url}</loc></url>`),
    '</urlset>',
    '',
  ].join("\n");
}

function renderCodexPluginPage(installCommand) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Memoire Codex plugin | Design memory for Codex</title>
  <meta name="description" content="Install Memoire as a Codex plugin with design-system memory, MCP tools, Tailwind and shadcn diagnostics, and Atomic Design guidance.">
  <link rel="canonical" href="https://www.memoire.cv/codex-plugin">
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f0f10; color: #f7f7f3; }
    body { margin: 0; background: #0f0f10; }
    main { max-width: 960px; margin: 0 auto; padding: 72px 24px 96px; }
    .eyebrow { color: #a7a7a2; font-size: 14px; text-transform: uppercase; letter-spacing: .08em; }
    h1 { font-size: clamp(44px, 7vw, 76px); line-height: .96; margin: 18px 0; letter-spacing: 0; }
    p { color: #d8d8d2; font-size: 20px; line-height: 1.6; max-width: 760px; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    pre { background: #050505; border: 1px solid #343438; border-radius: 12px; color: #f6f6f2; overflow-x: auto; padding: 18px; }
    section { border-top: 1px solid #2a2a2d; margin-top: 42px; padding-top: 30px; }
    h2 { font-size: 26px; margin: 0 0 16px; }
    ul { color: #d8d8d2; font-size: 18px; line-height: 1.7; padding-left: 22px; }
    a { color: #ffffff; text-underline-offset: 4px; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Codex plugin</div>
    <h1>Memoire Codex plugin</h1>
    <p>Give Codex the same design-system memory, MCP tools, Tailwind and shadcn diagnostics, Figma context, and Atomic Design workflow that Memoire already ships for local agents.</p>

    <section>
      <h2>Install from the Git-backed marketplace</h2>
      <pre><code>${escapeHtml(installCommand)}</code></pre>
      <p>Then open <code>/plugins</code> in Codex and install Memoire from the marketplace list.</p>
    </section>

    <section>
      <h2>Install through npm</h2>
      <pre><code>npm i -g @memi-design/cli
memi agent install codex-plugin</code></pre>
    </section>

    <section>
      <h2>What Codex gets</h2>
      <ul>
        <li>Memoire skill context for UI design, Figma, design systems, shadcn/ui, Tailwind, and Atomic Design.</li>
        <li>MCP server wiring for <code>memi mcp start --no-figma</code>, safe for headless discovery.</li>
        <li>Evidence from <code>memi diagnose</code>, tokens, specs, shadcn registries, and suite recipes before broad frontend edits.</li>
      </ul>
    </section>
  </main>
</body>
</html>
`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPolicyPage({ title, canonicalUrl, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(body[0])}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f0f10; color: #f7f7f3; }
    body { margin: 0; background: #0f0f10; }
    main { max-width: 820px; margin: 0 auto; padding: 72px 24px 96px; }
    h1 { font-size: clamp(40px, 6vw, 64px); line-height: 1; margin: 0 0 28px; letter-spacing: 0; }
    p { color: #d8d8d2; font-size: 20px; line-height: 1.65; }
    a { color: #ffffff; text-underline-offset: 4px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n    ")}
    <p>Contact: <a href="https://github.com/memi-design/memi">github.com/memi-design/memi</a></p>
  </main>
</body>
</html>
`;
}
