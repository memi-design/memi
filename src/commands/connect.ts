import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";
import type { BridgeClient } from "../figma/ws-server.js";

import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import chalk from "chalk";
import { resolvePluginHealth, type PluginInstallHealth } from "../plugin/install-info.js";
import { validateFigmaToken } from "../figma/rest-client.js";
import { ui } from "../tui/format.js";
import { readEnvValue, upsertEnvValue, type EnvValue, type EnvSource } from "../utils/env.js";
import { readBridgeLock, writeBridgeLock, clearBridgeLock } from "../figma/bridge-lock.js";

// Alias shared type so ConnectJsonPayload signatures remain readable
type ConfigSource = EnvSource;
type ExistingConfigValue = EnvValue;

interface ConnectJsonPayload {
  status: "needs-setup" | "connected" | "failed";
  stage: "token-check" | "bridge-start" | "wait-for-plugin";
  setup: {
    skipSetup: boolean;
    token: {
      present: boolean;
      source: ConfigSource;
    };
    fileKey: {
      present: boolean;
      source: ConfigSource;
      value: string | null;
    };
  };
  bridge: {
    port: number | null;
    connectedClients: number;
    connected: boolean;
    connectionState: "connected" | "reconnecting" | "disconnected";
    reconnectAttempts?: number;
    lastConnectedAt: string | null;
    lastDisconnectedAt: string | null;
  };
  plugin: {
    manifestPath: string;
    installPath: string;
    source: "home" | "local" | "missing";
    symlinked: boolean;
    exists: boolean;
    current: boolean;
    health: PluginInstallHealth["health"];
    operatorConsole: boolean;
    bundle: {
      ready: boolean;
      codePath: string;
      uiPath: string;
      metaPath: string;
      installMetaPath: string;
    };
    localBundle: {
      ready: boolean;
      codePath: string;
      uiPath: string;
      metaPath: string;
    };
  };
  widget: {
    operatorConsole: boolean;
    widgetVersion: string | null;
    packageVersion: string | null;
    builtAt: string | null;
    bundleHash: string | null;
  };
  nextSteps: string[];
  error?: {
    message: string;
  };
}

/** Prompt with ▸ indicator */
function ask(question: string, defaultVal?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultVal ? chalk.dim(` (${defaultVal})`) : "";
  return new Promise((resolve) => {
    rl.question(`  ${ui.promptPrefix()} ${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

/** Check process env, .env.local, and .env for a config value — delegates to shared util. */
async function findExistingEnvValue(root: string, key: string): Promise<ExistingConfigValue> {
  return readEnvValue(root, key);
}

function buildSetupPayload(
  skipSetup: boolean,
  token: ExistingConfigValue,
  fileKey: ExistingConfigValue,
): ConnectJsonPayload["setup"] {
  return {
    skipSetup,
    token: {
      present: Boolean(token.value),
      source: token.source,
    },
    fileKey: {
      present: Boolean(fileKey.value),
      source: fileKey.source,
      value: fileKey.value,
    },
  };
}

function buildPluginPayload(plugin: PluginInstallHealth): ConnectJsonPayload["plugin"] {
  return {
    manifestPath: plugin.manifestPath,
    installPath: plugin.installPath,
    source: plugin.source,
    symlinked: plugin.symlinked,
    exists: plugin.exists,
    current: plugin.current,
    health: plugin.health,
    operatorConsole: plugin.operatorConsole,
    bundle: {
      ready: plugin.bundle.ready,
      codePath: plugin.bundle.codePath,
      uiPath: plugin.bundle.uiPath,
      metaPath: plugin.bundle.metaPath,
      installMetaPath: plugin.bundle.installMetaPath,
    },
    localBundle: {
      ready: plugin.localBundle.ready,
      codePath: plugin.localBundle.codePath,
      uiPath: plugin.localBundle.uiPath,
      metaPath: plugin.localBundle.metaPath,
    },
  };
}

function buildWidgetPayload(plugin: PluginInstallHealth): ConnectJsonPayload["widget"] {
  return {
    operatorConsole: plugin.operatorConsole,
    widgetVersion: plugin.widgetVersion,
    packageVersion: plugin.packageVersion,
    builtAt: plugin.builtAt,
    bundleHash: plugin.bundleHash,
  };
}

function buildPluginNextSteps(plugin: PluginInstallHealth): string[] {
  const steps: string[] = [];

  if (!plugin.localBundle.ready) {
    steps.push("Run `npm run build` so plugin/code.js, plugin/ui.html, and widget-meta.json exist");
  }
  if (plugin.health === "missing" || plugin.health === "local-only") {
    steps.push("Import the Memoire Control Plane manifest in Figma from the reported manifest path");
  }
  if (plugin.health === "stale-home-copy") {
    steps.push("Run `memi setup plugin` or `memi doctor --repair-plugin` so ~/.memoire/plugin matches the current package bundle");
  }
  if (plugin.health === "symlink-risk") {
    steps.push("Avoid symlinked manifests when importing into Figma; prefer ~/.memoire/plugin/manifest.json");
  }
  if (plugin.health === "missing-assets") {
    steps.push("Rebuild the widget bundle and verify manifest, code.js, ui.html, and widget-meta.json are all present");
  }

  return steps;
}

function describePluginHealth(plugin: PluginInstallHealth): string {
  switch (plugin.health) {
    case "current":
      return "current";
    case "stale-home-copy":
      return "stale";
    case "local-only":
      return "local only";
    case "missing-assets":
      return "missing assets";
    case "symlink-risk":
      return "symlink risk";
    default:
      return "not installed";
  }
}

/** Append or update a key in a .env file */
async function setEnvVar(root: string, key: string, value: string): Promise<void> {
  const envPath = join(root, ".env.local");
  let content = "";
  try {
    content = await readFile(envPath, "utf-8");
  } catch {
    // new file
  }

  await writeFile(envPath, upsertEnvValue(content, key, value));
}

export function registerConnectCommand(program: Command, engine: MemoireEngine) {
  program
    .command("connect")
    .description("Connect to Figma — guided setup if first time")
    .option("-p, --port <port>", "Starting port to scan", "9223")
    .option("-n, --name <name>", "Instance name shown in Figma plugin")
    .option("--role <role>", "Register as an agent with this role (e.g., token-engineer)")
    .option("--skip-setup", "Skip the guided setup, go straight to connecting")
    .option("--background", "Start bridge as a background process and exit (no terminal required)")
    .option("--json", "Output connection state as JSON")
    .action(async (opts: { port: string; name?: string; role?: string; skipSetup?: boolean; background?: boolean; json?: boolean }) => {
      await engine.init();

      // ── Background mode ───────────────────────────────
      if (opts.background) {
        // Resolve the CLI entry (dist/index.js next to this file's dist location)
        const __filename = fileURLToPath(import.meta.url);
        const cliPath = join(dirname(__filename), "index.js");

        const args = [cliPath, "connect", "--skip-setup"];
        if (opts.role) args.push("--role", opts.role);
        if (opts.name) args.push("--name", opts.name);

        const child = spawn(process.execPath, args, {
          detached: true,
          stdio: "ignore",
          env: { ...process.env },
        });
        child.unref();

        if (!opts.json) {
          console.log();
          console.log(ui.ok("Bridge starting in background..."));
          console.log(ui.dim("  Waiting for plugin to register..."));
        }

        // Poll bridge.json for up to 8 seconds to confirm the child started
        const root = engine.config.projectRoot;
        const pollStart = Date.now();
        let port: number | null = null;

        while (Date.now() - pollStart < 8000) {
          await new Promise((r) => setTimeout(r, 400));
          const lock = await readBridgeLock(root).catch(() => null);
          if (lock?.port) {
            port = lock.port;
            break;
          }
        }

        if (opts.json) {
          console.log(JSON.stringify({ status: port ? "connected" : "starting", bridge: { port, pid: child.pid ?? null } }));
        } else if (port) {
          console.log(ui.ok(`Bridge running on port ${port}`));
          console.log(ui.dim("  Open the Mémoire plugin in Figma to connect"));
          console.log(ui.dim("  Run `memi connect --json` to check status"));
        } else {
          console.log(ui.warn("Bridge started but port not confirmed yet — check status with: memi connect --json"));
          console.log(ui.dim("  If it never confirms, run: memi connect (without --background)"));
        }
        console.log();
        return;
      }

      const root = engine.config.projectRoot;
      const json = Boolean(opts.json);
      const token = await findExistingEnvValue(root, "FIGMA_TOKEN");
      const fileKey = await findExistingEnvValue(root, "FIGMA_FILE_KEY");
      const plugin = await resolvePluginHealth(root);

      if (json && !token.value) {
        const connState = engine.figma.getConnectionState();
        console.log(JSON.stringify({
          status: "needs-setup",
          stage: "token-check",
          setup: buildSetupPayload(Boolean(opts.skipSetup), token, fileKey),
          bridge: {
            port: null,
            connectedClients: 0,
            connected: false,
            connectionState: connState,
            ...(connState === "reconnecting" ? { reconnectAttempts: engine.figma.reconnectAttempts } : {}),
            lastConnectedAt: engine.figma.lastConnectedAt?.toISOString() ?? null,
            lastDisconnectedAt: engine.figma.lastDisconnectedAt?.toISOString() ?? null,
          },
          plugin: buildPluginPayload(plugin),
          widget: buildWidgetPayload(plugin),
          nextSteps: [
            "Set FIGMA_TOKEN in .env.local, .env, or process environment",
            ...buildPluginNextSteps(plugin),
            "Run `memi connect --json --skip-setup` again after token setup",
          ],
        } satisfies ConnectJsonPayload, null, 2));
        return;
      }

      // ── Guided setup (first time) ─────────────────
      if (!token.value && !opts.skipSetup) {
        console.log(ui.brand("CONNECTION SETUP"));

        // ── Token ─────────────────────────────────────
        console.log(ui.section("TOKEN"));
        console.log("  Figma Personal Access Token");
        console.log();
        console.log(ui.instructions([
          "1. Open Figma > Settings > Account",
          '2. Scroll to "Personal Access Tokens"',
          '3. Generate new token named "Memoire"',
          "4. Token starts with figd_...",
        ]));
        console.log();

        const inputToken = await ask("Paste your token");

        if (!inputToken) {
          console.log();
          console.log(ui.warn("No token provided"));
          console.log('  Set later: export FIGMA_TOKEN="figd_xxxxx"');
          console.log("  Or re-run: memi connect");
          console.log();
          process.exit(0);
        }

        // Validate token format
        if (!inputToken.startsWith("figd_") || inputToken.length < 10) {
          console.log();
          console.log(ui.warn("Token doesn't look like a Figma token (usually starts with figd_)"));
          const proceed = await ask("Continue anyway? (y/n)", "y");
          if (proceed.toLowerCase() !== "y") {
            process.exit(0);
          }
        }

        await setEnvVar(root, "FIGMA_TOKEN", inputToken);
        process.env.FIGMA_TOKEN = inputToken;

        // ── Instant token validation via REST ─────────
        process.stdout.write("  Validating token...");
        try {
          const user = await validateFigmaToken(inputToken);
          process.stdout.write("\r" + " ".repeat(40) + "\r");
          console.log(ui.ok(`Token valid — connected as @${user.handle} (${user.email})`));
        } catch {
          process.stdout.write("\r" + " ".repeat(40) + "\r");
          console.log(ui.warn("Token saved but could not be validated — check internet, or test with: memi pull --rest"));
        }

        // ── File key ──────────────────────────────────
        console.log(ui.section("FILE"));
        console.log("  Default Figma File " + ui.dim("(optional)"));
        console.log();
        console.log("  Paste URL or file key. Enter to skip.");
        console.log("  " + ui.dim("Example: figma.com/design/abc123def/MyProject"));
        console.log();

        const fileInput = await ask("Figma file URL or key");

        if (fileInput) {
          const urlMatch = fileInput.match(/figma\.com\/(?:design|file)\/([^/]+)/);
          const resolvedFileKey = urlMatch ? urlMatch[1] : fileInput.trim();

          await setEnvVar(root, "FIGMA_FILE_KEY", resolvedFileKey);
          process.env.FIGMA_FILE_KEY = resolvedFileKey;
          console.log(ui.ok("File key saved: " + resolvedFileKey));
        } else {
          console.log(ui.skip("Skipped — add later in .env.local"));
        }

        // ── Plugin ────────────────────────────────────
        console.log(ui.section("PLUGIN"));
        console.log("  Memoire Control Plane");
        console.log();

        if (plugin.source === "local" && plugin.symlinked) {
          console.log(ui.warn("manifest.json is a symlink — Figma may reject it. Fix with: npm install -g @memi-design/cli"));
          console.log();
        }

        console.log(ui.dots("Health", describePluginHealth(plugin)));
        console.log(ui.dots("Widget", `v${plugin.widgetVersion ?? "?"} / ${plugin.packageVersion ?? "?"}`));
        console.log(ui.dots("Install", plugin.installPath));
        console.log(ui.dots("Bundle", plugin.bundle.ready ? ui.green("ready") : ui.red("missing")));
        console.log();

        console.log(ui.instructions([
          "1. Open Figma Desktop",
          "2. Plugins > Development > Import manifest",
          `3. Select: ${plugin.manifestPath}`,
          "4. Cmd+Shift+G to paste path in file picker",
        ]));
        console.log();

        const ready = await ask("Press Enter when ready to connect...");
        void ready;
        console.log();
      } else if (token.value) {
        if (!json) {
          console.log(ui.brand("CONNECT"));
          console.log(ui.ok("Figma token found " + ui.dim(token.value.startsWith("figd_") ? "(figd_...)" : "(configured)")));
        }
        if (!process.env.FIGMA_TOKEN) {
          process.env.FIGMA_TOKEN = token.value;
        }
      }

      if (fileKey.value && !process.env.FIGMA_FILE_KEY) {
        process.env.FIGMA_FILE_KEY = fileKey.value;
      }

      // ── Bridge ──────────────────────────────────────
      if (!json) {
        console.log(ui.section("BRIDGE"));
        console.log(ui.active("Starting bridge server..."));
      }

      try {
        const port = await engine.connectFigma();
        const connectedClients = engine.figma.wsServer?.connectedClients?.length ?? 0;

        if (json) {
          const connState = engine.figma.getConnectionState();
          console.log(JSON.stringify({
            status: "connected",
            stage: "wait-for-plugin",
            setup: buildSetupPayload(Boolean(opts.skipSetup), token, fileKey),
            bridge: {
              port,
              connectedClients,
              connected: connectedClients > 0,
              connectionState: connState,
              ...(connState === "reconnecting" ? { reconnectAttempts: engine.figma.reconnectAttempts } : {}),
              lastConnectedAt: engine.figma.lastConnectedAt?.toISOString() ?? null,
              lastDisconnectedAt: engine.figma.lastDisconnectedAt?.toISOString() ?? null,
            },
            plugin: buildPluginPayload(plugin),
            widget: buildWidgetPayload(plugin),
            nextSteps: connectedClients > 0
              ? []
              : [
                ...buildPluginNextSteps(plugin),
                "Open the Memoire Control Plane in Figma to attach to the running bridge",
              ],
          } satisfies ConnectJsonPayload, null, 2));
          return;
        }

        // ── Bridge info box ─────────────────────────────
        console.log();
        console.log(ui.box(`PORT ${port}`, [
          "",
          "In Figma:",
          "Plugins > Development > Memoire > Run",
          "",
          "Once connected:",
          ...formatGuideLines([
            ["memi pull", "sync design tokens"],
            ["memi ia extract app", "extract page tree"],
            ["memi sync", "full pipeline"],
          ]),
          "",
        ]));

        console.log(ui.dots("Widget", `v${plugin.widgetVersion ?? "?"} / ${plugin.packageVersion ?? "?"}`));
        console.log(ui.dots("Source", `${plugin.source} (${describePluginHealth(plugin)})`));
        console.log(ui.dots("Manifest", plugin.manifestPath));

        // ── Write bridge lock so `memi pull` can reuse this bridge ──
        await writeBridgeLock(root, port);
        const cleanupBridgeLock = () => clearBridgeLock(root).catch((err) => {
          if (process.env.DEBUG) console.error("bridge lock cleanup failed:", err);
        });
        process.once("exit", cleanupBridgeLock);
        process.once("SIGTERM", () => { cleanupBridgeLock(); process.exit(0); });
        process.once("SIGHUP", () => { cleanupBridgeLock(); process.exit(0); });

        // ── Event handlers ──────────────────────────────
        engine.figma.on("plugin-connected", (client: BridgeClient) => {
          console.log();
          console.log(ui.ok(`Connected: ${client.file} (${client.editor})`));
          console.log("    Run " + ui.bold("memi pull") + " or " + ui.bold("memi ia extract <name>"));
          console.log();
        });

        engine.figma.on("plugin-disconnected", () => {
          const remaining = engine.figma.wsServer?.connectedClients?.length ?? 0;
          console.log(ui.warn(`Plugin disconnected (${remaining} remaining) — reopen Mémoire in Figma to reconnect`));
        });

        engine.figma.on("chat", (data: { text: string; from: string; file: string }) => {
          console.log("  " + ui.dim(`[chat] ${data.from}: ${data.text}`));
        });

        engine.figma.on("action-result", (data: { action: string; result?: unknown; error?: string }) => {
          if (data.error) {
            console.log(ui.event("x", data.action, data.error));
          } else {
            const size = data.result ? JSON.stringify(data.result).length : 0;
            const sizeLabel = size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
            console.log(ui.event("+", data.action, sizeLabel));
          }
        });

        engine.figma.on("sync-data", (data: { part: string; result?: unknown; error?: string }) => {
          if (data.error) {
            console.log(ui.event("x", data.part, data.error));
          } else {
            const size = data.result ? JSON.stringify(data.result).length : 0;
            const sizeLabel = size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
            console.log(ui.event("+", data.part, sizeLabel));
          }
        });

        engine.figma.on("selection", (data: unknown) => {
          const nodes = (data as { nodes?: { name: string }[] })?.nodes || [];
          if (nodes.length > 0) {
            const names = nodes.map((n) => n.name).join(", ");
            console.log(ui.event("·", "SELECTION", `${nodes.length} node${nodes.length > 1 ? "s" : ""} — ${names}`));
          }
        });

        engine.figma.on("page-changed", (data: { page?: string }) => {
          console.log(ui.event("·", "PAGE", data.page || "unknown"));
        });

        process.once("SIGINT", () => {
          cleanupBridgeLock();
          engine.figma.disconnect();
          process.exit(0);
        });

        // ── Agent registration (optional) ────────────────
        if (opts.role) {
          const { AgentWorker } = await import("../agents/agent-worker.js");
          const worker = new AgentWorker({
            role: opts.role as import("../plugin/shared/contracts.js").AgentRole,
            name: opts.name,
          });
          const entry = worker.toRegistryEntry();
          await engine.agentRegistry.register(entry);
          await worker.start();
          engine.agentBridge.broadcastRegistration(entry);
          console.log(ui.ok(`Registered as agent: ${entry.name} (${entry.role})`));

          // Heartbeat
          setInterval(() => engine.agentRegistry.heartbeat(entry.id), 10_000);
        }

        console.log();
        console.log(ui.active("Waiting for Figma plugin... " + ui.dim("(Ctrl+C to stop)")));
        console.log();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (json) {
          console.log(JSON.stringify({
            status: "failed",
            stage: "bridge-start",
            setup: buildSetupPayload(Boolean(opts.skipSetup), token, fileKey),
            bridge: {
              port: null,
              connectedClients: 0,
              connected: false,
              connectionState: "disconnected" as const,
              lastConnectedAt: engine.figma.lastConnectedAt?.toISOString() ?? null,
              lastDisconnectedAt: engine.figma.lastDisconnectedAt?.toISOString() ?? null,
            },
            plugin: buildPluginPayload(plugin),
            widget: buildWidgetPayload(plugin),
            nextSteps: [
              ...buildPluginNextSteps(plugin),
              "Verify the Figma token and plugin manifest path",
              "Retry once the bridge port is available",
            ],
            error: {
              message,
            },
          } satisfies ConnectJsonPayload, null, 2));
          process.exitCode = 1;
          return;
        }

        console.log();
        console.log(ui.fail(message));
        console.log();
        process.exit(1);
      }
    });
}

/** Format guide pairs for use inside a box (no leading indent) */
function formatGuideLines(pairs: [string, string][]): string[] {
  const maxCmd = Math.max(...pairs.map(([c]) => c.length));
  return pairs.map(([cmd, desc]) => {
    const padded = cmd.padEnd(maxCmd + 1);
    const dots = chalk.dim("·".repeat(Math.max(2, 40 - padded.length - desc.length)));
    return `${padded} ${dots} ${chalk.dim(desc)}`;
  });
}
