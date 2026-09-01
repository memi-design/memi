import { describe, expect, it } from "vitest";
import { preflightCommand } from "../command-preflight.js";
import { createExecutionPolicy } from "../execution-policy.js";

describe("Trust Core command preflight", () => {
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
});
