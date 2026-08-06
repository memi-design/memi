import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashPackedPackageSurface } from "../package-artifact.js";

describe("hashPackedPackageSurface", () => {
  it("changes only when the declared packed package surface changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-package-artifact-"));
    await mkdir(path.join(root, "dist"), { recursive: true });
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      files: ["dist"],
    }));
    await writeFile(path.join(root, "dist", "index.js"), "export const value = 1;\n");
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n");

    const original = await hashPackedPackageSurface(root);
    await writeFile(path.join(root, "src", "index.ts"), "export const value = 2;\n");
    const sourceOnly = await hashPackedPackageSurface(root);
    await writeFile(path.join(root, "dist", "index.js"), "export const value = 2;\n");
    const packedChange = await hashPackedPackageSurface(root);

    expect(original).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(sourceOnly).toBe(original);
    expect(packedChange).not.toBe(original);
  });

  it("includes files npm adds to the real packed surface", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-package-artifact-packlist-"));
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "fixture-packlist",
      version: "1.0.0",
      files: ["dist"],
    }));
    await writeFile(path.join(root, "dist", "index.js"), "export {};\n");
    await writeFile(path.join(root, "README.md"), "# Index one\n");

    const original = await hashPackedPackageSurface(root);
    await writeFile(path.join(root, "README.md"), "# Index two\n");
    const changed = await hashPackedPackageSurface(root);

    expect(changed).not.toBe(original);
  });

  it("does not execute an ambient npm_execpath override", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-package-artifact-env-"));
    const sentinel = path.join(root, "ambient-npm-executed");
    const fakeNpm = path.join(root, "npm-cli.js");
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "fixture-ambient-npm",
      version: "1.0.0",
      files: ["dist"],
    }));
    await writeFile(path.join(root, "dist", "index.js"), "export {};\n");
    await writeFile(fakeNpm, [
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(sentinel)}, 'executed');`,
      "process.stdout.write('[]');",
    ].join("\n"));
    const previous = process.env.npm_execpath;
    process.env.npm_execpath = fakeNpm;
    try {
      await expect(hashPackedPackageSurface(root)).resolves.toMatch(/^sha256:[a-f0-9]{64}$/);
      await expect(access(sentinel)).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.npm_execpath;
      else process.env.npm_execpath = previous;
    }
  });
});
