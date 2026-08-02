import { readFile } from "node:fs/promises";
import { join } from "node:path";

const LEGACY_REPO_NAME = ["m-", "moire"].join("");
const LEGACY_PACKAGE_NAME = ["@sarveshsea", "/memoire"].join("");
const LEGACY_FORK_NAME = ["Miro", "Fish"].join("");
export const LEGACY_PACKAGE_ALIASES = [LEGACY_PACKAGE_NAME];
export const STUDIO_REPO = "memi-design/memi-studio";
export const ENGINE_REPO = "memi-design/memi";
export const SKILLS_SH_URL = "https://skills.sh/memi-design/memi";
export const HOMEBREW_STUDIO_CASK_URL = "https://raw.githubusercontent.com/memi-design/homebrew-memi/main/Casks/memi-studio.rb";
export const DEFAULT_STALE_REFERENCE_PATTERNS = [LEGACY_REPO_NAME, LEGACY_PACKAGE_NAME, LEGACY_FORK_NAME];
export const WEEKLY_NPM_DOWNLOAD_TARGET = 7_830;

export const DEFAULT_DIRECTORY_PULL_REQUESTS = [
  ["punkpeye/awesome-mcp-servers", 4373],
  ["TensorBlock/awesome-mcp-servers", 455],
  ["YuzeHao2023/Awesome-MCP-Servers", 208],
  ["MobinX/awesome-mcp-list", 241],
  ["toolsdk-ai/toolsdk-mcp-registry", 296],
  ["bytefer/awesome-shadcn-ui", 18],
  ["birobirobiro/awesome-shadcn-ui", 493],
];

export function actualDownloadPointUrl(packageName, period) {
  return `https://api.npmjs.org/downloads/point/${period}/${encodeURIComponent(packageName).replace(/^%40/, "%40")}`;
}

export function actualDownloadRangeUrl(packageName, period) {
  return `https://api.npmjs.org/downloads/range/${period}/${encodeURIComponent(packageName).replace(/^%40/, "%40")}`;
}

export async function buildGrowthStatus(options = {}) {
  const packageJson = options.packageJson;
  if (!packageJson?.name || !packageJson?.version) {
    throw new Error("buildGrowthStatus requires packageJson.name and packageJson.version");
  }

  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const fetchText = options.fetchText ?? defaultFetchText;
  const now = options.now ?? (() => new Date());
  const directoryPullRequests = options.directoryPullRequests ?? DEFAULT_DIRECTORY_PULL_REQUESTS;

  const [
    npmMetadata,
    weeklyDownloads,
    monthlyDownloads,
    downloadRange,
    githubRepo,
    skillsShPage,
    registrySearch,
    safeSkillPr,
    directoryStatuses,
    studioLatestRelease,
    homebrewCaskRaw,
    legacyAliasDownloads,
    staleReferenceSources,
  ] = await Promise.all([
    fetchJson(`https://registry.npmjs.org/${encodeURIComponent(packageJson.name).replace(/^%40/, "%40")}`),
    fetchJson(actualDownloadPointUrl(packageJson.name, "last-week")),
    fetchJson(actualDownloadPointUrl(packageJson.name, "last-month")),
    fetchJson(actualDownloadRangeUrl(packageJson.name, "last-month")),
    fetchJson(`https://api.github.com/repos/${ENGINE_REPO}`),
    fetchText(SKILLS_SH_URL),
    fetchJson(`https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(packageJson.mcpName ?? packageJson.name)}`),
    fetchJson(`https://api.github.com/repos/${ENGINE_REPO}/pulls/2`),
    Promise.all(directoryPullRequests.map(async ([repo, number]) => {
      const pull = await fetchJson(`https://api.github.com/repos/${repo}/pulls/${number}`);
      return {
        repo,
        number,
        url: `https://github.com/${repo}/pull/${number}`,
        state: summarizePullState(pull),
        title: pull.ok === false ? null : pull.title,
        updatedAt: pull.ok === false ? null : pull.updated_at,
      };
    })),
    fetchJson(`https://api.github.com/repos/${STUDIO_REPO}/releases/latest`),
    fetchText(HOMEBREW_STUDIO_CASK_URL),
    Promise.all(LEGACY_PACKAGE_ALIASES.map(async (name) => ({
      name,
      weekly: normalizeDownloadPoint(await fetchJson(actualDownloadPointUrl(name, "last-week"))),
      monthly: normalizeDownloadPoint(await fetchJson(actualDownloadPointUrl(name, "last-month"))),
    }))),
    options.staleReferenceSources ?? loadDefaultStaleReferenceSources(options.root),
  ]);

  const actualPackageDownloads = {
    name: packageJson.name,
    weekly: normalizeDownloadPoint(weeklyDownloads),
    monthly: normalizeDownloadPoint(monthlyDownloads),
  };
  const npm = normalizeNpmMetadata(npmMetadata, packageJson.name);
  const officialMcpRegistry = normalizeRegistry(registrySearch, packageJson.mcpName);
  const safeSkill = normalizeSafeSkillPr(safeSkillPr);
  const github = normalizeRepo(githubRepo);
  const skillsSh = parseSkillsShPage(skillsShPage);
  const studio = normalizeStudioRelease(studioLatestRelease);
  const homebrewStudioCask = parseHomebrewStudioCask(homebrewCaskRaw);
  const staleReferences = collectStaleReferenceMetrics(staleReferenceSources);
  const weeklyNpmDownloads = buildWeeklyNpmDownloadGoal(
    actualPackageDownloads.weekly,
    options.weeklyNpmDownloadTarget ?? WEEKLY_NPM_DOWNLOAD_TARGET,
  );
  const downloadTrend = summarizeDownloadRange(downloadRange);
  const adoptionTargets = buildAdoptionTargets();

  return {
    generatedAt: now().toISOString(),
    package: {
      name: packageJson.name,
      localVersion: packageJson.version,
      mcpName: packageJson.mcpName,
    },
    npm,
    downloads: {
      weekly: actualPackageDownloads.weekly,
      monthly: actualPackageDownloads.monthly,
      actualPackage: actualPackageDownloads,
      trend: downloadTrend,
      legacyAliases: legacyAliasDownloads,
    },
    growth: {
      weeklyNpmDownloads,
      downloadTrend,
      adoptionTargets,
    },
    github,
    skillsSh,
    studio,
    homebrewStudioCask,
    officialMcpRegistry,
    safeSkill,
    directoryPullRequests: directoryStatuses,
    staleReferences,
    nextActions: buildNextActions({
      packageJson,
      npm,
      officialMcpRegistry,
      safeSkill,
      github,
      skillsSh,
      staleReferences,
      homebrewStudioCask,
      studio,
      weeklyNpmDownloads,
      downloadTrend,
    }),
  };
}

export function printHuman(status) {
  console.log(`Memoire Growth Status (${status.generatedAt})`);
  console.log("");
  console.log(`Package: ${status.package.name}@${status.package.localVersion}`);
  console.log(`npm: ${status.npm.ok ? `${status.npm.latest} · ${status.npm.mcpName ?? "no mcpName"}` : `error: ${status.npm.error}`}`);
  console.log(`Downloads: ${formatDownloads(status.downloads.actualPackage.weekly, "weekly")} · ${formatDownloads(status.downloads.actualPackage.monthly, "monthly")}`);
  if (status.downloads.trend?.ok) {
    const trend = status.downloads.trend;
    console.log(`Trend: ${formatNumber(trend.latest7)} latest 7d · ${formatNumber(trend.previous7)} previous 7d · ${formatNumber(trend.prior7)} prior 7d · ${trend.classification}`);
  } else if (status.downloads.trend?.classification === "unavailable") {
    console.log(`Trend: unavailable · ${status.downloads.trend.error}`);
  }
  if (status.growth?.weeklyNpmDownloads) {
    const goal = status.growth.weeklyNpmDownloads;
    console.log(`10x weekly target: ${formatNumber(goal.current)} / ${formatNumber(goal.target)} (${formatPercent(goal.percentToTarget)} · ${formatNumber(goal.gap)} gap · ${formatMultiple(goal.multipleToTarget)} to target)`);
  }
  if (status.growth?.adoptionTargets) {
    const targets = status.growth.adoptionTargets;
    console.log(`Verified adoption targets (no telemetry): ${formatNumber(targets.externalIntegrations.target)} external integrations · ${formatNumber(targets.successfulFirstAudits.target)} successful first audits · ${formatNumber(targets.repeatAudits.target)} repeats · +${formatPercent(targets.sustainedNonReleaseBaselineGrowth.target)} sustained non-release baseline`);
  }
  for (const alias of status.downloads.legacyAliases) {
    console.log(`Legacy alias ${alias.name}: ${formatDownloads(alias.weekly, "weekly")} · ${formatDownloads(alias.monthly, "monthly")}`);
  }
  console.log(`GitHub: ${status.github.ok ? `${status.github.stars} stars · ${status.github.forks} forks · ${status.github.openIssues} open issues` : `error: ${status.github.error}`}`);
  console.log(`skills.sh: ${status.skillsSh.ok ? `${status.skillsSh.discoveredSkills} skills · ${status.skillsSh.totalInstalls} total installs` : "not measurable"}`);
  console.log(`Studio release: ${status.studio.ok ? `${status.studio.latestRelease.tag} · ${status.studio.latestRelease.totalDownloads} downloads` : `error: ${status.studio.error}`}`);
  console.log(`Homebrew Studio cask: ${status.homebrewStudioCask.version ?? "unknown"}`);
  console.log(`Official MCP Registry: ${status.officialMcpRegistry.listed ? "listed" : "not listed"} (${status.officialMcpRegistry.count} result${status.officialMcpRegistry.count === 1 ? "" : "s"})`);
  console.log(`SafeSkill PR: ${status.safeSkill.ok ? `#${status.safeSkill.number} ${status.safeSkill.state}${status.safeSkill.score !== null ? ` · ${status.safeSkill.score}/100` : ""}` : `error: ${status.safeSkill.error}`}`);
  console.log(`Stale references: ${status.staleReferences.total}`);
  console.log("");
  console.log("Directory PRs:");
  for (const pull of status.directoryPullRequests) {
    console.log(`- ${pull.repo}#${pull.number}: ${pull.state}${pull.title ? ` · ${pull.title}` : ""}`);
  }
  console.log("");
  console.log("Next:");
  for (const action of status.nextActions) {
    console.log(`- ${action}`);
  }
}

export function parseHomebrewStudioCask(raw) {
  const name = raw.match(/cask\s+"([^"]+)"/)?.[1] ?? null;
  const version = raw.match(/version\s+"([^"]+)"/)?.[1] ?? null;
  const releaseUrls = [...raw.matchAll(/url\s+"([^"]+)"/g)].map((match) => match[1]);
  return { name, version, releaseUrls };
}

export function parseSkillsShPage(raw) {
  const discoveredSkills = Number(String(raw).match(/content="(\d+) agent skills? from memi-design\/memi\b/i)?.[1]);
  const totalInstalls = Number(String(raw).match(/>([\d,]+)(?:<!-- -->)?\s*total installs\b/i)?.[1]?.replaceAll(",", ""));
  if (!Number.isFinite(discoveredSkills) || discoveredSkills < 1 || !Number.isFinite(totalInstalls)) {
    return { ok: false, url: SKILLS_SH_URL, discoveredSkills: 0, totalInstalls: 0 };
  }
  return { ok: true, url: SKILLS_SH_URL, discoveredSkills, totalInstalls };
}

export function collectStaleReferenceMetrics(sources = {}) {
  const byPattern = Object.fromEntries(DEFAULT_STALE_REFERENCE_PATTERNS.map((pattern) => [pattern, 0]));
  const byFile = {};
  let total = 0;

  for (const [file, content] of Object.entries(sources)) {
    let fileTotal = 0;
    for (const pattern of DEFAULT_STALE_REFERENCE_PATTERNS) {
      const count = countOccurrences(String(content), pattern);
      byPattern[pattern] += count;
      fileTotal += count;
    }
    if (fileTotal > 0) byFile[file] = fileTotal;
    total += fileTotal;
  }

  return { total, byPattern, byFile };
}

export function buildWeeklyNpmDownloadGoal(point, target = WEEKLY_NPM_DOWNLOAD_TARGET) {
  const current = point?.ok ? Number(point.downloads ?? 0) : 0;
  const normalizedTarget = Math.max(0, Number(target) || 0);
  const gap = Math.max(0, normalizedTarget - current);
  return {
    target: normalizedTarget,
    current,
    gap,
    achieved: current >= normalizedTarget,
    percentToTarget: normalizedTarget > 0 ? current / normalizedTarget : null,
    multipleToTarget: current > 0 ? normalizedTarget / current : null,
    start: point?.start ?? null,
    end: point?.end ?? null,
  };
}

export function buildAdoptionTargets() {
  return {
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
  };
}

export function summarizeDownloadRange(range) {
  if (range?.ok === false) {
    return {
      ok: false,
      classification: "unavailable",
      days: 0,
      status: range.status ?? null,
      error: range.error ?? "npm download range request failed",
    };
  }

  const points = Array.isArray(range?.downloads)
    ? range.downloads
      .map((point) => ({ day: point?.day ?? null, downloads: Number(point?.downloads) }))
      .filter((point) => point.day && Number.isFinite(point.downloads) && point.downloads >= 0)
    : [];

  if (points.length < 21) {
    return { ok: false, classification: "insufficient_data", days: points.length };
  }

  const latest7 = sumDownloads(points.slice(-7));
  const previous7 = sumDownloads(points.slice(-14, -7));
  const prior7 = sumDownloads(points.slice(-21, -14));
  const latestVsPrevious = ratioChange(latest7, previous7);
  const latestVsPrior = ratioChange(latest7, prior7);
  const peakDay = points.reduce(
    (peak, point) => point.downloads > peak.downloads ? point : peak,
    points[0],
  );

  let classification = "stable";
  if (latest7 < previous7 * 0.8 && latest7 < prior7 * 0.8) {
    classification = "declining";
  } else if (previous7 > latest7 * 2 && latest7 >= prior7 * 1.25) {
    classification = "normalizing_after_spike";
  } else if (latest7 > previous7 * 1.2 && latest7 >= prior7) {
    classification = "growing";
  }

  return {
    ok: true,
    days: points.length,
    latest7,
    previous7,
    prior7,
    latestVsPrevious,
    latestVsPrior,
    classification,
    peakDay,
  };
}

function sumDownloads(points) {
  return points.reduce((total, point) => total + point.downloads, 0);
}

function ratioChange(current, comparison) {
  if (comparison === 0) return current === 0 ? 0 : null;
  return (current - comparison) / comparison;
}

async function loadDefaultStaleReferenceSources(root) {
  if (!root) return {};
  const candidates = [
    "README.md",
    "docs/README.md",
    "docs/SUBMISSIONS.md",
    "scripts/install.sh",
    "scripts/install.ps1",
    "src/studio/agent-envelope.ts",
    "src/simulation/mirofish-adapter.ts",
  ];
  const entries = await Promise.all(candidates.map(async (file) => {
    try {
      return [file, await readFile(join(root, file), "utf-8")];
    } catch {
      return [file, ""];
    }
  }));
  return Object.fromEntries(entries);
}

async function defaultFetchJson(url) {
  try {
    const headers = {
      "Accept": "application/json",
      "User-Agent": "Memoire-GrowthStatus/1.1",
    };
    if (process.env.GITHUB_TOKEN && url.includes("api.github.com")) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.text();
    const payload = body ? JSON.parse(body) : null;
    if (!response.ok) {
      return { ok: false, status: response.status, error: payload?.message ?? response.statusText, url };
    }
    return payload;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), url };
  }
}

async function defaultFetchText(url) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Memoire-GrowthStatus/1.1" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return "";
    return response.text();
  } catch {
    return "";
  }
}

function normalizeNpmMetadata(metadata, packageName) {
  if (metadata.ok === false) return { ok: false, error: metadata.error };
  const latest = metadata["dist-tags"]?.latest;
  const version = latest ? metadata.versions?.[latest] : null;
  return {
    ok: true,
    latest,
    mcpName: version?.mcpName ?? null,
    description: version?.description ?? metadata.description ?? null,
    npmUrl: `https://www.npmjs.com/package/${packageName}`,
  };
}

function normalizeDownloadPoint(point) {
  if (point.ok === false) return { ok: false, error: point.error };
  return {
    ok: true,
    downloads: Number(point.downloads ?? 0),
    start: point.start ?? null,
    end: point.end ?? null,
  };
}

function normalizeRepo(repo) {
  if (repo.ok === false) return { ok: false, error: repo.error };
  return {
    ok: true,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    description: repo.description,
    topics: repo.topics ?? [],
    url: repo.html_url,
  };
}

function normalizeRegistry(search, serverName) {
  if (search.ok === false) return { ok: false, listed: false, count: 0, error: search.error };
  const servers = Array.isArray(search.servers) ? search.servers : [];
  const serverRecords = servers.map((entry) => entry?.server ?? entry).filter(Boolean);
  return {
    ok: true,
    listed: serverRecords.some((server) => server.name === serverName),
    count: search.metadata?.count ?? servers.length,
    latestVersion: serverRecords.find((server, index) => {
      const meta = servers[index]?._meta?.["io.modelcontextprotocol.registry/official"];
      return server.name === serverName && meta?.isLatest === true;
    })?.version ?? null,
    url: `https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(serverName ?? "")}`,
  };
}

function normalizeSafeSkillPr(pull) {
  if (pull.ok === false) return { ok: false, error: pull.error };
  const scoreMatch = `${pull.title ?? ""}\n${pull.body ?? ""}`.match(/(\d+)\/100/);
  return {
    ok: true,
    number: pull.number,
    state: summarizePullState(pull),
    title: pull.title,
    score: scoreMatch ? Number(scoreMatch[1]) : null,
    url: pull.html_url,
  };
}

function normalizeStudioRelease(release) {
  if (release.ok === false) return { ok: false, error: release.error };
  const assets = (release.assets ?? []).map((asset) => ({
    name: asset.name,
    size: asset.size,
    downloadCount: asset.download_count ?? 0,
    url: asset.browser_download_url,
  }));
  return {
    ok: true,
    latestRelease: {
      tag: release.tag_name,
      name: release.name,
      publishedAt: release.published_at,
      totalDownloads: assets.reduce((sum, asset) => sum + asset.downloadCount, 0),
      assets,
    },
  };
}

function summarizePullState(pull) {
  if (pull.ok === false) return "unknown";
  if (pull.merged_at) return "merged";
  return pull.state ?? "unknown";
}

function buildNextActions(input) {
  const actions = [];
  if (input.downloadTrend?.classification === "normalizing_after_spike") {
    actions.push(`Treat the apparent weekly drop as spike normalization: ${formatNumber(input.downloadTrend.latest7)} latest 7d versus ${formatNumber(input.downloadTrend.prior7)} before the spike. Grow durable acquisition instead of chasing release churn.`);
  } else if (input.downloadTrend?.classification === "declining") {
    actions.push(`Downloads are declining across three measured weeks (${formatNumber(input.downloadTrend.prior7)} → ${formatNumber(input.downloadTrend.previous7)} → ${formatNumber(input.downloadTrend.latest7)}); audit discovery and activation immediately.`);
  } else if (input.downloadTrend?.classification === "unavailable") {
    actions.push(`Retry the npm download trend request; the range API failed: ${input.downloadTrend.error}`);
  }
  if (input.npm.ok && input.npm.latest !== input.packageJson.version) {
    const versionOrder = compareSemver(input.packageJson.version, input.npm.latest);
    if (versionOrder > 0) {
      actions.push(`Publish ${input.packageJson.version} to npm; npm latest is ${input.npm.latest}.`);
    } else if (versionOrder < 0) {
      actions.push(`Sync local package metadata from ${input.packageJson.version} to npm latest ${input.npm.latest} before publishing or tagging.`);
    } else {
      actions.push(`Reconcile local package version ${input.packageJson.version} with npm latest ${input.npm.latest}.`);
    }
  }
  if (input.officialMcpRegistry.ok && !input.officialMcpRegistry.listed) {
    actions.push("Publish server.json to the Official MCP Registry after npm is current.");
  }
  if (input.safeSkill.ok && input.safeSkill.state === "open") {
    actions.push("Do not merge the SafeSkill blocked badge; address findings or close after replacement proof.");
  }
  if (input.github.ok && input.github.stars < 16) {
    actions.push(`Starstruck needs ${16 - input.github.stars} more real stars.`);
  }
  if (input.skillsSh.ok && input.skillsSh.discoveredSkills < 4) {
    actions.push(`Wait for skills.sh to reindex all 4 public skills; ${input.skillsSh.discoveredSkills} currently discovered.`);
  }
  if (input.staleReferences.total > 0) {
    actions.push(`Clear or intentionally quarantine ${input.staleReferences.total} stale naming/reference hit${input.staleReferences.total === 1 ? "" : "s"}.`);
  }
  if (input.homebrewStudioCask.version && input.studio.ok && input.studio.latestRelease.tag && `v${input.homebrewStudioCask.version}` !== input.studio.latestRelease.tag) {
    actions.push(`Update the Homebrew Studio cask from ${input.homebrewStudioCask.version} to ${input.studio.latestRelease.tag}.`);
  }
  if (input.weeklyNpmDownloads && !input.weeklyNpmDownloads.achieved) {
    actions.push(`Close the 10x weekly npm gap: ${formatNumber(input.weeklyNpmDownloads.gap)} more weekly downloads needed for ${input.packageJson.name}.`);
  }
  return actions;
}

function compareSemver(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  if (!leftParts || !rightParts) return Number.NaN;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function parseSemver(value) {
  const match = String(value ?? "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

function formatDownloads(point, label) {
  if (!point.ok) return `${label} error`;
  return `${point.downloads} ${label} (${point.start}..${point.end})`;
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function formatPercent(value) {
  if (value === null || value === undefined) return "n/a";
  if (value === 0) return "0%";
  const percentage = value * 100;
  return `${percentage < 0.01 ? percentage.toFixed(4) : percentage.toFixed(2)}%`;
}

function formatMultiple(value) {
  if (value === null || value === undefined) return "n/a";
  return `${value >= 100 ? Math.round(value).toLocaleString("en-US") : value.toFixed(1)}x`;
}

function countOccurrences(value, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (offset < value.length) {
    const index = value.indexOf(needle, offset);
    if (index === -1) break;
    count += 1;
    offset = index + needle.length;
  }
  return count;
}
