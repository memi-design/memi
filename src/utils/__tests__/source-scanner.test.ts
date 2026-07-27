import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanSources } from "../source-scanner.js";

vi.mock("../../security/safe-fetch.js", () => ({
  fetchPublicText: vi.fn(async (url: string, options: { headers?: Record<string, string> }) => {
    const response = await fetch(url, { headers: options.headers });
    return {
      url,
      status: response.status ?? (response.ok ? 200 : 500),
      ok: response.ok,
      headers: {},
      text: await response.text(),
    };
  }),
}));

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memoire-source-scan-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("scanSources", () => {
  it("walks local files deterministically with ignore dirs and max budget", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "src", "nested"), { recursive: true });
    await mkdir(join(root, "src", "node_modules"), { recursive: true });
    await writeFile(join(root, "src", "z.tsx"), "export const z = 1;");
    await writeFile(join(root, "src", "a.css"), ":root { --color: red; }");
    await writeFile(join(root, "src", "nested", "b.jsx"), "export const b = 1;");
    await writeFile(join(root, "src", "node_modules", "ignored.tsx"), "nope");

    const files = await scanSources({
      projectRoot: root,
      target: "src",
      extensions: [".tsx", ".jsx", ".css"],
      maxFiles: 2,
      concurrency: 2,
    });

    expect(files.map((file) => file.path)).toEqual(["a.css", "nested/b.jsx"]);
    expect(files.map((file) => file.projectPath)).toEqual(["src/a.css", "src/nested/b.jsx"]);
  });

  it("applies path exclusions before consuming the max-files budget", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "src", "__tests__"), { recursive: true });
    await mkdir(join(root, "src", "app"), { recursive: true });
    await writeFile(join(root, "src", "__tests__", "a.test.tsx"), "export const fixture = '<div />';");
    await writeFile(join(root, "src", "app", "page.tsx"), "export default function Page(){ return <main />; }");

    const files = await scanSources({
      projectRoot: root,
      target: "src",
      extensions: [".tsx"],
      maxFiles: 1,
      excludePath: (projectPath) => projectPath.includes("__tests__"),
    });

    expect(files.map((file) => file.projectPath)).toEqual(["src/app/page.tsx"]);
  });

  it("fetches url html and inline styles with a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => "<html><style>:root { --radius: 8px; }</style></html>",
    })));

    const files = await scanSources({
      projectRoot: await makeRoot(),
      target: "https://example.com",
      extensions: [".html", ".css"],
      fetchTimeoutMs: 50,
    });

    expect(files.map((file) => file.id)).toEqual([
      "https://example.com",
      "https://example.com#inline-1",
    ]);
    expect(fetch).toHaveBeenCalledWith("https://example.com", expect.objectContaining({
      headers: expect.objectContaining({
        "User-Agent": "Memoire-SourceScanner/1.0",
      }),
    }));
  });

  it("skips local files above the configured byte budget", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "small.css"), ":root { --color: red; }");
    await writeFile(join(root, "src", "large.css"), `:root { --large: ${"x".repeat(128)}; }`);

    const files = await scanSources({
      projectRoot: root,
      target: "src",
      extensions: [".css"],
      maxBytesPerFile: 64,
    });

    expect(files.map((file) => file.path)).toEqual(["small.css"]);
    expect(files[0]?.sizeBytes).toBeGreaterThan(0);
  });

  it("rejects local targets outside the project root", async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await writeFile(join(outside, "secret.ts"), "export const secret = true;");

    await expect(scanSources({
      projectRoot: root,
      target: join(outside, "secret.ts"),
      extensions: [".ts"],
    })).rejects.toThrow(/outside the project root/i);
  });

  it.each([
    "http://localhost/app",
    "http://127.0.0.1/app",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/app",
    "http://[::ffff:127.0.0.1]/app",
    "http://[::ffff:169.254.169.254]/latest/meta-data",
    "http://[::ffff:10.0.0.1]/app",
  ])("rejects private and loopback URL targets: %s", async (target) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(scanSources({
      projectRoot: await makeRoot(),
      target,
      extensions: [".html"],
    })).rejects.toThrow(/public http\(s\) address/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
