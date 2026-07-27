import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("figma widget studio companion", () => {
  it("surfaces Studio bridge context and active sync actions", async () => {
    const ui = await readFile(join(process.cwd(), "src", "plugin", "ui", "main.ts"), "utf-8");
    const styles = await readFile(join(process.cwd(), "src", "plugin", "ui", "styles.css"), "utf-8");

    expect(ui).toContain("Studio companion");
    expect(ui).toContain("studio-runtime");
    expect(ui).toContain("data-action=\"studio-full-sync\"");
    expect(ui).toContain("data-action=\"studio-pull-stickies\"");
    expect(ui).toContain("data-action=\"studio-open\"");
    expect(ui).toContain("lastSyncAt");
    expect(ui).toContain("agentStatuses");

    expect(styles).toContain(".studio-companion");
    expect(styles).toContain(".studio-companion-grid");
  });

  it("uses the macOS Studio defaults instead of the stale local preview port", async () => {
    const ui = await readFile(join(process.cwd(), "src", "plugin", "ui", "main.ts"), "utf-8");

    expect(ui).not.toContain("127.0.0.1:1422");
    expect(ui).toContain("127.0.0.1:1420");
    expect(ui).toContain("127.0.0.1:8765");
  });

  it("does not block initial plugin bootstrap on full document loading", async () => {
    const main = await readFile(join(process.cwd(), "src", "plugin", "main", "index.ts"), "utf-8");
    const bootstrapStart = main.indexOf("async function bootstrap");
    const firstPost = main.indexOf("post({", bootstrapStart);
    const firstLoadAllPages = main.indexOf("loadAllPagesAsync", bootstrapStart);

    expect(bootstrapStart).toBeGreaterThan(-1);
    expect(firstPost).toBeGreaterThan(bootstrapStart);
    expect(firstLoadAllPages === -1 || firstPost < firstLoadAllPages).toBe(true);
  });

  it("sends bridge hello through the v2 serializer", async () => {
    const ui = await readFile(join(process.cwd(), "src", "plugin", "ui", "main.ts"), "utf-8");

    expect(ui).not.toContain("forwardToBridge({\n    type: \"bridge-hello\"");
    expect(ui).toMatch(/serializeBridgeEnvelope\(\s*createBridgeHelloMessage/);
  });
});
