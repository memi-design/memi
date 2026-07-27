// @ts-nocheck
import { describe, expect, it, vi } from "vitest";

import { runPublicReleaseGate } from "../../../scripts/lib/public-release-gate.mjs";

const baseOptions = {
  packageName: "@memi-design/cli",
  expectedVersion: "2.6.2",
  expectedPhrase: "read-only design engineering audit and skill layer for coding agents",
  expectedInstall: "npm i -g @memi-design/cli",
  expectedSiteUrl: "https://www.memoire.cv",
  expectedStudioVersion: "2.5.0",
  expectedCommunityNotes: 5,
  minCommunityCatalogDate: "2026-07-04T00:00:00.000Z",
  skipInstall: false,
  skipSite: false,
  registryUrl: "https://registry.npmjs.org/%40memi-design%2Fcli",
};

const registryMetadata = {
  "dist-tags": { latest: "2.6.2" },
  readme: [
    "Memi is the read-only design engineering audit and skill layer for coding agents.",
    "npm i -g @memi-design/cli",
  ].join("\n"),
  versions: {
    "2.6.2": {
      readme: [
        "Memi is the read-only design engineering audit and skill layer for coding agents.",
        "npm i -g @memi-design/cli",
      ].join("\n"),
    },
  },
};

describe("public release gate helper", () => {
  it("records install smoke even when earlier site parity checks fail", async () => {
    const runInstallSmoke = vi.fn(async () => ({ ok: true, version: "2.6.2" }));

    const result = await runPublicReleaseGate(baseOptions, {
      fetchJson: vi.fn(async () => registryMetadata),
      runSiteSmoke: vi.fn(async () => ({
        ok: false,
        failures: ["docs missing CLI version 2.6.2"],
      })),
      runInstallSmoke,
    });

    expect(runInstallSmoke).toHaveBeenCalledOnce();
    expect(result.installSmoke).toEqual({ ok: true, version: "2.6.2" });
    expect(result.failures).toContain("docs missing CLI version 2.6.2");
    expect(result.status).toBe("failed");
  });

  it("skips install smoke only when explicitly requested", async () => {
    const runInstallSmoke = vi.fn(async () => ({ ok: true, version: "2.6.2" }));

    const result = await runPublicReleaseGate({
      ...baseOptions,
      skipInstall: true,
    }, {
      fetchJson: vi.fn(async () => registryMetadata),
      runSiteSmoke: vi.fn(async () => ({ ok: true, failures: [] })),
      runInstallSmoke,
    });

    expect(runInstallSmoke).not.toHaveBeenCalled();
    expect(result.installSmoke).toBeNull();
    expect(result.status).toBe("passed");
  });

  it("surfaces install smoke failures alongside earlier surface failures", async () => {
    const result = await runPublicReleaseGate(baseOptions, {
      fetchJson: vi.fn(async () => registryMetadata),
      runSiteSmoke: vi.fn(async () => ({
        ok: false,
        failures: ["homepage missing Studio version 2.5.0"],
      })),
      runInstallSmoke: vi.fn(async () => ({
        ok: false,
        error: "install smoke failed: memi binary missing",
      })),
    });

    expect(result.failures).toEqual([
      "homepage missing Studio version 2.5.0",
      "install smoke failed: memi binary missing",
    ]);
    expect(result.status).toBe("failed");
  });

  it("records registry and site exceptions without hiding install evidence", async () => {
    const runInstallSmoke = vi.fn(async () => ({ ok: true, version: "2.6.2" }));

    const result = await runPublicReleaseGate(baseOptions, {
      fetchJson: vi.fn(async () => {
        throw new Error("registry unavailable");
      }),
      runSiteSmoke: vi.fn(async () => {
        throw new Error("site unavailable");
      }),
      runInstallSmoke,
    });

    expect(runInstallSmoke).toHaveBeenCalledOnce();
    expect(result.latest).toBeNull();
    expect(result.registrySmoke).toMatchObject({
      ok: false,
      error: "registry unavailable",
    });
    expect(result.siteSmoke).toMatchObject({
      ok: false,
      error: "site unavailable",
    });
    expect(result.installSmoke).toEqual({ ok: true, version: "2.6.2" });
    expect(result.failures).toEqual([
      "npm registry check failed: registry unavailable",
      "site smoke failed: site unavailable",
    ]);
  });

  it("turns a thrown install error into explicit aggregate evidence", async () => {
    const result = await runPublicReleaseGate(baseOptions, {
      fetchJson: vi.fn(async () => registryMetadata),
      runSiteSmoke: vi.fn(async () => ({ ok: true, failures: [] })),
      runInstallSmoke: vi.fn(async () => {
        throw new Error("temporary directory unavailable");
      }),
    });

    expect(result.installSmoke).toMatchObject({
      ok: false,
      error: "temporary directory unavailable",
    });
    expect(result.failures).toContain(
      "install smoke failed: temporary directory unavailable",
    );
    expect(result.status).toBe("failed");
  });
});
