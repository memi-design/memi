import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MEMI_CAPABILITIES,
  MemiCapabilityDeniedError,
  createExecutionPolicy,
  parseExecutionPolicyArgs,
} from "../execution-policy.js";

const cleanup: string[] = [];

afterEach(async () => {
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

  it("requires every connected capability to be explicitly granted for the invocation", () => {
    const policy = createExecutionPolicy({
      projectRoot: "/workspace",
      profile: "connected",
      allow: ["network", "figma"],
    });

    expect(policy.allows("network")).toBe(true);
    expect(policy.allows("figma")).toBe(true);
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
      "--json",
    ], { projectRoot: "/workspace" });

    expect(parsed.policy.profile).toBe("connected");
    expect(parsed.policy.effectiveCapabilities).toEqual(["network", "project-write"]);
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
});
