import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Command } from "commander";
import { registerConnectCommand } from "../connect.js";
import { captureLogs, lastLog, writePluginBundle } from "./test-helpers.js";

let projectRoot: string;
let originalHome: string | undefined;

beforeEach(async () => {
  projectRoot = join(tmpdir(), `memoire-connect-json-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(projectRoot, "plugin"), { recursive: true });
  projectRoot = await realpath(projectRoot);
  await writePluginBundle(join(projectRoot, "plugin"), { packageVersion: "0.2.1", widgetVersion: "2" });
  originalHome = process.env.HOME;
  process.env.HOME = join(projectRoot, "fake-home");
  delete process.env.FIGMA_TOKEN;
  delete process.env.FIGMA_FILE_KEY;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  delete process.env.FIGMA_TOKEN;
  delete process.env.FIGMA_FILE_KEY;
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  await rm(projectRoot, { recursive: true, force: true });
});

describe("connect --json", () => {
  it("returns a setup payload instead of prompting when the token is missing", async () => {
    const logs = captureLogs();
    const program = new Command();
    const engine = makeConnectEngine(projectRoot);

    registerConnectCommand(program, engine as never);
    await program.parseAsync(["connect", "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      status: "needs-setup",
      stage: "token-check",
      setup: {
        skipSetup: false,
        token: {
          present: false,
          source: "missing",
        },
        fileKey: {
          present: false,
          source: "missing",
          value: null,
        },
      },
      bridge: {
        port: null,
        connectedClients: 0,
        connected: false,
      },
      plugin: {
        manifestPath: join(projectRoot, "plugin", "manifest.json"),
        installPath: join(projectRoot, "plugin"),
        source: "local",
        exists: true,
        symlinked: false,
        health: "local-only",
        current: false,
        operatorConsole: true,
      },
      widget: {
        operatorConsole: true,
        widgetVersion: "2",
        packageVersion: "0.2.1",
      },
    });
    expect(payload.nextSteps[0]).toContain("Set FIGMA_TOKEN");
    expect(engine.connectFigma).not.toHaveBeenCalled();
  });

  it("reports config sources and bridge details when the bridge starts", async () => {
    const logs = captureLogs();
    const program = new Command();
    const engine = makeConnectEngine(projectRoot, { connectedClients: 1 });

    await writeFile(join(projectRoot, ".env.local"), 'FIGMA_TOKEN="figd_localtoken"\n', "utf-8");
    await writeFile(join(projectRoot, ".env"), 'FIGMA_FILE_KEY="file_from_env"\n', "utf-8");

    registerConnectCommand(program, engine as never);
    await program.parseAsync(["connect", "--json", "--skip-setup"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      status: "connected",
      stage: "wait-for-plugin",
      setup: {
        skipSetup: true,
        token: {
          present: true,
          source: ".env.local",
        },
        fileKey: {
          present: true,
          source: ".env",
          value: "file_from_env",
        },
      },
      bridge: {
        port: 9223,
        connectedClients: 1,
        connected: true,
      },
      plugin: {
        source: "local",
        health: "local-only",
        operatorConsole: true,
      },
      widget: {
        widgetVersion: "2",
        packageVersion: "0.2.1",
      },
    });
    expect(engine.connectFigma).toHaveBeenCalledTimes(1);
  });

  it("returns a failure payload for bridge startup errors", async () => {
    const logs = captureLogs();
    const program = new Command();
    const engine = makeConnectEngine(projectRoot, { failMessage: "Port scan failed" });

    await writeFile(join(projectRoot, ".env.local"), 'FIGMA_TOKEN="figd_localtoken"\n', "utf-8");

    registerConnectCommand(program, engine as never);
    await program.parseAsync(["connect", "--json", "--skip-setup"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      status: "failed",
      stage: "bridge-start",
      setup: {
        token: {
          present: true,
          source: ".env.local",
        },
      },
      bridge: {
        port: null,
        connectedClients: 0,
        connected: false,
      },
      plugin: {
        health: "local-only",
        operatorConsole: true,
      },
      widget: {
        widgetVersion: "2",
      },
      error: {
        message: "Port scan failed",
      },
    });
    expect(process.exitCode).toBe(1);
  });
});

function makeConnectEngine(
  projectRootPath: string,
  options: { connectedClients?: number; failMessage?: string } = {},
) {
  return {
    config: { projectRoot: projectRootPath },
    async init() {},
    connectFigma: vi.fn(async () => {
      if (options.failMessage) {
        throw new Error(options.failMessage);
      }
      return 9223;
    }),
    figma: {
      wsServer: {
        connectedClients: Array.from({ length: options.connectedClients ?? 0 }, () => ({})),
      },
      on() {},
      disconnect() {},
      getConnectionState() { return options.connectedClients ? "connected" : "disconnected"; },
      get reconnectAttempts() { return 0; },
      get lastConnectedAt() { return null; },
      get lastDisconnectedAt() { return null; },
    },
  };
}
