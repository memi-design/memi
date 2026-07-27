import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { installPluginToHome } from "../installer.js";

const CAPABILITY_PLACEHOLDER = "__MEMOIRE_BRIDGE_CAPABILITY_V1__";

describe("Figma plugin bridge capability install", () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("injects a stable out-of-band secret only into the installed plugin copy", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memoire-plugin-project-"));
    const homeDir = await mkdtemp(join(tmpdir(), "memoire-plugin-home-"));
    cleanup.push(projectRoot, homeDir);

    const pluginRoot = join(projectRoot, "plugin");
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(join(pluginRoot, "manifest.json"), "{}\n", "utf-8");
    await writeFile(join(pluginRoot, "code.js"), "/* fixture */\n", "utf-8");
    await writeFile(
      join(pluginRoot, "ui.html"),
      `<script>const capability = "${CAPABILITY_PLACEHOLDER}";</script>\n`,
      "utf-8",
    );
    await writeFile(join(pluginRoot, "widget-meta.json"), "{}\n", "utf-8");

    const first = await installPluginToHome(projectRoot, homeDir);
    const capabilityPath = join(homeDir, ".memoire", "bridge-capability");
    const capability = (await readFile(capabilityPath, "utf-8")).trim();
    const installedUi = await readFile(join(first.destination, "ui.html"), "utf-8");
    const sourceUi = await readFile(join(pluginRoot, "ui.html"), "utf-8");

    expect(capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(installedUi).toContain(capability);
    expect(installedUi).not.toContain(CAPABILITY_PLACEHOLDER);
    expect(sourceUi).toContain(CAPABILITY_PLACEHOLDER);
    if (process.platform !== "win32") {
      expect((await stat(capabilityPath)).mode & 0o777).toBe(0o600);
    }

    await installPluginToHome(projectRoot, homeDir);
    expect((await readFile(capabilityPath, "utf-8")).trim()).toBe(capability);
  });
});
