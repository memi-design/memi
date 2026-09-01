/**
 * `memi self-update` — update the memi CLI itself to the latest published
 * version.
 *
 * - npm installs:  runs `npm i -g @memi-design/cli@latest`.
 * - standalone binary:  points at `memi upgrade` (which swaps the binary).
 *
 * This is distinct from `memi update <registry>`, which refreshes installed
 * design-system components — not the CLI.
 */

import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";
import { spawnSync } from "node:child_process";
import ora from "ora";
import { ui } from "../tui/format.js";
import { getMemoirePackageVersion } from "../utils/package-version.js";
import {
  PKG_NAME,
  formatUpdateFailureGuidance,
  getInstallChannel,
  isNewer,
  refreshUpdateCache,
} from "../utils/update-check.js";
import { getExecutionPolicy } from "../security/execution-policy.js";

function runNpmGlobalInstall(version: string): boolean {
  const r = spawnSync("npm", ["install", "-g", `${PKG_NAME}@${version}`], { stdio: "inherit" });
  return r.status === 0;
}

export function registerSelfUpdateCommand(program: Command, _engine: MemoireEngine): void {
  program
    .command("self-update")
    .description("Update the memi CLI itself to the latest published version")
    .option("--check", "Check for a newer version without installing")
    .option("--json", "Output result as JSON")
    .option("--silent", "Refresh the update cache quietly (internal background use)")
    .action(async (opts: { check?: boolean; json?: boolean; silent?: boolean }) => {
      const executionPolicy = getExecutionPolicy();
      const current = getMemoirePackageVersion();
      const channel = getInstallChannel();

      // Internal: detached background refresh kicked off by the startup notifier.
      if (opts.silent) {
        await refreshUpdateCache(executionPolicy);
        return;
      }

      const spinner = opts.json || opts.check
        ? null
        : ora({ text: "Checking for updates…", indent: 2, color: "cyan" }).start();
      const cache = await refreshUpdateCache(executionPolicy);
      spinner?.stop();

      const latest = cache.latestVersion;
      if (!latest) {
        if (opts.json) {
          console.log(JSON.stringify({ status: "check-failed", current, channel }, null, 2));
        } else {
          console.log(`\n${ui.fail("Could not reach the npm registry. Check your connection and try again.")}\n`);
        }
        process.exitCode = 1;
        return;
      }

      const available = isNewer(latest, current);
      const updateCmd = channel === "binary" ? "memi upgrade" : "memi self-update";

      // Check-only.
      if (opts.check) {
        if (opts.json) {
          console.log(JSON.stringify({ status: available ? "update-available" : "up-to-date", current, latest, channel }, null, 2));
        } else if (available) {
          console.log(`\n${ui.active(`memi ${latest} available`)} ${ui.dim(`(you have ${current})`)}\n${ui.dim(`  Update:  ${updateCmd}`)}\n`);
        } else {
          console.log(`\n${ui.ok(`memi is up to date (${current})`)}\n`);
        }
        return;
      }

      // Already current.
      if (!available) {
        if (opts.json) console.log(JSON.stringify({ status: "up-to-date", current, latest, channel }, null, 2));
        else console.log(`\n${ui.ok(`Already on the latest version (${current})`)}\n`);
        return;
      }

      // Standalone binary — defer to the binary swapper.
      if (channel === "binary") {
        if (opts.json) {
          console.log(JSON.stringify({ status: "use-upgrade", current, latest, channel }, null, 2));
          return;
        }
        console.log(`\n${ui.active(`memi ${latest} available`)} ${ui.dim(`(you have ${current})`)}`);
        console.log(`${ui.dim("  You're running the standalone binary. Update with:")}`);
        console.log("    memi upgrade\n");
        return;
      }

      // npm channel — install the new version.
      if (opts.json) {
        const ok = runNpmGlobalInstall(latest);
        console.log(JSON.stringify({ status: ok ? "updated" : "update-failed", from: current, to: latest, channel }, null, 2));
        if (!ok) process.exitCode = 1;
        return;
      }

      console.log(`\n${ui.active(`Updating memi ${current} → ${latest}`)}\n`);
      const ok = runNpmGlobalInstall(latest);
      if (ok) {
        console.log(`\n${ui.ok(`Updated to ${latest}. Run  memi --version  to confirm.`)}\n`);
      } else {
        console.log(`\n${ui.fail(`Update failed. Try manually:  ${formatUpdateFailureGuidance(latest)}`)}\n`);
        process.exitCode = 1;
      }
    });
}
