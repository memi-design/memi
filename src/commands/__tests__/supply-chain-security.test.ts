import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHADCN_SERVER_HOST } from "../shadcn.js";

describe("public package supply-chain defaults", () => {
  it("binds the shadcn registry server to loopback", () => {
    expect(SHADCN_SERVER_HOST).toBe("127.0.0.1");
  });

  it("does not ship npm install lifecycle scripts", async () => {
    const root = process.cwd();
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));

    expect(pkg.scripts.preinstall).toBeUndefined();
    expect(pkg.scripts.install).toBeUndefined();
    expect(pkg.scripts.postinstall).toBeUndefined();
    expect(pkg.scripts.prepare).toBeUndefined();
    expect(pkg.files).not.toContain("scripts/postinstall.mjs");
    expect(pkg.files).not.toContain("scripts/prepare.mjs");
  });

  it("pins patched production dependency ranges in the lockfile", async () => {
    const root = process.cwd();
    const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf-8"));

    expect(lock.packages["node_modules/@chenglou/pretext"]?.version).toBe("0.0.6");
    expect(lock.packages["node_modules/path-to-regexp"]?.version).toMatch(/^8\.[4-9]\./);
    expect(lock.packages["node_modules/hono"]?.version).toBe("4.13.0");
  });

  it("keeps raw Figma JavaScript execution out of public source paths", async () => {
    const root = process.cwd();
    const pluginMain = await readFile(join(root, "src", "plugin", "main", "index.ts"), "utf-8");
    const mcpTools = await readFile(join(root, "src", "mcp", "tools.ts"), "utf-8");
    const studioToolBroker = await readFile(join(root, "src", "studio", "tool-broker.ts"), "utf-8");

    expect(pluginMain).not.toContain("new Function");
    expect(pluginMain).not.toContain("eval(");
    expect(mcpTools).not.toContain("figma_execute");
    expect(studioToolBroker).not.toContain("figma_execute");
  });

  it("pins and verifies the MCP Registry publisher before execution", async () => {
    const workflow = await readFile(join(process.cwd(), ".github", "workflows", "publish-mcp-registry.yml"), "utf-8");

    expect(workflow).toContain("MCP_PUBLISHER_VERSION: v1.8.0");
    expect(workflow).toContain("1370446bbe74d562608e8005a6ccce02d146a661fbd78674e11cc70b9618d6cf");
    expect(workflow).not.toContain("/releases/latest/download/");
    expect(workflow).toContain("sha256sum --check");
  });

  it("pins patched production dependency resolutions", async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf-8"));
    const lock = JSON.parse(await readFile(join(process.cwd(), "package-lock.json"), "utf-8"));

    expect(pkg.dependencies.tar).toBe("7.5.22");
    expect(pkg.dependencies["@modelcontextprotocol/sdk"]).toBe("^1.30.0");
    expect(lock.packages["node_modules/tar"]?.version).toBe("7.5.22");
    expect(lock.packages["node_modules/fast-uri"]?.version).toBe("3.1.5");
    expect(lock.packages["node_modules/hono"]?.version).toBe("4.13.0");
    expect(lock.packages["node_modules/ip-address"]?.version).toBe("10.4.0");
    expect(lock.packages["node_modules/body-parser"]?.version).toBe("2.3.0");
    expect(lock.packages["node_modules/@hono/node-server"]?.version).toBe("2.1.0");
  });

  it("validates standalone installer archive entries before extraction", async () => {
    const installer = await readFile(join(process.cwd(), "scripts", "install.sh"), "utf-8");

    expect(installer).toContain("tar -tzf");
    expect(installer).toContain("unsafe archive entry");
    expect(installer).toContain("unexpected archive root");
    expect(installer.indexOf("tar -tzf")).toBeLessThan(installer.indexOf("tar -xzf"));
  });

  it("fails closed when checksum tooling is unavailable", async () => {
    const installer = await readFile(join(process.cwd(), "scripts", "install.sh"), "utf-8");

    expect(installer).toContain("error: need shasum or sha256sum to verify the release");
    expect(installer).toContain("Re-run with --no-verify only if you trust the release source.");
  });

  it("verifies the Docker release archive before extraction", async () => {
    const dockerfile = await readFile(
      join(process.cwd(), "docker", "Dockerfile.binary"),
      "utf-8",
    );

    expect(dockerfile).toContain("SHA256SUMS.txt");
    expect(dockerfile).toContain("sha256sum --check");
    expect(dockerfile.indexOf("sha256sum --check")).toBeLessThan(
      dockerfile.indexOf("tar -xzf"),
    );
  });
});
