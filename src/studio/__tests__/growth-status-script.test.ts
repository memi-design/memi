// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
  actualDownloadPointUrl,
  actualDownloadRangeUrl,
  buildWeeklyNpmDownloadGoal,
  buildGrowthStatus,
  collectStaleReferenceMetrics,
  parseHomebrewStudioCask,
  parseSkillsShPage,
  summarizeDownloadRange,
  WEEKLY_NPM_DOWNLOAD_TARGET,
} from "../../../scripts/lib/growth-status.mjs";

describe("growth status script contract", () => {
  const staleRepoName = ["m-", "moire"].join("");
  const stalePackageName = ["@sarveshsea", "/memoire"].join("");
  const staleForkName = ["Miro", "Fish"].join("");

  it("tracks downloads for the real public npm package, not the legacy alias", () => {
    expect(actualDownloadPointUrl("@memi-design/cli", "last-week")).toBe("https://api.npmjs.org/downloads/point/last-week/%40memi-design%2Fcli");
    expect(actualDownloadPointUrl(stalePackageName, "last-week")).toBe("https://api.npmjs.org/downloads/point/last-week/%40sarveshsea%2Fmemoire");
    expect(actualDownloadRangeUrl("@memi-design/cli", "last-month")).toBe("https://api.npmjs.org/downloads/range/last-month/%40memi-design%2Fcli");
  });

  it("separates a real decline from a release spike rolling out of the window", () => {
    const downloads = [
      20, 18, 22, 25, 21, 24, 22,
      200, 180, 220, 210, 190, 205, 195,
      42, 48, 45, 50, 46, 43, 44,
    ].map((count, index) => ({ day: `2026-07-${String(index + 1).padStart(2, "0")}`, downloads: count }));

    expect(summarizeDownloadRange({ downloads })).toMatchObject({
      latest7: 318,
      previous7: 1_400,
      prior7: 152,
      classification: "normalizing_after_spike",
      latestVsPrevious: -0.7728571428571429,
      latestVsPrior: 1.0921052631578947,
      peakDay: { day: "2026-07-10", downloads: 220 },
    });
  });

  it("classifies sustained week-over-week losses as declining", () => {
    const downloads = [30, 31, 29, 32, 30, 31, 30, 20, 19, 18, 20, 19, 18, 20, 10, 11, 9, 10, 8, 9, 10]
      .map((count, index) => ({ day: `2026-07-${String(index + 1).padStart(2, "0")}`, downloads: count }));

    expect(summarizeDownloadRange({ downloads })).toMatchObject({
      latest7: 67,
      previous7: 134,
      prior7: 213,
      classification: "declining",
    });
  });

  it("does not call a partial recovery growing while it remains below the prior baseline", () => {
    const downloads = [
      ...Array(7).fill(100),
      ...Array(7).fill(70),
      ...Array(7).fill(90),
    ].map((count, index) => ({ day: `2026-07-${String(index + 1).padStart(2, "0")}`, downloads: count }));

    expect(summarizeDownloadRange({ downloads })).toMatchObject({
      latest7: 630,
      previous7: 490,
      prior7: 700,
      latestVsPrevious: 0.2857142857142857,
      latestVsPrior: -0.1,
      classification: "stable",
    });
  });

  it("surfaces an npm range API failure instead of calling it insufficient data", () => {
    expect(summarizeDownloadRange({
      ok: false,
      status: 503,
      error: "Service unavailable",
      url: "https://api.npmjs.org/downloads/range/last-month/%40memi-design%2Fcli",
    })).toEqual({
      ok: false,
      classification: "unavailable",
      days: 0,
      status: 503,
      error: "Service unavailable",
    });
  });

  it("parses the Studio Homebrew cask version and release URLs", () => {
    const cask = parseHomebrewStudioCask(`
      cask "memi-studio" do
        version "1.0.0"
        url "https://github.com/memi-design/memi-studio/releases/download/v#{version}/Memoire.Studio_#{version}_aarch64.dmg"
      end
    `);

    expect(cask).toEqual({
      name: "memi-studio",
      version: "1.0.0",
      releaseUrls: ["https://github.com/memi-design/memi-studio/releases/download/v#{version}/Memoire.Studio_#{version}_aarch64.dmg"],
    });
  });

  it("parses skills.sh discovery and install counts", () => {
    const page = `
      <meta name="description" content="4 agent skills from memi-design/memi — including audit-frontend-design.">
      <span>27<!-- --> total installs</span>
    `;

    expect(parseSkillsShPage(page)).toEqual({
      ok: true,
      url: "https://skills.sh/memi-design/memi",
      discoveredSkills: 4,
      totalInstalls: 27,
    });
  });

  it("reports actual package, Studio release, Homebrew, and stale aliases separately", async () => {
    const calls: string[] = [];
    const status = await buildGrowthStatus({
      packageJson: {
        name: "@memi-design/cli",
        version: "1.0.1",
        mcpName: "io.github.sarveshsea/memi",
      },
      now: () => new Date("2026-05-13T00:00:00.000Z"),
      fetchJson: async (url: string) => {
        calls.push(url);
        if (url.includes("registry.npmjs.org")) {
          return { "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { mcpName: "io.github.sarveshsea/memi" } } };
        }
        if (url.includes("downloads/point/last-week/%40memi-design%2Fcli")) return { downloads: 128, start: "2026-05-05", end: "2026-05-11" };
        if (url.includes("downloads/point/last-month/%40memi-design%2Fcli")) return { downloads: 256, start: "2026-04-12", end: "2026-05-11" };
        if (url.includes("downloads/point/last-week/%40sarveshsea%2Fmemoire")) return { downloads: 979, start: "2026-05-05", end: "2026-05-11" };
        if (url.includes("downloads/point/last-month/%40sarveshsea%2Fmemoire")) return { downloads: 2232, start: "2026-04-12", end: "2026-05-11" };
        if (url.includes("repos/memi-design/memi-studio/releases/latest")) {
          return {
            tag_name: "v1.0.0",
            published_at: "2026-05-10T20:58:22Z",
            assets: [{ name: "Memoire.Studio_1.0.0_aarch64.dmg", download_count: 3 }],
          };
        }
        if (url.includes("repos/memi-design/memi")) return { stargazers_count: 10, forks_count: 2, open_issues_count: 2, html_url: "https://github.com/memi-design/memi", topics: [] };
        if (url.includes("registry.modelcontextprotocol.io")) return { servers: [], metadata: { count: 0 } };
        if (url.includes("/pulls/")) return { state: "open", number: 1, title: "PR", html_url: url, updated_at: "2026-05-13T00:00:00Z" };
        return {};
      },
      fetchText: async () => `cask "memi-studio" do\n  version "1.0.0"\nend\n`,
      directoryPullRequests: [],
      staleReferenceSources: {
        "README.md": `${staleRepoName} ${stalePackageName} ${staleForkName}`,
        "docs/README.md": "clean",
      },
    });

    expect(calls).toContain("https://api.npmjs.org/downloads/point/last-week/%40memi-design%2Fcli");
    expect(status.downloads.actualPackage.weekly.downloads).toBe(128);
    expect(status.growth.weeklyNpmDownloads).toMatchObject({
      target: 7_830,
      current: 128,
      gap: 7_702,
      achieved: false,
    });
    expect(status.growth.adoptionTargets).toEqual({
      telemetryRequired: false,
      evidenceMode: "privacy_safe_verified_aggregate",
      externalIntegrations: {
        target: 10,
        unit: "integrations",
      },
      successfulFirstAudits: {
        target: 100,
        unit: "audits",
      },
      repeatAudits: {
        target: 25,
        unit: "repeat_audits",
      },
      sustainedNonReleaseBaselineGrowth: {
        target: 0.25,
        unit: "ratio",
        releasePeriodsExcluded: true,
      },
    });
    expect(status.downloads.legacyAliases[0].weekly.downloads).toBe(979);
    expect(status.studio.latestRelease).toMatchObject({ tag: "v1.0.0", totalDownloads: 3 });
    expect(status.homebrewStudioCask).toMatchObject({ version: "1.0.0" });
    expect(status.staleReferences.total).toBe(3);
  });

  it("does not recommend publishing an older local package over a newer npm latest", async () => {
    const status = await buildGrowthStatus({
      packageJson: {
        name: "@memi-design/cli",
        version: "1.0.2",
        mcpName: "io.github.sarveshsea/memi",
      },
      now: () => new Date("2026-06-07T00:00:00.000Z"),
      fetchJson: async (url: string) => {
        if (url.includes("registry.npmjs.org")) {
          return { "dist-tags": { latest: "1.1.0" }, versions: { "1.1.0": { mcpName: "io.github.sarveshsea/memi" } } };
        }
        if (url.includes("downloads/point/")) return { downloads: 188, start: "2026-05-27", end: "2026-06-02" };
        if (url.includes("repos/memi-design/memi-studio/releases/latest")) {
          return { tag_name: "v1.0.3", published_at: "2026-05-27T19:26:42Z", assets: [] };
        }
        if (url.includes("repos/memi-design/memi")) return { stargazers_count: 16, forks_count: 3, open_issues_count: 1, html_url: "https://github.com/memi-design/memi", topics: [] };
        if (url.includes("registry.modelcontextprotocol.io")) return { servers: [{ name: "io.github.sarveshsea/memi" }], metadata: { count: 1 } };
        if (url.includes("/pulls/")) return { state: "closed", number: 2, title: "SafeSkill", html_url: url, updated_at: "2026-06-07T00:00:00Z" };
        return {};
      },
      fetchText: async () => `cask "memi-studio" do\n  version "1.0.3"\nend\n`,
      directoryPullRequests: [],
      staleReferenceSources: {},
    });

    expect(status.nextActions).toContain("Sync local package metadata from 1.0.2 to npm latest 1.1.0 before publishing or tagging.");
    expect(status.nextActions).not.toContain("Publish 1.0.2 to npm; npm latest is 1.1.0.");
  });

  it("detects the current wrapped MCP Registry search response shape", async () => {
    const status = await buildGrowthStatus({
      packageJson: {
        name: "@memi-design/cli",
        version: "1.1.0",
        mcpName: "io.github.sarveshsea/memi",
      },
      now: () => new Date("2026-06-07T00:00:00.000Z"),
      fetchJson: async (url: string) => {
        if (url.includes("registry.npmjs.org")) {
          return { "dist-tags": { latest: "1.1.0" }, versions: { "1.1.0": { mcpName: "io.github.sarveshsea/memi" } } };
        }
        if (url.includes("downloads/point/")) return { downloads: 188, start: "2026-05-27", end: "2026-06-02" };
        if (url.includes("repos/memi-design/memi-studio/releases/latest")) {
          return { tag_name: "v1.0.3", published_at: "2026-05-27T19:26:42Z", assets: [] };
        }
        if (url.includes("repos/memi-design/memi")) return { stargazers_count: 16, forks_count: 3, open_issues_count: 1, html_url: "https://github.com/memi-design/memi", topics: [] };
        if (url.includes("registry.modelcontextprotocol.io")) {
          return {
            servers: [
              {
                server: { name: "io.github.sarveshsea/memi", version: "1.1.0" },
                _meta: {
                  "io.modelcontextprotocol.registry/official": {
                    status: "active",
                    isLatest: true,
                  },
                },
              },
            ],
            metadata: { count: 1 },
          };
        }
        if (url.includes("/pulls/")) return { state: "closed", number: 2, title: "SafeSkill", html_url: url, updated_at: "2026-06-07T00:00:00Z" };
        return {};
      },
      fetchText: async () => `cask "memi-studio" do\n  version "1.0.3"\nend\n`,
      directoryPullRequests: [],
      staleReferenceSources: {},
    });

    expect(status.officialMcpRegistry).toMatchObject({
      listed: true,
      count: 1,
      latestVersion: "1.1.0",
    });
    expect(status.nextActions).not.toContain("Publish server.json to the Official MCP Registry after npm is current.");
  });

  it("counts stale package and repo references without mixing them into downloads", () => {
    expect(collectStaleReferenceMetrics({
      "README.md": `${staleRepoName} ${stalePackageName} ${staleForkName}`,
      "docs/ok.md": "memi-studio",
    })).toEqual({
      total: 3,
      byPattern: {
        [staleRepoName]: 1,
        [stalePackageName]: 1,
        [staleForkName]: 1,
      },
      byFile: {
        "README.md": 3,
      },
    });
  });

  it("computes the weekly npm download gap without hiding zero-download launches", () => {
    expect(WEEKLY_NPM_DOWNLOAD_TARGET).toBe(7_830);
    expect(buildWeeklyNpmDownloadGoal({ ok: true, downloads: 0, start: "2026-05-05", end: "2026-05-11" })).toEqual({
      target: 7_830,
      current: 0,
      gap: 7_830,
      achieved: false,
      percentToTarget: 0,
      multipleToTarget: null,
      start: "2026-05-05",
      end: "2026-05-11",
    });
  });
});
