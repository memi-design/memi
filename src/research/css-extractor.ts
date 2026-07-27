/**
 * CSS Extractor — Fetches a URL's HTML and stylesheets, then parses
 * them into raw design tokens (colors, typography, spacing, radii, shadows).
 *
 * Used by `memi design-doc` to build a DESIGN.md from any public URL
 * without requiring a headless browser.
 */

import { createLogger } from "../engine/logger.js";
import type { DesignToken } from "../engine/registry.js";
import { fetchPublicText } from "../security/safe-fetch.js";
import { extractDesignTokensFromCss, type TokenExtractionReport } from "../tokens/extractor.js";

const log = createLogger("css-extractor");

const FETCH_TIMEOUT_MS = 15000;
const MAX_REMOTE_TEXT_BYTES = 2_000_000;
const MAX_STYLESHEETS = 10;
const MAX_COLORS = 50;        // cap to avoid noise from icon-heavy sites

// ── Types ─────────────────────────────────────────────────

export type WcagLevel = 'AAA' | 'AA' | 'AA-large' | 'fail';

export interface ContrastPair {
  fg: string;
  bg: string;
  ratio: number;
  level: WcagLevel;
}

export interface RawDesignTokens {
  colors: string[];
  fonts: string[];
  fontSizes: string[];
  spacing: string[];
  radii: string[];
  shadows: string[];
  cssVars: Record<string, string>;
  contrastPairs: ContrastPair[];
  designTokens?: DesignToken[];
  tokenReport?: TokenExtractionReport;
}

export interface PageAssets {
  url: string;
  title: string;
  html: string;
  cssBlocks: string[];
}

// ── SSRF guard ────────────────────────────────────────────

/**
 * Allow only public http(s) URLs. Blocks loopback, private IPv4 ranges,
 * link-local (169.254.x.x — AWS/GCP metadata endpoints), and non-http schemes.
 */
function assertPublicUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are allowed (got ${parsed.protocol})`);
  }

  const host = parsed.hostname.toLowerCase();

  // IPv6 loopback / unspecified
  if (host === "::1" || host === "::" || host === "[::1]") {
    throw new Error("Requests to loopback addresses are not allowed");
  }

  // IPv4 private / reserved ranges
  const PRIVATE_IPV4 =
    /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0)/;
  if (host === "localhost" || PRIVATE_IPV4.test(host)) {
    throw new Error("Requests to private/reserved IP ranges are not allowed");
  }
}

// ── Fetch ─────────────────────────────────────────────────

async function fetchText(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string | null> {
  try {
    const response = await fetchPublicText(url, {
      maxBytes: MAX_REMOTE_TEXT_BYTES,
      timeoutMs,
      headers: {
        "User-Agent": "Memoire-DesignDoc/1.0",
        "Accept": "text/html,text/css,*/*",
      },
    });
    if (!response.ok) return null;
    return response.text;
  } catch {
    return null;
  }
}

/**
 * Resolve a potentially relative URL against a base URL.
 */
function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * Extract @import URLs from a CSS string, resolved relative to baseUrl.
 * Handles both url() and bare string syntax.
 */
function extractImportUrls(css: string, baseUrl: string): string[] {
  const urls: string[] = [];
  // @import url("...") or @import url('...') or @import "..." or @import '...'
  const re = /@import\s+(?:url\(["']?([^"')]+)["']?\)|["']([^"']+)["'])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const href = (m[1] ?? m[2] ?? "").trim();
    if (!href) continue;
    const resolved = resolveUrl(href, baseUrl);
    if (resolved) urls.push(resolved);
  }
  return urls;
}

/**
 * Fetch a page's HTML and all linked/inline CSS blocks.
 * Follows up to MAX_STYLESHEETS <link rel="stylesheet"> hrefs
 * and one level of @import rules within each stylesheet.
 */
export async function fetchPageAssets(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<PageAssets> {
  assertPublicUrl(url);
  log.info({ url }, "Fetching page assets");

  const html = await fetchText(url, timeoutMs);
  if (!html) {
    return { url, title: "", html: "", cssBlocks: [] };
  }

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : url;

  const cssBlocks: string[] = [];

  // 1. Inline <style> blocks
  const styleTagRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch: RegExpExecArray | null;
  while ((styleMatch = styleTagRegex.exec(html)) !== null) {
    const content = styleMatch[1].trim();
    if (content) cssBlocks.push(content);
  }

  // 2. Linked stylesheets — <link rel="stylesheet" href="...">
  // Fix #3 (CRITICAL): re-validate each resolved URL before fetching to prevent
  // SSRF via attacker-controlled stylesheet hrefs pointing at private IP ranges.
  const linkRegex = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  const sheetUrls: string[] = [];
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const resolved = resolveUrl(linkMatch[1], url);
    if (resolved) {
      try { assertPublicUrl(resolved); sheetUrls.push(resolved); } catch { /* skip private */ }
    }
  }

  // Also catch href-first variant: <link href="..." rel="stylesheet">
  const linkRegex2 = /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*>/gi;
  while ((linkMatch = linkRegex2.exec(html)) !== null) {
    const resolved = resolveUrl(linkMatch[1], url);
    if (resolved && !sheetUrls.includes(resolved)) {
      try { assertPublicUrl(resolved); sheetUrls.push(resolved); } catch { /* skip private */ }
    }
  }

  // Fetch stylesheets in parallel (capped at MAX_STYLESHEETS)
  const sheetFetches = sheetUrls.slice(0, MAX_STYLESHEETS).map((sheetUrl) =>
    fetchText(sheetUrl).then(async (css) => {
      if (!css) return;
      cssBlocks.push(css);
      // 3. Follow @import rules within each stylesheet (one level deep)
      const importUrls = extractImportUrls(css, sheetUrl);
      for (const importUrl of importUrls.slice(0, 3)) {
        // Re-validate @import URLs before fetching (same SSRF guard)
        try { assertPublicUrl(importUrl); } catch { continue; }
        const importedCss = await fetchText(importUrl).catch(() => null);
        if (importedCss) cssBlocks.push(importedCss);
      }
    }).catch(() => null)
  );
  await Promise.all(sheetFetches);

  log.info(
    { url, inlineBlocks: cssBlocks.length - sheetUrls.length, sheets: sheetFetches.length },
    "CSS assets fetched",
  );

  return { url, title, html, cssBlocks };
}

// ── Parsers ───────────────────────────────────────────────

const COLOR_PATTERNS = [
  /#[0-9a-fA-F]{3,8}\b/g,
  /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/g,
  /hsla?\(\s*[\d.]+(?:deg|turn|rad)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*[\d.]+)?\s*\)/g,
  /oklch\(\s*[\d.]+%?\s+[\d.]+\s+[\d.]+(?:\s*\/\s*[\d.]+)?\s*\)/g,
  /color-mix\([^)]+\)/g,
];

// Colors we don't want: pure black, white, transparent, common reset values
const IGNORE_COLORS = new Set([
  "#000", "#000000", "#fff", "#ffffff",
  "rgba(0,0,0,0)", "rgba(255,255,255,0)", "transparent",
  "#0000", "#ffff",
]);

function normalizeColor(c: string): string {
  return c.replace(/\s+/g, "").toLowerCase();
}

function extractColors(css: string): string[] {
  const found = new Set<string>();
  for (const pattern of COLOR_PATTERNS) {
    let m: RegExpExecArray | null;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((m = re.exec(css)) !== null) {
      if (found.size >= MAX_COLORS) break;
      const normalized = normalizeColor(m[0]);
      if (!IGNORE_COLORS.has(normalized)) found.add(m[0].trim());
    }
    if (found.size >= MAX_COLORS) break;
  }
  return Array.from(found);
}

function extractFontFamilies(css: string): string[] {
  const found = new Set<string>();
  const re = /font-family\s*:\s*([^;}{]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const val = m[1].trim().replace(/!important/i, "").trim();
    if (val && !val.startsWith("var(")) found.add(val);
  }
  return Array.from(found);
}

function extractFontSizes(css: string): string[] {
  const found = new Set<string>();
  const re = /font-size\s*:\s*([^;}{]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const val = m[1].trim().replace(/!important/i, "").trim();
    if (val && !val.startsWith("var(")) found.add(val);
  }
  return Array.from(found);
}

function extractSpacing(css: string): string[] {
  const found = new Set<string>();
  // Only concrete values — skip var() and calc()
  const re = /(?:^|[\s;{])(?:padding|margin|gap|row-gap|column-gap)\s*:\s*([^;}{]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const val = m[1].trim().replace(/!important/i, "").trim();
    if (!val.startsWith("var(") && !val.startsWith("calc(")) {
      // Split shorthand values
      for (const part of val.split(/\s+/)) {
        if (/^\d+(?:\.\d+)?(?:px|rem|em|%)$/.test(part) && part !== "0px") {
          found.add(part);
        }
      }
    }
  }
  return Array.from(found).sort((a, b) => parseFloat(a) - parseFloat(b));
}

function extractRadii(css: string): string[] {
  const found = new Set<string>();
  const re = /border-radius\s*:\s*([^;}{]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const val = m[1].trim().replace(/!important/i, "").trim();
    if (val && !val.startsWith("var(") && val !== "0") found.add(val);
  }
  return Array.from(found);
}

function extractShadows(css: string): string[] {
  const found = new Set<string>();
  const re = /box-shadow\s*:\s*([^;}{]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const val = m[1].trim().replace(/!important/i, "").trim();
    if (val && val !== "none" && !val.startsWith("var(")) found.add(val);
  }
  return Array.from(found);
}

function extractCssVars(css: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const re = /--([\w-]+)\s*:\s*([^;}{]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const key = `--${m[1].trim()}`;
    const val = m[2].trim().replace(/!important/i, "").trim();
    if (val) vars[key] = val;
  }
  return vars;
}

// ── WCAG Contrast Utilities ───────────────────────────────

/**
 * Convert a 3-digit or 6-digit hex color to [r, g, b] tuple (0–255 each).
 * Returns null for invalid input.
 */
export function hexToRgb(hex: string): [number, number, number] | null {
  const cleaned = hex.trim().replace(/^#/, "");
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16);
    const g = parseInt(cleaned[1] + cleaned[1], 16);
    const b = parseInt(cleaned[2] + cleaned[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  if (cleaned.length === 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

/**
 * Compute WCAG relative luminance for a linearized RGB channel value (0–255).
 * Formula: 0.2126R + 0.7152G + 0.0722B with sRGB linearization.
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const linearize = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Compute WCAG contrast ratio between two relative luminance values.
 * Returns a value like 4.52 (range 1–21).
 */
export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Map a contrast ratio to a WCAG level.
 * AAA ≥ 7, AA ≥ 4.5, AA-large ≥ 3, else fail.
 */
export function wcagLevel(ratio: number): WcagLevel {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA-large';
  return 'fail';
}

const MAX_CONTRAST_PAIRS = 20;

/**
 * Build contrast pairs from a list of hex colors.
 * Tests each color against #ffffff and #000000 as common fg/bg pairs.
 * Caps at MAX_CONTRAST_PAIRS entries.
 */
function buildContrastPairs(colors: string[]): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  const whites = relativeLuminance(255, 255, 255); // 1.0
  const blacks = relativeLuminance(0, 0, 0);       // 0.0

  for (const color of colors) {
    if (pairs.length >= MAX_CONTRAST_PAIRS) break;
    const rgb = hexToRgb(color);
    if (!rgb) continue;
    const lum = relativeLuminance(rgb[0], rgb[1], rgb[2]);

    // color on white background
    const ratioOnWhite = contrastRatio(lum, whites);
    pairs.push({
      fg: color,
      bg: "#ffffff",
      ratio: Math.round(ratioOnWhite * 100) / 100,
      level: wcagLevel(ratioOnWhite),
    });

    if (pairs.length >= MAX_CONTRAST_PAIRS) break;

    // color on black background
    const ratioOnBlack = contrastRatio(lum, blacks);
    pairs.push({
      fg: color,
      bg: "#000000",
      ratio: Math.round(ratioOnBlack * 100) / 100,
      level: wcagLevel(ratioOnBlack),
    });
  }

  return pairs;
}

/**
 * Parse CSS blocks into raw design tokens.
 */
export function parseCSSTokens(cssBlocks: string[]): RawDesignTokens {
  const combined = cssBlocks.join("\n");
  const tokenReport = extractDesignTokensFromCss(cssBlocks, { sourceName: "css-extractor" });

  const cssVars = extractCssVars(combined);
  const colors = extractColors(combined);
  const fonts = extractFontFamilies(combined);
  const fontSizes = extractFontSizes(combined);
  const spacing = extractSpacing(combined);
  const radii = extractRadii(combined);
  const shadows = extractShadows(combined);

  const contrastPairs = buildContrastPairs(colors);

  log.info(
    { colors: colors.length, fonts: fonts.length, fontSizes: fontSizes.length, cssVars: Object.keys(cssVars).length, contrastPairs: contrastPairs.length },
    "CSS tokens parsed",
  );

  return {
    colors,
    fonts,
    fontSizes,
    spacing,
    radii,
    shadows,
    cssVars,
    contrastPairs,
    designTokens: tokenReport.tokens,
    tokenReport,
  };
}
