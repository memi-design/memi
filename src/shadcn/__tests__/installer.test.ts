import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { MemoireEngine } from "../../engine/core.js";
import type { AnySpec } from "../../specs/types.js";
import {
  assertShadcnInstallTargetContained,
  installShadcnRegistryItem,
  resolveShadcnRegistryItem,
} from "../installer.js";

describe("shadcn registry installer", () => {
  it("accepts Windows alias targets within the project and rejects escapes", () => {
    const root = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\memoire-shadcn-install";

    expect(() => assertShadcnInstallTargetContained(
      root,
      `${root}\\components\\ui\\button.tsx`,
      "@/components/ui/button.tsx",
    )).not.toThrow();
    expect(() => assertShadcnInstallTargetContained(
      root,
      "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\outside\\button.tsx",
      "@/components/ui/button.tsx",
    )).toThrow(/outside project root/i);
    expect(() => assertShadcnInstallTargetContained(
      root,
      "D:\\outside\\button.tsx",
      "@/components/ui/button.tsx",
    )).toThrow(/outside project root/i);
  });

  it.each([
    "http://[::ffff:127.0.0.1]/registry.json",
    "http://[::ffff:169.254.169.254]/registry.json",
    "http://[::ffff:10.0.0.1]/registry.json",
  ])("rejects IPv4-mapped IPv6 private registry URLs: %s", async (url) => {
    await expect(resolveShadcnRegistryItem(url, "Button", process.cwd())).rejects.toThrow(/unsafe/i);
  });

  it("installs item content to file targets and records a spec", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memoire-shadcn-install-"));
    try {
      await writeFile(join(projectRoot, "components.json"), JSON.stringify({
        aliases: { components: "@/components" },
      }));
      await writeShadcnFixture(projectRoot);

      const savedSpecs: AnySpec[] = [];
      const engine = {
        config: { projectRoot },
        registry: {
          saveSpec: async (spec: AnySpec) => {
            savedSpecs.push(spec);
            await mkdir(join(projectRoot, ".memoire", "specs", "components"), { recursive: true });
            await writeFile(join(projectRoot, ".memoire", "specs", "components", `${spec.name}.json`), JSON.stringify(spec));
          },
        },
      } as unknown as MemoireEngine;

      const result = await installShadcnRegistryItem(engine, {
        from: join(projectRoot, "public", "r"),
        name: "Button",
      });

      expect(result.codePath).toBe(join(projectRoot, "components", "ui", "button.tsx"));
      expect(await readFile(result.codePath!, "utf8")).toContain("export function Button");
      expect(savedSpecs[0]?.name).toBe("Button");
      expect(result.specPath).toContain(".memoire/specs/components/Button.json");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("reports missing shadcn items with the requested name", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memoire-shadcn-missing-"));
    try {
      await writeShadcnFixture(projectRoot);
      await expect(resolveShadcnRegistryItem(join(projectRoot, "public", "r"), "Missing", projectRoot)).rejects.toThrow(/Missing|missing/i);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("refuses to read item files outside the local registry root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memoire-shadcn-traversal-"));
    try {
      const registryRoot = join(projectRoot, "public", "r");
      await mkdir(registryRoot, { recursive: true });
      await writeFile(join(projectRoot, "secret.ts"), "export const secret = true;");
      await writeFile(join(registryRoot, "button.json"), JSON.stringify({
        "$schema": "https://ui.shadcn.com/schema/registry-item.json",
        name: "button",
        type: "registry:ui",
        title: "Button",
        files: [{
          path: "../../secret.ts",
          type: "registry:component",
          target: "@/components/ui/button.tsx",
        }],
      }));

      const engine = {
        config: { projectRoot },
        registry: { saveSpec: async () => undefined },
      } as unknown as MemoireEngine;

      await expect(installShadcnRegistryItem(engine, {
        from: join(registryRoot, "button.json"),
        name: "Button",
      })).rejects.toThrow(/escapes the shadcn registry root/i);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

async function writeShadcnFixture(projectRoot: string): Promise<void> {
  const outDir = join(projectRoot, "public", "r");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "registry.json"), JSON.stringify({
    "$schema": "https://ui.shadcn.com/schema/registry.json",
    name: "test",
    items: [{
      name: "button",
      type: "registry:ui",
      title: "Button",
      description: "Button item",
      files: [{ path: "registry/button/button.tsx", type: "registry:component", target: "@/components/ui/button.tsx" }],
      meta: { memoire: { itemRoute: "/r/button.json" } },
    }],
  }));
  await writeFile(join(outDir, "button.json"), JSON.stringify({
    "$schema": "https://ui.shadcn.com/schema/registry-item.json",
    name: "button",
    type: "registry:ui",
    title: "Button",
    description: "Button item",
    files: [{
      path: "registry/button/button.tsx",
      type: "registry:component",
      target: "@/components/ui/button.tsx",
      content: "export function Button() { return <button /> }",
    }],
    categories: ["atom"],
  }));
}
