import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { installPluginToHome } from "../installer.js";
import { createExecutionPolicy } from "../../security/execution-policy.js";

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

    const policy = createExecutionPolicy({
      projectRoot,
      homeDir,
      profile: "connected",
      allow: ["home-write"],
    });
    const first = await installPluginToHome(projectRoot, homeDir, policy);
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

    await installPluginToHome(projectRoot, homeDir, policy);
    expect((await readFile(capabilityPath, "utf-8")).trim()).toBe(capability);
  });

  it("rejects a symlinked ~/.memoire root before copying plugin files outside home", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memoire-plugin-project-"));
    const homeDir = await mkdtemp(join(tmpdir(), "memoire-plugin-home-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "memoire-plugin-outside-"));
    cleanup.push(projectRoot, homeDir, outsideDir);

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
    await symlink(outsideDir, join(homeDir, ".memoire"), "dir");

    const policy = createExecutionPolicy({
      projectRoot,
      homeDir,
      profile: "connected",
      allow: ["home-write"],
    });

    await expect(installPluginToHome(projectRoot, homeDir, policy)).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "home-write",
      operation: "install the Figma plugin",
    });
    expect(await readdir(outsideDir)).toEqual([]);
  });
});
