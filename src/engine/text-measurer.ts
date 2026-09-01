/**
 * TextMeasurer — Server-side text measurement powered by @chenglou/pretext.
 *
 * Provides accurate multiline text height prediction and line counting
 * without a browser DOM. Uses @napi-rs/canvas to provide the Canvas
 * context that Pretext's prepare() phase requires.
 *
 * Usage:
 *   const measurer = new TextMeasurer();
 *   const result = measurer.measure("Hello world", { maxWidth: 200 });
 *   // { height: 40, lineCount: 2 }
 */

import { prepare, layout, prepareWithSegments, layoutWithLines, clearCache } from "@chenglou/pretext";
import type { PreparedText } from "@chenglou/pretext";
import { getExecutionPolicy } from "../security/execution-policy.js";
import { createLogger } from "./logger.js";

const log = createLogger("text-measurer");
const CANVAS_INSTALL_COMMAND = "npm install --save-exact @napi-rs/canvas@0.1.97";
const MAX_PRETEXT_INPUT_CHARS = 20_000;
const MAX_REPEATED_PUNCTUATION_RUN = 2_000;
const RISKY_PUNCTUATION = new Set("()[]{}#@!%^~<>:;'\"`.,/\\|+=_*?".split(""));

// ── OffscreenCanvas Polyfill ────────────────────────────
// @napi-rs/canvas is an optional native dependency. When unavailable
// (binary builds, platforms without a prebuilt .node, hand-installed npm with
// --no-optional), measurement falls back to a character-width approximation.

let polyfillInstalled = false;
let canvasUnavailable = false;
let canvasCapabilityWarningLogged = false;

async function ensurePolyfill(): Promise<void> {
  if (polyfillInstalled || canvasUnavailable) return;
  if (typeof globalThis.OffscreenCanvas !== "undefined") {
    polyfillInstalled = true;
    return;
  }
  if (!getExecutionPolicy().allows("host-integration-code")) {
    if (!canvasCapabilityWarningLogged) {
      log.warn(
        `Optional native canvas code is disabled. Re-run with --profile connected --allow host-integration-code. For native measurement, run \`${CANVAS_INSTALL_COMMAND}\`.`,
      );
      canvasCapabilityWarningLogged = true;
    }
    return;
  }
  canvasCapabilityWarningLogged = false;
  try {
    const canvasMod: { createCanvas: (w: number, h: number) => unknown } =
      await import("@napi-rs/canvas");
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (globalThis as any).OffscreenCanvas = class OffscreenCanvasPolyfill {
      width: number;
      height: number;
      private _canvas: any;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
        this._canvas = canvasMod.createCanvas(w, h);
      }
      getContext(type: string) {
        return this._canvas.getContext(type);
      }
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    polyfillInstalled = true;
    log.info("Installed OffscreenCanvas polyfill for server-side text measurement");
  } catch {
    canvasUnavailable = true;
    log.warn(
      `@napi-rs/canvas not available — text measurement uses character-width approximation. For native measurement, run \`${CANVAS_INSTALL_COMMAND}\`.`,
    );
  }
}

function approximateLayout(text: string, font: string, maxWidth: number, lineHeight: number) {
  const detailed = approximateLayoutDetailed(text, font, maxWidth, lineHeight);
  return { height: detailed.height, lineCount: detailed.lineCount };
}

function approximateLayoutDetailed(text: string, font: string, maxWidth: number, lineHeight: number): DetailedMeasureResult {
  const fontSize = parseFontSize(font);
  const avgCharWidth = fontSize * 0.55;
  const charsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth));
  const paragraphs = text.split("\n");
  const lines: Array<{ text: string; width: number }> = [];
  for (const p of paragraphs) {
    if (p.length === 0) {
      lines.push({ text: "", width: 0 });
      continue;
    }
    for (let start = 0; start < p.length; start += charsPerLine) {
      const lineText = p.slice(start, start + charsPerLine);
      lines.push({
        text: lineText,
        width: Math.min(maxWidth, lineText.length * avgCharWidth),
      });
    }
  }
  const lineCount = lines.length;
  return { height: lineCount * lineHeight, lineCount, lines };
}

// ── Types ──────────────────────────────────────────────────

export interface MeasureOptions {
  /** Maximum width in pixels for line wrapping. */
  maxWidth: number;
  /** CSS font string (e.g., "16px Inter", "bold 14px sans-serif"). Default: "16px sans-serif". */
  font?: string;
  /** Line height in pixels. Default: font-size * 1.5. */
  lineHeight?: number;
}

export interface MeasureResult {
  /** Total height in pixels. */
  height: number;
  /** Number of wrapped lines. */
  lineCount: number;
}

export interface DetailedMeasureResult extends MeasureResult {
  /** Per-line text content and width. */
  lines: Array<{ text: string; width: number }>;
}

export interface OverflowCheck {
  /** Whether the text fits within the container. */
  fits: boolean;
  /** Actual height needed. */
  actualHeight: number;
  /** Container height. */
  containerHeight: number;
  /** Number of lines. */
  lineCount: number;
  /** How many pixels of overflow (negative = fits with room). */
  overflow: number;
}

export interface BreakpointResult {
  /** Breakpoint name (e.g., "mobile", "tablet", "desktop"). */
  breakpoint: string;
  /** Container width at this breakpoint. */
  width: number;
  /** Whether text fits at this width. */
  fits: boolean;
  /** Line count at this width. */
  lineCount: number;
  /** Height at this width. */
  height: number;
}

// ── Default Breakpoints ────────────────────────────────────

const DEFAULT_BREAKPOINTS: Record<string, number> = {
  mobile: 320,
  "mobile-lg": 375,
  tablet: 768,
  desktop: 1024,
  "desktop-lg": 1440,
};

// ── TextMeasurer ───────────────────────────────────────────

export class TextMeasurer {
  private cache = new Map<string, PreparedText>();
  private approximateCache = new Set<string>();
  private maxCacheSize: number;
  private initPromise: Promise<void>;

  constructor(maxCacheSize = 500) {
    this.maxCacheSize = maxCacheSize;
    this.initPromise = ensurePolyfill();
  }

  /** Await canvas polyfill readiness. Optional — synchronous APIs fall back. */
  async ready(): Promise<void> {
    await this.initPromise;
  }

  /** Measure text: returns height and line count. */
  measure(text: string, opts: MeasureOptions): MeasureResult {
    const font = opts.font ?? "16px sans-serif";
    const lineHeight = opts.lineHeight ?? parseFontSize(font) * 1.5;
    const useApproximate = !polyfillInstalled || shouldUseApproximateMeasurement(text);
    if (useApproximate) {
      if (!shouldUseApproximateMeasurement(text)) this.trackApproximate(text, font);
      return approximateLayout(text, font, opts.maxWidth, lineHeight);
    }
    const prepared = this.getPrepared(text, font);
    return layout(prepared, opts.maxWidth, lineHeight);
  }

  /** Measure text with per-line detail. */
  measureDetailed(text: string, opts: MeasureOptions): DetailedMeasureResult {
    const font = opts.font ?? "16px sans-serif";
    const lineHeight = opts.lineHeight ?? parseFontSize(font) * 1.5;
    const useApproximate = !polyfillInstalled || shouldUseApproximateMeasurement(text);
    if (useApproximate) {
      if (!shouldUseApproximateMeasurement(text)) this.trackApproximate(text, font);
      return approximateLayoutDetailed(text, font, opts.maxWidth, lineHeight);
    }
    const prepared = prepareWithSegments(text, font);
    const result = layoutWithLines(prepared, opts.maxWidth, lineHeight);
    return {
      height: result.height,
      lineCount: result.lineCount,
      lines: result.lines.map((l) => ({ text: l.text, width: l.width })),
    };
  }

  /** Check if text fits within a container. */
  checkOverflow(text: string, opts: MeasureOptions & { containerHeight: number }): OverflowCheck {
    const result = this.measure(text, opts);
    return {
      fits: result.height <= opts.containerHeight,
      actualHeight: result.height,
      containerHeight: opts.containerHeight,
      lineCount: result.lineCount,
      overflow: result.height - opts.containerHeight,
    };
  }

  /** Test text at multiple breakpoints. */
  checkBreakpoints(
    text: string,
    opts: {
      font?: string;
      lineHeight?: number;
      containerHeight?: number;
      breakpoints?: Record<string, number>;
    } = {},
  ): BreakpointResult[] {
    const breakpoints = opts.breakpoints ?? DEFAULT_BREAKPOINTS;
    const containerHeight = opts.containerHeight ?? Infinity;

    return Object.entries(breakpoints).map(([name, width]) => {
      const result = this.measure(text, { maxWidth: width, font: opts.font, lineHeight: opts.lineHeight });
      return {
        breakpoint: name,
        width,
        fits: result.height <= containerHeight,
        lineCount: result.lineCount,
        height: result.height,
      };
    });
  }

  /** Find the minimum width where text fits in a given number of lines. */
  findMinWidth(text: string, opts: { maxLines: number; font?: string; lineHeight?: number; minWidth?: number; maxWidth?: number }): number {
    const font = opts.font ?? "16px sans-serif";
    const lineHeight = opts.lineHeight ?? parseFontSize(font) * 1.5;
    let lo = opts.minWidth ?? 50;
    let hi = opts.maxWidth ?? 2000;

    // Binary search for minimum width
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const result = this.measure(text, { maxWidth: mid, font, lineHeight });
      if (result.lineCount <= opts.maxLines) {
        hi = mid;
      } else {
        lo = mid;
      }
    }

    return hi;
  }

  /** Clear the internal measurement cache and Pretext's global cache. */
  clearCache(): void {
    this.cache.clear();
    this.approximateCache.clear();
    clearCache();
  }

  /** Get cache size for monitoring. */
  get cacheSize(): number {
    return this.cache.size + this.approximateCache.size;
  }

  // ── Internal ─────────────────────────────────────────

  private getPrepared(text: string, font: string): PreparedText {
    if (shouldUseApproximateMeasurement(text)) {
      throw new Error("Pretext measurement refused unsafe text input");
    }
    const key = `${font}\0${text}`;
    let prepared = this.cache.get(key);
    if (!prepared) {
      prepared = prepare(text, font);
      this.cache.set(key, prepared);
      // Evict oldest entries when cache is full
      if (this.cache.size > this.maxCacheSize) {
        const firstKey = this.cache.keys().next().value!;
        this.cache.delete(firstKey);
      }
    } else {
      // True LRU: move accessed entry to end of insertion order
      this.cache.delete(key);
      this.cache.set(key, prepared);
    }
    return prepared;
  }

  private trackApproximate(text: string, font: string): void {
    const key = `${font}\0${text}`;
    if (this.approximateCache.has(key)) {
      this.approximateCache.delete(key);
    }
    this.approximateCache.add(key);
    if (this.approximateCache.size > this.maxCacheSize) {
      const firstKey = this.approximateCache.values().next().value!;
      this.approximateCache.delete(firstKey);
    }
  }
}

/** Parse font size from a CSS font string. */
function parseFontSize(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)\s*px/);
  return match ? parseFloat(match[1]) : 16;
}

function shouldUseApproximateMeasurement(text: string): boolean {
  return text.length > MAX_PRETEXT_INPUT_CHARS || hasLongRepeatedPunctuationRun(text);
}

function hasLongRepeatedPunctuationRun(text: string): boolean {
  let previous = "";
  let runLength = 0;
  for (const char of text) {
    if (char === previous && isRiskyPunctuation(char)) {
      runLength += 1;
      if (runLength >= MAX_REPEATED_PUNCTUATION_RUN) return true;
      continue;
    }
    previous = char;
    runLength = isRiskyPunctuation(char) ? 1 : 0;
  }
  return false;
}

function isRiskyPunctuation(char: string): boolean {
  return RISKY_PUNCTUATION.has(char);
}

// ── Singleton ──────────────────────────────────────────────

let instance: TextMeasurer | null = null;

export function getTextMeasurer(): TextMeasurer {
  if (!instance) instance = new TextMeasurer();
  return instance;
}
