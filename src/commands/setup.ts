/**
 * memi setup — Zero-friction onboarding.
 *
 * One command that handles the full Figma + Claude Code setup:
 *   1. Validate Figma token via REST (instant — shows @handle)
 *   2. Validate Figma file key (shows file component count)
 *   3. Check plugin health, auto-fix if stale
 *   4. Copy manifest path to clipboard (macOS)
 *   5. Start bridge in background
 *   6. Write MCP config to .mcp.json
 *   7. Test pull to confirm the full chain
 *   8. Print "You're ready" summary
 */

import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";

import { readFile, writeFile, access } from "fs/promises";
import { join, dirname } from "path";
import { createInterface } from "readline";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import chalk from "chalk";
import {
  validateFigmaToken,
  validateFigmaFile,
  FigmaConfigError,
} from "../figma/rest-client.js";
import { resolvePluginHealth } from "../plugin/install-info.js";
import { installPluginToHome } from "../plugin/installer.js";
import { ui } from "../tui/format.js";
import { readEnvValueRaw, upsertEnvValue } from "../utils/env.js";

// ── Helpers ───────────────────────────────────────────────

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

/** Read a config value from env/files — delegates to shared utility. */
async function readEnvValue(root: string, key: string): Promise<string | null> {
  return readEnvValueRaw(root, key);
}

async function writeEnvVar(root: string, key: string, value: string): Promise<void> {
  const envPath = join(root, ".env.local");
  let content = "";
  try { content = await readFile(envPath, "utf-8"); } catch { /* new file */ }
  await writeFile(envPath, upsertEnvValue(content, key, value));
}

function copyToClipboard(text: string): boolean {
  // Determine the clipboard command for the current platform
  let cmd: string;
  let args: string[] = [];

  if (process.platform === "darwin") {
    // macOS
    cmd = "pbcopy";
  } else if (process.platform === "win32") {
    // Windows
    cmd = "clip";
  } else {
    // Linux — prefer xclip; skip silently if unavailable (xdg-open can't copy to clipboard)
    const probe = spawnSync("which", ["xclip"], { stdio: ["ignore", "pipe", "ignore"] });
    if (probe.status === 0 && probe.stdout?.toString().trim()) {
      cmd = "xclip";
      args = ["-selection", "clipboard"];
    } else {
      // xclip not available — clipboard copy not supported on this system
      return false;
    }
  }

  try {
    const proc = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    proc.stdin.write(text);
    proc.stdin.end();
    return true;
  } catch {
    return false;
  }
}

async function pollBridgeLock(lockPath: string, timeoutMs = 8000): Promise<number | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const raw = await readFile(lockPath, "utf-8");
      const lock = JSON.parse(raw) as { port: number; pid: number };
      if (lock.port && lock.pid) {
        try { process.kill(lock.pid, 0); return lock.port; } catch { /* stale */ }
      }
    } catch { /* not written yet */ }
  }
  return null;
}

function step(label: string): void {
  console.log();
  console.log(ui.section(label));
  console.log();
}

// ── Main command ──────────────────────────────────────────

export function registerSetupCommand(program: Command, engine: MemoireEngine): void {
  const setup = program
    .command("setup")
    .description("Full Figma + Claude Code setup in one command — token, plugin, bridge, MCP config");

  setup
    .command("plugin")
    .description("Copy the packaged Figma plugin to ~/.memoire/plugin explicitly")
    .option("--json", "Output plugin install result as JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await installPluginToHome(engine.config.projectRoot);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(ui.ok(`Figma plugin copied to ${result.destination}`));
      console.log(ui.dots("Manifest", result.manifestPath));
      if (result.sourcePackageVersion || result.widgetVersion) {
        console.log(ui.dots("Bundle", `widget ${result.widgetVersion ?? "unknown"} / package ${result.sourcePackageVersion ?? "unknown"}`));
      }
    });

  setup
    .option("--skip-pull", "Skip the final test pull")
    .option("--json", "Output final status as JSON")
    .action(async (opts: { skipPull?: boolean; json?: boolean }) => {
      await engine.init();

      const root = engine.config.projectRoot;
      const summary: Record<string, string> = {};

      if (!opts.json) {
        console.log();
        console.log(ui.brand("MÉMOIRE SETUP"));
        console.log(ui.dim("  Connecting Figma to Claude Code"));
      }

      // ── 1. TOKEN ─────────────────────────────────────────
      step("1 / 6  TOKEN");

      let token = await readEnvValue(root, "FIGMA_TOKEN");
      let tokenUser: { handle: string; email: string } | null = null;

      if (token) {
        process.stdout.write("  Validating existing token...");
        try {
          tokenUser = await validateFigmaToken(token);
          process.stdout.write("\r" + " ".repeat(50) + "\r");
          console.log(ui.ok(`@${tokenUser.handle}  ${chalk.dim(tokenUser.email)}`));
          summary.token = `@${tokenUser.handle}`;
        } catch (err) {
          process.stdout.write("\r" + " ".repeat(50) + "\r");
          const msg = err instanceof FigmaConfigError ? err.message : "Token invalid";
          console.log(ui.warn(`Existing token failed: ${msg}`));
          token = null; // force re-prompt
        }
      }

      if (!token) {
        console.log("  Generate at figma.com > Settings > Account > Personal Access Tokens");
        console.log();
        const inputToken = await ask("Paste Figma token");

        if (!inputToken) {
          console.log(ui.fail("Token required — generate one at figma.com > Settings > Account > Personal Access Tokens, then re-run: memi setup"));
          process.exit(1);
        }

        process.stdout.write("  Validating...");
        try {
          tokenUser = await validateFigmaToken(inputToken);
          process.stdout.write("\r" + " ".repeat(40) + "\r");
          console.log(ui.ok(`@${tokenUser.handle}  ${chalk.dim(tokenUser.email)}`));
          await writeEnvVar(root, "FIGMA_TOKEN", inputToken);
          process.env.FIGMA_TOKEN = inputToken;
          token = inputToken;
          summary.token = `@${tokenUser.handle}`;
        } catch (err) {
          process.stdout.write("\r" + " ".repeat(40) + "\r");
          const msg = err instanceof FigmaConfigError ? err.message : String(err);
          console.log(ui.fail(`Token invalid: ${msg} — generate a new one at figma.com > Settings > Account > Personal Access Tokens, then re-run: memi setup`));
          process.exit(1);
        }
      }

      // ── 2. FILE KEY ───────────────────────────────────────
      step("2 / 6  FILE");

      let fileKey = await readEnvValue(root, "FIGMA_FILE_KEY");

      if (fileKey) {
        process.stdout.write("  Validating file...");
        try {
          const info = await validateFigmaFile(fileKey, token!);
          process.stdout.write("\r" + " ".repeat(50) + "\r");
          const label = info.componentCount > 0
            ? `${fileKey}  ${chalk.dim(`${info.componentCount} components`)}`
            : fileKey;
          console.log(ui.ok(label));
          summary.file = fileKey;
        } catch (err) {
          process.stdout.write("\r" + " ".repeat(50) + "\r");
          const msg = err instanceof FigmaConfigError ? err.message : "File inaccessible";
          console.log(ui.warn(`Existing file key failed: ${msg} — paste the full Figma URL below to re-enter it`));
          fileKey = null;
        }
      }

      if (!fileKey) {
        console.log("  Paste the URL of your Figma file");
        console.log("  " + chalk.dim("e.g. figma.com/design/abc123/My-Project"));
        console.log();
        const fileInput = await ask("File URL or key", "skip");

        if (fileInput && fileInput !== "skip") {
          const urlMatch = fileInput.match(/figma\.com\/(?:design|file)\/([^/?]+)/);
          const resolvedKey = urlMatch ? urlMatch[1] : fileInput.trim();

          process.stdout.write("  Validating file...");
          try {
            const info = await validateFigmaFile(resolvedKey, token!);
            process.stdout.write("\r" + " ".repeat(50) + "\r");
            const label = info.componentCount > 0
              ? `${resolvedKey}  ${chalk.dim(`${info.componentCount} components`)}`
              : resolvedKey;
            console.log(ui.ok(label));
            await writeEnvVar(root, "FIGMA_FILE_KEY", resolvedKey);
            process.env.FIGMA_FILE_KEY = resolvedKey;
            fileKey = resolvedKey;
            summary.file = resolvedKey;
          } catch (err) {
            process.stdout.write("\r" + " ".repeat(50) + "\r");
            const msg = err instanceof FigmaConfigError ? err.message : String(err);
            console.log(ui.warn(`Could not validate file key: ${msg} — saving anyway. Verify the URL is from figma.com/design/... and you have view access`));
            await writeEnvVar(root, "FIGMA_FILE_KEY", resolvedKey);
            process.env.FIGMA_FILE_KEY = resolvedKey;
            fileKey = resolvedKey;
            summary.file = resolvedKey;
          }
        } else {
          console.log(ui.skip("Skipped — add FIGMA_FILE_KEY to .env.local later"));
          summary.file = "skipped";
        }
      }

      // ── 3. PLUGIN ─────────────────────────────────────────
      step("3 / 6  PLUGIN");

      let plugin = await resolvePluginHealth(root);

      if (plugin.health === "stale-home-copy") {
        console.log(ui.warn("Plugin is stale — reinstalling..."));
        const installed = await installPluginToHome(root);
        console.log(ui.ok(`Plugin reinstalled at ${installed.destination}`));
        plugin = await resolvePluginHealth(root);
      } else if (plugin.health === "missing") {
        const installed = await installPluginToHome(root);
        console.log(ui.ok(`Plugin installed at ${installed.destination}`));
        plugin = await resolvePluginHealth(root);
      } else if (plugin.health === "local-only") {
        console.log(ui.warn("Plugin is only available from the package checkout — copying to ~/.memoire/plugin..."));
        const installed = await installPluginToHome(root);
        console.log(ui.ok(`Plugin installed at ${installed.destination}`));
        plugin = await resolvePluginHealth(root);
      }

      const manifestPath = plugin.manifestPath;
      const copied = copyToClipboard(manifestPath);

      console.log(ui.dots("Status", plugin.health === "current" ? ui.green("current") : plugin.health));
      console.log(ui.dots("Manifest", manifestPath));

      if (copied) {
        console.log(ui.ok("Manifest path copied to clipboard"));
      }
      // Do not print a "copy failed" message — just silently skip on unsupported systems

      console.log();
      console.log("  To install in Figma:");
      console.log("    1. Open Figma Desktop");
      console.log("    2. Plugins > Development > Import plugin from manifest...");
      if (copied) {
        console.log("    3. Cmd+Shift+G, then Cmd+V to paste the path");
      } else {
        console.log(`    3. Navigate to: ${manifestPath}`);
      }

      summary.plugin = plugin.health;

      // ── 4. BRIDGE ─────────────────────────────────────────
      step("4 / 6  BRIDGE");

      const bridgeRunning = await engine.hasRunningBridge();

      if (bridgeRunning) {
        console.log(ui.ok("Bridge already running"));
        summary.bridge = "running";
      } else {
        const __filename = fileURLToPath(import.meta.url);
        const cliPath = join(dirname(__filename), "index.js");

        const child = spawn(process.execPath, [cliPath, "connect", "--skip-setup"], {
          detached: true,
          stdio: "ignore",
          env: { ...process.env },
        });
        child.unref();

        const lockPath = join(root, ".memoire", "bridge.json");
        const port = await pollBridgeLock(lockPath, 8000);

        if (port) {
          console.log(ui.ok(`Bridge started on port ${port}`));
          console.log("  Open Mémoire in Figma to connect the plugin");
          summary.bridge = `port ${port}`;
        } else {
          console.log(ui.warn("Bridge took longer than expected to start — check with: memi connect --json"));
          console.log("  If it never starts, run: memi connect");
          summary.bridge = "starting";
        }
      }

      // ── 5. MCP CONFIG ─────────────────────────────────────
      step("5 / 6  MCP CONFIG");

      const mcpPath = join(root, ".mcp.json");
      let mcpWritten = false;

      try {
        await access(mcpPath);
        // File exists — check if memoire entry is already there
        try {
          const existing = JSON.parse(await readFile(mcpPath, "utf-8")) as Record<string, unknown>;
          const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
          if (servers.memoire) {
            console.log(ui.ok(".mcp.json already configured"));
            summary.mcp = "existing";
          } else {
            servers.memoire = buildMcpEntry();
            existing.mcpServers = servers;
            await writeFile(mcpPath, JSON.stringify(existing, null, 2) + "\n");
            console.log(ui.ok("Added memoire to existing .mcp.json"));
            mcpWritten = true;
            summary.mcp = "updated";
          }
        } catch {
          // Malformed JSON — overwrite safely
          await writeFile(mcpPath, JSON.stringify({ mcpServers: { memoire: buildMcpEntry() } }, null, 2) + "\n");
          console.log(ui.ok(".mcp.json written"));
          mcpWritten = true;
          summary.mcp = "written";
        }
      } catch {
        // File doesn't exist — create it
        await writeFile(mcpPath, JSON.stringify({ mcpServers: { memoire: buildMcpEntry() } }, null, 2) + "\n");
        console.log(ui.ok(".mcp.json written"));
        mcpWritten = true;
        summary.mcp = "written";
      }

      if (mcpWritten) {
        console.log(chalk.dim("  Claude Code will pick this up automatically in this project"));
        console.log(chalk.dim("  For global access: memi mcp config --install --global"));
      }

      // ── 6. TEST PULL ──────────────────────────────────────
      step("6 / 6  TEST PULL");

      if (opts.skipPull || !token || !fileKey || fileKey === "skipped") {
        console.log(ui.skip("Skipped — run `memi pull` when ready"));
        summary.pull = "skipped";
      } else {
        process.stdout.write("  Pulling design system via REST...");
        try {
          await engine.pullDesignSystemREST(true);
          const ds = engine.registry.designSystem;
          process.stdout.write("\r" + " ".repeat(60) + "\r");
          console.log(ui.ok(`${ds.tokens.length} tokens  ${ds.components.length} components  ${ds.styles.length} styles`));
          summary.pull = `${ds.tokens.length} tokens, ${ds.components.length} components`;
        } catch (err) {
          process.stdout.write("\r" + " ".repeat(60) + "\r");
          const msg = err instanceof Error ? err.message : String(err);
          console.log(ui.warn(`Pull failed: ${msg} — check your token and file key, then retry with: memi pull --rest`));
          summary.pull = `failed: ${msg}`;
        }
      }

      // ── DONE ──────────────────────────────────────────────
      console.log();
      console.log(ui.section("READY"));
      console.log();

      if (opts.json) {
        console.log(JSON.stringify({ status: "ready", summary }, null, 2));
        return;
      }

      const lines: [string, string][] = [
        ["Token", summary.token ?? "not set"],
        ["File", summary.file ?? "not set"],
        ["Plugin", summary.plugin ?? "unknown"],
        ["Bridge", summary.bridge ?? "unknown"],
        ["MCP config", summary.mcp ?? "unknown"],
        ["Test pull", summary.pull ?? "skipped"],
      ];

      const maxLabel = Math.max(...lines.map(([l]) => l.length));
      for (const [label, value] of lines) {
        const dots = chalk.dim("·".repeat(Math.max(2, 32 - label.length - value.length)));
        console.log(`  ${label.padEnd(maxLabel + 1)} ${dots} ${value}`);
      }

      console.log();
      console.log("  Next steps:");
      console.log(`    ${chalk.bold("memi pull")}               sync design tokens & components`);
      console.log(`    ${chalk.bold("memi spec component Name")}  create a component spec`);
      console.log(`    ${chalk.bold("memi generate")}            generate React + Tailwind code`);
      console.log(`    ${chalk.bold("memi compose \"intent\"")}    natural language design tasks`);
      console.log();
    });
}

function buildMcpEntry() {
  return {
    command: "memi",
    args: ["mcp", "start", "--no-figma"],
    env: {
      FIGMA_TOKEN: "${FIGMA_TOKEN}",
      FIGMA_FILE_KEY: "${FIGMA_FILE_KEY}",
    },
  };
}
