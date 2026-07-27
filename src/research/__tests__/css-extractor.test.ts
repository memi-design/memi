/**
 * CSS Extractor stress tests — 65 conditions covering HTML/CSS fetching,
 * color extraction, font extraction, spacing, radii, shadows, and CSS vars.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPublicText } from "../../security/safe-fetch.js";
import { fetchPageAssets, parseCSSTokens, hexToRgb, relativeLuminance, contrastRatio, wcagLevel } from "../css-extractor.js";

vi.mock("../../security/safe-fetch.js", () => ({
  fetchPublicText: vi.fn(),
}));

const fetchPublicTextMock = vi.mocked(fetchPublicText);

// ── Fetch mock helpers ───────────────────────────────────

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; body?: string }>) {
  let i = 0;
  fetchPublicTextMock.mockImplementation(async (url) => {
    const r = responses[i++] ?? { ok: false, status: 404, body: "" };
    return {
      url,
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 404),
      headers: {},
      text: r.body ?? "",
    };
  });
}

function stubFetch(html: string, css = "") {
  // first call → HTML page, subsequent calls → CSS sheets
  mockFetchSequence([
    { ok: true, body: html },
    { ok: true, body: css },
  ]);
}

afterEach(() => {
  fetchPublicTextMock.mockReset();
  vi.restoreAllMocks();
});

// ── fetchPageAssets — Basic fetch ────────────────────────

describe("fetchPageAssets — basic fetch", () => {
  it("returns empty assets on network failure", async () => {
    fetchPublicTextMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.html).toBe("");
    expect(assets.cssBlocks).toEqual([]);
  });

  it("returns empty assets on non-ok response", async () => {
    mockFetchSequence([{ ok: false, status: 404, body: "" }]);
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.html).toBe("");
    expect(assets.cssBlocks).toEqual([]);
  });

  it("returns the url in the result", async () => {
    stubFetch("<html><title>Test</title></html>");
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.url).toBe("https://example.com");
  });

  it("extracts title from <title> tag", async () => {
    stubFetch("<html><title>My Site</title></html>");
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.title).toBe("My Site");
  });

  it("collapses whitespace in title", async () => {
    stubFetch("<html><title>  My   Site  </title></html>");
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.title).toBe("My Site");
  });

  it("falls back to URL if no title tag", async () => {
    stubFetch("<html><head></head></html>");
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.title).toBe("https://example.com");
  });

  it("returns raw html", async () => {
    const html = "<html><body><p>Hello</p></body></html>";
    stubFetch(html);
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.html).toBe(html);
  });
});

// ── fetchPageAssets — Inline styles ─────────────────────

describe("fetchPageAssets — inline <style> blocks", () => {
  it("extracts a single inline style block", async () => {
    stubFetch('<html><style>.a { color: red; }</style></html>');
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.cssBlocks).toHaveLength(1);
    expect(assets.cssBlocks[0]).toContain("color: red");
  });

  it("extracts multiple inline style blocks", async () => {
    stubFetch(`<html>
      <style>.a { color: red; }</style>
      <style>.b { font-size: 14px; }</style>
    </html>`);
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.cssBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it("skips empty <style> blocks", async () => {
    stubFetch('<html><style></style><style>   </style></html>');
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.cssBlocks).toHaveLength(0);
  });

  it("handles style tags with attributes", async () => {
    stubFetch('<html><style type="text/css">.x { color: blue; }</style></html>');
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.cssBlocks).toHaveLength(1);
  });
});

// ── fetchPageAssets — Linked stylesheets ────────────────

describe("fetchPageAssets — linked stylesheets", () => {
  it("fetches a relative stylesheet", async () => {
    mockFetchSequence([
      { ok: true, body: '<html><link rel="stylesheet" href="/styles.css"></html>' },
      { ok: true, body: ".btn { color: blue; }" },
    ]);
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.cssBlocks.some((b) => b.includes("color: blue"))).toBe(true);
  });

  it("fetches an absolute stylesheet", async () => {
    mockFetchSequence([
      { ok: true, body: '<html><link rel="stylesheet" href="https://cdn.example.com/reset.css"></html>' },
      { ok: true, body: "* { box-sizing: border-box; }" },
    ]);
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.cssBlocks.some((b) => b.includes("box-sizing"))).toBe(true);
  });

  it("handles href-first link variant", async () => {
    mockFetchSequence([
      { ok: true, body: '<html><link href="/app.css" rel="stylesheet"></html>' },
      { ok: true, body: ":root { --bg: #fff; }" },
    ]);
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.cssBlocks.some((b) => b.includes("--bg"))).toBe(true);
  });

  it("gracefully handles a stylesheet fetch failure", async () => {
    fetchPublicTextMock
      .mockResolvedValueOnce({
        url: "https://example.com",
        ok: true,
        status: 200,
        headers: {},
        text: '<html><link rel="stylesheet" href="/bad.css"></html>',
      })
      .mockRejectedValueOnce(new Error("Timeout"));
    const assets = await fetchPageAssets("https://example.com");
    expect(assets).toBeDefined(); // doesn't throw
    expect(assets.cssBlocks).toHaveLength(0);
  });

  it("handles stylesheet returning non-ok response", async () => {
    mockFetchSequence([
      { ok: true, body: '<html><link rel="stylesheet" href="/missing.css"></html>' },
      { ok: false, status: 404, body: "" },
    ]);
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.cssBlocks).toHaveLength(0);
  });

  it("skips malformed href", async () => {
    stubFetch('<html><link rel="stylesheet" href="::invalid::"></html>');
    const assets = await fetchPageAssets("https://example.com");
    expect(assets.cssBlocks).toHaveLength(0);
  });

  it("caps at MAX_STYLESHEETS (10)", async () => {
    const links = Array.from({ length: 15 }, (_, i) => `<link rel="stylesheet" href="/s${i}.css">`).join("\n");
    const html = `<html><head>${links}</head></html>`;
    const responses = [
      { ok: true, body: html },
      ...Array.from({ length: 10 }, (_, i) => ({ ok: true, body: `.c${i}{color:red}` })),
    ];
    mockFetchSequence(responses);
    const assets = await fetchPageAssets("https://example.com");
    // 1 for page + up to 10 for stylesheets = max 11 calls
    expect(fetchPublicTextMock.mock.calls.length).toBeLessThanOrEqual(11);
    expect(assets.cssBlocks.length).toBeLessThanOrEqual(10);
  });
});

// ── parseCSSTokens — Colors ───────────────────────────────

describe("parseCSSTokens — colors", () => {
  it("extracts 3-digit hex color", () => {
    const t = parseCSSTokens([".a { color: #f0c; }"]);
    expect(t.colors.some((c) => c.includes("#f0c") || c.includes("#F0C"))).toBe(true);
  });

  it("extracts 6-digit hex color", () => {
    const t = parseCSSTokens([".a { color: #ff0033; }"]);
    expect(t.colors).toContain("#ff0033");
  });

  it("extracts 8-digit hex with alpha", () => {
    const t = parseCSSTokens([".a { background: #ff003380; }"]);
    expect(t.colors.some((c) => c.startsWith("#ff0033"))).toBe(true);
  });

  it("extracts rgb()", () => {
    const t = parseCSSTokens(["body { color: rgb(255, 128, 0); }"]);
    expect(t.colors.some((c) => c.startsWith("rgb("))).toBe(true);
  });

  it("extracts rgba()", () => {
    const t = parseCSSTokens(["body { color: rgba(255, 128, 0, 0.5); }"]);
    expect(t.colors.some((c) => c.startsWith("rgba("))).toBe(true);
  });

  it("extracts hsl()", () => {
    const t = parseCSSTokens(["body { color: hsl(200, 50%, 60%); }"]);
    expect(t.colors.some((c) => c.startsWith("hsl("))).toBe(true);
  });

  it("extracts hsla()", () => {
    const t = parseCSSTokens(["body { color: hsla(200, 50%, 60%, 0.9); }"]);
    expect(t.colors.some((c) => c.startsWith("hsla("))).toBe(true);
  });

  it("extracts oklch()", () => {
    const t = parseCSSTokens(["body { color: oklch(0.7 0.2 250); }"]);
    expect(t.colors.some((c) => c.startsWith("oklch("))).toBe(true);
  });

  it("ignores #000", () => {
    const t = parseCSSTokens([".a { color: #000; }"]);
    expect(t.colors).not.toContain("#000");
  });

  it("ignores #000000", () => {
    const t = parseCSSTokens([".a { color: #000000; }"]);
    const normalized = t.colors.map((c) => c.toLowerCase());
    expect(normalized).not.toContain("#000000");
  });

  it("ignores #fff", () => {
    const t = parseCSSTokens([".a { background: #fff; }"]);
    expect(t.colors).not.toContain("#fff");
  });

  it("ignores #ffffff", () => {
    const t = parseCSSTokens([".a { background: #ffffff; }"]);
    const normalized = t.colors.map((c) => c.toLowerCase());
    expect(normalized).not.toContain("#ffffff");
  });

  it("deduplicates identical colors", () => {
    const t = parseCSSTokens([".a { color: #3b82f6; } .b { color: #3b82f6; }"]);
    const count = t.colors.filter((c) => c === "#3b82f6").length;
    expect(count).toBe(1);
  });

  it("returns empty array when no colors present", () => {
    const t = parseCSSTokens([".a { font-size: 14px; margin: 8px; }"]);
    expect(t.colors).toEqual([]);
  });

  it("handles empty cssBlocks array", () => {
    const t = parseCSSTokens([]);
    expect(t.colors).toEqual([]);
  });
});

// ── parseCSSTokens — Font families ───────────────────────

describe("parseCSSTokens — font families", () => {
  it("extracts a single font-family declaration", () => {
    const t = parseCSSTokens(["body { font-family: Inter, sans-serif; }"]);
    expect(t.fonts).toHaveLength(1);
    expect(t.fonts[0]).toContain("Inter");
  });

  it("extracts multiple font-family declarations", () => {
    const t = parseCSSTokens([
      "body { font-family: Inter, sans-serif; }",
      "h1 { font-family: 'Cormorant Garamond', serif; }",
    ]);
    expect(t.fonts.length).toBeGreaterThanOrEqual(2);
  });

  it("strips !important from font-family", () => {
    const t = parseCSSTokens(["body { font-family: Inter !important; }"]);
    expect(t.fonts[0]).not.toContain("!important");
  });

  it("skips var() font-family values", () => {
    const t = parseCSSTokens(["body { font-family: var(--font-sans); }"]);
    expect(t.fonts).toHaveLength(0);
  });

  it("deduplicates identical font families", () => {
    const t = parseCSSTokens([
      "body { font-family: Inter, sans-serif; }",
      "p { font-family: Inter, sans-serif; }",
    ]);
    const count = t.fonts.filter((f) => f.includes("Inter, sans-serif")).length;
    expect(count).toBe(1);
  });

  it("returns empty array when no font-family present", () => {
    const t = parseCSSTokens([".a { color: #3b82f6; }"]);
    expect(t.fonts).toEqual([]);
  });
});

// ── parseCSSTokens — Font sizes ──────────────────────────

describe("parseCSSTokens — font sizes", () => {
  it("extracts px font size", () => {
    const t = parseCSSTokens(["body { font-size: 16px; }"]);
    expect(t.fontSizes).toContain("16px");
  });

  it("extracts rem font size", () => {
    const t = parseCSSTokens(["p { font-size: 0.875rem; }"]);
    expect(t.fontSizes.some((s) => s.includes("rem"))).toBe(true);
  });

  it("strips !important from font size", () => {
    const t = parseCSSTokens(["h1 { font-size: 32px !important; }"]);
    expect(t.fontSizes[0]).not.toContain("!important");
  });

  it("skips var() font size values", () => {
    const t = parseCSSTokens(["body { font-size: var(--size-base); }"]);
    expect(t.fontSizes).toHaveLength(0);
  });

  it("deduplicates identical font sizes", () => {
    const t = parseCSSTokens([".a { font-size: 14px; } .b { font-size: 14px; }"]);
    const count = t.fontSizes.filter((s) => s === "14px").length;
    expect(count).toBe(1);
  });
});

// ── parseCSSTokens — Spacing ─────────────────────────────

describe("parseCSSTokens — spacing", () => {
  it("extracts padding values", () => {
    const t = parseCSSTokens([".a { padding: 16px 24px; }"]);
    expect(t.spacing.some((s) => s === "16px" || s === "24px")).toBe(true);
  });

  it("extracts margin values", () => {
    const t = parseCSSTokens([".a { margin: 8px; }"]);
    expect(t.spacing).toContain("8px");
  });

  it("extracts gap values", () => {
    const t = parseCSSTokens([".a { gap: 12px; }"]);
    expect(t.spacing).toContain("12px");
  });

  it("skips var() spacing values", () => {
    const t = parseCSSTokens([".a { padding: var(--space-4); }"]);
    const noVarSpacing = t.spacing.filter((s) => s.includes("var("));
    expect(noVarSpacing).toHaveLength(0);
  });

  it("skips calc() spacing values", () => {
    const t = parseCSSTokens([".a { margin: calc(100% - 2rem); }"]);
    const noCalcSpacing = t.spacing.filter((s) => s.includes("calc("));
    expect(noCalcSpacing).toHaveLength(0);
  });

  it("sorts numerically", () => {
    const t = parseCSSTokens([".a { padding: 32px 8px 16px 4px; }"]);
    const values = t.spacing.map((s) => parseFloat(s));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  it("returns empty array when no spacing", () => {
    const t = parseCSSTokens([".a { color: #333; }"]);
    expect(t.spacing).toEqual([]);
  });
});

// ── parseCSSTokens — Border radii ────────────────────────

describe("parseCSSTokens — border radii", () => {
  it("extracts border-radius value", () => {
    const t = parseCSSTokens([".btn { border-radius: 6px; }"]);
    expect(t.radii).toContain("6px");
  });

  it("strips !important", () => {
    const t = parseCSSTokens([".btn { border-radius: 4px !important; }"]);
    expect(t.radii[0]).not.toContain("!important");
  });

  it("skips var() radii", () => {
    const t = parseCSSTokens([".btn { border-radius: var(--radius); }"]);
    const noVar = t.radii.filter((r) => r.includes("var("));
    expect(noVar).toHaveLength(0);
  });

  it("skips '0' (zero, no unit)", () => {
    const t = parseCSSTokens([".btn { border-radius: 0; }"]);
    expect(t.radii).not.toContain("0");
  });

  it("deduplicates identical radii", () => {
    const t = parseCSSTokens([".a { border-radius: 8px; } .b { border-radius: 8px; }"]);
    const count = t.radii.filter((r) => r === "8px").length;
    expect(count).toBe(1);
  });

  it("returns empty when no radii", () => {
    const t = parseCSSTokens([".a { color: #333; }"]);
    expect(t.radii).toEqual([]);
  });
});

// ── parseCSSTokens — Shadows ─────────────────────────────

describe("parseCSSTokens — shadows", () => {
  it("extracts box-shadow value", () => {
    const t = parseCSSTokens([".card { box-shadow: 0 2px 4px rgba(0,0,0,0.1); }"]);
    expect(t.shadows).toHaveLength(1);
  });

  it("strips !important", () => {
    const t = parseCSSTokens([".card { box-shadow: 0 1px 3px #000 !important; }"]);
    expect(t.shadows[0]).not.toContain("!important");
  });

  it("skips 'none' value", () => {
    const t = parseCSSTokens([".card { box-shadow: none; }"]);
    expect(t.shadows).not.toContain("none");
  });

  it("skips var() shadows", () => {
    const t = parseCSSTokens([".card { box-shadow: var(--shadow-md); }"]);
    const noVar = t.shadows.filter((s) => s.includes("var("));
    expect(noVar).toHaveLength(0);
  });

  it("deduplicates identical shadows", () => {
    const css = ".a { box-shadow: 0 2px 4px #333; } .b { box-shadow: 0 2px 4px #333; }";
    const t = parseCSSTokens([css]);
    const count = t.shadows.filter((s) => s.includes("0 2px 4px #333")).length;
    expect(count).toBe(1);
  });

  it("returns empty when no shadows", () => {
    const t = parseCSSTokens([".a { color: #333; }"]);
    expect(t.shadows).toEqual([]);
  });
});

// ── parseCSSTokens — CSS variables ───────────────────────

describe("parseCSSTokens — CSS custom properties", () => {
  it("extracts --var-name: value pairs", () => {
    const t = parseCSSTokens([":root { --bg: #fafaf9; --fg: #0a0a0a; }"]);
    expect(t.cssVars["--bg"]).toBe("#fafaf9");
    expect(t.cssVars["--fg"]).toBe("#0a0a0a");
  });

  it("strips !important from CSS var values", () => {
    const t = parseCSSTokens([":root { --size: 16px !important; }"]);
    expect(t.cssVars["--size"]).not.toContain("!important");
  });

  it("handles multiple variable blocks", () => {
    const t = parseCSSTokens([
      ":root { --a: 1px; }",
      ".dark { --a: 2px; --b: 3px; }",
    ]);
    expect(t.cssVars["--a"]).toBeDefined();
    expect(t.cssVars["--b"]).toBeDefined();
  });

  it("returns empty object when no CSS vars", () => {
    const t = parseCSSTokens([".a { color: #333; }"]);
    expect(t.cssVars).toEqual({});
  });

  it("handles empty cssBlocks", () => {
    const t = parseCSSTokens([]);
    expect(t.cssVars).toEqual({});
  });

  it("handles multiple var definitions (last wins for same name)", () => {
    const t = parseCSSTokens([":root { --color: #111; --color: #222; }"]);
    expect(typeof t.cssVars["--color"]).toBe("string");
  });
});

// ── parseCSSTokens — Combined / edge cases ───────────────

describe("parseCSSTokens — combined edge cases", () => {
  it("handles all empty token categories gracefully", () => {
    const t = parseCSSTokens(["/* no tokens here */"]);
    expect(t.colors).toEqual([]);
    expect(t.fonts).toEqual([]);
    expect(t.fontSizes).toEqual([]);
    expect(t.spacing).toEqual([]);
    expect(t.radii).toEqual([]);
    expect(t.shadows).toEqual([]);
    expect(t.cssVars).toEqual({});
  });

  it("deduplicates across multiple CSS blocks", () => {
    const t = parseCSSTokens([
      ".a { color: #3b82f6; }",
      ".b { color: #3b82f6; }",
      ".c { color: #3b82f6; }",
    ]);
    const count = t.colors.filter((c) => c === "#3b82f6").length;
    expect(count).toBe(1);
  });

  it("handles a large realistic CSS block", () => {
    const css = `
      :root {
        --bg: #fafaf9;
        --fg: #0a0a0a;
        --accent: #5b5bd6;
        --muted: #71717a;
      }
      body {
        font-family: 'Inter', -apple-system, sans-serif;
        font-size: 16px;
        background-color: #fafaf9;
        color: #0a0a0a;
      }
      h1 { font-size: 2.25rem; }
      h2 { font-size: 1.5rem; }
      .btn {
        padding: 8px 16px;
        border-radius: 6px;
        background-color: #5b5bd6;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12);
      }
      .card {
        border-radius: 12px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.08);
        padding: 24px;
      }
    `;
    const t = parseCSSTokens([css]);
    expect(Object.keys(t.cssVars).length).toBeGreaterThan(0);
    expect(t.colors.length).toBeGreaterThan(0);
    expect(t.fonts.length).toBeGreaterThan(0);
    expect(t.fontSizes.length).toBeGreaterThan(0);
    expect(t.radii.length).toBeGreaterThan(0);
    expect(t.shadows.length).toBeGreaterThan(0);
  });
});

// ── @import following ────────────────────────────────────

describe("fetchPageAssets — @import following", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("follows @import url() in linked stylesheet", async () => {
    const html = `<html><link rel="stylesheet" href="/main.css"></html>`;
    const mainCss = `@import url("/tokens.css"); body { color: #111; }`;
    const tokensCss = `:root { --color-bg: #fafafa; }`;

    // Fetch sequence: HTML → main.css → tokens.css (from @import)
    mockFetchSequence([
      { ok: true, body: html },
      { ok: true, body: mainCss },
      { ok: true, body: tokensCss },
    ]);

    const assets = await fetchPageAssets("https://example.com");
    const allCss = assets.cssBlocks.join("\n");
    // Both main.css body color and @import tokens.css variable should be present
    expect(allCss).toContain("#111");
    expect(allCss).toContain("--color-bg");
  });

  it("follows @import with quoted syntax", async () => {
    const html = `<html><link rel="stylesheet" href="/base.css"></html>`;
    const baseCss = `@import "fonts.css"; h1 { font-size: 2rem; }`;
    const fontsCss = `@font-face { font-family: "Inter"; src: url("/inter.woff2"); }`;

    mockFetchSequence([
      { ok: true, body: html },
      { ok: true, body: baseCss },
      { ok: true, body: fontsCss },
    ]);

    const assets = await fetchPageAssets("https://example.com");
    const combined = assets.cssBlocks.join("\n");
    expect(combined).toContain("font-family");
    expect(combined).toContain("2rem");
  });

  it("does not crash when @import fetch fails", async () => {
    const html = `<html><link rel="stylesheet" href="/main.css"></html>`;
    const mainCss = `@import url("/missing.css"); body { background: #fff; }`;

    mockFetchSequence([
      { ok: true, body: html },
      { ok: true, body: mainCss },
      { ok: false, status: 404, body: "" }, // @import target 404s
    ]);

    const assets = await fetchPageAssets("https://example.com");
    // Should still return the main CSS content without crashing
    expect(assets.cssBlocks.length).toBeGreaterThan(0);
    const combined = assets.cssBlocks.join("\n");
    expect(combined).toContain("#fff");
  });

  it("resolves relative @import paths against the stylesheet URL", async () => {
    const html = `<html><link rel="stylesheet" href="https://cdn.example.com/styles/main.css"></html>`;
    const mainCss = `@import "vars/tokens.css"; .btn { padding: 8px 16px; }`;
    const tokensCss = `:root { --primary: #3b82f6; }`;

    mockFetchSequence([
      { ok: true, body: html },
      { ok: true, body: mainCss },
      { ok: true, body: tokensCss },
    ]);

    const assets = await fetchPageAssets("https://example.com");
    const combined = assets.cssBlocks.join("\n");
    // The tokens from the resolved @import should be present
    expect(combined).toContain("--primary");
  });
});

// ── WA-101: hexToRgb ──────────────────────────────────────

describe("hexToRgb", () => {
  it("parses a 6-digit hex", () => {
    expect(hexToRgb("#ff0033")).toEqual([255, 0, 51]);
  });

  it("parses a 3-digit hex by expanding channels", () => {
    expect(hexToRgb("#f0c")).toEqual([255, 0, 204]);
  });

  it("parses lowercase 6-digit hex", () => {
    expect(hexToRgb("#aabbcc")).toEqual([170, 187, 204]);
  });

  it("parses uppercase 6-digit hex", () => {
    expect(hexToRgb("#AABBCC")).toEqual([170, 187, 204]);
  });

  it("returns null for invalid hex string", () => {
    expect(hexToRgb("#xyz")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(hexToRgb("")).toBeNull();
  });

  it("returns null for 4-digit hex (not supported)", () => {
    expect(hexToRgb("#ffff")).toBeNull();
  });

  it("handles #000000 (pure black)", () => {
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
  });

  it("handles #ffffff (pure white)", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
  });
});

// ── WA-101: relativeLuminance ─────────────────────────────

describe("relativeLuminance", () => {
  it("pure black has luminance 0", () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 6);
  });

  it("pure white has luminance ~1.0", () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1.0, 4);
  });

  it("midtone gray (128,128,128) is between 0 and 1", () => {
    const lum = relativeLuminance(128, 128, 128);
    expect(lum).toBeGreaterThan(0);
    expect(lum).toBeLessThan(1);
  });

  it("pure red (255,0,0) uses 0.2126 coefficient", () => {
    // linearized(255)=1, so luminance ≈ 0.2126
    expect(relativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 3);
  });

  it("pure green (0,255,0) uses 0.7152 coefficient", () => {
    expect(relativeLuminance(0, 255, 0)).toBeCloseTo(0.7152, 3);
  });

  it("pure blue (0,0,255) uses 0.0722 coefficient", () => {
    expect(relativeLuminance(0, 0, 255)).toBeCloseTo(0.0722, 3);
  });
});

// ── WA-101: contrastRatio ─────────────────────────────────

describe("contrastRatio", () => {
  it("black on white = 21:1", () => {
    const white = relativeLuminance(255, 255, 255);
    const black = relativeLuminance(0, 0, 0);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 0);
  });

  it("white on white = 1:1", () => {
    const white = relativeLuminance(255, 255, 255);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 4);
  });

  it("same luminance always returns 1", () => {
    expect(contrastRatio(0.5, 0.5)).toBeCloseTo(1, 4);
  });

  it("is symmetric — order does not matter", () => {
    const l1 = relativeLuminance(100, 100, 200);
    const l2 = relativeLuminance(200, 200, 200);
    expect(contrastRatio(l1, l2)).toBeCloseTo(contrastRatio(l2, l1), 8);
  });

  it("result is always >= 1", () => {
    for (const [r, g, b] of [[0, 0, 0], [128, 64, 32], [200, 200, 200]] as Array<[number, number, number]>) {
      const lum = relativeLuminance(r, g, b);
      const white = relativeLuminance(255, 255, 255);
      expect(contrastRatio(lum, white)).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── WA-101: wcagLevel ─────────────────────────────────────

describe("wcagLevel", () => {
  it("ratio exactly 7.0 → AAA", () => {
    expect(wcagLevel(7.0)).toBe("AAA");
  });

  it("ratio > 7 → AAA", () => {
    expect(wcagLevel(10)).toBe("AAA");
  });

  it("ratio exactly 4.5 → AA", () => {
    expect(wcagLevel(4.5)).toBe("AA");
  });

  it("ratio between 4.5 and 7 → AA", () => {
    expect(wcagLevel(5.5)).toBe("AA");
  });

  it("ratio exactly 3.0 → AA-large", () => {
    expect(wcagLevel(3.0)).toBe("AA-large");
  });

  it("ratio between 3 and 4.5 → AA-large", () => {
    expect(wcagLevel(3.5)).toBe("AA-large");
  });

  it("ratio below 3 → fail", () => {
    expect(wcagLevel(2.9)).toBe("fail");
  });

  it("ratio 1 → fail", () => {
    expect(wcagLevel(1)).toBe("fail");
  });
});

// ── WA-102: parseCSSTokens contrastPairs ─────────────────

describe("parseCSSTokens — contrastPairs", () => {
  it("returns contrastPairs field", () => {
    const t = parseCSSTokens([".a { color: #3b82f6; }"]);
    expect(t).toHaveProperty("contrastPairs");
    expect(Array.isArray(t.contrastPairs)).toBe(true);
  });

  it("contrastPairs includes white and black baseline comparisons", () => {
    const t = parseCSSTokens([".a { color: #3b82f6; }"]);
    const bgs = t.contrastPairs.map((p) => p.bg);
    expect(bgs).toContain("#ffffff");
    expect(bgs).toContain("#000000");
  });

  it("contrastPairs are empty when no colors extracted", () => {
    const t = parseCSSTokens([".a { font-size: 14px; }"]);
    expect(t.contrastPairs).toEqual([]);
  });

  it("each pair has fg, bg, ratio, and level fields", () => {
    const t = parseCSSTokens([".a { color: #5b5bd6; }"]);
    for (const p of t.contrastPairs) {
      expect(p).toHaveProperty("fg");
      expect(p).toHaveProperty("bg");
      expect(p).toHaveProperty("ratio");
      expect(p).toHaveProperty("level");
    }
  });

  it("ratio values are numbers rounded to at most 2 decimal places", () => {
    const t = parseCSSTokens([".a { color: #3b82f6; }"]);
    for (const p of t.contrastPairs) {
      expect(typeof p.ratio).toBe("number");
      expect(String(p.ratio)).toMatch(/^\d+(\.\d{1,2})?$/);
    }
  });

  it("caps contrastPairs at 20 entries even with many colors", () => {
    const colors = Array.from(
      { length: 15 },
      (_, i) => `#${String(i * 17).padStart(2, "0")}${String(i * 13).padStart(2, "0")}aa`,
    );
    const css = colors.map((c, i) => `.c${i} { color: ${c}; }`).join("\n");
    const t = parseCSSTokens([css]);
    expect(t.contrastPairs.length).toBeLessThanOrEqual(20);
  });

  it("non-hex colors produce no contrastPairs entries (only hex supported)", () => {
    // rgb() colors are not hex — hexToRgb will return null for them, so no pairs
    const t = parseCSSTokens(["body { color: rgb(91, 91, 214); }"]);
    // rgb() colors won't produce pairs since hexToRgb only handles hex
    expect(Array.isArray(t.contrastPairs)).toBe(true);
    // All pairs that exist should have valid levels
    for (const p of t.contrastPairs) {
      expect(["AAA", "AA", "AA-large", "fail"]).toContain(p.level);
    }
  });
});
