/**
 * Resolver tests — local registry resolution + SSRF guard.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { resolveRegistry, readRegistryFile, findComponentRef } from "../resolver.js";

vi.mock("../../security/safe-fetch.js", () => ({
  fetchPublicText: vi.fn(async (url: string, options: { headers?: Record<string, string> }) => {
    const response = await fetch(url, { headers: options.headers });
    return {
      url,
      status: response.status,
      ok: response.ok,
      headers: {},
      text: await response.text(),
    };
  }),
}));

const validRegistry = {
  name: "@test/ds",
  version: "1.0.0",
  tokens: { href: "./tokens/tokens.json", format: "w3c-dtcg" },
  components: [{ name: "Button", href: "./components/Button.json", level: "atom", framework: "agnostic" }],
  meta: { extractedAt: "2026-04-13T00:00:00.000Z", memoireVersion: "0.11.0" },
};

describe("Registry resolver", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("resolves a local registry directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memoire-resolver-"));
    try {
      await writeFile(join(dir, "registry.json"), JSON.stringify(validRegistry));
      const resolved = await resolveRegistry(dir);
      expect(resolved.registry.name).toBe("@test/ds");
      expect(resolved.baseUrl).toBe(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws if registry.json is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memoire-resolver-"));
    try {
      await expect(resolveRegistry(dir)).rejects.toThrow(/registry/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks localhost URLs (SSRF guard)", async () => {
    await expect(resolveRegistry("http://localhost/registry.json")).rejects.toThrow(/private\/loopback/);
  });

  it("blocks 127.0.0.1 URLs", async () => {
    await expect(resolveRegistry("http://127.0.0.1/registry.json")).rejects.toThrow(/private\/loopback/);
  });

  it("blocks private IPv4 ranges", async () => {
    await expect(resolveRegistry("http://192.168.1.1/r.json")).rejects.toThrow(/private\/loopback/);
    await expect(resolveRegistry("http://10.0.0.1/r.json")).rejects.toThrow(/private\/loopback/);
  });

  it.each([
    "http://[::ffff:127.0.0.1]/registry.json",
    "http://[::ffff:169.254.169.254]/registry.json",
    "http://[::ffff:10.0.0.1]/registry.json",
  ])("blocks IPv4-mapped IPv6 private URLs: %s", async (url) => {
    await expect(resolveRegistry(url)).rejects.toThrow(/private\/loopback/);
  });

  it("rejects non-http(s) protocols", async () => {
    await expect(resolveRegistry("ftp://example.com/r.json")).rejects.toThrow(/http\(s\)|npm/);
  });

  it("findComponentRef returns the component by name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memoire-resolver-"));
    try {
      await writeFile(join(dir, "registry.json"), JSON.stringify(validRegistry));
      const resolved = await resolveRegistry(dir);
      const ref = findComponentRef(resolved.registry, "Button");
      expect(ref.href).toBe("./components/Button.json");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("findComponentRef throws for missing component with available list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memoire-resolver-"));
    try {
      await writeFile(join(dir, "registry.json"), JSON.stringify(validRegistry));
      const resolved = await resolveRegistry(dir);
      expect(() => findComponentRef(resolved.registry, "Missing")).toThrow(/Available.*Button/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves relative paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memoire-resolver-"));
    const subDir = join(dir, "sub");
    try {
      await mkdir(subDir);
      await writeFile(join(subDir, "registry.json"), JSON.stringify(validRegistry));
      const resolved = await resolveRegistry("./sub", dir);
      expect(resolved.registry.name).toBe("@test/ds");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("contains local referenced files within the resolved registry directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memoire-resolver-"));
    try {
      await writeFile(join(dir, "registry.json"), JSON.stringify(validRegistry));
      await writeFile(join(dir, "tokens.json"), "{}");
      const resolved = await resolveRegistry(dir);

      await expect(readRegistryFile(resolved, "../tokens.json")).rejects.toThrow(/escapes the registry root/i);
      await expect(readRegistryFile(resolved, "/etc/passwd")).rejects.toThrow(/escapes the registry root/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("rejects local registry symlinks that escape the registry root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memoire-resolver-"));
    const outside = await mkdtemp(join(tmpdir(), "memoire-resolver-secret-"));
    try {
      await writeFile(join(dir, "registry.json"), JSON.stringify(validRegistry));
      await writeFile(join(outside, "secret.json"), "{\"secret\":true}");
      await symlink(join(outside, "secret.json"), join(dir, "linked.json"));
      const resolved = await resolveRegistry(dir);

      await expect(readRegistryFile(resolved, "./linked.json")).rejects.toThrow(/escapes the registry root/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("resolves featured marketplace aliases to catalog package names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memoire-resolver-"));
    const pkgDir = join(dir, "node_modules", "@memoire-examples", "ai-chat");
    try {
      await mkdir(pkgDir, { recursive: true });
      await writeFile(join(pkgDir, "registry.json"), JSON.stringify({
        ...validRegistry,
        name: "@memoire-examples/ai-chat",
      }));
      const resolved = await resolveRegistry("ai-chat", dir);
      expect(resolved.registry.name).toBe("@memoire-examples/ai-chat");
      expect(resolved.source).toBe("npm:@memoire-examples/ai-chat@1.0.0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a missing npm registry package without requiring node_modules", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memoire-resolver-"));
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
      await expect(resolveRegistry("@missing/ds", dir)).rejects.toThrow(/could not be resolved locally or from npm/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not satisfy an exact npm pin from a mismatched local registry version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "memoire-resolver-pin-"));
    const packageDir = join(dir, "node_modules", "@test", "ds");
    try {
      await mkdir(packageDir, { recursive: true });
      await writeFile(join(packageDir, "registry.json"), JSON.stringify({
        ...validRegistry,
        version: "2.0.0",
      }));
      vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));

      await expect(resolveRegistry("@test/ds@1.0.0", dir)).rejects.toThrow(/could not be resolved|version/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
