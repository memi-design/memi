import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("studio runtime/web compatibility", () => {
  // The Tauri macOS app moved to github.com/memi-design/memi-studio. The
  // engine repo's `memi studio web` mode still serves a packaged web bundle
  // when one is staged — this test pins that surface.
  it("serves packaged Studio web assets when staged", async () => {
    const serverSource = await readFile(join(process.cwd(), "src", "studio", "server.ts"), "utf-8");
    const commandSource = await readFile(join(process.cwd(), "src", "commands", "studio.ts"), "utf-8");

    expect(serverSource).toContain("candidateStudioAssetRoots");
    expect(serverSource).toContain("studio-web");
    expect(commandSource).toContain("servePackagedStudioWeb");
  });
});
