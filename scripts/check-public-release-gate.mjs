#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runPublicReleaseGate } from "./lib/public-release-gate.mjs";
import {
  canClearPublicParityCap,
  loadReleaseManifest,
  resolveReleaseRecordPath,
  serializeJson,
  verifyPublishedEngineTransitionFromGit,
} from "./lib/release-manifest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const manifest = await loadReleaseManifest(root);
const engine = manifest.releaseGroups.engine;

const packageName = process.env.PACKAGE_NAME || pkg.name;
const expectedVersion = process.env.EXPECTED_VERSION || engine.version;
const expectedPhrase =
  process.env.EXPECTED_README_PHRASE
  || "read-only design engineering audit and skill layer for coding agents";
const expectedInstall = process.env.EXPECTED_INSTALL_COMMAND || `npm i -g ${packageName}`;
const expectedSiteUrl = trimTrailingSlash(
  process.env.EXPECTED_SITE_URL || manifest.surfaces.website.publicUrl,
);
const expectedStudioVersion =
  process.env.EXPECTED_STUDIO_VERSION || manifest.releaseGroups.studio.version;
const expectedCommunityNotes = Number.parseInt(process.env.EXPECTED_COMMUNITY_NOTES || "5", 10);
const minCommunityCatalogDate = process.env.MIN_COMMUNITY_CATALOG_DATE || "2026-07-04T00:00:00.000Z";
const skipInstall = process.env.SKIP_INSTALL_SMOKE === "1";
const skipSite = process.env.SKIP_SITE_SMOKE === "1";
const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName).replace(/^%40/, "%40")}`;

const basePayload = await runPublicReleaseGate({
  packageName,
  expectedVersion,
  expectedPhrase,
  expectedInstall,
  expectedSiteUrl,
  expectedStudioVersion,
  expectedCommunityNotes,
  minCommunityCatalogDate,
  skipInstall,
  skipSite,
  registryUrl,
}, {
  fetchJson,
  runSiteSmoke,
  runInstallSmoke,
});

const evidence = {
  transition: { verified: false },
  npm: { verified: false },
  githubRelease: { verified: false },
  githubAction: { verified: false },
  mcp: { verified: false },
  studio: { verified: false },
  website: { verified: false },
};
const stateFailures = [];
if (engine.state !== "published") {
  stateFailures.push(
    `engine release ${engine.version} is ${engine.state}; only a provenance-bound published state can clear public parity caps`,
  );
} else {
  const transitionFailures = await verifyPublishedEngineTransitionFromGit(root, manifest);
  evidence.transition = {
    verified: transitionFailures.length === 0,
    sourceCommit: engine.sourceCommit,
    failures: transitionFailures,
  };
  stateFailures.push(...transitionFailures);
  const liveChecks = await Promise.all([
    captureLiveEvidence("npm provenance", verifyLiveNpm),
    captureLiveEvidence("GitHub release", verifyGithubRelease),
    captureLiveEvidence("GitHub Action", verifyGithubAction),
    captureLiveEvidence("MCP registry", verifyMcpRegistry),
    captureLiveEvidence("Studio release", verifyStudioRelease),
    captureLiveEvidence("website release artifact", verifyWebsiteArtifact),
  ]);
  for (const [key, result] of [
    ["npm", liveChecks[0]],
    ["githubRelease", liveChecks[1]],
    ["githubAction", liveChecks[2]],
    ["mcp", liveChecks[3]],
    ["studio", liveChecks[4]],
    ["website", liveChecks[5]],
  ]) {
    evidence[key] = result.evidence;
    stateFailures.push(...result.failures);
  }
}
const parityEligible =
  basePayload.status === "passed"
  && stateFailures.length === 0
  && canClearPublicParityCap(manifest, evidence);
if (!parityEligible && engine.state === "published" && stateFailures.length === 0) {
  stateFailures.push("independent release evidence did not satisfy the parity clearance contract");
}
const payload = {
  ...basePayload,
  releaseState: engine.state,
  releaseRecord: engine.releaseRecord,
  evidence,
  parityEligible,
  status: parityEligible ? "passed" : "failed",
  failures: [...basePayload.failures, ...stateFailures],
};

console.log(JSON.stringify(payload, null, 2));
if (payload.failures.length > 0) process.exit(1);

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

async function fetchBytes(url, maxBytes = 200 * 1024 * 1024) {
  const response = await fetch(url, {
    headers: { "User-Agent": "memoire-public-release-gate" },
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const declared = Number.parseInt(response.headers.get("content-length") || "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`download exceeds ${maxBytes} bytes: ${url}`);
  }
  if (!response.body) throw new Error(`download body is missing: ${url}`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`download exceeds ${maxBytes} bytes: ${url}`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
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

async function captureLiveEvidence(label, run) {
  try {
    const evidence = await run();
    if (!evidence || evidence.verified !== true) {
      throw new Error("returned incomplete evidence");
    }
    return { evidence, failures: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      evidence: { verified: false, error: message },
      failures: [`${label} verification failed: ${message}`],
    };
  }
}

async function verifyLiveNpm() {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts", "verify-npm-release.mjs")],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        EXPECTED_VERSION: engine.version,
        EXPECTED_SOURCE_COMMIT: engine.sourceCommit,
        EXPECTED_SOURCE_REPOSITORY: "https://github.com/sarveshsea/memi",
        EXPECTED_SOURCE_WORKFLOW: ".github/workflows/publish.yml",
        EXPECTED_SOURCE_REF: "refs/heads/main",
        NPM_VERIFY_ATTEMPTS: "1",
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`);
  }
  const output = JSON.parse(result.stdout);
  if (output.status !== "verified" || output.provenance?.sourceCommit !== engine.sourceCommit) {
    throw new Error("npm verifier did not bind the published source commit");
  }
  const recordPath = await resolveReleaseRecordPath(root, engine.releaseRecord.path);
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  if (output.invocationId !== record.attestation?.invocationId) {
    throw new Error("live npm provenance does not match the recorded workflow invocation");
  }
  return {
    verified: true,
    sourceCommit: output.provenance.sourceCommit,
    invocationId: output.invocationId,
    integrity: output.integrity,
    shasum: output.shasum,
    tarball: output.tarball,
  };
}

async function verifyGithubRelease() {
  const repository = manifest.surfaces.githubRelease.repository;
  const tag = `${manifest.surfaces.githubRelease.tagPrefix}${engine.version}`;
  const sourceCommit = await resolveGithubTagCommit(repository, tag);
  if (sourceCommit !== engine.sourceCommit) {
    throw new Error(`${tag} resolves to ${sourceCommit}, expected ${engine.sourceCommit}`);
  }
  const release = await fetchJson(`https://api.github.com/repos/${repository}/releases/tags/${tag}`);
  const assets = new Map(
    (Array.isArray(release.assets) ? release.assets : [])
      .map((asset) => [asset.name, asset.browser_download_url]),
  );
  const archives = [
    "memi-darwin-arm64.tar.gz",
    "memi-darwin-x64.tar.gz",
    "memi-linux-x64.tar.gz",
    "memi-win-x64.zip",
  ];
  const requiredAssets = [
    ...archives,
    ...archives.map((name) => `${name}.sha256`),
    "SHA256SUMS.txt",
  ];
  const missing = requiredAssets.filter((name) => !assets.get(name));
  if (missing.length > 0) throw new Error(`release assets missing: ${missing.join(", ")}`);
  const sums = parseChecksums(
    (await fetchBytes(assets.get("SHA256SUMS.txt"), 1024 * 1024)).toString("utf8"),
  );
  for (const archive of archives) {
    const expected = sums.get(archive);
    if (!expected) throw new Error(`SHA256SUMS.txt is missing ${archive}`);
    const actual = createHash("sha256")
      .update(await fetchBytes(assets.get(archive)))
      .digest("hex");
    if (actual !== expected) throw new Error(`${archive} does not match SHA256SUMS.txt`);
  }
  return {
    verified: true,
    sourceCommit,
    checksumsVerified: true,
    tag,
    assets: requiredAssets,
  };
}

async function verifyGithubAction() {
  const surface = manifest.surfaces.githubAction;
  const sourceCommit = await resolveGithubTagCommit(surface.repository, surface.majorTag);
  if (sourceCommit !== engine.sourceCommit) {
    throw new Error(`${surface.majorTag} resolves to ${sourceCommit}, expected ${engine.sourceCommit}`);
  }
  return {
    verified: true,
    sourceCommit,
    tag: surface.majorTag,
  };
}

async function verifyMcpRegistry() {
  const serverName = manifest.surfaces.mcp.serverName;
  const registry = await fetchJson(
    `https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(serverName)}`,
  );
  const entries = Array.isArray(registry.servers) ? registry.servers : [];
  const match = entries.find((entry) => {
    const server = entry?.server ?? entry;
    const metadata = entry?._meta?.["io.modelcontextprotocol.registry/official"];
    return server?.name === serverName
      && server?.version === engine.version
      && metadata?.isLatest === true;
  });
  if (!match) throw new Error(`${serverName}@${engine.version} is not the official latest entry`);
  return { verified: true, version: engine.version, serverName };
}

async function verifyStudioRelease() {
  const surface = manifest.surfaces.studio;
  const version = manifest.releaseGroups.studio.version;
  const tag = `${surface.tagPrefix}${version}`;
  const release = await fetchJson(
    `https://api.github.com/repos/${surface.repository}/releases/tags/${tag}`,
  );
  const names = new Set((Array.isArray(release.assets) ? release.assets : []).map((asset) => asset.name));
  const required = [
    surface.arm64Asset.replace("{version}", version),
    surface.x64Asset.replace("{version}", version),
    surface.checksumAsset,
  ];
  const missing = required.filter((name) => !names.has(name));
  if (missing.length > 0) throw new Error(`Studio release assets missing: ${missing.join(", ")}`);
  return { verified: true, version, tag, assets: required };
}

async function verifyWebsiteArtifact() {
  const url = manifest.surfaces.website.releaseArtifactUrl;
  if (!url) throw new Error("releaseArtifactUrl is not configured");
  const artifact = await fetchJson(url);
  if (serializeJson(artifact?.release) !== serializeJson(manifest)) {
    throw new Error("deployed website release payload does not match the canonical manifest");
  }
  const manifestSha256 = createHash("sha256").update(serializeJson(manifest)).digest("hex");
  if (artifact?.provenance?.manifestSha256 !== manifestSha256) {
    throw new Error("deployed website release artifact has the wrong manifest SHA-256");
  }
  const transitionCommit = execFileSync(
    "git",
    ["log", "-1", "--format=%H", "--", "release-manifest.json"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  if (artifact?.provenance?.sourceCommit !== transitionCommit) {
    throw new Error("deployed website release artifact is not generated from the transition commit");
  }
  return { verified: true, manifestSha256, sourceCommit: transitionCommit, url };
}

async function resolveGithubTagCommit(repository, tag) {
  const ref = await fetchJson(
    `https://api.github.com/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
  );
  let object = ref.object;
  for (let depth = 0; depth < 3 && object?.type === "tag"; depth += 1) {
    const annotated = await fetchJson(
      `https://api.github.com/repos/${repository}/git/tags/${object.sha}`,
    );
    object = annotated.object;
  }
  if (object?.type !== "commit" || !/^[0-9a-f]{40}$/.test(object.sha ?? "")) {
    throw new Error(`tag ${tag} does not resolve to a commit`);
  }
  return object.sha;
}

function parseChecksums(value) {
  const checksums = new Map();
  for (const line of value.split(/\r?\n/)) {
    const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (match) checksums.set(match[2], match[1]);
  }
  return checksums;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
