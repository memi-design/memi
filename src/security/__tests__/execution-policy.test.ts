import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MEMI_CAPABILITIES,
  MemiCapabilityDeniedError,
  configureExecutionPolicy,
  createExecutionPolicy,
  getExecutionPolicy,
  parseExecutionPolicyArgs,
  resetExecutionPolicyForTests,
} from "../execution-policy.js";

const cleanup: string[] = [];

afterEach(async () => {
  resetExecutionPolicyForTests();
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("MemiExecutionPolicy", () => {
  it("defaults to a frozen locked profile with no effective capabilities", () => {
    const policy = createExecutionPolicy({ projectRoot: "/workspace" });

    expect(policy.snapshot()).toEqual({
      profile: "locked",
      requestedCapabilities: [],
      effectiveCapabilities: [],
      dataLocations: {
        project: ".memi/",
        home: "~/.memoire/",
      },
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.effectiveCapabilities)).toBe(true);
    expect(() => policy.assert("network", "check npm for updates")).toThrowError(
      expect.objectContaining({
        code: "MEMI_CAPABILITY_DENIED",
        profile: "locked",
        capability: "network",
        operation: "check npm for updates",
      }),
    );
  });

  it("ignores requested grants in locked mode", () => {
    const policy = createExecutionPolicy({
      projectRoot: "/workspace",
      profile: "locked",
      allow: ["network", "shell", "project-write"],
    });

    expect(policy.requestedCapabilities).toEqual(["network", "project-write", "shell"]);
    expect(policy.effectiveCapabilities).toEqual([]);
  });

  it("allows local writes only beneath the real .memi directory", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-policy-local-"));
    cleanup.push(projectRoot);
    await mkdir(join(projectRoot, ".memi"), { recursive: true });
    const policy = createExecutionPolicy({ projectRoot, profile: "local" });

    await expect(policy.assertProjectWrite(join(projectRoot, ".memi", "receipt.json"), "write receipt")).resolves.toBeUndefined();
    await expect(policy.assertProjectWrite(join(projectRoot, "src", "index.ts"), "write source")).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "project-write",
    });
    await expect(policy.assertProjectWrite(join(projectRoot, ".memi", "..", "outside.json"), "escape workspace")).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "project-write",
    });
  });

  it("rejects a symlink escape from .memi", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-policy-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "memi-policy-outside-"));
    cleanup.push(projectRoot, outsideRoot);
    await mkdir(join(projectRoot, ".memi"), { recursive: true });
    await symlink(outsideRoot, join(projectRoot, ".memi", "escape"), "dir");
    const policy = createExecutionPolicy({ projectRoot, profile: "local" });

    await expect(policy.assertProjectWrite(join(projectRoot, ".memi", "escape", "receipt.json"), "write receipt")).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "project-write",
    });
  });

  it("rejects a symlinked receipt leaf before a write can follow it", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-policy-leaf-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "memi-policy-leaf-outside-"));
    cleanup.push(projectRoot, outsideRoot);
    await mkdir(join(projectRoot, ".memi"), { recursive: true });
    const outsideReceipt = join(outsideRoot, "receipt.json");
    await writeFile(outsideReceipt, "outside", "utf8");
    const receiptPath = join(projectRoot, ".memi", "receipt.json");
    await symlink(outsideReceipt, receiptPath, "file");
    const policy = createExecutionPolicy({ projectRoot, profile: "local" });

    await expect(policy.assertProjectWrite(receiptPath, "persist metadata receipt")).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "project-write",
      operation: "persist metadata receipt",
    });
  });

  it("requires every connected capability to be explicitly granted for the invocation", () => {
    const policy = createExecutionPolicy({
      projectRoot: "/workspace",
      profile: "connected",
      allow: ["network", "figma", "host-integration-code"],
    });

    expect(policy.allows("network")).toBe(true);
    expect(policy.allows("figma")).toBe(true);
    expect(policy.allows("host-integration-code")).toBe(true);
    expect(policy.allows("shell")).toBe(false);
    expect(() => policy.assert("shell", "launch a child process")).toThrow(MemiCapabilityDeniedError);
  });

  it("parses profile, offline alias, and repeatable allow flags without consuming command args", () => {
    const parsed = parseExecutionPolicyArgs([
      "--profile=connected",
      "--allow",
      "network",
      "diagnose",
      "--allow=project-write",
      "--allow=host-integration-code",
      "--json",
    ], { projectRoot: "/workspace" });

    expect(parsed.policy.profile).toBe("connected");
    expect(parsed.policy.effectiveCapabilities).toEqual(["host-integration-code", "network", "project-write"]);
    expect(parsed.commandArgs).toEqual(["diagnose", "--json"]);

    const offline = parseExecutionPolicyArgs(["--offline", "doctor", "--json"], { projectRoot: "/workspace" });
    expect(offline.policy.profile).toBe("locked");
    expect(offline.commandArgs).toEqual(["doctor", "--json"]);
  });

  it("rejects invalid capabilities and conflicting offline/profile flags", () => {
    expect(() => parseExecutionPolicyArgs(["--allow", "root"], { projectRoot: "/workspace" })).toThrow(
      `Invalid capability "root". Use one of: ${MEMI_CAPABILITIES.join(", ")}`,
    );
    expect(() => parseExecutionPolicyArgs(["--offline", "--profile", "connected"], { projectRoot: "/workspace" })).toThrow(
      "--offline cannot be combined with --profile connected",
    );
  });

  it("serializes denials as a typed, structured error without private paths", () => {
    const error = new MemiCapabilityDeniedError({
      profile: "locked",
      capability: "home-write",
      operation: "repair plugin",
    });

    expect(error.toJSON()).toEqual({
      code: "MEMI_CAPABILITY_DENIED",
      message: "Profile locked denied home-write for repair plugin. Re-run with --profile connected --allow home-write after reviewing the operation.",
      profile: "locked",
      capability: "home-write",
      operation: "repair plugin",
    });
  });

  it("configures one immutable invocation policy and resets safely for tests", () => {
    const configured = configureExecutionPolicy({
      projectRoot: "/workspace",
      profile: "connected",
      allow: ["network"],
    });

    expect(getExecutionPolicy()).toBe(configured);
    resetExecutionPolicyForTests();
    expect(getExecutionPolicy().profile).toBe("locked");
  });

  it("allows connected project writes only inside the project root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-policy-connected-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "memi-policy-connected-outside-"));
    cleanup.push(projectRoot, outsideRoot);
    const policy = createExecutionPolicy({
      projectRoot,
      profile: "connected",
      allow: ["project-write"],
    });

    await expect(policy.assertProjectWrite(join(projectRoot, "generated", "Button.tsx"), "generate code")).resolves.toBeUndefined();
    await expect(policy.assertProjectWrite(join(outsideRoot, "Button.tsx"), "escape project")).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "project-write",
    });
  });

  it("allows granted home writes only inside the configured home", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-policy-home-project-"));
    const homeDir = await mkdtemp(join(tmpdir(), "memi-policy-home-"));
    cleanup.push(projectRoot, homeDir);
    const policy = createExecutionPolicy({
      projectRoot,
      homeDir,
      profile: "connected",
      allow: ["home-write"],
    });

    await expect(policy.assertHomeWrite(join(homeDir, ".memoire", "config.json"), "write config")).resolves.toBeUndefined();
    const configPath = join(homeDir, ".memoire", "config.json");
    await policy.runHomeWrite(configPath, "write config", async (safePath) => {
      await writeFile(safePath, "{}\n", "utf8");
    });
    expect(await readFile(configPath, "utf8")).toBe("{}\n");
    await expect(policy.assertHomeWrite(join(projectRoot, "config.json"), "escape home")).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "home-write",
    });

    const missingHome = createExecutionPolicy({
      projectRoot,
      profile: "connected",
      allow: ["home-write"],
    });
    await expect(missingHome.assertHomeWrite("config.json", "write config")).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "home-write",
    });
  });

  it("mediates first-run stamp writes without following a symlinked ~/.memoire root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-policy-stamp-project-"));
    const homeDir = await mkdtemp(join(tmpdir(), "memi-policy-stamp-home-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "memi-policy-stamp-outside-"));
    cleanup.push(projectRoot, homeDir, outsideRoot);
    await symlink(outsideRoot, join(homeDir, ".memoire"), "dir");
    const policy = createExecutionPolicy({
      projectRoot,
      homeDir,
      profile: "connected",
      allow: ["home-write"],
    });
    const stamp = join(homeDir, ".memoire", ".first-run-done");

    await expect(policy.runHomeWrite(stamp, "persist first-run stamp", async (safePath) => {
      await writeFile(safePath, "2026-08-31T00:00:00.000Z", "utf8");
    })).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "home-write",
      operation: "persist first-run stamp",
    });
    expect(await readdir(outsideRoot)).toEqual([]);
  });

  it("denies mediated home writes when no home boundary was declared", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-policy-no-home-project-"));
    cleanup.push(projectRoot);
    const policy = createExecutionPolicy({
      projectRoot,
      profile: "connected",
      allow: ["home-write"],
    });

    await expect(policy.runHomeWrite("/tmp/.memoire-update-check.json", "persist update cache", async (safePath) => {
      await writeFile(safePath, "{}", "utf8");
    })).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "home-write",
      operation: "persist update cache",
    });
  });

  it("supports -- terminators and rejects missing or invalid profile values", () => {
    const terminated = parseExecutionPolicyArgs(
      ["--offline", "--", "diagnose", "--allow", "network"],
      { projectRoot: "/workspace" },
    );
    expect(terminated.commandArgs).toEqual(["--", "diagnose", "--allow", "network"]);
    expect(terminated.policy.profile).toBe("locked");

    expect(() => parseExecutionPolicyArgs(["--profile"], { projectRoot: "/workspace" })).toThrow("Invalid profile");
    expect(() => parseExecutionPolicyArgs(["--profile", "online"], { projectRoot: "/workspace" })).toThrow("Invalid profile");
    expect(() => parseExecutionPolicyArgs(["--allow"], { projectRoot: "/workspace" })).toThrow("Invalid capability");
  });
});
