import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareSemver,
  isNewer,
  getInstallChannel,
  formatUpdateFailureGuidance,
  readUpdateCache,
  resolveUpdateSubcommand,
  updateCachePath,
  writeUpdateCache,
} from "../../utils/update-check.js";
import { createExecutionPolicy } from "../../security/execution-policy.js";

describe("compareSemver", () => {
  it("orders core versions numerically", () => {
    expect(compareSemver("1.0.3", "1.0.2")).toBe(1);
    expect(compareSemver("1.0.2", "1.0.3")).toBe(-1);
    expect(compareSemver("1.0.2", "1.0.2")).toBe(0);
    expect(compareSemver("1.2.0", "1.10.0")).toBe(-1); // numeric, not lexical
    expect(compareSemver("2.0.0", "1.99.99")).toBe(1);
  });

  it("tolerates a leading v and build metadata", () => {
    expect(compareSemver("v1.1.0", "1.0.9")).toBe(1);
    expect(compareSemver("1.0.0+build.5", "1.0.0+build.1")).toBe(0);
  });

  it("ranks a release above a prerelease of the same core", () => {
    expect(compareSemver("2.0.0", "2.0.0-rc.1")).toBe(1);
    expect(compareSemver("2.0.0-rc.1", "2.0.0")).toBe(-1);
    expect(compareSemver("2.0.0-rc.2", "2.0.0-rc.1")).toBe(1);
    expect(compareSemver("2.0.0-rc.1", "2.0.0-rc.1")).toBe(0);
  });
});

describe("isNewer", () => {
  it("is true only when latest strictly exceeds current", () => {
    expect(isNewer("1.0.3", "1.0.2")).toBe(true);
    expect(isNewer("1.0.2", "1.0.2")).toBe(false);
    expect(isNewer("1.0.1", "1.0.2")).toBe(false);
    expect(isNewer("2.0.0", "2.0.0-rc.1")).toBe(true);
  });
});

describe("getInstallChannel", () => {
  it("reports npm when running under node (test runner)", () => {
    expect(getInstallChannel()).toBe("npm");
  });
});

describe("update notification routing", () => {
  it("finds self-update after repeatable root policy options", () => {
    expect(resolveUpdateSubcommand([
      "/usr/bin/node",
      "/opt/memi/dist/index.js",
      "--profile",
      "connected",
      "--allow",
      "network",
      "--allow=shell",
      "self-update",
      "--check",
    ])).toBe("self-update");
  });

  it("finds upgrade after offline and receipt options", () => {
    expect(resolveUpdateSubcommand([
      "memi",
      "--offline",
      "--receipt",
      ".memi/upgrade.json",
      "upgrade",
      "--check",
    ])).toBe("upgrade");
  });

  it("supports equals-style global options without treating their values as commands", () => {
    expect(resolveUpdateSubcommand([
      "node",
      "index.js",
      "--profile=connected",
      "--allow=network",
      "--receipt=.memi/update.json",
      "self-update",
    ])).toBe("self-update");
  });

  it("pins failure guidance to the already-resolved version", () => {
    expect(formatUpdateFailureGuidance("2.8.0-beta.1")).toBe(
      "npm i -g @memi-design/cli@2.8.0-beta.1",
    );
    expect(formatUpdateFailureGuidance("2.8.0-beta.1")).not.toContain("@latest");
  });
});

describe("update cache", () => {
  let dir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "memi-update-test-"));
    prevHome = process.env.HOME;
    process.env.HOME = dir;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves the cache path under $HOME/.memoire", () => {
    expect(updateCachePath()).toBe(join(dir, ".memoire", "update-check.json"));
  });

  it("round-trips a cache entry", async () => {
    const entry = { lastCheckAt: "2026-06-06T00:00:00.000Z", latestVersion: "1.2.3", channel: "npm" as const };
    const policy = createExecutionPolicy({
      projectRoot: dir,
      homeDir: dir,
      profile: "connected",
      allow: ["home-write"],
    });
    await writeUpdateCache(entry, policy);
    expect(readUpdateCache(policy)).toEqual(entry);
    // and it is valid JSON on disk
    const raw = JSON.parse(readFileSync(updateCachePath(), "utf-8"));
    expect(raw.latestVersion).toBe("1.2.3");
  });

  it("returns null when no cache exists", () => {
    expect(readUpdateCache()).toBeNull();
  });

  it("does not follow a symlinked ~/.memoire root when persisting the cache", async () => {
    const outside = mkdtempSync(join(tmpdir(), "memi-update-outside-"));
    rmSync(join(dir, ".memoire"), { recursive: true, force: true });
    symlinkSync(outside, join(dir, ".memoire"), "dir");
    const policy = createExecutionPolicy({
      projectRoot: dir,
      homeDir: dir,
      profile: "connected",
      allow: ["home-write"],
    });
    const outsideCache = join(outside, "update-check.json");

    await writeUpdateCache(
      { lastCheckAt: "2026-08-31T00:00:00.000Z", latestVersion: "2.8.0-beta.1", channel: "npm" },
      policy,
    );

    expect(existsSync(outsideCache)).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });

  it("has no /tmp write fallback when HOME and USERPROFILE are missing", async () => {
    const previousUserProfile = process.env.USERPROFILE;
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    const policy = createExecutionPolicy({
      projectRoot: dir,
      profile: "connected",
      allow: ["home-write"],
    });

    expect(() => updateCachePath(policy)).toThrow("HOME/USERPROFILE");
    await writeUpdateCache(
      { lastCheckAt: "2026-08-31T00:00:00.000Z", latestVersion: null, channel: "npm" },
      policy,
    );

    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
  });
});

describe("CLI registration", () => {
  it("wires self-update into the entrypoint", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(process.cwd(), "src", "index.ts"), "utf-8");
    expect(source).toContain("registerSelfUpdateCommand");
    expect(source).toContain("registerSelfUpdateCommand(program, engine);");
    expect(source).toContain("maybeNotifyUpdate");
  });
});
