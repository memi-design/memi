import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ensureBridgeCapability } from "../bridge-capability.js";
import { createExecutionPolicy } from "../execution-policy.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("home-write call-site mediation", () => {
  it("rejects a symlinked ~/.memoire root before creating a bridge capability outside home", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-bridge-project-"));
    const homeDir = await mkdtemp(join(tmpdir(), "memi-bridge-home-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "memi-bridge-outside-"));
    cleanup.push(projectRoot, homeDir, outsideRoot);
    await symlink(outsideRoot, join(homeDir, ".memoire"), "dir");
    const policy = createExecutionPolicy({
      projectRoot,
      homeDir,
      profile: "connected",
      allow: ["home-write"],
    });

    await expect(ensureBridgeCapability(homeDir, policy)).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "home-write",
      operation: "persist the Figma bridge capability",
    });
    expect(await readdir(outsideRoot)).toEqual([]);
  });

  it("denies bridge capability creation when HOME has no declared boundary", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memi-bridge-no-home-project-"));
    cleanup.push(projectRoot);
    const policy = createExecutionPolicy({
      projectRoot,
      profile: "connected",
      allow: ["home-write"],
    });

    await expect(ensureBridgeCapability(undefined, policy)).rejects.toMatchObject({
      code: "MEMI_CAPABILITY_DENIED",
      capability: "home-write",
      operation: "persist the Figma bridge capability",
    });
  });
});
