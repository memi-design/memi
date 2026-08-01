import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { StudioBrowserAdapter } from "../browser-adapter.js";
import { defaultStudioConfig } from "../config.js";
import { StudioToolBroker } from "../tool-broker.js";

describe("studio tool broker", () => {
  it("registers autonomous lab tools with bounded execution metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-tools-"));
    try {
      const broker = new StudioToolBroker({
        projectRoot: root,
        getConfig: async () => defaultStudioConfig(root),
        browser: new StudioBrowserAdapter({ projectRoot: root }),
      });

      expect(broker.listTools().map((tool) => tool.id)).toEqual(expect.arrayContaining([
        "workspace.read",
        "workspace.search",
        "workspace.write",
        "shell.run",
        "git.status",
        "git.diff",
        "git.checkpoint",
        "browser.open",
        "browser.snapshot",
        "browser.screenshot",
        "figma.action",
        "mcp.list",
        "knowledge.search",
        "knowledge.capture",
        "ux.audit_screenshot",
      ]));
      expect(broker.listTools().find((tool) => tool.id === "workspace.write")).toMatchObject({
        category: "workspace",
        requiresApproval: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads workspace files but rejects paths outside configured roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-tools-"));
    try {
      await writeFile(join(root, "DESIGN.md"), "# Design\n");
      const broker = new StudioToolBroker({
        projectRoot: root,
        getConfig: async () => defaultStudioConfig(root),
        browser: new StudioBrowserAdapter({ projectRoot: root }),
      });

      await expect(broker.call({
        toolId: "workspace.read",
        input: { path: join(root, "DESIGN.md") },
      })).resolves.toMatchObject({
        status: "completed",
        toolId: "workspace.read",
        data: { type: "file", content: "# Design\n" },
      });

      await expect(broker.call({
        toolId: "workspace.read",
        input: { path: join(root, "..", "outside-workspace.txt") },
      })).resolves.toMatchObject({
        status: "failed",
        error: expect.stringMatching(/workspace/i),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires approval for workspace writes and can write after approval", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-tools-"));
    try {
      const broker = new StudioToolBroker({
        projectRoot: root,
        getConfig: async () => defaultStudioConfig(root),
        browser: new StudioBrowserAdapter({ projectRoot: root }),
      });
      const target = join(root, "research", "decision.md");

      await expect(broker.call({
        toolId: "workspace.write",
        input: { path: target, content: "# Decision\n" },
      })).resolves.toMatchObject({
        status: "approval_required",
        approval: { reason: expect.stringMatching(/write/i) },
      });

      await expect(broker.call({
        toolId: "workspace.write",
        input: { path: target, content: "# Decision\n" },
        approved: true,
      })).resolves.toMatchObject({
        status: "completed",
        data: { path: target, bytes: 11 },
      });
      await expect(readFile(target, "utf-8")).resolves.toBe("# Decision\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks dangerous shell commands even with approval", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-tools-"));
    try {
      const config = {
        ...defaultStudioConfig(root),
        enabledTools: { ...defaultStudioConfig(root).enabledTools, shell: true },
      };
      const broker = new StudioToolBroker({
        projectRoot: root,
        getConfig: async () => config,
        browser: new StudioBrowserAdapter({ projectRoot: root }),
      });

      await expect(broker.call({
        toolId: "shell.run",
        input: { command: "rm -rf /" },
        approved: true,
      })).resolves.toMatchObject({
        status: "failed",
        error: expect.stringMatching(/blocked/i),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("captures browser screenshots as artifacts through injected Playwright runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-browser-"));
    try {
      const browser = new StudioBrowserAdapter({
        projectRoot: root,
        playwrightLoader: async () => ({
          chromium: {
            launch: async () => ({
              newPage: async () => ({
                url: () => "http://127.0.0.1:1422/",
                goto: async () => undefined,
                title: async () => "Memoire",
                content: async () => "<html><body>Memoire</body></html>",
                screenshot: async ({ path }: { path: string }) => {
                  await mkdir(join(path, ".."), { recursive: true });
                  await writeFile(path, "png");
                },
                click: async () => undefined,
                fill: async () => undefined,
                close: async () => undefined,
              }),
              close: async () => undefined,
            }),
          },
        }),
      });
      const session = await browser.createSession({ url: "http://127.0.0.1:1422/" });

      await expect(browser.runAction({
        action: "screenshot",
        sessionId: session.id,
      })).resolves.toMatchObject({
        status: "completed",
        artifactPath: expect.stringMatching(/screenshot.*\.png$/),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("audits screenshot artifacts through UX tenets and traps", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-ux-tool-"));
    try {
      const screenshotPath = join(root, ".memoire", "studio", "artifacts", "screen.png");
      await mkdir(join(screenshotPath, ".."), { recursive: true });
      await writeFile(screenshotPath, "png");
      const broker = new StudioToolBroker({
        projectRoot: root,
        getConfig: async () => defaultStudioConfig(root),
        browser: new StudioBrowserAdapter({ projectRoot: root }),
      });

      await expect(broker.call({
        toolId: "ux.audit_screenshot",
        input: { artifactPath: screenshotPath, target: "current screen" },
      })).resolves.toMatchObject({
        status: "completed",
        toolId: "ux.audit_screenshot",
        artifactPath: expect.stringMatching(/ux-audit\.json$/),
        data: {
          report: {
            schemaVersion: 2,
            artifactPath: screenshotPath,
            findings: expect.any(Array),
            recommendedTweaks: expect.any(Array),
          },
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
