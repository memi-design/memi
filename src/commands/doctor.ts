/**
 * Doctor Command — Self-diagnostic health check for the Memoire engine.
 * Validates project setup, design system, specs, tokens, Figma bridge,
 * preview files, Node version, dependencies, and workspace integrity.
 */

import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";
import { access, readdir, constants } from "fs/promises";
import { join } from "path";
import { resolvePluginHealth } from "../plugin/install-info.js";
import { installPluginToHome } from "../plugin/installer.js";
import { BRIDGE_PORT_START, BRIDGE_PORT_END } from "../figma/port-scanner.js";
import { formatElapsed } from "../utils/format.js";
import { detectProject } from "../engine/project-context.js";
import { createRequire } from "node:module";
import { getExecutionPolicy, type MemiExecutionPolicySnapshot } from "../security/execution-policy.js";
import { createMetadataReceipt, type MetadataReceipt } from "../security/metadata-receipt.js";
import { getMemoirePackageVersion } from "../utils/package-version.js";

type CheckStatus = "pass" | "warn" | "fail";
type CheckCategory = "project" | "design" | "plugin" | "bridge" | "runtime" | "workspace" | "team";

interface CheckResult {
  code: string;
  category: CheckCategory;
  status: CheckStatus;
  label: string;
  detail: string;
  meta?: Record<string, unknown>;
}

interface DoctorPayload {
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
  };
  checks: CheckResult[];
  policy: MemiExecutionPolicySnapshot & {
    offlineInternalUse: {
      suitable: boolean;
      requiresEmployerApproval: true;
      reasons: readonly string[];
    };
  };
  optionalIntegrations: {
    anthropic: boolean;
    canvas: boolean;
    playwright: boolean;
  };
  receipt?: Readonly<MetadataReceipt>;
}

const ICON: Record<CheckStatus, string> = {
  pass: "+",
  warn: "!",
  fail: "x",
};

/**
 * Register the `memi doctor` command onto the Commander program.
 *
 * Runs a suite of self-diagnostic checks covering project detection,
 * design system health, plugin bundle integrity, Figma bridge status,
 * Node.js version, .env.local presence, REST credentials, and workspace
 * writability. Prints a grouped summary with pass/warn/fail icons.
 *
 * @param program  The root Commander Command instance.
 * @param engine   The initialised MemoireEngine.
 */
export function registerDoctorCommand(program: Command, engine: MemoireEngine): void {
  program
    .command("doctor")
    .description("Run self-diagnostic checks on the Memoire engine")
    .option("--json", "Output doctor results as JSON")
    .option("--repair-plugin", "Explicitly copy the packaged Figma plugin to ~/.memoire/plugin when stale or missing")
    .action(async (opts: { json?: boolean; repairPlugin?: boolean }) => {
      const start = Date.now();
      const executionPolicy = getExecutionPolicy();
      const results: CheckResult[] = [];
      const push = (
        code: string,
        category: CheckCategory,
        status: CheckStatus,
        label: string,
        detail: string,
        meta?: Record<string, unknown>,
      ) => {
        results.push({ code, category, status, label, detail, meta });
      };

      // 1. Project detected
      try {
        // Engine initialization persists legacy `.memoire/` project state.
        // Locked and local doctor runs are observational until that state is
        // migrated beneath the local profile's `.memi/` write boundary.
        if (executionPolicy.profile === "connected") {
          await engine.init();
        }
        const project = engine.project ?? await detectProject(engine.config.projectRoot);
        if (project) {
          const parts: string[] = [project.framework];
          if (project.styling.tailwind) parts.push("Tailwind");
          push("project.detected", "project", "pass", "Project detected", parts.join(" + "), {
            framework: project.framework,
            tailwind: project.styling.tailwind,
          });
        } else {
          push("project.detected", "project", "fail", "Project detected", "no project context found");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        push("project.detected", "project", "fail", "Project detected", msg);
      }

      // 2. Design system loaded
      try {
        if (executionPolicy.profile === "connected") {
          await engine.registry.load();
        }
        const ds = engine.registry.designSystem;
        const tokenCount = ds.tokens.length;
        if (tokenCount > 0) {
          const byType: Record<string, number> = {};
          for (const t of ds.tokens) {
            byType[t.type] = (byType[t.type] ?? 0) + 1;
          }
          const breakdown = Object.entries(byType)
            .map(([type, count]) => `${type}: ${count}`)
            .join(", ");
          push("design.system", "design", "pass", "Design system", `${tokenCount} tokens (${breakdown})`, {
            tokens: tokenCount,
            breakdown: byType,
          });
        } else {
          push("design.system", "design", "warn", "Design system", "no tokens loaded");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        push("design.system", "design", "fail", "Design system", msg);
      }

      // 3. Specs valid
      try {
        const specs = await engine.registry.getAllSpecs();
        let valid = 0;
        let warnings = 0;
        const issues: string[] = [];
        const byType: Record<string, number> = {};

        for (const spec of specs) {
          byType[spec.type] = (byType[spec.type] ?? 0) + 1;
          let hasIssue = false;

          if (!("purpose" in spec) || !spec.purpose) {
            issues.push(`${spec.name}: missing purpose`);
            hasIssue = true;
          }
          if (spec.type === "component" && "shadcnBase" in spec) {
            const comp = spec as { shadcnBase?: string[] };
            if (!comp.shadcnBase || comp.shadcnBase.length === 0) {
              issues.push(`${spec.name}: missing shadcnBase`);
              hasIssue = true;
            }
          }

          if (hasIssue) {
            warnings++;
          } else {
            valid++;
          }
        }

        const typeSummary = Object.entries(byType)
          .map(([type, count]) => `${type}: ${count}`)
          .join(", ");

        if (warnings > 0) {
          push("design.specs", "design", "warn", "Specs", `${valid} valid, ${warnings} with issues (${typeSummary}). ${issues.join("; ")}`, {
            valid,
            warnings,
            types: byType,
          });
        } else if (specs.length > 0) {
          push("design.specs", "design", "pass", "Specs", `${valid} valid (${typeSummary})`, {
            valid,
            types: byType,
          });
        } else {
          push("design.specs", "design", "warn", "Specs", "no specs found");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        push("design.specs", "design", "fail", "Specs", msg);
      }

      // 4. Token coverage
      {
        const ds = engine.registry.designSystem;
        const requiredTypes = ["color", "spacing", "typography", "radius"] as const;
        const presentTypes = new Set(ds.tokens.map((t) => t.type));
        const missing = requiredTypes.filter((t) => !presentTypes.has(t));

        if (missing.length === 0) {
          push("design.tokens", "design", "pass", "Token coverage", "all core types present", {
            requiredTypes,
          });
        } else {
          push("design.tokens", "design", "fail", "Token gap", `no ${missing.join(", ")} tokens`, {
            missing,
          });
        }
      }

      // 5. Plugin bundle
      try {
        let plugin = await resolvePluginHealth(engine.config.projectRoot);
        if (opts.repairPlugin && plugin.localBundle.ready && plugin.health !== "current") {
          const home = process.env.HOME || process.env.USERPROFILE;
          await executionPolicy.assertHomeWrite(
            join(home ?? "", ".memoire", "plugin"),
            "repair the Figma plugin",
          );
          const repair = await installPluginToHome(engine.config.projectRoot);
          plugin = await resolvePluginHealth(engine.config.projectRoot);
          push("plugin.repair", "plugin", plugin.health === "current" ? "pass" : "warn", "Plugin repair", `copied plugin to ${repair.destination}`, {
            manifestPath: repair.manifestPath,
            health: plugin.health,
          });
        }
        const missing = [
          !plugin.localBundle.meta?.manifest.exists ? "manifest.json" : "",
          !plugin.localBundle.meta?.code.exists ? "code.js" : "",
          !plugin.localBundle.meta?.ui.exists ? "ui.html" : "",
          !plugin.localBundle.meta ? "widget-meta.json" : "",
        ].filter(Boolean);

        if (plugin.localBundle.ready && plugin.localBundle.meta) {
          push("plugin.bundle", "plugin", "pass", "Plugin bundle", "manifest, code.js, ui.html, and widget-meta.json ready", {
            root: plugin.localBundle.root,
            builtAt: plugin.localBundle.meta.builtAt,
            packageVersion: plugin.localBundle.meta.packageVersion,
            widgetVersion: plugin.localBundle.meta.widgetVersion,
          });
        } else {
          push("plugin.bundle", "plugin", "fail", "Plugin bundle", `missing ${missing.join(", ") || "plugin assets"}`, {
            root: plugin.localBundle.root,
            missing,
          });
        }

        if (plugin.health === "current") {
          push("plugin.install", "plugin", "pass", "Plugin install", `${plugin.installPath} is current`, {
            source: plugin.source,
            health: plugin.health,
          });
        } else if (plugin.health === "local-only" || plugin.health === "symlink-risk" || plugin.health === "stale-home-copy") {
          push("plugin.install", "plugin", "warn", "Plugin install", `${plugin.installPath} (${plugin.health})`, {
            source: plugin.source,
            health: plugin.health,
            manifestPath: plugin.manifestPath,
          });
        } else {
          push("plugin.install", "plugin", "fail", "Plugin install", `${plugin.installPath} (${plugin.health})`, {
            source: plugin.source,
            health: plugin.health,
            manifestPath: plugin.manifestPath,
          });
        }

        if (plugin.widgetVersion || plugin.packageVersion || plugin.builtAt) {
          push(
            "plugin.widget-meta",
            "plugin",
            "pass",
            "Widget V2 metadata",
            `widget ${plugin.widgetVersion ?? "unknown"} / package ${plugin.packageVersion ?? "unknown"}`,
            {
              widgetVersion: plugin.widgetVersion,
              packageVersion: plugin.packageVersion,
              builtAt: plugin.builtAt,
              bundleHash: plugin.bundleHash,
            },
          );
        } else {
          push("plugin.widget-meta", "plugin", "warn", "Widget V2 metadata", "metadata not available", {
            manifestPath: plugin.manifestPath,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        push("plugin.bundle", "plugin", "fail", "Plugin bundle", msg);
        push("plugin.install", "plugin", "fail", "Plugin install", msg);
      }

      // 6. Figma bridge
      try {
        const bridgeStatus = typeof engine.figma.getStatus === "function"
          ? engine.figma.getStatus()
          : { running: false, port: 0, clients: [], connectionState: "disconnected" as const, reconnectAttempts: 0, lastConnectedAt: null, lastDisconnectedAt: null };

        const connectionState = engine.figma.getConnectionState();

        if (engine.figma.isConnected) {
          push("bridge.figma", "bridge", "pass", "Figma bridge", `connected (${bridgeStatus.clients.length} client${bridgeStatus.clients.length === 1 ? "" : "s"})`, {
            running: bridgeStatus.running,
            port: bridgeStatus.port,
            clients: bridgeStatus.clients.length,
            connectionState,
            lastConnectedAt: bridgeStatus.lastConnectedAt,
            lastDisconnectedAt: bridgeStatus.lastDisconnectedAt,
          });
        } else if (connectionState === "reconnecting") {
          push("bridge.figma", "bridge", "warn", "Figma bridge", `reconnecting (attempt ${bridgeStatus.reconnectAttempts}) — reopen Mémoire in Figma`, {
            running: bridgeStatus.running,
            port: bridgeStatus.port,
            connectionState,
            reconnectAttempts: bridgeStatus.reconnectAttempts,
            lastConnectedAt: bridgeStatus.lastConnectedAt,
            lastDisconnectedAt: bridgeStatus.lastDisconnectedAt,
          });
        } else if (bridgeStatus.running) {
          push("bridge.figma", "bridge", "warn", "Figma bridge", `listening on :${bridgeStatus.port} — waiting for the Control Plane`, {
            running: bridgeStatus.running,
            port: bridgeStatus.port,
            connectionState,
            lastConnectedAt: bridgeStatus.lastConnectedAt,
            lastDisconnectedAt: bridgeStatus.lastDisconnectedAt,
          });
        } else {
          push("bridge.figma", "bridge", "warn", "Figma bridge", `not connected (ports ${BRIDGE_PORT_START}-${BRIDGE_PORT_END})`, {
            running: bridgeStatus.running,
            port: bridgeStatus.port,
            connectionState,
          });
        }
      } catch {
        push("bridge.figma", "bridge", "warn", "Figma bridge", "unable to check connection");
      }

      // 6b. Widget operator snapshot (#62, #63). When the bridge is
      // connected, pull the machine-readable Jobs / Selection / System
      // snapshot from the plugin so JSON consumers can see live widget
      // health in the same payload as the rest of the doctor report.
      if (opts.json && engine.figma.isConnected) {
        try {
          const snapshot = await engine.figma.getWidgetSnapshot(4000);
          if (snapshot && typeof snapshot === "object") {
            push("widget.snapshot", "bridge", "pass", "Widget snapshot", "operator surfaces available", {
              snapshot,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          push("widget.snapshot", "bridge", "warn", "Widget snapshot", msg);
        }
      }

      // 7. Preview files
      try {
        const previewDir = join(engine.config.projectRoot, "preview");
        const files = await readdir(previewDir);
        const htmlFiles = files.filter((f) => f.endsWith(".html"));
        if (htmlFiles.length > 0) {
          push("runtime.preview", "runtime", "pass", "Preview", `${htmlFiles.length} pages`, {
            htmlFiles,
          });
        } else {
          push("runtime.preview", "runtime", "warn", "Preview", "no HTML files in preview/");
        }
      } catch {
        push("runtime.preview", "runtime", "fail", "Preview", "preview/ directory not found");
      }

      // 8. Node version
      {
        const version = process.version;
        const major = parseInt(version.slice(1).split(".")[0], 10);
        if (major >= 20) {
          push("runtime.node", "runtime", "pass", "Node", version, { version });
        } else {
          push("runtime.node", "runtime", "fail", "Node", `${version} (requires >= 20)`, { version });
        }
      }

      // 9. Dependencies
      try {
        const nmPath = join(engine.config.projectRoot, "node_modules");
        await access(nmPath, constants.R_OK);
        push("runtime.dependencies", "runtime", "pass", "Dependencies", "installed");
      } catch {
        push("runtime.dependencies", "runtime", "fail", "Dependencies", "node_modules not found");
      }

      // 10. .env.local and FIGMA_TOKEN presence
      {
        const envLocalPath = join(engine.config.projectRoot, ".env.local");
        let envLocalExists = false;
        try {
          await access(envLocalPath, constants.R_OK);
          envLocalExists = true;
        } catch {
          envLocalExists = false;
        }
        const tokenInEnv = !!process.env.FIGMA_TOKEN;

        if (envLocalExists) {
          push("env.local", "runtime", "pass", ".env.local", "found");
        } else if (tokenInEnv) {
          push("env.local", "runtime", "warn", ".env.local", "FIGMA_TOKEN found in shell env — consider adding to .env.local for persistence");
        } else {
          push("env.local", "runtime", "warn", ".env.local", "FIGMA_TOKEN not set — run: memi setup");
        }
      }

      // 11. REST credentials (optional — enables plugin-free pull)
      const figmaToken = engine.config.figmaToken || process.env.FIGMA_TOKEN;
      const figmaFileKey = engine.config.figmaFileKey || process.env.FIGMA_FILE_KEY;
      if (figmaToken && figmaFileKey) {
        push("rest.credentials", "bridge", "pass", "REST credentials", "FIGMA_TOKEN + FIGMA_FILE_KEY set — `memi pull --rest` available");
      } else if (figmaToken && !figmaFileKey) {
        push("rest.credentials", "bridge", "warn", "REST credentials", "FIGMA_TOKEN set but FIGMA_FILE_KEY missing — add to .env.local to enable `memi pull --rest`");
      } else {
        push("rest.credentials", "bridge", "warn", "REST credentials", "Not configured — add FIGMA_TOKEN + FIGMA_FILE_KEY to .env.local for plugin-free pulls");
      }

      // 12. Penpot credentials (optional — enables Penpot pull)
      const penpotToken = process.env.PENPOT_TOKEN;
      const penpotFileId = process.env.PENPOT_FILE_ID;
      if (penpotToken && penpotFileId) {
        push("penpot.credentials", "bridge", "pass", "Penpot credentials", "PENPOT_TOKEN + PENPOT_FILE_ID set — `memi pull --penpot` available");
      } else if (penpotToken || penpotFileId) {
        push("penpot.credentials", "bridge", "warn", "Penpot credentials", `${penpotToken ? "PENPOT_TOKEN" : "PENPOT_FILE_ID"} set but incomplete — add both to .env.local`);
      }
      // Only show if something is set (Penpot is optional)

      // 13. Workspace
      try {
        const memoireDir = join(engine.config.projectRoot, ".memoire");
        await access(memoireDir, constants.R_OK | constants.W_OK);
        push("workspace.memoire", "workspace", "pass", "Workspace", ".memoire/ OK");
      } catch {
        push("workspace.memoire", "workspace", "fail", "Workspace", ".memoire/ missing or not writable");
      }

      // 14. Team gate: committed policy, shared baseline, gitignore rules.
      try {
        const { loadPolicy, POLICY_FILE_NAME } = await import("../app-quality/policy.js");
        const { readBaseline } = await import("../app-quality/baseline.js");
        const { checkGitignorePolicy } = await import("../utils/gitignore-policy.js");

        let policyHash: string | undefined;
        try {
          const policy = await loadPolicy(engine.config.projectRoot);
          policyHash = policy.policyHash;
          if (policy.source === "file") {
            push("team.policy", "team", "pass", "Policy", `${POLICY_FILE_NAME} committed (${policy.preset}, ${policy.policyHash})`);
          } else {
            push("team.policy", "team", "warn", "Policy", `No ${POLICY_FILE_NAME} — using defaults. Run \`memi init --team\` to commit one.`);
          }
        } catch (err) {
          push("team.policy", "team", "fail", "Policy", err instanceof Error ? err.message : String(err));
        }

        const baseline = await readBaseline(engine.config.projectRoot);
        if (!baseline) {
          push("team.baseline", "team", "warn", "Baseline", "No .memoire/baseline.json — every historical finding gates. Run `memi baseline accept` or `memi init --team`.");
        } else if (policyHash && baseline.policyHash && baseline.policyHash !== policyHash) {
          push("team.baseline", "team", "warn", "Baseline", `Accepted under policy ${baseline.policyHash}, current is ${policyHash} — fingerprints may not match; re-accept after aligning`);
        } else {
          push("team.baseline", "team", "pass", "Baseline", `${baseline.entries.length} accepted fingerprint(s) — only NEW findings gate`);
        }

        const gitignore = await checkGitignorePolicy(engine.config.projectRoot);
        if (gitignore.conflictingLine) {
          push("team.gitignore", "team", "warn", "Gitignore", `"${gitignore.conflictingLine}" outside the managed block keeps the baseline ignored — remove it`);
        } else if (!gitignore.present) {
          push("team.gitignore", "team", "warn", "Gitignore", "No managed memi block — baseline.json may be gitignored. Run `memi init --team`.");
        } else {
          push("team.gitignore", "team", gitignore.upToDate ? "pass" : "warn", "Gitignore", gitignore.upToDate ? "Managed block present (.memoire/* local, baseline.json shared)" : "Managed block present but stale — run `memi init --team` to refresh");
        }
      } catch (err) {
        push("team.checks", "team", "warn", "Team checks", err instanceof Error ? err.message : String(err));
      }

      const payload = buildDoctorPayload(results, executionPolicy, Date.now() - start);

      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      // Print results
      console.log("\n  Memoire Doctor\n");

      const categories: CheckCategory[] = ["project", "design", "plugin", "bridge", "runtime", "workspace", "team"];
      const labels: Record<CheckCategory, string> = {
        project: "Project",
        design: "Design",
        plugin: "Plugin",
        bridge: "Bridge",
        runtime: "Runtime",
        workspace: "Workspace",
        team: "Team gate",
      };

      for (const category of categories) {
        const group = results.filter((result) => result.category === category);
        if (!group.length) continue;
        console.log(`  ${labels[category]}`);
        for (const r of group) {
          console.log(`    ${ICON[r.status]} ${r.label}: ${r.detail}`);
        }
        console.log("");
      }

      console.log(`\n  ${payload.summary.pass} passed, ${payload.summary.warn} warnings, ${payload.summary.fail} failed\n`);
    });
}

function buildDoctorPayload(
  results: CheckResult[],
  executionPolicy: ReturnType<typeof getExecutionPolicy>,
  durationMs: number,
): DoctorPayload {
  const pass = results.filter((r) => r.status === "pass").length;
  const warn = results.filter((r) => r.status === "warn").length;
  const fail = results.filter((r) => r.status === "fail").length;

  const policySnapshot = executionPolicy.snapshot();
  const nodeSupported = Number.parseInt(process.version.slice(1).split(".")[0] ?? "0", 10) >= 20;
  const suitable = executionPolicy.profile === "locked" &&
    executionPolicy.effectiveCapabilities.length === 0 &&
    nodeSupported;
  const reasons = [
    ...(executionPolicy.profile === "locked" ? [] : ["Use the locked profile for offline repository review."]),
    ...(executionPolicy.effectiveCapabilities.length === 0 ? [] : ["Remove invocation capability grants."]),
    ...(nodeSupported ? [] : ["Node.js 20 or newer is required."]),
  ];
  const optionalIntegrations = installedOptionalIntegrations();
  const receipt = executionPolicy.profile === "locked"
    ? createMetadataReceipt({
        command: "doctor",
        version: getMemoirePackageVersion(),
        commit: process.env.MEMI_BUILD_COMMIT ?? process.env.GITHUB_SHA ?? "unknown",
        policy: executionPolicy,
        ruleIds: results.map((result) => result.code),
        counts: { total: results.length, pass, warn, fail },
        durationMs,
      })
    : undefined;

  return {
    summary: {
      total: results.length,
      pass,
      warn,
      fail,
    },
    checks: results,
    policy: {
      ...policySnapshot,
      offlineInternalUse: {
        suitable,
        requiresEmployerApproval: true,
        reasons: Object.freeze(reasons),
      },
    },
    optionalIntegrations,
    ...(receipt ? { receipt } : {}),
  };
}

function installedOptionalIntegrations(): DoctorPayload["optionalIntegrations"] {
  const require = createRequire(import.meta.url);
  const installed = (packageName: string): boolean => {
    try {
      require.resolve(packageName);
      return true;
    } catch {
      return false;
    }
  };

  return Object.freeze({
    anthropic: installed("@anthropic-ai/sdk"),
    canvas: installed("@napi-rs/canvas"),
    playwright: installed("playwright"),
  });
}
