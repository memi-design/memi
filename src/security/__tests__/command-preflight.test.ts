import { describe, expect, it } from "vitest";
import { preflightCommand } from "../command-preflight.js";
import { createExecutionPolicy } from "../execution-policy.js";

describe("Trust Core command preflight", () => {
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

  it("allows offline local Note sources but gates remote Notes", async () => {
    const local = createExecutionPolicy({ projectRoot: "/workspace", profile: "local" });

    await expect(preflightCommand(local, {
      commandPath: ["notes", "install"],
      options: {},
      args: ["./offline-note"],
    })).resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(local, {
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
    const local = createExecutionPolicy({ projectRoot: "/workspace", profile: "local" });

    await expect(preflightCommand(connected, { commandPath: ["mcp", "config"], options: { install: true, global: true }, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["notes", "install"], options: {}, args: ["https://example.com/note"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(connected, { commandPath: ["notes", "update"], options: {}, args: [] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(local, { commandPath: ["notes", "create"], options: {}, args: ["note"] }))
      .resolves.toEqual({ optionOverrides: {} });
    await expect(preflightCommand(local, { commandPath: ["notes", "remove"], options: {}, args: ["note"] }))
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
});
