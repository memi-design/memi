/**
 * `memi design-doc <url>` — Extract a design system from any public URL
 * and generate a structured DESIGN.md file.
 *
 * Fetches HTML + stylesheets, parses CSS tokens, then uses Claude to
 * synthesize a clean DESIGN.md covering colors, typography, spacing,
 * components, voice, and a Tailwind config sketch.
 *
 * Output is usable as AI context for `memi compose` or any Claude prompt.
 */

import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname, isAbsolute } from "path";
import { fetchPageAssets, parseCSSTokens, type RawDesignTokens, type ContrastPair } from "../research/css-extractor.js";
import { getAI, hasAI } from "../ai/client.js";
import { formatElapsed } from "../utils/format.js";
import { ui } from "../tui/format.js";
import { getMemoirePackageVersion } from "../utils/package-version.js";

export interface DesignDocPayload {
  status: "completed" | "failed";
  url: string;
  output: string;
  spec?: string;
  cssVarCount: number;
  colorCount: number;
  contrastFailCount: number;
  elapsedMs: number;
  error?: string;
}

export function registerDesignDocCommand(program: Command, engine: MemoireEngine) {
  const cmd = program
    .command("design-doc <url>")
    .alias("extract")
    .description("Extract design system from any URL and generate DESIGN.md — no Figma needed")
    .option("-o, --output <path>", "Output path for DESIGN.md", "./DESIGN.md")
    .option("--spec", "Also write a DesignSpec JSON to specs/")
    .option("--json", "Output results as JSON")
    .option("--wcag", "Include full contrast table for all extracted color pairs")
    .option("--timeout <ms>", "Fetch timeout in milliseconds", "15000")
    .option("--codegen", "Also write a Tailwind v4 @theme block (tokens.css)")
    .option("--init <name>", "Build a full registry package from extracted tokens")
    .action(async (url: string, opts: { output: string; spec?: boolean; json?: boolean; wcag?: boolean; timeout?: string; codegen?: boolean; init?: string }) => {
      const start = Date.now();
      await engine.init();

      if (!opts.json) {
        console.log(`\n  Extracting design system from ${url}...\n`);
      }

      try {
        // 1. Fetch page assets (HTML + CSS)
        if (!opts.json) console.log("  · Fetching HTML and stylesheets...");
        const timeout = parseInt(opts.timeout ?? "15000", 10) || 15000;
        const assets = await fetchPageAssets(url, timeout);

        if (!assets.html && assets.cssBlocks.length === 0) {
          throw new Error(`Could not fetch ${url} — check the URL and try again`);
        }

        if (!opts.json && assets.title && assets.title !== url) {
          console.log(`  · "${assets.title}"`);
        }

        // 2. Parse CSS tokens
        const tokens = parseCSSTokens(assets.cssBlocks);

        if (!opts.json) {
          const varCount = Object.keys(tokens.cssVars).length;
          const summary = [
            varCount > 0 ? `${varCount} CSS vars` : null,
            tokens.colors.length > 0 ? `${tokens.colors.length} colors` : null,
            tokens.fonts.length > 0 ? `${tokens.fonts.length} fonts` : null,
            tokens.radii.length > 0 ? `${tokens.radii.length} radii` : null,
          ].filter(Boolean).join(", ");
          console.log(`  · ${summary || "no tokens extracted"}`);

          // Contrast summary
          printContrastSummary(tokens.contrastPairs, !!opts.wcag);
        }

        // 3. Generate DESIGN.md via the configured provider (or raw fallback)
        let content: string;

        if (hasAI()) {
          if (!opts.json) console.log("  · Synthesizing with configured AI provider...");
          content = await synthesizeWithAI(url, assets.title, tokens);
        } else {
          if (!opts.json) console.log("  · No AI provider configured — generating from raw extraction...");
          content = generateFromRaw(url, assets.title, tokens);
        }

        // Append contrast section and attribution to DESIGN.md
        content += buildContrastSection(tokens.contrastPairs, !!opts.wcag);
        content += `\n---\n\n*Design system extracted with [Memoire](https://memoire.cv) · \`npx @memi-design/cli extract ${url}\`*\n`;

        // 4. Write DESIGN.md
        const outputPath = isAbsolute(opts.output)
          ? opts.output
          : join(engine.config.projectRoot, opts.output);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, content, "utf-8");

        // 5. Optionally write DesignSpec JSON
        let specPath: string | undefined;
        if (opts.spec) {
          // Fix #9 (MEDIUM): fully sanitize hostname — strip unicode, collapse hyphens
          const hostname = new URL(url).hostname
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 60);
          const specName = `design-${hostname || "unknown"}`;
          specPath = join(engine.config.projectRoot, "specs", "design", `${specName}.json`);
          const spec = buildDesignSpec(specName, url, tokens);
          await mkdir(dirname(specPath), { recursive: true });
          await writeFile(specPath, JSON.stringify(spec, null, 2), "utf-8");
        }

        // 6. Optional codegen: write Tailwind v4 @theme tokens.css
        let tokensCssPath: string | undefined;
        if (opts.codegen || opts.init) {
          const { generateTailwindV4Theme } = await import("../codegen/tailwind-v4.js");
          const designTokens = buildDesignTokensFromRaw(tokens);
          const css = generateTailwindV4Theme(designTokens);
          tokensCssPath = isAbsolute(opts.output)
            ? join(dirname(opts.output), "tokens.css")
            : join(engine.config.projectRoot, dirname(opts.output), "tokens.css");
          await writeFile(tokensCssPath, css, "utf-8");
        }

        // 7. Optional --init: build full registry package
        let registryDir: string | undefined;
        if (opts.init) {
          const { publishRegistry } = await import("../registry/publisher.js");
          const baseName = opts.init.replace(/^@[^/]+\//, "");
          registryDir = join(engine.config.projectRoot, baseName);
          const pkgVersion = getMemoirePackageVersion();
          await publishRegistry({
            name: opts.init,
            version: "0.1.0",
            description: `Design system extracted from ${url}`,
            homepage: url,
            outDir: registryDir,
            designSystem: {
              tokens: buildDesignTokensFromRaw(tokens),
              components: [],
              styles: [],
              lastSync: new Date().toISOString(),
            },
            specs: [],
            memoireVersion: pkgVersion,
            sourceDesignDocUrl: url,
          });
        }

        const elapsed = Date.now() - start;

        if (opts.json) {
          const payload: DesignDocPayload = {
            status: "completed",
            url,
            output: outputPath,
            ...(specPath ? { spec: specPath } : {}),
            cssVarCount: Object.keys(tokens.cssVars).length,
            colorCount: tokens.colors.length,
            contrastFailCount: tokens.contrastPairs.filter((p) => p.level === "fail").length,
            elapsedMs: elapsed,
          };
          console.log(JSON.stringify(payload, null, 2));
          return;
        }

        console.log(`\n  Written: ${outputPath}`);
        if (specPath) console.log(`  Spec:    ${specPath}`);
        console.log(`\n  ${formatElapsed(elapsed)}\n`);

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          const payload: DesignDocPayload = {
            status: "failed",
            url,
            output: opts.output,
            cssVarCount: 0,
            colorCount: 0,
            contrastFailCount: 0,
            elapsedMs: Date.now() - start,
            error: msg,
          };
          console.log(JSON.stringify(payload, null, 2));
          process.exitCode = 1;
          return;
        }
        console.log(ui.fail(`Error: ${msg}`));
        console.log();
        process.exitCode = 1;
      }
    });
}

// ── AI synthesis ──────────────────────────────────────────

async function synthesizeWithAI(
  url: string,
  title: string,
  tokens: RawDesignTokens,
): Promise<string> {
  const ai = getAI()!;

  // Build a compact summary of the raw tokens to stay within context limits
  const varSample = Object.entries(tokens.cssVars)
    .slice(0, 80)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const colorSample = tokens.colors.slice(0, 40).join(", ");
  const fontSample = tokens.fonts.slice(0, 10).join(" | ");
  const sizeSample = tokens.fontSizes.slice(0, 15).join(", ");
  const spacingSample = tokens.spacing.slice(0, 15).join(", ");
  const radiiSample = tokens.radii.slice(0, 10).join(", ");
  const shadowSample = tokens.shadows.slice(0, 5).join("\n");

  const system = `You are a design system analyst. You extract precise, actionable design systems from raw CSS data.
Your output is a DESIGN.md file that:
- Uses actual values from the data (not placeholders)
- Names tokens semantically (bg, fg, muted, accent, etc.)
- Is opinionated — flag bad patterns (purple gradients, excessive shadows, inconsistent radii)
- Is directly usable as an AI system prompt context for maintaining design consistency
- Covers the Tailwind config sketch with real values`;

  const userMessage = `Extract a complete DESIGN.md from this site's CSS data.

Source: ${url}
Title: ${title || url}

## CSS Custom Properties (sample of ${Object.keys(tokens.cssVars).length} total)
${varSample || "(none found)"}

## Colors (${tokens.colors.length} total)
${colorSample || "(none found)"}

## Font Families
${fontSample || "(none found)"}

## Font Sizes
${sizeSample || "(none found)"}

## Spacing Values
${spacingSample || "(none found)"}

## Border Radii
${radiiSample || "(none found)"}

## Box Shadows
${shadowSample || "(none found)"}

---

Output ONLY the DESIGN.md content, starting with:

# Design System — [site name]
> Extracted ${new Date().toISOString().split("T")[0]} · Source: ${url}

Include these sections:
## Color System
## Typography
## Spacing
## Borders & Surfaces
## Component Patterns
## Voice & Tone
## Do / Don't
## Tailwind Config Sketch

Be specific. Use actual values. No purple gradients.`;

  const response = await ai.complete({
    system,
    messages: [{ role: "user", content: userMessage }],
    model: "deep",
    maxTokens: 4096,
  });

  return response.content.trim();
}

// ── Raw fallback (no AI) ──────────────────────────────────

function generateFromRaw(url: string, title: string, tokens: RawDesignTokens): string {
  const date = new Date().toISOString().split("T")[0];
  const siteName = title || new URL(url).hostname;

  const cssVarSection = Object.keys(tokens.cssVars).length > 0
    ? Object.entries(tokens.cssVars)
        .slice(0, 60)
        .map(([k, v]) => `| \`${k}\` | \`${v}\` |`)
        .join("\n")
    : "| *(no CSS variables found)* | |";

  const colorSection = tokens.colors.length > 0
    ? tokens.colors.slice(0, 30).map((c) => `| \`${c}\` |`).join("\n")
    : "| *(no colors extracted)* |";

  const fontSection = tokens.fonts.length > 0
    ? tokens.fonts.slice(0, 8).map((f) => `- ${f}`).join("\n")
    : "*(no font families extracted)*";

  const spacingSection = tokens.spacing.length > 0
    ? tokens.spacing.slice(0, 12).map((s) => `\`${s}\``).join(" · ")
    : "*(no spacing values extracted)*";

  const radiiSection = tokens.radii.length > 0
    ? tokens.radii.slice(0, 8).map((r) => `\`${r}\``).join(" · ")
    : "*(no border radii extracted)*";

  return `# Design System — ${siteName}
> Extracted ${date} · Source: ${url}
> Note: Configure an AI provider for synthesized analysis

## CSS Custom Properties
| Variable | Value |
|----------|-------|
${cssVarSection}

## Colors
| Value |
|-------|
${colorSection}

## Typography
${fontSection}

**Font sizes:** ${tokens.fontSizes.slice(0, 12).join(", ") || "*(none extracted)*"}

## Spacing
${spacingSection}

## Borders & Surfaces
**Radii:** ${radiiSection}

${tokens.shadows.length > 0 ? `**Shadows:**\n${tokens.shadows.slice(0, 4).map((s) => `\`${s}\``).join("\n")}` : ""}

## Notes
- Run \`memi design-doc ${url}\` with an AI provider configured for full analysis
- See raw data above to manually build your Tailwind config
`;
}

// ── Contrast helpers ──────────────────────────────────────

/**
 * Print a contrast summary to the console.
 * When wcag=true, shows all pairs. Otherwise only failures.
 */
function printContrastSummary(pairs: ContrastPair[], wcag: boolean): void {
  if (pairs.length === 0) return;

  const counts = { AAA: 0, AA: 0, "AA-large": 0, fail: 0 };
  for (const p of pairs) counts[p.level]++;

  console.log(
    `  contrast  ${counts.AAA} AAA / ${counts.AA} AA / ${counts["AA-large"]} AA-large / ${counts.fail} FAIL`,
  );

  if (wcag) {
    // Full table
    for (const p of pairs) {
      console.log(`  [${p.level}]  ${p.fg} on ${p.bg} — ratio ${p.ratio.toFixed(2)}`);
    }
  } else {
    // Only failures
    for (const p of pairs.filter((p) => p.level === "fail")) {
      console.log(`  [FAIL]  ${p.fg} on ${p.bg} — ratio ${p.ratio.toFixed(2)} (needs 4.5 for AA)`);
    }
  }
}

/**
 * Build a "## Contrast" section for the DESIGN.md.
 * When wcag=true, emits a full markdown table of all pairs.
 * Otherwise emits a summary and failure list.
 */
function buildContrastSection(pairs: ContrastPair[], wcag: boolean): string {
  if (pairs.length === 0) return "";

  const counts = { AAA: 0, AA: 0, "AA-large": 0, fail: 0 };
  for (const p of pairs) counts[p.level]++;

  const summary = `${counts.AAA} AAA / ${counts.AA} AA / ${counts["AA-large"]} AA-large / ${counts.fail} FAIL`;

  if (wcag) {
    const rows = pairs
      .map((p) => `| \`${p.fg}\` | \`${p.bg}\` | ${p.ratio.toFixed(2)} | ${p.level} |`)
      .join("\n");
    return `
## Contrast

> ${summary}

| Foreground | Background | Ratio | Level |
|------------|------------|-------|-------|
${rows}
`;
  }

  // Summary + failures only
  const failLines = pairs
    .filter((p) => p.level === "fail")
    .map((p) => `- \`${p.fg}\` on \`${p.bg}\` — ratio ${p.ratio.toFixed(2)} (needs 4.5 for AA)`)
    .join("\n");

  return `
## Contrast

> ${summary}
${failLines ? `\n**Failures:**\n${failLines}` : ""}
`;
}

// ── DesignSpec builder ────────────────────────────────────

function buildDesignSpec(name: string, url: string, tokens: RawDesignTokens): object {
  const colorEntries = tokens.colors.slice(0, 20).map((val, i) => ({
    name: `color-${i + 1}`,
    value: val,
    usage: "extracted from CSS",
  }));

  // Pull typography from CSS vars where possible
  const typography = tokens.fonts.slice(0, 5).map((font, i) => ({
    element: i === 0 ? "body" : i === 1 ? "heading" : `text-${i}`,
    fontFamily: font,
  }));

  const radiiRecord: Record<string, number> = {};
  tokens.radii.slice(0, 6).forEach((r, i) => {
    const numeric = parseFloat(r);
    if (!isNaN(numeric)) {
      radiiRecord[`r${i + 1}`] = numeric;
    }
  });

  return {
    name,
    type: "design",
    purpose: `Design system extracted from ${url}`,
    colors: colorEntries,
    typography,
    borderRadius: radiiRecord,
    shadows: tokens.shadows.slice(0, 4).map((val, i) => ({
      element: `shadow-${i + 1}`,
      value: val,
    })),
    spacing: [],
    interactions: [],
    notes: [
      `Source: ${url}`,
      `Extracted: ${new Date().toISOString()}`,
      `CSS variables: ${Object.keys(tokens.cssVars).length}`,
    ],
    tags: ["auto-extracted", "design-doc"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Convert raw CSS tokens into DesignToken[] for codegen consumption. */
function buildDesignTokensFromRaw(raw: RawDesignTokens): import("../engine/registry.js").DesignToken[] {
  if (raw.designTokens?.length) {
    return raw.designTokens;
  }

  const tokens: import("../engine/registry.js").DesignToken[] = [];
  for (const color of raw.colors.slice(0, 30)) {
    const slug = color.replace(/[^a-z0-9]/gi, "").slice(0, 10) || "color";
    tokens.push({
      name: `color-${slug}`,
      collection: "colors",
      type: "color",
      values: { default: color },
      cssVariable: `--color-${slug}`,
    });
  }
  for (const [key, value] of Object.entries(raw.cssVars).slice(0, 50)) {
    const type: import("../engine/registry.js").DesignToken["type"] =
      /color|bg|text|fill|border/i.test(key) ? "color" :
      /radius/i.test(key) ? "radius" :
      /shadow/i.test(key) ? "shadow" :
      /space|gap|pad|margin/i.test(key) ? "spacing" :
      /font/i.test(key) ? "typography" : "other";
    tokens.push({
      name: key.replace(/^--/, ""),
      collection: "extracted",
      type,
      values: { default: value },
      cssVariable: key.startsWith("--") ? key : `--${key}`,
    });
  }
  return tokens;
}
