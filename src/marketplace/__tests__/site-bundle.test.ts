import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const bundleRoot = join(root, "examples", "site-bundle");

describe("marketplace site bundle", () => {
  it("contains complete catalog entries for website rendering", async () => {
    const catalog = JSON.parse(await readFile(join(bundleRoot, "catalog.json"), "utf8"));
    expect(catalog.entries.length).toBeGreaterThanOrEqual(11);

    for (const entry of catalog.entries) {
      expect(entry.installCommand).toContain(entry.packageName);
      expect(entry.sourceUrl).toContain(entry.sourcePath);
      expect(entry.registryItemUrl).toMatch(/^https:\/\/www\.memoire\.cv\/r\//);
      expect(entry.openInV0Url).toContain(encodeURIComponent(entry.registryItemUrl));
      await expect(access(join(bundleRoot, entry.screenshotPath))).resolves.toBeUndefined();
      expect(entry.items.length).toBe(entry.componentCount);
      for (const item of entry.items) {
        const itemJson = JSON.parse(await readFile(join(bundleRoot, "items", entry.slug, `${item.itemName}.json`), "utf8"));
        expect(itemJson.meta.memoire.registryItemUrl).toBe(item.registryItemUrl);
        expect(itemJson.meta.memoire.openInV0Url).toContain(encodeURIComponent(item.registryItemUrl));
        expect(itemJson.files[0].target).toMatch(/^components\//);
      }
    }
  });

  it("contains SEO metadata and sitemap entries for every registry page", async () => {
    const catalog = JSON.parse(await readFile(join(bundleRoot, "catalog.json"), "utf8"));
    const seo = JSON.parse(await readFile(join(bundleRoot, "seo.json"), "utf8"));
    const sitemap = await readFile(join(bundleRoot, "sitemap.xml"), "utf8");
    const copy = await readFile(join(bundleRoot, "copy-snippets.md"), "utf8");

    for (const entry of catalog.entries) {
      const page = seo.pages.find((candidate: { slug: string }) => candidate.slug === entry.slug);
      expect(page).toBeDefined();
      expect(page.title).toContain(entry.title);
      expect(page.description).toBe(entry.description);
      expect(page.keywords).toContain("shadcn registry");
      expect(sitemap).toContain(`https://www.memoire.cv/components/${entry.slug}`);
      expect(copy).toContain(entry.installCommand);
    }
  });

  it("contains a public Codex plugin landing page and SEO entry", async () => {
    const seo = JSON.parse(await readFile(join(bundleRoot, "seo.json"), "utf8"));
    const sitemap = await readFile(join(bundleRoot, "sitemap.xml"), "utf8");
    const page = await readFile(join(bundleRoot, "codex-plugin", "index.html"), "utf8");
    const privacy = await readFile(join(bundleRoot, "privacy", "index.html"), "utf8");
    const terms = await readFile(join(bundleRoot, "terms", "index.html"), "utf8");
    const seoPage = seo.pages.find((candidate: { slug: string }) => candidate.slug === "codex-plugin");
    const privacyPage = seo.pages.find((candidate: { slug: string }) => candidate.slug === "privacy");
    const termsPage = seo.pages.find((candidate: { slug: string }) => candidate.slug === "terms");
    const installCommand = "codex plugin marketplace add memi-design/memi --ref main --sparse .agents/plugins --sparse plugins/memoire";

    expect(seoPage).toMatchObject({
      slug: "codex-plugin",
      title: "Memoire Codex plugin | Design memory for Codex",
      canonicalUrl: "https://www.memoire.cv/codex-plugin",
    });
    expect(sitemap).toContain("https://www.memoire.cv/codex-plugin");
    expect(sitemap).toContain("https://www.memoire.cv/privacy");
    expect(sitemap).toContain("https://www.memoire.cv/terms");
    expect(page).toContain("Memoire Codex plugin");
    expect(page).toContain(installCommand);
    expect(page).toContain("memi agent install codex-plugin");
    expect(privacyPage).toMatchObject({ canonicalUrl: "https://www.memoire.cv/privacy" });
    expect(termsPage).toMatchObject({ canonicalUrl: "https://www.memoire.cv/terms" });
    expect(privacy).toContain("Memoire privacy policy");
    expect(terms).toContain("Memoire terms of service");
  });

  it("contains public no-npm installers at the site root", async () => {
    const shellInstaller = await readFile(join(bundleRoot, "install.sh"), "utf8");
    const powershellInstaller = await readFile(join(bundleRoot, "install.ps1"), "utf8");

    expect(shellInstaller).toContain("archive_sums_url");
    expect(shellInstaller).toContain(".sha256");
    expect(powershellInstaller).toContain("$archiveSumsUrl");
    expect(powershellInstaller).toContain(".sha256");
  });

  it("checks public no-npm installers in the release site-bundle gate", async () => {
    const checker = await readFile(join(root, "scripts", "check-site-bundle-urls.mjs"), "utf8");

    expect(checker).toContain('join(baseDir, "install.sh")');
    expect(checker).toContain('join(baseDir, "install.ps1")');
    expect(checker).toContain('`${baseUrl}/install.sh`');
    expect(checker).toContain('`${baseUrl}/install.ps1`');
  });
});
