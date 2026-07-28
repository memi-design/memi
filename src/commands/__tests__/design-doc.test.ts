/**
 * design-doc command stress tests — 25 conditions covering output file writing,
 * spec generation, AI vs raw fallback, JSON mode, error cases, and edge URLs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Command } from "commander";
import { registerDesignDocCommand } from "../design-doc.js";
import { captureLogs } from "./test-helpers.js";

// ── Mock dependencies ────────────────────────────────────

vi.mock("../../research/css-extractor.js", () => ({
  fetchPageAssets: vi.fn(),
  parseCSSTokens: vi.fn(),
}));

vi.mock("../../ai/client.js", () => ({
  getAI: vi.fn(),
  hasAI: vi.fn(),
}));

import { fetchPageAssets, parseCSSTokens } from "../../research/css-extractor.js";
import { getAI, hasAI } from "../../ai/client.js";

const mockFetchAssets = vi.mocked(fetchPageAssets);
const mockParseTokens = vi.mocked(parseCSSTokens);
const mockHasAI = vi.mocked(hasAI);
const mockGetAI = vi.mocked(getAI);

// ── Helpers ──────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `design-doc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });

  mockFetchAssets.mockResolvedValue({
    url: "https://example.com",
    title: "Example Site",
    html: "<html></html>",
    cssBlocks: [".btn { color: #5b5bd6; border-radius: 6px; }"],
  });

  mockParseTokens.mockReturnValue({
    colors: ["#5b5bd6", "#fafaf9"],
    fonts: ["Inter, sans-serif"],
    fontSizes: ["16px", "14px"],
    spacing: ["8px", "16px"],
    radii: ["6px"],
    shadows: ["0 2px 4px rgba(0,0,0,0.1)"],
    cssVars: { "--bg": "#fafaf9", "--accent": "#5b5bd6" },
    contrastPairs: [
      { fg: "#5b5bd6", bg: "#ffffff", ratio: 4.56, level: "AA" },
      { fg: "#5b5bd6", bg: "#000000", ratio: 4.60, level: "AA" },
      { fg: "#fafaf9", bg: "#ffffff", ratio: 1.02, level: "fail" },
      { fg: "#fafaf9", bg: "#000000", ratio: 20.58, level: "AAA" },
    ],
  });

  mockHasAI.mockReturnValue(false);
  mockGetAI.mockReturnValue(null);
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await rm(testDir, { recursive: true, force: true });
});

function makeEngine(projectRoot = testDir) {
  return {
    async init() {},
    config: { projectRoot },
    registry: { designSystem: { tokens: [], components: [], styles: [], lastSync: "" } },
  };
}

// ── File output ───────────────────────────────────────────

describe("design-doc — file output", () => {
  it("writes DESIGN.md to default path (./DESIGN.md)", async () => {
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com"], { from: "user" });
    const exists = await readFile(join(testDir, "DESIGN.md"), "utf-8").then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("writes DESIGN.md to --output path", async () => {
    captureLogs();
    const out = join(testDir, "docs", "BRAND.md");
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com", "--output", out], { from: "user" });
    const exists = await readFile(out, "utf-8").then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("creates parent directories if they don't exist", async () => {
    captureLogs();
    const out = join(testDir, "nested", "deep", "DESIGN.md");
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com", "--output", out], { from: "user" });
    const exists = await readFile(out, "utf-8").then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("DESIGN.md contains the source URL", async () => {
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com"], { from: "user" });
    const content = await readFile(join(testDir, "DESIGN.md"), "utf-8");
    expect(content).toContain("example.com");
  });

  it("DESIGN.md contains today's date", async () => {
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com"], { from: "user" });
    const content = await readFile(join(testDir, "DESIGN.md"), "utf-8");
    const today = new Date().toISOString().split("T")[0];
    expect(content).toContain(today);
  });

  it("raw fallback includes CSS Variables section header", async () => {
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com"], { from: "user" });
    const content = await readFile(join(testDir, "DESIGN.md"), "utf-8");
    expect(content).toContain("CSS Custom Properties");
  });

  it("raw fallback includes Colors section", async () => {
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com"], { from: "user" });
    const content = await readFile(join(testDir, "DESIGN.md"), "utf-8");
    expect(content).toContain("Colors");
  });

  it("raw fallback includes Typography section", async () => {
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com"], { from: "user" });
    const content = await readFile(join(testDir, "DESIGN.md"), "utf-8");
    expect(content).toContain("Typography");
  });
});

// ── --spec flag ───────────────────────────────────────────

describe("design-doc --spec", () => {
  it("writes a DesignSpec JSON file", async () => {
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com", "--spec"], { from: "user" });
    const specDir = join(testDir, "specs", "design");
    const files = await readFile(join(specDir, "design-example-com.json"), "utf-8").then(() => true).catch(() => false);
    expect(files).toBe(true);
  });

  it("DesignSpec JSON has type 'design'", async () => {
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com", "--spec"], { from: "user" });
    const spec = JSON.parse(await readFile(join(testDir, "specs", "design", "design-example-com.json"), "utf-8"));
    expect(spec.type).toBe("design");
  });

  it("DesignSpec JSON includes colors from extraction", async () => {
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com", "--spec"], { from: "user" });
    const spec = JSON.parse(await readFile(join(testDir, "specs", "design", "design-example-com.json"), "utf-8"));
    expect(Array.isArray(spec.colors)).toBe(true);
  });

  it("DesignSpec hostname uses dots-to-dashes conversion", async () => {
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://my.site.com", "--spec"], { from: "user" });
    const specPath = join(testDir, "specs", "design", "design-my-site-com.json");
    const exists = await readFile(specPath, "utf-8").then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("DesignSpec includes source URL in notes", async () => {
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com", "--spec"], { from: "user" });
    const spec = JSON.parse(await readFile(join(testDir, "specs", "design", "design-example-com.json"), "utf-8"));
    expect(spec.notes.some((n: string) => n.includes("example.com"))).toBe(true);
  });
});

// ── --json mode ───────────────────────────────────────────

describe("design-doc --json", () => {
  it("emits valid JSON payload on success", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com", "--json"], { from: "user" });
    expect(() => JSON.parse(logs.at(-1)!)).not.toThrow();
  });

  it("JSON payload has status 'completed'", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com", "--json"], { from: "user" });
    expect(JSON.parse(logs.at(-1)!).status).toBe("completed");
  });

  it("JSON payload includes url field", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com", "--json"], { from: "user" });
    expect(JSON.parse(logs.at(-1)!).url).toBe("https://example.com");
  });

  it("JSON payload includes colorCount, cssVarCount, and contrastFailCount", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com", "--json"], { from: "user" });
    const payload = JSON.parse(logs.at(-1)!);
    expect(typeof payload.colorCount).toBe("number");
    expect(typeof payload.cssVarCount).toBe("number");
    expect(typeof payload.contrastFailCount).toBe("number");
  });

  it("JSON payload has elapsedMs", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com", "--json"], { from: "user" });
    const payload = JSON.parse(logs.at(-1)!);
    expect(typeof payload.elapsedMs).toBe("number");
    expect(payload.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("--json only emits one line", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com", "--json"], { from: "user" });
    expect(logs).toHaveLength(1);
  });
});

// ── Error handling ────────────────────────────────────────

describe("design-doc — error handling", () => {
  it("sets exitCode 1 when fetchPageAssets fails", async () => {
    mockFetchAssets.mockRejectedValue(new Error("Network error"));
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://bad.example.com"], { from: "user" });
    expect(process.exitCode).toBe(1);
  });

  it("--json emits failed payload on fetch error", async () => {
    mockFetchAssets.mockRejectedValue(new Error("Connection refused"));
    const logs = captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://bad.example.com", "--json"], { from: "user" });
    const payload = JSON.parse(logs.at(-1)!);
    expect(payload.status).toBe("failed");
    expect(payload.error).toBeDefined();
  });

  it("failed JSON payload includes the url", async () => {
    mockFetchAssets.mockRejectedValue(new Error("Timeout"));
    const logs = captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://timeout.example.com", "--json"], { from: "user" });
    const payload = JSON.parse(logs.at(-1)!);
    expect(payload.url).toBe("https://timeout.example.com");
  });

  it("empty html and cssBlocks → throws with helpful message", async () => {
    mockFetchAssets.mockResolvedValue({ url: "https://example.com", title: "", html: "", cssBlocks: [] });
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com"], { from: "user" });
    expect(process.exitCode).toBe(1);
  });
});

// ── AI vs raw fallback ────────────────────────────────────

describe("design-doc — AI vs raw fallback", () => {
  it("calls hasAI() to check for API key", async () => {
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com"], { from: "user" });
    expect(mockHasAI).toHaveBeenCalled();
  });

  it("does NOT call getAI() when hasAI returns false", async () => {
    mockHasAI.mockReturnValue(false);
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com"], { from: "user" });
    expect(mockGetAI).not.toHaveBeenCalled();
  });

  it("calls getAI().complete() when hasAI returns true", async () => {
    const mockComplete = vi.fn().mockResolvedValue({ content: "# Design System\n## Color System\n## Typography" });
    mockHasAI.mockReturnValue(true);
    mockGetAI.mockReturnValue({ complete: mockComplete } as never);
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com"], { from: "user" });
    expect(mockComplete).toHaveBeenCalledOnce();
  });

  it("AI prompt includes the source URL", async () => {
    const mockComplete = vi.fn().mockResolvedValue({ content: "# Design System\n" });
    mockHasAI.mockReturnValue(true);
    mockGetAI.mockReturnValue({ complete: mockComplete } as never);
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://brand.example.com"], { from: "user" });
    const callArgs = mockComplete.mock.calls[0][0];
    const prompt = JSON.stringify(callArgs);
    expect(prompt).toContain("brand.example.com");
  });

  it("AI prompt uses 'deep' model tier", async () => {
    const mockComplete = vi.fn().mockResolvedValue({ content: "# Design System\n" });
    mockHasAI.mockReturnValue(true);
    mockGetAI.mockReturnValue({ complete: mockComplete } as never);
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com"], { from: "user" });
    const opts = mockComplete.mock.calls[0][0];
    expect(opts.model).toBe("deep");
  });

  it("raw fallback output includes provider configuration hint", async () => {
    mockHasAI.mockReturnValue(false);
    captureLogs();
    const program = new Command();
    registerDesignDocCommand(program, makeEngine() as never);
    await program.parseAsync(["design-doc", "https://example.com"], { from: "user" });
    const content = await readFile(join(testDir, "DESIGN.md"), "utf-8");
    expect(content).toContain("Configure an AI provider");
  });
});
