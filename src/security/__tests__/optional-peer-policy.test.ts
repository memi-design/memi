import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicClient } from "../../ai/client.js";
import { parseExcel } from "../../research/excel-parser.js";
import { StudioBrowserAdapter } from "../../studio/browser-adapter.js";
import { configureExecutionPolicy, resetExecutionPolicyForTests } from "../execution-policy.js";

afterEach(() => {
  resetExecutionPolicyForTests();
});

describe("optional host integration policy", () => {
  it("denies an injected Anthropic peer before invoking its loader", async () => {
    configureExecutionPolicy({ projectRoot: "/workspace" });
    const loader = vi.fn(async () => {
      throw new Error("Anthropic loader must not run");
    });
    const client = new AnthropicClient("test-key", undefined, loader);

    await expect(client.complete({
      messages: [{ role: "user", content: "hello" }],
    })).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "host-integration-code",
    });
    expect(loader).not.toHaveBeenCalled();
  });

  it("denies an injected Playwright peer before invoking its loader", async () => {
    configureExecutionPolicy({ projectRoot: "/workspace" });
    const loader = vi.fn(async () => {
      throw new Error("Playwright loader must not run");
    });
    const browser = new StudioBrowserAdapter({
      projectRoot: "/workspace",
      playwrightLoader: loader,
    });

    await expect(browser.createSession()).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "host-integration-code",
    });
    expect(loader).not.toHaveBeenCalled();
  });

  it("reports an installed Playwright peer as unauthorized without importing it", async () => {
    configureExecutionPolicy({ projectRoot: "/workspace" });
    const loader = vi.fn(async () => ({
      chromium: { launch: vi.fn() },
    }));
    const browser = new StudioBrowserAdapter({
      projectRoot: "/workspace",
      playwrightLoader: loader,
    });

    await expect(browser.status()).resolves.toMatchObject({
      installed: true,
      message: expect.stringContaining("--allow host-integration-code"),
    });
    expect(loader).not.toHaveBeenCalled();
  });

  it("denies XLSX peers while keeping the built-in CSV path available", async () => {
    configureExecutionPolicy({ projectRoot: "/workspace" });

    const directory = await mkdtemp(join(tmpdir(), "memi-optional-peer-csv-"));
    const csvPath = join(directory, "survey.csv");
    await writeFile(csvPath, "Role,Count\nDesigner,2\n", "utf8");
    try {
      await expect(parseExcel(csvPath)).resolves.toEqual({
        sheetName: "CSV",
        headers: ["Role", "Count"],
        rows: [["Designer", "2"]],
        rowCount: 1,
        columnCount: 2,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    await expect(parseExcel("denied.xlsx")).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "host-integration-code",
    });
  });
});
