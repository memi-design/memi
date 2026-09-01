import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { preflightCommand, type CommandInvocation } from "../command-preflight.js";
import { createExecutionPolicy, type MemiCapability } from "../execution-policy.js";

describe("Trust Core command preflight", () => {
  const tempRoots: string[] = [];
  const allCapabilities = [
    "browser",
    "figma",
    "home-write",
    "dynamic-install",
    "network",
    "project-write",
    "shell",
    "source-content-persistence",
    "telemetry",
  ] as const;

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function expectExactCapabilities(
    invocation: CommandInvocation,
    capabilities: readonly MemiCapability[],
  ): Promise<void> {
    for (const missing of capabilities) {
      const policy = createExecutionPolicy({
        projectRoot: "/workspace",
        homeDir: "/home/user",
        profile: "connected",
        allow: capabilities.filter((capability) => capability !== missing),
      });
      await expect(preflightCommand(policy, invocation)).rejects.toMatchObject({
        code: "MEMI_CAPABILITY_DENIED",
        capability: missing,
      });
    }

    const policy = createExecutionPolicy({
      projectRoot: "/workspace",
      homeDir: "/home/user",
      profile: "connected",
      allow: capabilities,
    });
    await expect(preflightCommand(policy, invocation)).resolves.toEqual({ optionOverrides: {} });
  }

  it("forces locked diagnose onto the read-only path", async () => {
    const policy = createExecutionPolicy({ projectRoot: "/workspace" });

    await expect(preflightCommand(policy, {
      commandPath: ["diagnose"],
      options: { write: true, json: true },
      args: [],
    })).resolves.toEqual({ optionOverrides: { write: false } });
  });

  it("allows local diagnose writes because they are constrained to .memi", async () => {
    const policy = createExecutionPolicy({ projectRoot: "/workspace", profile: "local" });

    await expect(preflightCommand(policy, {
      commandPath: ["diagnose"],
      options: { write: true },
      args: [],
    })).resolves.toEqual({ optionOverrides: {} });
  });

  it("blocks update checks, setup, and Figma before their first side effect", async () => {
    const policy = createExecutionPolicy({ projectRoot: "/workspace" });

    await expect(preflightCommand(policy, {
      commandPath: ["self-update"],
      options: { check: true },
      args: [],
    })).rejects.toMatchObject({ code: "MEMI_CAPABILITY_DENIED", capability: "network" });
    await expect(preflightCommand(policy, {
      commandPath: ["setup"],
      options: {},
      args: [],
    })).rejects.toMatchObject({ code: "MEMI_CAPABILITY_DENIED", capability: "network" });
    await expect(preflightCommand(policy, {
      commandPath: ["connect"],
      options: {},
      args: [],
    })).rejects.toMatchObject({ code: "MEMI_CAPABILITY_DENIED", capability: "figma" });
  });

  it("requires exact per-run connected grants for self-update", async () => {
    const checkPolicy = createExecutionPolicy({
      projectRoot: "/workspace",
      homeDir: "/home/user",
      profile: "connected",
      allow: ["network"],
    });
    await expect(preflightCommand(checkPolicy, {
      commandPath: ["self-update"],
      options: { check: true },
      args: [],
    })).resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(checkPolicy, {
      commandPath: ["self-update"],
      options: {},
      args: [],
    })).rejects.toMatchObject({ code: "MEMI_CAPABILITY_DENIED", capability: "dynamic-install" });

    const applyPolicy = createExecutionPolicy({
      projectRoot: "/workspace",
      homeDir: "/home/user",
      profile: "connected",
      allow: ["network", "dynamic-install", "shell", "home-write"],
    });
    await expect(preflightCommand(applyPolicy, {
      commandPath: ["self-update"],
      options: {},
      args: [],
    })).resolves.toEqual({ optionOverrides: {} });
  });

  it("keeps read-only MCP config usable but gates config installation", async () => {
    const locked = createExecutionPolicy({ projectRoot: "/workspace" });

    await expect(preflightCommand(locked, {
      commandPath: ["mcp", "config"],
      options: { install: false },
      args: [],
    })).resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(locked, {
      commandPath: ["mcp", "config"],
      options: { install: true, global: false },
      args: [],
    })).rejects.toMatchObject({ code: "MEMI_CAPABILITY_DENIED", capability: "project-write" });
  });

  it("keeps Note writes out of local mode and gates remote Notes separately", async () => {
    const local = createExecutionPolicy({ projectRoot: "/workspace", profile: "local" });
    const connected = createExecutionPolicy({
      projectRoot: "/workspace",
      profile: "connected",
      allow: ["project-write"],
    });

    await expect(preflightCommand(local, {
      commandPath: ["notes", "install"],
      options: {},
      args: ["./offline-note"],
    })).rejects.toMatchObject({ code: "MEMI_CAPABILITY_DENIED", capability: "project-write" });
    await expect(preflightCommand(connected, {
      commandPath: ["notes", "install"],
      options: {},
      args: ["./offline-note"],
    })).resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, {
      commandPath: ["notes", "install"],
      options: {},
      args: ["github:memi-design/mobile-craft"],
    })).rejects.toMatchObject({ code: "MEMI_CAPABILITY_DENIED", capability: "network" });
  });

  it("gates repair and installer paths by their actual write destination", async () => {
    const locked = createExecutionPolicy({ projectRoot: "/workspace" });
    const local = createExecutionPolicy({ projectRoot: "/workspace", profile: "local" });

    await expect(preflightCommand(locked, {
      commandPath: ["doctor"],
      options: { repairPlugin: true },
      args: [],
    })).rejects.toMatchObject({ code: "MEMI_CAPABILITY_DENIED", capability: "home-write" });
    await expect(preflightCommand(local, {
      commandPath: ["agent", "install"],
      options: { dryRun: false, global: false },
      args: ["codex"],
    })).rejects.toMatchObject({ code: "MEMI_CAPABILITY_DENIED", capability: "dynamic-install" });
  });

  it("blocks model composition and browser launch while preserving print-only view", async () => {
    const locked = createExecutionPolicy({ projectRoot: "/workspace" });

    await expect(preflightCommand(locked, {
      commandPath: ["compose"],
      options: { figma: false },
      args: ["build a dashboard"],
    })).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "network",
      operation: "run model composition",
    });
    await expect(preflightCommand(locked, {
      commandPath: ["view"],
      options: {},
      args: ["Button"],
    })).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "browser",
      operation: "open a registry URL",
    });
    await expect(preflightCommand(locked, {
      commandPath: ["view"],
      options: { print: true },
      args: ["Button"],
    })).resolves.toEqual({ optionOverrides: {} });
  });

  it("covers connected diagnose, doctor, update, and setup grant boundaries", async () => {
    const connected = createExecutionPolicy({ projectRoot: "/workspace", homeDir: "/home/user", profile: "connected", allow: allCapabilities });
    const networkOnly = createExecutionPolicy({ projectRoot: "/workspace", profile: "connected", allow: ["network"] });

    await expect(preflightCommand(networkOnly, { commandPath: ["diagnose"], options: { write: true }, args: [] }))
      .rejects.toMatchObject({ capability: "project-write" });
    await expect(preflightCommand(connected, { commandPath: ["doctor"], options: { repairPlugin: true }, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["upgrade"], options: { check: true }, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(networkOnly, { commandPath: ["upgrade"], options: {}, args: [] }))
      .rejects.toMatchObject({ capability: "dynamic-install" });
    await expect(preflightCommand(connected, { commandPath: ["upgrade"], options: {}, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["setup", "plugin"], options: {}, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["setup"], options: {}, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
  });

  it("covers connect, compose, view, and MCP grant combinations", async () => {
    const connected = createExecutionPolicy({ projectRoot: "/workspace", homeDir: "/home/user", profile: "connected", allow: allCapabilities });
    const noFigma = createExecutionPolicy({ projectRoot: "/workspace", profile: "connected", allow: ["network", "project-write", "shell"] });

    await expect(preflightCommand(connected, { commandPath: ["connect"], options: { background: false }, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["connect"], options: { background: true }, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(noFigma, { commandPath: ["compose"], options: { figma: false }, args: ["intent"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["compose"], options: { figma: true }, args: ["intent"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["view"], options: {}, args: ["Button"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(noFigma, { commandPath: ["view"], options: { json: true }, args: ["Button"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(noFigma, { commandPath: ["mcp", "start"], options: { figma: false }, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["mcp"], options: { figma: true }, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
  });

  it("covers MCP, Notes, agents, registry update, uninstall, and no-op commands", async () => {
    const connected = createExecutionPolicy({ projectRoot: "/workspace", homeDir: "/home/user", profile: "connected", allow: allCapabilities });
    const locked = createExecutionPolicy({ projectRoot: "/workspace" });

    await expect(preflightCommand(connected, { commandPath: ["mcp", "config"], options: { install: true, global: true }, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["notes", "install"], options: {}, args: ["https://example.com/note"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["notes", "update"], options: {}, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["notes", "create"], options: {}, args: ["note"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["notes", "remove"], options: {}, args: ["note"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(locked, { commandPath: ["agent", "install"], options: { dryRun: true }, args: ["codex"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["agent", "install"], options: { global: true }, args: ["codex"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["agent", "spawn"], options: { remote: false }, args: ["general"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["agent", "spawn"], options: { remote: true }, args: ["general"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["update"], options: {}, args: ["@acme/ds"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["uninstall"], options: {}, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(locked, { commandPath: ["status"], options: {}, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
  });

  it("fails closed on every command path without an explicit mapping", async () => {
    const policies = [
      createExecutionPolicy({ projectRoot: "/workspace" }),
      createExecutionPolicy({ projectRoot: "/workspace", profile: "local" }),
      createExecutionPolicy({
        projectRoot: "/workspace",
        homeDir: "/home/user",
        profile: "connected",
        allow: allCapabilities,
      }),
    ];

    for (const policy of policies) {
      await expect(preflightCommand(policy, {
        commandPath: ["future", "unreviewed"],
        options: {},
        args: [],
      })).rejects.toMatchObject({
        code: "MEMI_CAPABILITY_DENIED",
        capability: "command-mapping",
        operation: 'execute unmapped command "future.unreviewed"',
      });
    }
  });

  it("denies mapped non-.memi writes in locked and local profiles", async () => {
    const policies = [
      createExecutionPolicy({ projectRoot: "/workspace" }),
      createExecutionPolicy({ projectRoot: "/workspace", profile: "local" }),
    ];
    const invocations: CommandInvocation[] = [
      { commandPath: ["studio", "browser", "open"], options: {}, args: ["https://example.com"] },
      { commandPath: ["studio", "browser", "status"], options: {}, args: [] },
      { commandPath: ["studio", "serve"], options: {}, args: [] },
      { commandPath: ["studio", "run"], options: { harness: "codex" }, args: [] },
      { commandPath: ["studio", "web"], options: {}, args: [] },
      { commandPath: ["preview"], options: { buildOnly: true }, args: [] },
      { commandPath: ["publish"], options: { name: "@acme/ui" }, args: [] },
      { commandPath: ["research", "from-file"], options: {}, args: ["study.csv"] },
      { commandPath: ["pull"], options: { rest: true }, args: [] },
      { commandPath: ["sync"], options: {}, args: [] },
      { commandPath: ["export"], options: { dryRun: true }, args: [] },
      { commandPath: ["export"], options: { dryRun: false }, args: [] },
    ];

    for (const policy of policies) {
      for (const invocation of invocations) {
        await expect(preflightCommand(policy, invocation)).rejects.toMatchObject({
          code: "MEMI_CAPABILITY_DENIED",
        });
      }
    }
  });

  it("requires exact connected grants for Studio browser, runtime, and harness commands", async () => {
    await expectExactCapabilities(
      { commandPath: ["studio", "browser", "open"], options: {}, args: ["https://example.com"] },
      ["browser", "network", "project-write", "shell"],
    );
    await expectExactCapabilities(
      { commandPath: ["studio", "serve"], options: {}, args: [] },
      ["browser", "figma", "network", "project-write", "shell", "source-content-persistence"],
    );
    await expectExactCapabilities(
      { commandPath: ["studio", "run"], options: { harness: "codex" }, args: [] },
      ["network", "project-write", "shell", "source-content-persistence"],
    );
    await expectExactCapabilities(
      { commandPath: ["studio", "run"], options: { harness: "codex", mode: "brokered" }, args: [] },
      ["browser", "figma", "network", "project-write", "shell", "source-content-persistence"],
    );
    await expectExactCapabilities(
      { commandPath: ["studio", "web"], options: {}, args: [] },
      ["browser", "figma", "network", "project-write", "shell", "source-content-persistence"],
    );
  });

  it("keeps the read-only allowlist narrow and maps initialization side effects", async () => {
    const locked = createExecutionPolicy({ projectRoot: "/workspace" });

    await expect(preflightCommand(locked, {
      commandPath: ["doctor"],
      options: { repairPlugin: false },
      args: [],
    })).resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(locked, {
      commandPath: ["studio", "browser", "status"],
      options: {},
      args: [],
    })).rejects.toMatchObject({ code: "MEMI_CAPABILITY_DENIED", capability: "project-write" });
    await expect(preflightCommand(locked, {
      commandPath: ["export"],
      options: { dryRun: true },
      args: [],
    })).rejects.toMatchObject({ code: "MEMI_CAPABILITY_DENIED", capability: "project-write" });
    await expect(preflightCommand(locked, {
      commandPath: ["studio", "status"],
      options: {},
      args: [],
    })).rejects.toMatchObject({ code: "MEMI_CAPABILITY_DENIED", capability: "project-write" });

    await expectExactCapabilities(
      { commandPath: ["studio", "browser", "status"], options: {}, args: [] },
      ["project-write"],
    );
    await expectExactCapabilities(
      { commandPath: ["studio", "status"], options: {}, args: [] },
      ["project-write", "shell"],
    );
  });

  it("maps preview, publish, research, pull, sync, and export options to exact grants", async () => {
    await expectExactCapabilities(
      { commandPath: ["preview"], options: { buildOnly: true }, args: [] },
      ["project-write"],
    );
    await expectExactCapabilities(
      { commandPath: ["preview"], options: { buildOnly: false }, args: [] },
      ["dynamic-install", "network", "project-write", "shell"],
    );
    await expectExactCapabilities(
      { commandPath: ["publish"], options: { name: "@acme/ui" }, args: [] },
      ["project-write"],
    );
    await expectExactCapabilities(
      {
        commandPath: ["publish"],
        options: { name: "@acme/ui", figma: "https://figma.com/design/key/file", theme: "https://example.com/theme.css", push: true },
        args: [],
      },
      ["network", "project-write", "shell"],
    );
    await expectExactCapabilities(
      { commandPath: ["research", "from-file"], options: {}, args: ["study.csv"] },
      ["project-write", "source-content-persistence"],
    );
    await expectExactCapabilities(
      { commandPath: ["research", "from-stickies"], options: {}, args: [] },
      ["figma", "network", "project-write", "source-content-persistence"],
    );
    await expectExactCapabilities(
      { commandPath: ["research", "web"], options: { urls: "https://example.com" }, args: ["topic"] },
      ["network", "project-write", "source-content-persistence"],
    );
    await expectExactCapabilities(
      { commandPath: ["research", "web"], options: { planOnly: true }, args: ["topic"] },
      [],
    );
    await expectExactCapabilities(
      { commandPath: ["research", "web"], options: {}, args: ["topic"] },
      [],
    );
    await expectExactCapabilities(
      { commandPath: ["pull"], options: { rest: true }, args: [] },
      ["network", "project-write"],
    );
    await expectExactCapabilities(
      { commandPath: ["pull"], options: { penpot: true }, args: [] },
      ["network", "project-write"],
    );
    await expectExactCapabilities(
      { commandPath: ["sync"], options: { autoPr: true }, args: [] },
      ["figma", "network", "project-write", "shell"],
    );
    await expectExactCapabilities(
      { commandPath: ["export"], options: { dryRun: true }, args: [] },
      ["project-write"],
    );
    await expectExactCapabilities(
      { commandPath: ["export"], options: { dryRun: false }, args: [] },
      ["project-write"],
    );
  });

  it("requires shell authority for GitHub-backed Note installation", async () => {
    await expectExactCapabilities(
      { commandPath: ["notes", "install"], options: {}, args: ["github:memi-design/mobile-craft"] },
      ["network", "project-write", "shell"],
    );
  });

  it("rejects user-selected project outputs outside the connected project root", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "memi-command-preflight-"));
    tempRoots.push(sandbox);
    const projectRoot = join(sandbox, "project");
    await mkdir(projectRoot);
    const policy = createExecutionPolicy({
      projectRoot,
      profile: "connected",
      allow: ["project-write"],
    });
    const invocations: CommandInvocation[] = [
      { commandPath: ["publish"], options: { name: "@acme/ui", dir: join(sandbox, "publish-outside") }, args: [] },
      { commandPath: ["publish"], options: { name: "../../publish-outside" }, args: [] },
      { commandPath: ["export"], options: { dryRun: false, target: "../export-outside" }, args: [] },
    ];

    for (const invocation of invocations) {
      await expect(preflightCommand(policy, invocation)).rejects.toMatchObject({
        code: "MEMI_CAPABILITY_DENIED",
        capability: "project-write",
      });
    }
  });
});
