import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPluginBundle } from "../../../scripts/build-plugin.mjs";
import { createRequire } from "node:module";
const { version } = createRequire(import.meta.url)("../../../package.json") as { version: string };

describe("plugin build pipeline", () => {
  it("emits plugin code.js and ui.html", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "memoire-plugin-test-"));
    const pluginDir = join(tempDir, "plugin");

    try {
      const result = await buildPluginBundle({ rootDir: process.cwd(), outDir: pluginDir });

      const code = await readFile(result.codePath, "utf8");
      const html = await readFile(result.htmlPath, "utf8");
      const meta = await readFile(result.metaPath, "utf8");
      const parsedMeta = JSON.parse(meta) as {
        builtAt: string;
        bundleHash: string;
        manifest: { path: string };
        code: { path: string };
        ui: { path: string };
      };

      expect(code).toContain("figma.showUI");
      expect(code).toContain("height: 600");
      expect(html).toContain("tab-panel");
      expect(html).toContain("<script>");
      expect(html).toContain("Jobs");
      expect(html).toContain("Selection");
      expect(html).toContain("System");
      expect(html).toContain('document.addEventListener("DOMContentLoaded", bootstrapOnReady);');
      expect(html).toContain('document.removeEventListener("DOMContentLoaded", bootstrapOnReady);');
      expect(html).not.toContain("min-height: 100vh");
      expect(html).toContain("min-height: 120px");
      expect(html).not.toContain("fonts.googleapis.com");
      expect(html).not.toContain("fonts.gstatic.com");
      expect(html).not.toContain("JetBrains Mono");
      expect(html).not.toContain("Cormorant Garamond");
      expect(html).toContain("ui-sans-serif");
      expect(html).toContain("ui-monospace");
      expect(html).not.toContain('src="/assets/');
      expect(html).not.toContain('href="/assets/');
      expect(html.match(/__MEMOIRE_BRIDGE_CAPABILITY_V1__/g)).toHaveLength(1);
      // Nullish-coalescing and optional-chaining checks use the syntax-
      // aware scan from hasRawToken so acorn's internal token tables
      // (which carry "??" and "?." as *string literals* describing the
      // language) don't trigger false positives.
      expect(hasRawToken(code, "??")).toBe(false);
      expect(hasRawToken(code, "?.")).toBe(false);
      expect(hasRawToken(html, "??")).toBe(false);
      expect(hasRawToken(html, "?.")).toBe(false);
      expect(code).not.toContain(".includes(");
      expect(code).not.toContain(".find(");
      expect(code).not.toContain(".findIndex(");
      expect(code).not.toContain(".padStart(");
      expect(code).not.toContain("Object.fromEntries(");
      expect(html).not.toContain(".includes(");
      expect(html).not.toContain(".find(");
      expect(html).not.toContain(".findIndex(");
      expect(html).not.toContain(".padStart(");
      expect(hasRawObjectSpread(code)).toBe(false);
      expect(hasRawObjectSpread(html)).toBe(false);
      expect(meta).toContain('"widgetVersion": "2"');
      expect(meta).toContain(`"packageVersion": "${version}"`);
      expect(parsedMeta.manifest.path).toBe("manifest.json");
      expect(parsedMeta.code.path).toBe("code.js");
      expect(parsedMeta.ui.path).toBe("ui.html");
      expect(meta).not.toContain(process.cwd());
      expect(meta).not.toContain(tempDir);

      const rebuilt = await buildPluginBundle({ rootDir: process.cwd(), outDir: pluginDir });
      const rebuiltMeta = JSON.parse(await readFile(rebuilt.metaPath, "utf8")) as {
        builtAt: string;
        bundleHash: string;
      };
      expect(rebuiltMeta.bundleHash).toBe(parsedMeta.bundleHash);
      expect(rebuiltMeta.builtAt).toBe(parsedMeta.builtAt);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 60_000);
});

// Syntax-aware scan for a literal token sequence. Mirrors
// hasRawObjectSpread: skips over string literals (single/double/backtick)
// and comments so occurrences of the token inside *strings* (e.g. acorn's
// token table containing "??") don't register as ES2020 syntax. Returns
// true iff the token appears outside any string or comment context.
function hasRawToken(source: string, token: string): boolean {
  let quote: "'" | "\"" | "`" | null = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { inLineComment = true; i += 1; continue; }
    if (ch === "/" && next === "*") { inBlockComment = true; i += 1; continue; }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
    if (source.slice(i, i + token.length) === token) return true;
  }
  return false;
}

function hasRawObjectSpread(source: string): boolean {
  const stack: string[] = [];
  let quote: "'" | "\"" | "`" | null = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{" || char === "[" || char === "(") {
      stack.push(char);
      continue;
    }

    if (char === "}" || char === "]" || char === ")") {
      stack.pop();
      continue;
    }

    if (char === "." && source.slice(index, index + 3) === "...") {
      if (stack[stack.length - 1] === "{") {
        return true;
      }
    }
  }

  return false;
}
