// @ts-nocheck
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensurePackDryRunInputs } from "../../../scripts/pack-dry-run.mjs";

describe("pack dry-run preconditions", () => {
  const roots: string[] = [];

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function createRoot(name: string) {
    const { mkdtemp } = await import("node:fs/promises");
    const root = await mkdtemp(join(tmpdir(), `${name}-`));
    roots.push(root);
    await mkdir(join(root, "release"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "@memi-design/cli", version: "2.8.0-beta.1" }));
    await writeFile(join(root, "npm-shrinkwrap.json"), JSON.stringify({ name: "@memi-design/cli", version: "2.8.0-beta.1", packages: { "": { name: "@memi-design/cli", version: "2.8.0-beta.1" } } }));
    await writeFile(join(root, "release", "npm-shrinkwrap.production.json"), JSON.stringify({ name: "@memi-design/cli", version: "2.8.0-beta.1", packages: { "": { name: "@memi-design/cli", version: "2.8.0-beta.1" } } }));
    return root;
  }

  it("rebuilds missing dist artifacts before staging the package", async () => {
    const root = await createRoot("memi-pack-preflight");
    const calls: string[] = [];

    await ensurePackDryRunInputs(root, async (script) => {
      calls.push(script);
      if (script === "build") {
        await mkdir(join(root, "dist"), { recursive: true });
        await writeFile(join(root, "dist", "bin.js"), "#!/usr/bin/env node\n");
        await writeFile(join(root, "dist", "index.js"), "export {};\n");
        await writeFile(join(root, "dist", "index.d.ts"), "export {};\n");
      }
    });

    expect(calls).toEqual(["build"]);
  });

  it("rebuilds when the published launcher is missing", async () => {
    const root = await createRoot("memi-pack-launcher");
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "index.js"), "export {};\n");
    await writeFile(join(root, "dist", "index.d.ts"), "export {};\n");
    const calls: string[] = [];

    await ensurePackDryRunInputs(root, async (script) => {
      calls.push(script);
      if (script === "build") {
        await writeFile(join(root, "dist", "bin.js"), "#!/usr/bin/env node\n");
      }
    });

    expect(calls).toEqual(["build"]);
  });

  it("rebuilds the production shrinkwrap when the committed release copy is missing", async () => {
    const root = await createRoot("memi-pack-shrinkwrap");
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "bin.js"), "#!/usr/bin/env node\n");
    await writeFile(join(root, "dist", "index.js"), "export {};\n");
    await writeFile(join(root, "dist", "index.d.ts"), "export {};\n");
    const { rm } = await import("node:fs/promises");
    await rm(join(root, "release", "npm-shrinkwrap.production.json"));
    const calls: string[] = [];

    await ensurePackDryRunInputs(root, async (script) => {
      calls.push(script);
      if (script === "build:production-shrinkwrap") {
        await writeFile(join(root, "release", "npm-shrinkwrap.production.json"), JSON.stringify({ name: "@memi-design/cli", version: "2.8.0-beta.1", packages: { "": { name: "@memi-design/cli", version: "2.8.0-beta.1" } } }));
      }
    });

    expect(calls).toEqual(["build:production-shrinkwrap"]);
  });

  it("skips rebuilds when the pack inputs are already present", async () => {
    const root = await createRoot("memi-pack-present");
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "bin.js"), "#!/usr/bin/env node\n");
    await writeFile(join(root, "dist", "index.js"), "export {};\n");
    await writeFile(join(root, "dist", "index.d.ts"), "export {};\n");
    const calls: string[] = [];

    await ensurePackDryRunInputs(root, async (script) => {
      calls.push(script);
    });

    expect(calls).toEqual([]);
  });
});
