import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findMarketplaceEntry,
  parseMarketplaceCatalog,
  safeParseMarketplaceCatalog,
} from "../catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..", "..");
const examplesCatalogPath = join(root, "examples", "marketplace-catalog.v1.json");
const assetsCatalogPath = join(root, "assets", "marketplace-catalog.v1.json");
const featuredCatalogPath = join(root, "examples", "featured-registries.json");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("marketplace catalog v1", () => {
  const examplesCatalogText = readFileSync(examplesCatalogPath, "utf8");
  const assetsCatalogText = readFileSync(assetsCatalogPath, "utf8");
  const catalog = parseMarketplaceCatalog(JSON.parse(examplesCatalogText));

  it("ships identical website and npm-package catalog copies", () => {
    expect(assetsCatalogText).toBe(examplesCatalogText);
  });

  it("validates the catalog contract", () => {
    const result = safeParseMarketplaceCatalog(readJson(examplesCatalogPath));
    expect(result.success).toBe(true);
    expect(catalog.version).toBe(1);
    expect(catalog.source).toBe("memoire-repo");
  });

  it("keeps deterministic registry ordering", () => {
    expect(catalog.entries.map((entry) => entry.slug)).toEqual([
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
    ]);
  });

  it("keeps the legacy featured catalog as a compatibility subset", () => {
    const featured = readJson(featuredCatalogPath) as Array<{
      slug: string;
      packageName: string;
      installCommand: string;
      sourcePath: string;
      screenshotPath: string;
    }>;

    expect(featured.map((entry) => entry.slug)).toEqual(["starter-saas", "docs-blog", "dashboard"]);
    for (const entry of featured) {
      const marketplaceEntry = findMarketplaceEntry(catalog, entry.slug);
      expect(marketplaceEntry).toBeDefined();
      expect(marketplaceEntry?.featured).toBe(true);
      expect(marketplaceEntry?.packageName).toBe(entry.packageName);
      expect(marketplaceEntry?.installCommand).toBe(entry.installCommand);
      expect(marketplaceEntry?.sourcePath).toBe(entry.sourcePath);
      expect(marketplaceEntry?.screenshotPath).toBe(entry.screenshotPath);
    }
  });

  it("requires SEO and conversion fields for every entry", () => {
    for (const entry of catalog.entries) {
      expect(entry.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(entry.packageName).toMatch(/^@memoire-examples\//);
      expect(entry.description.length).toBeGreaterThan(30);
      expect(entry.tags.length).toBeGreaterThanOrEqual(5);
      expect(entry.installCommand).toContain(entry.packageName);
      expect(entry.sourceUrl).toContain("github.com/memi-design/memi");
      expect(entry.screenshotUrl).toContain("raw.githubusercontent.com/memi-design/memi");
      expect(existsSync(join(root, entry.sourcePath))).toBe(true);
      expect(existsSync(join(root, entry.screenshotPath))).toBe(true);
    }
  });

  it("requires component metadata to match registry inventory", () => {
    for (const entry of catalog.entries) {
      expect(entry.componentCount).toBe(entry.components.length);
      expect(entry.componentCount).toBeGreaterThanOrEqual(4);
      expect(entry.components.map((component) => component.name)).toContain("Button");
      expect(entry.components.every((component) => component.level)).toBe(true);
      expect(entry.components.every((component) => component.category)).toBe(true);
    }
  });

  it("finds entries by slug, package name, and title", () => {
    expect(findMarketplaceEntry(catalog, "starter-saas")?.packageName).toBe("@memoire-examples/starter-saas");
    expect(findMarketplaceEntry(catalog, "@memoire-examples/docs-blog")?.slug).toBe("docs-blog");
    expect(findMarketplaceEntry(catalog, "Dashboard")?.slug).toBe("dashboard");
  });

  it("rejects stale component counts", () => {
    const raw = JSON.parse(examplesCatalogText);
    raw.entries[0].componentCount = 999;
    const result = safeParseMarketplaceCatalog(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("componentCount");
    }
  });
});
