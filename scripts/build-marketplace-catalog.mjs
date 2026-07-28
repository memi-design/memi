#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const presetsDir = join(root, "examples", "presets");
const generatedAt = "2026-04-26T00:00:00.000Z";

const componentCategories = {
  Badge: "status",
  Button: "action",
  Card: "surface",
  ChatComposer: "chat-input",
  ChatMessage: "chat-message",
  Input: "form",
  ProductCard: "product-card",
};

const presetMeta = {
  "starter-saas": {
    title: "Starter SaaS",
    category: "saas",
    tags: ["saas", "starter", "app-shell", "blue", "neutral"],
    featured: true,
    screenshotPath: "assets/showcases/starter-saas.svg",
    description: "Neutral SaaS starter with blue product accents and clean app-shell primitives.",
  },
  "docs-blog": {
    title: "Docs Blog",
    category: "content",
    tags: ["docs", "blog", "editorial", "content", "reading"],
    featured: true,
    screenshotPath: "assets/showcases/docs-blog.svg",
    description: "Editorial docs/blog kit with softer surfaces and reading-friendly accents.",
  },
  dashboard: {
    title: "Dashboard",
    category: "dashboard",
    tags: ["dashboard", "analytics", "admin", "ops", "dark"],
    featured: true,
    screenshotPath: "assets/showcases/dashboard.svg",
    description: "High-contrast analytics dashboard starter for admin and ops products.",
  },
  "landing-page": {
    title: "Landing Page",
    category: "marketing",
    tags: ["landing-page", "marketing", "conversion", "hero", "waitlist"],
    featured: false,
    installComponent: "HeroSection",
    screenshotPath: "assets/showcases/landing-page.svg",
    description: "Conversion-focused landing page registry with hero, CTA, and form primitives.",
  },
  "auth-flow": {
    title: "Auth Flow",
    category: "auth",
    tags: ["auth", "login", "signup", "settings", "shadcn"],
    featured: false,
    installComponent: "AuthCard",
    screenshotPath: "assets/showcases/auth-flow.svg",
    description: "Install login, signup, and account-settings UI into shadcn apps.",
  },
  "ai-chat": {
    title: "AI Chat",
    category: "ai-chat",
    tags: ["ai-chat", "chat-ui", "llm", "assistant", "shadcn"],
    featured: false,
    installComponent: "ChatComposer",
    screenshotPath: "assets/showcases/ai-chat.svg",
    description: "AI chat registry with composer, message, card, and prompt primitives.",
  },
  ecommerce: {
    title: "Ecommerce",
    category: "ecommerce",
    tags: ["ecommerce", "product", "conversion", "storefront", "shadcn"],
    featured: false,
    installComponent: "ProductCard",
    screenshotPath: "assets/showcases/ecommerce.svg",
    description: "Product card, badge, input, and button patterns for shadcn stores.",
  },
  starter: {
    title: "Starter",
    category: "starter",
    tags: ["starter", "minimal", "shadcn", "tailwind", "neutral"],
    featured: false,
    screenshotPath: "assets/showcases/starter.svg",
    description: "Minimal neutral registry for teams that want a clean shadcn starting point.",
  },
  "tweakcn-vercel": {
    title: "tweakcn Vercel",
    category: "tweakcn",
    tags: ["tweakcn", "vercel", "dark", "minimal", "blue"],
    featured: false,
    screenshotPath: "assets/showcases/tweakcn-vercel.svg",
    description: "Vercel-inspired dark registry with sharp surfaces and electric-blue actions.",
  },
  "tweakcn-supabase": {
    title: "tweakcn Supabase",
    category: "tweakcn",
    tags: ["tweakcn", "supabase", "green", "technical", "dark"],
    featured: false,
    screenshotPath: "assets/showcases/tweakcn-supabase.svg",
    description: "Supabase-inspired registry for technical products with green-on-dark contrast.",
  },
  "tweakcn-linear": {
    title: "tweakcn Linear",
    category: "tweakcn",
    tags: ["tweakcn", "linear", "indigo", "productivity", "editorial"],
    featured: false,
    screenshotPath: "assets/showcases/tweakcn-linear.svg",
    description: "Linear-inspired registry with warm surfaces and focused indigo-violet accents.",
  },
};

const priority = [
  "starter-saas",
  "docs-blog",
  "dashboard",
  "landing-page",
  "auth-flow",
  "ai-chat",
  "ecommerce",
  "starter",
  "tweakcn-vercel",
  "tweakcn-supabase",
  "tweakcn-linear",
];

function fail(message) {
  throw new Error(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function githubTreeUrl(path) {
  return `https://github.com/memi-design/memi/tree/main/${path}`;
}

function githubRawUrl(path) {
  return `https://raw.githubusercontent.com/memi-design/memi/main/${path}`;
}

function memoireRegistryItemUrl(slug, componentName) {
  return `https://www.memoire.cv/r/${slug}/${toItemName(componentName)}.json`;
}

function openInV0Url(itemUrl) {
  return `https://v0.dev/chat/api/open?url=${encodeURIComponent(itemUrl)}`;
}

function normalizeHref(href) {
  return href.replace(/^\.\//, "");
}

function toItemName(name) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

async function listPresetSlugs() {
  const entries = await readdir(presetsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== "__tests__" && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const aIndex = priority.indexOf(a);
      const bIndex = priority.indexOf(b);
      if (aIndex !== -1 || bIndex !== -1) {
        return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
      }
      return a.localeCompare(b);
    });
}

function assertFile(path, label) {
  if (!existsSync(join(root, path))) {
    fail(`${label} does not exist: ${path}`);
  }
}

async function buildEntry(slug) {
  const meta = presetMeta[slug];
  if (!meta) {
    fail(`missing marketplace metadata for preset: ${slug}`);
  }

  const sourcePath = `examples/presets/${slug}`;
  const presetRoot = join(root, sourcePath);
  const pkg = await readJson(join(presetRoot, "package.json"));
  const registry = await readJson(join(presetRoot, "registry.json"));

  if (pkg.name !== registry.name) {
    fail(`${slug}: package.json name does not match registry.json name`);
  }
  if (!pkg.name?.startsWith("@memoire-examples/")) {
    fail(`${slug}: package name must use @memoire-examples scope`);
  }
  if (!Array.isArray(registry.components) || registry.components.length < 4) {
    fail(`${slug}: registry must expose at least four components`);
  }

  assertFile(meta.screenshotPath, `${slug} screenshotPath`);
  assertFile(sourcePath, `${slug} sourcePath`);

  const components = registry.components.map((component) => {
    const specPath = `${sourcePath}/${normalizeHref(component.href)}`;
    assertFile(specPath, `${slug} component ${component.name}`);
    if (component.code?.href) {
      assertFile(`${sourcePath}/${normalizeHref(component.code.href)}`, `${slug} component ${component.name} code`);
    }
    return {
      name: component.name,
      level: component.level,
      category: componentCategories[component.name] ?? meta.category,
    };
  });

  const installComponent =
    registry.components.find((component) => component.name === meta.installComponent) ??
    registry.components.find((component) => component.name === "Button") ??
    registry.components[0];
  const installCommand = `memi add ${installComponent.name} --from ${pkg.name}`;
  if (!installCommand.includes(pkg.name)) {
    fail(`${slug}: installCommand must include package name`);
  }
  const registryItemUrl = memoireRegistryItemUrl(slug, installComponent.name);

  return {
    slug,
    title: meta.title,
    packageName: pkg.name,
    description: meta.description,
    category: meta.category,
    tags: meta.tags,
    featured: meta.featured,
    installCommand,
    componentCount: components.length,
    components,
    sourcePath,
    sourceUrl: githubTreeUrl(sourcePath),
    screenshotPath: meta.screenshotPath,
    screenshotUrl: githubRawUrl(meta.screenshotPath),
    registryItemUrl,
    openInV0Url: openInV0Url(registryItemUrl),
  };
}

async function main() {
  const slugs = await listPresetSlugs();
  const missingMeta = Object.keys(presetMeta).filter((slug) => !slugs.includes(slug));
  if (missingMeta.length > 0) {
    fail(`marketplace metadata references missing presets: ${missingMeta.join(", ")}`);
  }

  const entries = [];
  for (const slug of slugs) {
    entries.push(await buildEntry(slug));
  }

  const catalog = {
    version: 1,
    generatedAt,
    source: "memoire-repo",
    entries,
  };

  const json = `${JSON.stringify(catalog, null, 2)}\n`;
  const outputPaths = [
    join(root, "examples", "marketplace-catalog.v1.json"),
    join(root, "assets", "marketplace-catalog.v1.json"),
  ];

  for (const outputPath of outputPaths) {
    await writeFile(outputPath, json);
    console.log(`wrote ${relative(root, outputPath)}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
