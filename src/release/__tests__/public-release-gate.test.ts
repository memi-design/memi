// @ts-nocheck
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  fetchJsonWithRetry,
  runPublicReleaseGate,
  verifyWebsiteArtifactEvidence,
} from "../../../scripts/lib/public-release-gate.mjs";

const root = join(import.meta.dirname, "..", "..", "..");

const baseOptions = {
  packageName: "@memi-design/cli",
  expectedVersion: "2.6.2",
  expectedPhrase: "the design layer for agentic AI",
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
    "Memi is the design layer for agentic AI.",
    "npm i -g @memi-design/cli",
  ].join("\n"),
  versions: {
    "2.6.2": {
      readme: [
        "Memi is the design layer for agentic AI.",
        "npm i -g @memi-design/cli",
      ].join("\n"),
    },
  },
};

describe("public release gate helper", () => {
  it("retries transient registry failures without weakening permanent HTTP failures", async () => {
    const transientFetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ version: "2.7.9" }) });

    await expect(fetchJsonWithRetry("https://registry.example.test/latest", {
      fetchImpl: transientFetch,
      retryDelayMs: 0,
    })).resolves.toEqual({ version: "2.7.9" });
    expect(transientFetch).toHaveBeenCalledTimes(3);

    const permanentFetch = vi.fn(async () => ({ ok: false, status: 404 }));
    await expect(fetchJsonWithRetry("https://registry.example.test/missing", {
      fetchImpl: permanentFetch,
      retryDelayMs: 0,
    })).rejects.toThrow("404");
    expect(permanentFetch).toHaveBeenCalledOnce();
  });

  it("verifies exact historical manifest bytes and fails closed on drift or fetch failure", async () => {
    const manifestText = await readFile(join(root, "release-manifest.json"), "utf8");
    const manifest = JSON.parse(manifestText);
    const artifact = JSON.parse(
      await readFile(join(root, "release-artifacts", "memoire-web.release.json"), "utf8"),
    );
    const options = { manifest, url: manifest.surfaces.website.releaseArtifactUrl };
    const fetchJson = vi.fn(async () => artifact);

    await expect(verifyWebsiteArtifactEvidence(options, {
      fetchJson,
      fetchText: vi.fn(async () => manifestText),
    })).resolves.toMatchObject({
      verified: true,
      sourceCommit: artifact.provenance.sourceCommit,
      sourceUrl: artifact.provenance.sourceUrl,
    });

    await expect(verifyWebsiteArtifactEvidence(options, {
      fetchJson,
      fetchText: vi.fn(async () => `${manifestText} `),
    })).rejects.toThrow("does not contain the canonical manifest bytes");

    await expect(verifyWebsiteArtifactEvidence(options, {
      fetchJson,
      fetchText: vi.fn(async () => {
        throw new Error("provenance source unavailable");
      }),
    })).rejects.toThrow("provenance source unavailable");
  });

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

  it("marks an explicitly skipped required stage as diagnostic, never passed", async () => {
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
    expect(result.status).toBe("diagnostic");
    expect(result.failures).toContain("required install smoke was skipped");
  });

  it("marks a skipped site stage as diagnostic, never passed", async () => {
    const result = await runPublicReleaseGate({
      ...baseOptions,
      skipSite: true,
    }, {
      fetchJson: vi.fn(async () => registryMetadata),
      runSiteSmoke: vi.fn(async () => ({ ok: true, failures: [] })),
      runInstallSmoke: vi.fn(async () => ({ ok: true, version: "2.6.2" })),
    });

    expect(result.siteSmoke).toBeNull();
    expect(result.status).toBe("diagnostic");
    expect(result.failures).toContain("required site smoke was skipped");
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

  it("fails closed when a stage returns a malformed result", async () => {
    const result = await runPublicReleaseGate(baseOptions, {
      fetchJson: vi.fn(async () => registryMetadata),
      runSiteSmoke: vi.fn(async () => undefined),
      runInstallSmoke: vi.fn(async () => undefined),
    });

    expect(result.siteSmoke).toMatchObject({
      ok: false,
      error: "site smoke returned an invalid result",
    });
    expect(result.installSmoke).toMatchObject({
      ok: false,
      error: "install smoke returned an invalid result",
    });
    expect(result.failures).toEqual([
      "site smoke failed: site smoke returned an invalid result",
      "install smoke failed: install smoke returned an invalid result",
    ]);
    expect(result.status).toBe("failed");
  });
});
