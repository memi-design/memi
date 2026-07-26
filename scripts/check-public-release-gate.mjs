#!/usr/bin/env node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

const packageName = process.env.PACKAGE_NAME || pkg.name;
const expectedVersion = process.env.EXPECTED_VERSION || pkg.version;
const expectedPhrase = process.env.EXPECTED_README_PHRASE || "Design QA skills for coding agents";
const expectedInstall = process.env.EXPECTED_INSTALL_COMMAND || `npm i -g ${packageName}`;
const expectedSiteUrl = trimTrailingSlash(process.env.EXPECTED_SITE_URL || "https://www.memoire.cv");
const expectedStudioVersion = process.env.EXPECTED_STUDIO_VERSION || "";
const expectedCommunityNotes = Number.parseInt(process.env.EXPECTED_COMMUNITY_NOTES || "5", 10);
const minCommunityCatalogDate = process.env.MIN_COMMUNITY_CATALOG_DATE || "2026-07-04T00:00:00.000Z";
const skipInstall = process.env.SKIP_INSTALL_SMOKE === "1";
const skipSite = process.env.SKIP_SITE_SMOKE === "1";

const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName).replace(/^%40/, "%40")}`;
const metadata = await fetchJson(registryUrl);
const latest = metadata["dist-tags"]?.latest;
const latestReadme = [
  metadata.readme,
  latest ? metadata.versions?.[latest]?.readme : "",
  metadata.versions?.[expectedVersion]?.readme,
].filter(Boolean).join("\n");

const failures = [];
if (latest !== expectedVersion) {
  failures.push(`npm latest is ${latest ?? "(missing)"}, expected ${expectedVersion}`);
}
if (!latestReadme.includes(expectedPhrase)) {
  failures.push(`npm README missing phrase: ${expectedPhrase}`);
}
if (!latestReadme.includes(expectedInstall)) {
  failures.push(`npm README missing install command: ${expectedInstall}`);
}

let siteSmoke = null;
if (!skipSite) {
  siteSmoke = await runSiteSmoke({
    siteUrl: expectedSiteUrl,
    packageName,
    expectedVersion,
    expectedStudioVersion,
    expectedCommunityNotes,
    minCommunityCatalogDate,
  });
  failures.push(...siteSmoke.failures);
}

let installSmoke = null;
if (failures.length === 0 && !skipInstall) {
  installSmoke = await runInstallSmoke(packageName, expectedVersion);
  if (!installSmoke.ok) {
    failures.push(installSmoke.error);
  }
}

const payload = {
  packageName,
  expectedVersion,
  latest,
  expectedPhrase,
  expectedInstall,
  siteSmoke,
  installSmoke,
  status: failures.length === 0 ? "passed" : "failed",
  failures,
};

console.log(JSON.stringify(payload, null, 2));
if (failures.length > 0) process.exit(1);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "memoire-public-release-gate" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "memoire-public-release-gate" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

async function runSiteSmoke({
  siteUrl,
  packageName,
  expectedVersion,
  expectedStudioVersion,
  expectedCommunityNotes,
  minCommunityCatalogDate,
}) {
  const failures = [];
  const npmPackageUrl = `https://www.npmjs.com/package/${packageName}`;
  const [home, docs, changelog, communityCatalog] = await Promise.all([
    fetchText(`${siteUrl}/`),
    fetchText(`${siteUrl}/docs`),
    fetchText(`${siteUrl}/changelog`),
    fetchJson(`${siteUrl}/notes/community/catalog.v1.json`),
  ]);

  if (!home.includes(npmPackageUrl) && !home.includes(packageName)) {
    failures.push(`homepage missing npm package reference: ${packageName}`);
  }
  if (expectedStudioVersion && !home.includes(expectedStudioVersion)) {
    failures.push(`homepage missing Studio version ${expectedStudioVersion}`);
  }
  if (home.includes("Studio 1.0.4") || home.includes("v1.0.4")) {
    failures.push("homepage still contains stale Studio 1.0.4 copy");
  }

  if (!docs.includes(packageName)) {
    failures.push(`docs missing npm package reference: ${packageName}`);
  }
  if (!docs.includes(expectedVersion)) {
    failures.push(`docs missing CLI version ${expectedVersion}`);
  }
  if (/Current npm target:[\s\S]{0,120}0\.14\.1/.test(docs)) {
    failures.push("docs still contain stale Current npm target 0.14.1");
  }

  if (!changelog.includes(`v${expectedVersion}`) && !changelog.includes(expectedVersion)) {
    failures.push(`changelog missing release ${expectedVersion}`);
  }

  const communityNotes = Array.isArray(communityCatalog.notes) ? communityCatalog.notes : [];
  if (communityNotes.length < expectedCommunityNotes) {
    failures.push(`community catalog has ${communityNotes.length} notes, expected at least ${expectedCommunityNotes}`);
  }
  if (minCommunityCatalogDate && communityCatalog.generatedAt) {
    const generatedAt = Date.parse(communityCatalog.generatedAt);
    const minDate = Date.parse(minCommunityCatalogDate);
    if (Number.isFinite(generatedAt) && Number.isFinite(minDate) && generatedAt < minDate) {
      failures.push(`community catalog generatedAt ${communityCatalog.generatedAt} is older than ${minCommunityCatalogDate}`);
    }
  }

  return {
    ok: failures.length === 0,
    siteUrl,
    expectedStudioVersion: expectedStudioVersion || null,
    expectedCommunityNotes,
    minCommunityCatalogDate,
    communityNotes: communityNotes.length,
    generatedAt: communityCatalog.generatedAt ?? null,
    failures,
  };
}

async function runInstallSmoke(name, version) {
  const dir = await mkdtemp(join(tmpdir(), "memoire-release-gate-"));
  try {
    const pkgRef = `${name}@${version}`;
    const result = spawnSync("npm", ["exec", "--yes", "--package", pkgRef, "--", "memi", "--version"], {
      cwd: dir,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    const stdout = result.stdout.trim();
    if (result.status !== 0) {
      return { ok: false, error: `install smoke failed: ${result.stderr.trim() || result.status}` };
    }
    if (stdout !== version) {
      return { ok: false, error: `memi --version returned ${stdout}, expected ${version}` };
    }
    return { ok: true, version: stdout };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
