import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerAgentCommand } from "../agent.js";
import { installAgentKits } from "../../agents/agent-kits.js";
import { captureLogs, lastLog } from "./test-helpers.js";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = join(tmpdir(), `memoire-agent-install-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(projectRoot, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("agent install command", () => {
  it("emits a design agent brief for local-first UI work", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerAgentCommand(program, makeAgentEngine(projectRoot) as never);

    await program.parseAsync([
      "agent",
      "brief",
      ".",
      "--intent",
      "Improve the pricing page hierarchy",
      "--agent",
      "codex",
      "--json",
    ], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      action: "brief",
      schemaVersion: 1,
      target: ".",
      intent: "Improve the pricing page hierarchy",
      agent: "codex",
      mode: "local",
    });
    expect(payload.evidenceCommands.map((command: { command: string }) => command.command)).toEqual(expect.arrayContaining([
      "memi diagnose . --json",
      "memi ux audit . --json",
      "memi tokens --from ./src --report",
      "memi agent install --dry-run --json --project .",
    ]));
    expect(payload.handoffChecklist).toContain("List the exact evidence commands run and summarize the resulting design risks.");
  });

  it("emits a dry-run JSON plan for every supported agent when target is omitted", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerAgentCommand(program, makeAgentEngine(projectRoot) as never);

    await program.parseAsync(["agent", "install", "--dry-run", "--json", "--project", projectRoot], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      action: "install",
      status: "planned",
      target: "all",
      dryRun: true,
      force: false,
    });
    expect(payload.suiteManifest).toMatchObject({
      destination: join(projectRoot, "memoire.agent.yaml"),
      wouldWrite: true,
      exists: false,
    });
    expect(payload.plans.map((plan: { target: string }) => plan.target)).toEqual([
      "universal",
      "universal",
      "universal",
      "universal",
      "hermes",
      "openclaw",
      "claude-code",
      "cursor",
      "codex",
      "codex",
      "codex",
      "codex",
      "opencode",
      "grok-build",
      "grok-build",
      "grok-build",
    ]);
    expect(payload.plans.find((plan: { target: string }) => plan.target === "hermes").destination)
      .toContain(join(".hermes", "skills", "memoire", "memoire-design-tooling"));
    expect(payload.plans.find((plan: { target: string }) => plan.target === "openclaw").destination)
      .toBe(join(projectRoot, "skills", "memoire", "memoire-design-tooling"));
    expect(payload.plans.find((plan: { target: string }) => plan.target === "universal").destination)
      .toBe(join(projectRoot, ".agents", "skills", "memoire-design-tooling"));
  });

  it("writes a standard Agent Skills package for universal agent discovery", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerAgentCommand(program, makeAgentEngine(projectRoot) as never);

    await program.parseAsync(["agent", "install", "universal", "--project", projectRoot, "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      action: "install",
      status: "completed",
      target: "universal",
    });
    expect(payload.plans).toEqual(expect.arrayContaining([expect.objectContaining({
      target: "universal",
      kind: "skill",
      source: expect.stringContaining(join("skills", "memoire-design-tooling")),
      destination: join(projectRoot, ".agents", "skills", "memoire-design-tooling"),
    })]));

    const skillNames = ["memoire-design-tooling", "audit-frontend-design", "remember-design-system", "enforce-design-ci"];
    expect(payload.plans).toHaveLength(skillNames.length);
    for (const skillName of skillNames) {
      const skill = await readFile(join(projectRoot, ".agents", "skills", skillName, "SKILL.md"), "utf-8");
      expect(skill).toContain(`name: ${skillName}`);
    }
  });

  it("plans the Hermes skill install path and source asset", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerAgentCommand(program, makeAgentEngine(projectRoot) as never);

    await program.parseAsync(["agent", "install", "hermes", "--dry-run", "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      action: "install",
      status: "planned",
      target: "hermes",
      dryRun: true,
      plans: [{
        target: "hermes",
        kind: "skill",
        source: expect.stringContaining(join("agent-kits", "hermes", "memoire-design-tooling")),
        destination: expect.stringContaining(join(".hermes", "skills", "memoire", "memoire-design-tooling")),
      }],
    });
  });

  it("plans the Codex plugin install path and marketplace target", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerAgentCommand(program, makeAgentEngine(projectRoot) as never);

    await program.parseAsync(["agent", "install", "codex-plugin", "--dry-run", "--json", "--project", projectRoot], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      action: "install",
      status: "planned",
      target: "codex-plugin",
      dryRun: true,
      plans: [{
        target: "codex-plugin",
        kind: "plugin",
        source: expect.stringContaining(join("plugins", "memoire")),
        destination: expect.stringContaining(join("plugins", "memoire")),
        marketplaceDestination: expect.stringContaining(join(".agents", "plugins", "marketplace.json")),
      }],
      suiteManifest: {
        wouldWrite: false,
      },
    });
  });

  it("writes the OpenClaw workspace skill and blocks overwrite without --force", async () => {
    const targetDir = join(projectRoot, "skills", "memoire", "memoire-design-tooling");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "SKILL.md"), "existing skill\n", "utf-8");

    const blockedLogs = captureLogs();
    const blockedProgram = new Command();
    registerAgentCommand(blockedProgram, makeAgentEngine(projectRoot) as never);
    await blockedProgram.parseAsync(["agent", "install", "openclaw", "--project", projectRoot, "--json"], { from: "user" });

    const blockedPayload = JSON.parse(lastLog(blockedLogs));
    expect(blockedPayload).toMatchObject({
      action: "install",
      status: "failed",
      target: "openclaw",
      error: { message: expect.stringContaining("--force") },
    });
    expect(await readFile(join(targetDir, "SKILL.md"), "utf-8")).toBe("existing skill\n");

    vi.restoreAllMocks();
    process.exitCode = 0;

    const forceLogs = captureLogs();
    const forceProgram = new Command();
    registerAgentCommand(forceProgram, makeAgentEngine(projectRoot) as never);
    await forceProgram.parseAsync(["agent", "install", "openclaw", "--project", projectRoot, "--force", "--json"], { from: "user" });

    const forcePayload = JSON.parse(lastLog(forceLogs));
    expect(forcePayload).toMatchObject({
      action: "install",
      status: "completed",
      target: "openclaw",
      plans: [{ target: "openclaw", overwritten: true }],
    });
    const written = await readFile(join(targetDir, "SKILL.md"), "utf-8");
    expect(written).toContain("name: memoire-design-tooling");
    expect(written).toContain("memi");
  });

  it("writes Grok Build skill and project MCP config", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerAgentCommand(program, makeAgentEngine(projectRoot) as never);

    await program.parseAsync(["agent", "install", "grok-build", "--project", projectRoot, "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      action: "install",
      status: "completed",
      target: "grok-build",
    });
    expect(payload.plans.map((plan: { kind: string }) => plan.kind)).toEqual(["skill", "skill", "grok-config"]);
    expect(payload.plans.map((plan: { destination: string }) => plan.destination)).toEqual([
      join(projectRoot, ".grok", "skills", "memoire-design-tooling"),
      join(projectRoot, ".agents", "skills", "memoire-design-tooling"),
      join(projectRoot, ".grok", "config.toml"),
    ]);

    const nativeSkill = await readFile(join(projectRoot, ".grok", "skills", "memoire-design-tooling", "SKILL.md"), "utf-8");
    expect(nativeSkill).toContain("Grok Build");
    expect(nativeSkill).toContain("REFERENCES.md");

    const universalSkill = await readFile(join(projectRoot, ".agents", "skills", "memoire-design-tooling", "SKILL.md"), "utf-8");
    expect(universalSkill).toContain("Grok Build");

    const grokConfig = await readFile(join(projectRoot, ".grok", "config.toml"), "utf-8");
    expect(grokConfig).toContain("[mcp_servers.memoire]");
    expect(grokConfig).toContain('command = "memi"');
    expect(grokConfig).toContain("startup_timeout_sec = 60");
  });

  it("writes MCP config kits for Claude Code without changing notes state", async () => {
    const logs = captureLogs();
    const program = new Command();
    registerAgentCommand(program, makeAgentEngine(projectRoot) as never);

    await program.parseAsync(["agent", "install", "claude-code", "--project", projectRoot, "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(payload).toMatchObject({
      action: "install",
      status: "completed",
      target: "claude-code",
      plans: [{ target: "claude-code", kind: "mcp-config" }],
    });
    const mcpConfig = JSON.parse(await readFile(join(projectRoot, ".mcp.json"), "utf-8"));
    expect(mcpConfig.mcpServers.memoire).toMatchObject({
      command: "memi",
      args: ["mcp", "start", "--no-figma"],
    });
    const suiteManifest = await readFile(join(projectRoot, "memoire.agent.yaml"), "utf-8");
    expect(suiteManifest).toContain("schemaVersion: 1");
    expect(suiteManifest).toContain("recipes:");
    expect(suiteManifest).toContain("design-audit");
    expect(suiteManifest).toContain("memi daemon status --json");
    await expect(stat(join(projectRoot, ".memoire", "notes"))).rejects.toThrow();
  });

  it("installs the Codex plugin into a home-local plugin marketplace", async () => {
    const result = await installAgentKits({
      target: "codex-plugin",
      projectRoot,
      homeDir: projectRoot,
    });

    expect(result).toMatchObject({
      action: "install",
      status: "completed",
      target: "codex-plugin",
      plans: [{ target: "codex-plugin", kind: "plugin" }],
      suiteManifest: { wouldWrite: false },
    });
    const pluginSkill = await readFile(join(projectRoot, "plugins", "memoire", "skills", "memoire-design-tooling", "SKILL.md"), "utf-8");
    expect(pluginSkill).toContain("name: memoire-design-tooling");

    const marketplace = JSON.parse(await readFile(join(projectRoot, ".agents", "plugins", "marketplace.json"), "utf-8"));
    expect(marketplace).toMatchObject({
      name: "memoire-local",
      interface: {
        displayName: "Memoire Local",
      },
      plugins: [{
        name: "memoire",
        source: { source: "local", path: "./plugins/memoire" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      }],
    });
    await expect(stat(join(projectRoot, "memoire.agent.yaml"))).rejects.toThrow();
  });

  it("merges and force-refreshes the Codex plugin marketplace entry", async () => {
    const marketplaceDir = join(projectRoot, ".agents", "plugins");
    await mkdir(marketplaceDir, { recursive: true });
    await writeFile(join(marketplaceDir, "marketplace.json"), JSON.stringify({
      name: "custom",
      interface: { displayName: "Custom Plugins" },
      plugins: [{
        name: "existing",
        source: { source: "local", path: "./plugins/existing" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      }],
    }, null, 2) + "\n", "utf-8");

    await installAgentKits({ target: "codex-plugin", projectRoot, homeDir: projectRoot });
    await writeFile(join(projectRoot, "plugins", "memoire", "MARKER.txt"), "stale\n", "utf-8");

    await expect(installAgentKits({ target: "codex-plugin", projectRoot, homeDir: projectRoot }))
      .rejects.toThrow("--force");

    await installAgentKits({ target: "codex-plugin", projectRoot, homeDir: projectRoot, force: true });

    const marketplace = JSON.parse(await readFile(join(marketplaceDir, "marketplace.json"), "utf-8"));
    expect(marketplace.interface.displayName).toBe("Custom Plugins");
    expect(marketplace.plugins.map((plugin: { name: string }) => plugin.name)).toEqual(["existing", "memoire"]);
    expect(marketplace.plugins.find((plugin: { name: string }) => plugin.name === "memoire")).toMatchObject({
      source: { source: "local", path: "./plugins/memoire" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    });
    await expect(stat(join(projectRoot, "plugins", "memoire", "MARKER.txt"))).rejects.toThrow();
  });

  it("smoke-tests the public Git-backed Codex marketplace command", () => {
    const smoke = spawnSync(process.execPath, ["scripts/smoke-codex-plugin-marketplace.mjs"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });

    expect(smoke.status, smoke.stderr || smoke.stdout).toBe(0);
    const payload = JSON.parse(smoke.stdout);
    expect(payload).toMatchObject({
      passed: true,
      command: "codex plugin marketplace add memi-design/memi --ref main --sparse .agents/plugins --sparse plugins/memoire",
      sparsePaths: [".agents/plugins", "plugins/memoire"],
    });
  });
});

function makeAgentEngine(projectRootPath: string) {
  return {
    config: { projectRoot: projectRootPath },
    async init() {},
    figma: { isConnected: false },
    agentRegistry: {
      async register() {},
      async deregister() {},
      getAll() {
        return [];
      },
      get() {
        return null;
      },
      heartbeat() {},
    },
    agentBridge: {
      broadcastRegistration() {},
      broadcastDeregistration() {},
    },
    taskQueue: {
      getStats() {
        return { pending: 0, running: 0, completed: 0, failed: 0 };
      },
    },
  };
}
