import { writeCliJson } from "../utils/cli-output.js";
/**
 * Agent Command — Manage multi-Claude agent instances.
 *
 * Subcommands:
 *   memi agent spawn <role>    Spawn a new agent worker
 *   memi agent list             List all registered agents
 *   memi agent kill <id>        Kill an agent by ID
 *   memi agent status           Show agent registry status
 */

import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";
import type { AgentRole } from "../plugin/shared/contracts.js";
import { AgentWorker } from "../agents/agent-worker.js";
import { AGENT_INSTALL_TARGETS, installAgentKits, normalizeAgentInstallTarget } from "../agents/agent-kits.js";
import { buildDesignAgentBrief, normalizeDesignAgentBriefDetail, normalizeDesignAgentBriefMode } from "../agents/design-agent-brief.js";
import { ui } from "../tui/format.js";
import { readContainedSource } from "../security/contained-source.js";

const VALID_ROLES: AgentRole[] = [
  "token-engineer",
  "component-architect",
  "layout-designer",
  "dataviz-specialist",
  "code-generator",
  "accessibility-checker",
  "design-auditor",
  "research-analyst",
  "general",
];

export function registerAgentCommand(program: Command, engine: MemoireEngine): void {
  const agent = program
    .command("agent")
    .description("Manage design-agent briefs, agent kits, and multi-Claude agent instances");

  // ── agent brief ────────────────────────────────────────
  agent
    .command("brief [target]")
    .description("Create a cost-aware design-agent preflight brief for UI work")
    .option("--intent <intent>", "Design intent or product task the agent should perform")
    .option("--agent <agent>", "Agent stack to optimize install guidance for", "design-agent")
    .option("--mode <mode>", "Evidence mode: local, figma, research, or full", "local")
    .option("--detail <detail>", "Payload detail: compact, standard, or full", "standard")
    .option("--project <path>", "Project/workspace root for the brief")
    .option("--json", "Output the brief as JSON")
    .option("--frontend", "Inspect actual repository components, tokens and stories in a bounded brief")
    .option("--design-evidence <path>", "Read Figma or Paper evidence JSON from a project-relative file (requires --frontend)")
    .option("--verification-evidence <path>", "Read host-reported check receipts from a project-relative JSON file (requires --frontend)")
    .option("--max-bytes <bytes>", "Frontend brief JSON byte budget (2048–16384)", "16384")
    .action(async (target: string | undefined, opts: {
      intent?: string;
      agent?: string;
      mode?: string;
      detail?: string;
      project?: string;
      json?: boolean;
      frontend?: boolean;
      designEvidence?: string;
      verificationEvidence?: string;
      maxBytes?: string;
    }) => {
      try {
        if (opts.designEvidence && !opts.frontend) throw new Error("--design-evidence requires --frontend");
        if (opts.verificationEvidence && !opts.frontend) throw new Error("--verification-evidence requires --frontend");
        if (opts.frontend) {
          if (target && target !== ".") throw new Error("Use --project to select the frontend workspace; the brief target must be '.'");
          const projectRoot = opts.project ?? engine.config.projectRoot;
          let designEvidence: unknown;
          if (opts.designEvidence) {
            const source = await readContainedSource(projectRoot, opts.designEvidence, 262_144);
            if (!source.ok) throw new Error(`Design evidence could not be read: ${source.reason}`);
            designEvidence = JSON.parse(source.content);
          }
          let verificationEvidence: unknown;
          if (opts.verificationEvidence) {
            const source = await readContainedSource(projectRoot, opts.verificationEvidence, 32_768);
            if (!source.ok) throw new Error(`Verification evidence could not be read: ${source.reason}`);
            verificationEvidence = JSON.parse(source.content);
          }
          const { buildFrontendBrief } = await import("../frontend/index.js");
          const result = await buildFrontendBrief({
            projectRoot, intent: opts.intent ?? "Improve the existing interface", designEvidence, verificationEvidence,
            maxBytes: Number(opts.maxBytes),
          });
          // Compact JSON preserves the declared byte budget, including when used through a skill.
          await writeCliJson(result);
          return;
        }
        const brief = buildDesignAgentBrief({
          projectRoot: opts.project ?? engine.config.projectRoot,
          target,
          intent: opts.intent,
          agent: opts.agent,
          mode: normalizeDesignAgentBriefMode(opts.mode),
          detail: normalizeDesignAgentBriefDetail(opts.detail),
        });

        if (opts.json) {
          await writeCliJson(brief, 2);
          return;
        }

        console.log();
        console.log(ui.section("DESIGN AGENT BRIEF"));
        console.log(ui.dots("agent", brief.agent));
        console.log(ui.dots("mode", brief.mode));
        console.log(ui.dots("detail", brief.detail));
        console.log(ui.dots("target", brief.target));
        console.log(ui.dots("intent", brief.intent));
        console.log();
        console.log(ui.section("EVIDENCE COMMANDS"));
        for (const command of brief.evidenceCommands) {
          console.log(`  ${command.command}`);
          console.log(`    ${ui.dim(command.why)} ${ui.dim(`[${command.cost}]`)}`);
        }
        console.log();
        console.log(ui.section("DESIGN RULES"));
        for (const rule of brief.designRules) {
          console.log(`  - ${rule}`);
        }
        console.log();
        console.log(ui.section("HANDOFF"));
        for (const item of brief.handoffChecklist) {
          console.log(`  - ${item}`);
        }
        console.log();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          await writeCliJson({
            action: "brief",
            status: "failed",
            error: { message: msg },
          }, 2);
        } else {
          console.log(ui.fail(msg));
        }
        process.exitCode = 1;
      }
    });

  // ── agent install ───────────────────────────────────────
  agent
    .command("install [target]")
    .description("Install Memoire agent kits for universal Agent Skills, Hermes, OpenClaw, Claude Code, Cursor, Codex, Codex plugin, or OpenCode")
    .option("--dry-run", "Show the install plan without writing files")
    .option("--json", "Output install result as JSON")
    .option("--force", "Overwrite an existing Memoire kit or MCP server entry")
    .option("--project <path>", "Project/workspace root for project-scoped installs")
    .option("--global", "Use global config location when a target supports global install")
    .action(async (target: string | undefined, opts: {
      dryRun?: boolean;
      json?: boolean;
      force?: boolean;
      project?: string;
      global?: boolean;
    }) => {
      const selectedTarget = normalizeAgentInstallTarget(target);
      const projectRoot = opts.project ?? engine.config.projectRoot;

      try {
        const result = await installAgentKits({
          target: selectedTarget,
          projectRoot,
          dryRun: opts.dryRun,
          force: opts.force,
          global: opts.global,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log();
        console.log(result.status === "planned"
          ? ui.section("AGENT KIT INSTALL PLAN")
          : ui.ok("Memoire agent kits installed"));
        console.log(ui.dots("suite manifest", result.suiteManifest.destination));
        for (const plan of result.plans) {
          const label = `${plan.target} (${plan.kind})`;
          console.log(ui.dots(label, plan.destination));
          if (result.status === "planned") {
            console.log(`    ${ui.dim(plan.exists ? "exists" : "new")}  ${ui.dim(plan.note)}`);
          }
        }
        if (result.status === "planned") {
          console.log();
          console.log(ui.dim(`  Write these files with: memi agent install ${selectedTarget}`));
        }
        console.log();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const payload = {
          action: "install" as const,
          status: "failed" as const,
          target: selectedTarget,
          dryRun: Boolean(opts.dryRun),
          force: Boolean(opts.force),
          validTargets: ["all", ...AGENT_INSTALL_TARGETS],
          error: { message: msg },
        };
        if (opts.json) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.log(ui.fail(msg));
        }
        process.exitCode = 1;
      }
    });

  // ── agent spawn ─────────────────────────────────────────
  agent
    .command("spawn <role>")
    .description("Spawn a new agent worker with a specific role")
    .option("-n, --name <name>", "Agent display name")
    .option("--remote", "Connect to a remote daemon via WebSocket (scans ports 9223-9232)")
    .option("--host <host>", "Daemon host for remote mode", "localhost")
    .option("--json", "Output agent info as JSON")
    .action(async (role: string, opts: { name?: string; remote?: boolean; host?: string; json?: boolean }) => {
      await engine.init();

      if (!VALID_ROLES.includes(role as AgentRole)) {
        if (opts.json) {
          console.log(JSON.stringify({ error: `Invalid role: ${role}`, validRoles: VALID_ROLES }));
          process.exitCode = 1;
          return;
        }
        console.log();
        console.log(ui.fail(`Invalid role: ${role}`));
        console.log(`  Valid roles: ${VALID_ROLES.join(", ")}`);
        console.log();
        process.exitCode = 1;
        return;
      }

      const worker = new AgentWorker({
        role: role as AgentRole,
        name: opts.name,
        mode: opts.remote ? "remote" : "in-process",
        daemonHost: opts.host,
      });

      const entry = worker.toRegistryEntry();
      await engine.agentRegistry.register(entry);
      await worker.start();

      // Broadcast registration via bridge if connected
      if (engine.figma.isConnected) {
        engine.agentBridge.broadcastRegistration(entry);
      }

      if (opts.json) {
        console.log(JSON.stringify(entry, null, 2));
      } else {
        console.log();
        console.log(ui.ok(`Agent spawned: ${entry.name} (${entry.role})`));
        console.log(ui.dots("ID", entry.id));
        console.log(ui.dots("PID", String(entry.pid)));
        console.log(ui.dots("Capabilities", entry.capabilities.join(", ")));
        console.log();
        console.log(ui.dim(`  To stop: memi agent kill ${entry.id}`));
        console.log();
        console.log(ui.active("Agent running. Waiting for tasks..."));
        console.log();
      }

      // Graceful shutdown
      const shutdown = async () => {
        worker.stop();
        await engine.agentRegistry.deregister(entry.id);
        if (engine.figma.isConnected) {
          engine.agentBridge.broadcastDeregistration(entry.id);
        }
        if (!opts.json) {
          console.log();
          console.log(ui.ok(`Agent ${entry.name} stopped`));
          console.log();
        }
        process.exit(0);
      };

      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);

      // Keep alive
      setInterval(() => {
        engine.agentRegistry.heartbeat(entry.id);
      }, 10_000);
    });

  // ── agent list ──────────────────────────────────────────
  agent
    .command("list")
    .description("List all registered agents")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      await engine.init();

      const agents = engine.agentRegistry.getAll();

      if (opts.json) {
        console.log(JSON.stringify({ agents, count: agents.length }, null, 2));
        return;
      }

      if (agents.length === 0) {
        console.log();
        console.log(ui.pending("No agents registered"));
        console.log(`  Spawn one with: memi agent spawn <role>`);
        console.log();
        return;
      }

      console.log();
      console.log(ui.section(`AGENTS (${agents.length})`));
      for (const a of agents) {
        const statusIcon = a.status === "online" ? "+" : a.status === "busy" ? "~" : "x";
        const statusLabel = a.status === "online" ? ui.green(a.status) : a.status === "busy" ? ui.dim(a.status) : ui.red(a.status);
        console.log(`  ${statusIcon} ${a.name} (${a.role}) — ${statusLabel}`);
        console.log(`    ID: ${a.id} | PID: ${a.pid}`);
      }
      console.log();
    });

  // ── agent kill ──────────────────────────────────────────
  agent
    .command("kill <id>")
    .description("Kill an agent by ID")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      await engine.init();

      const entry = engine.agentRegistry.get(id);
      if (!entry) {
        if (opts.json) {
          console.log(JSON.stringify({ error: `Agent ${id} not found` }));
          process.exitCode = 1;
          return;
        }
        console.log();
        console.log(ui.fail(`Agent ${id} not found`));
        console.log();
        process.exitCode = 1;
        return;
      }

      // Try to kill the process
      try {
        process.kill(entry.pid, "SIGTERM");
      } catch {
        // Process already dead
      }

      await engine.agentRegistry.deregister(id);
      if (engine.figma.isConnected) {
        engine.agentBridge.broadcastDeregistration(id);
      }

      if (opts.json) {
        console.log(JSON.stringify({ killed: id, role: entry.role, name: entry.name }));
      } else {
        console.log();
        console.log(ui.ok(`Agent ${entry.name} (${entry.role}) killed`));
        console.log();
      }
    });

  // ── agent status ────────────────────────────────────────
  agent
    .command("status")
    .description("Show agent registry and task queue status")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      await engine.init();

      const agents = engine.agentRegistry.getAll();
      const queueStats = engine.taskQueue.getStats();

      if (opts.json) {
        console.log(JSON.stringify({
          agents: {
            total: agents.length,
            online: agents.filter((a) => a.status === "online").length,
            busy: agents.filter((a) => a.status === "busy").length,
            offline: agents.filter((a) => a.status === "offline").length,
            entries: agents,
          },
          queue: queueStats,
        }, null, 2));
        return;
      }

      const now = Date.now();

      console.log();
      console.log(ui.section("AGENT REGISTRY"));
      console.log(ui.dots("Total", String(agents.length)));
      console.log(ui.dots("Online", String(agents.filter((a) => a.status === "online").length)));
      console.log(ui.dots("Busy", String(agents.filter((a) => a.status === "busy").length)));

      if (agents.length > 0) {
        console.log();
        for (const a of agents) {
          const ageMs = now - a.lastHeartbeat;
          const stale = ageMs > 30_000;
          const heartbeatLabel = stale
            ? ui.red(`stale (${formatAge(ageMs)} ago)`)
            : ui.dim(`${formatAge(ageMs)} ago`);
          const statusLabel = stale ? ui.red("stale") : a.status === "online" ? ui.green(a.status) : ui.dim(a.status);
          const roleCol = a.role.padEnd(24, " ");
          console.log(`    ${roleCol}  ${statusLabel.padEnd(10)}  heartbeat: ${heartbeatLabel}`);
          console.log(`    ${ui.dim(`id: ${a.id}`)}`);
        }
      }

      console.log();
      console.log(ui.section("TASK QUEUE"));
      console.log(ui.dots("Pending", String(queueStats.pending)));
      console.log(ui.dots("Running", String(queueStats.running)));
      console.log(ui.dots("Completed", String(queueStats.completed)));
      console.log(ui.dots("Failed", String(queueStats.failed)));
      console.log();
    });
}

function formatAge(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}
