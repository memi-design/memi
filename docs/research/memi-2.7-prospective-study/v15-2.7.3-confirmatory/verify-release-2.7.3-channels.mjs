import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");
const outputPath = resolve(__dirname, "release-2.7.3-channel-provenance.json");

const subject = {
  packageName: "@memi-design/cli",
  version: "2.7.3",
  githubRepository: "memi-design/memi",
  githubTag: "v2.7.3",
  githubActionMajorTag: "v2",
  ghcrRepository: "ghcr.io/memi-design/memi",
  mcpRegistryPath: "packages/developer-tools/memi.json",
  homebrewTap: "memi-design/homebrew-memi",
  websiteReleaseArtifactUrl: "https://www.memoire.cv/release/memi-release.json",
};

function sha(buffer, algorithm) {
  return createHash(algorithm).update(buffer).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fetchBuffer(url, options = {}) {
  const response = await fetch(url, options);
  const body = Buffer.from(await response.arrayBuffer());
  return {
    url,
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers),
    body,
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    url,
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers),
    text,
    json,
  };
}

async function head(url) {
  const response = await fetch(url, { method: "HEAD", redirect: "follow" });
  return {
    url,
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers),
  };
}

function decodeDssePayload(envelope) {
  if (!envelope?.payload) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function parseChecksums(text) {
  const entries = text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim().match(/^([a-f0-9]+)\s+(.+)$/i))
    .filter(Boolean)
    .map((match) => [match[2], match[1]]);
  return Object.fromEntries(entries);
}

function parseHomebrewFormula(text) {
  const version = text.match(/version "([^"]+)"/)?.[1] ?? null;
  const assets = {};
  let currentUrl = null;
  for (const line of text.split("\n")) {
    const urlMatch = line.match(/url "([^"]+)"/);
    if (urlMatch) {
      currentUrl = urlMatch[1];
      continue;
    }
    const shaMatch = line.match(/sha256 "([a-f0-9]+)"/);
    if (shaMatch && currentUrl) {
      assets[currentUrl.split("/").pop()] = shaMatch[1];
      currentUrl = null;
    }
  }
  return { version, assets };
}

function runJsonCommand(command, args, cwd) {
  const stdout = execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function runCommand(command, args, cwd) {
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "" };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
      exitCode: error.status ?? null,
    };
  }
}

function pickHeader(headers, key) {
  return headers[key] ?? headers[key.toLowerCase()] ?? null;
}

function summarizeFailures(channels) {
  const findings = [];
  if (channels.ghcr.status !== "verified") {
    findings.push("GHCR public digests were not retrievable without authentication.");
  }
  if (channels.mcpRegistry.status !== "verified") {
    findings.push("The MCP registry entry does not pin an explicit version; version 2.7.3 is only inferable through the npm package.");
  }
  if (channels.publicReleaseGate.observed?.parityEligible === true && channels.website.matches.publicArtifactParityFlag === false) {
    findings.push("The public release gate passed, but the declared parity flag in release-manifest.json and the deployed website artifact still says parity is pending.");
  }
  if (channels.githubRelease.observations.annotatedTagVerification?.verified === false) {
    findings.push(`GitHub tag ${subject.githubTag} is unsigned according to the GitHub tag API.`);
  }
  return findings;
}

const localReleaseManifest = await readJson(resolve(repoRoot, "release-manifest.json"));
const localNpmRelease = await readJson(resolve(repoRoot, "release-artifacts/npm/2.7.3.release.json"));
const localWebsiteRelease = await readJson(resolve(repoRoot, "release-artifacts/memoire-web.release.json"));
const currentAuditCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();

const now = new Date().toISOString();

const npmMetadata = await fetchJson("https://registry.npmjs.org/@memi-design/cli");
const npmVersion = npmMetadata.json?.versions?.[subject.version];
const npmTarballUrl = npmVersion?.dist?.tarball;
const npmTarball = await fetchBuffer(npmTarballUrl);
const npmAttestation = await fetchJson(
  "https://registry.npmjs.org/-/npm/v1/attestations/@memi-design%2fcli@2.7.3",
);
const npmAttestationSubjects = (npmAttestation.json?.attestations ?? []).map((entry) => {
  const payload = decodeDssePayload(entry.bundle?.dsseEnvelope);
  return {
    predicateType: entry.predicateType,
    subject: payload?.subject?.[0] ?? null,
    predicate: payload?.predicate
      ? {
          name: payload.predicate.name ?? null,
          version: payload.predicate.version ?? null,
          registry: payload.predicate.registry ?? null,
        }
      : null,
    invocationId: payload?.predicate?.runDetails?.metadata?.invocationId ?? null,
    workflowPath: payload?.predicate?.buildDefinition?.externalParameters?.workflow?.path ?? null,
    workflowRef: payload?.predicate?.buildDefinition?.externalParameters?.workflow?.ref ?? null,
    resolvedGitCommit:
      payload?.predicate?.buildDefinition?.resolvedDependencies?.[0]?.digest?.gitCommit ?? null,
    logIndex: entry.bundle?.verificationMaterial?.tlogEntries?.[0]?.logIndex ?? null,
  };
});

const githubHeaders = { "user-agent": "codex-release-audit" };
const githubRelease = await fetchJson(
  `https://api.github.com/repos/${subject.githubRepository}/releases/tags/${subject.githubTag}`,
  { headers: githubHeaders },
);
const githubTagRef = await fetchJson(
  `https://api.github.com/repos/${subject.githubRepository}/git/ref/tags/${subject.githubTag}`,
  { headers: githubHeaders },
);
const githubAnnotatedTag = await fetchJson(
  `https://api.github.com/repos/${subject.githubRepository}/git/tags/${githubTagRef.json?.object?.sha}`,
  { headers: githubHeaders },
);
const githubActionRef = await fetchJson(
  `https://api.github.com/repos/${subject.githubRepository}/git/ref/tags/${subject.githubActionMajorTag}`,
  { headers: githubHeaders },
);
const checksumsAsset = (githubRelease.json?.assets ?? []).find((asset) => asset.name === "SHA256SUMS.txt");
const githubChecksums = checksumsAsset ? await fetchBuffer(checksumsAsset.browser_download_url) : null;
const githubChecksumMap = githubChecksums ? parseChecksums(githubChecksums.body.toString("utf8")) : {};

const homebrewFormula = await fetchBuffer(
  "https://raw.githubusercontent.com/memi-design/homebrew-memi/main/Formula/memoire.rb",
);
const homebrewParsed = parseHomebrewFormula(homebrewFormula.body.toString("utf8"));
const homebrewCore = await fetchJson("https://formulae.brew.sh/api/formula/memoire.json");

const mcpRegistry = await fetchBuffer(
  "https://raw.githubusercontent.com/toolsdk-ai/toolsdk-mcp-registry/main/packages/developer-tools/memi.json",
);
const mcpRegistryJson = JSON.parse(mcpRegistry.body.toString("utf8"));

const websiteArtifactHead = await head(subject.websiteReleaseArtifactUrl);
const websiteRootHead = await head("https://www.memoire.cv/");
const websiteArtifact = await fetchJson(subject.websiteReleaseArtifactUrl);
const websiteSourceManifest = await fetchBuffer(websiteArtifact.json?.provenance?.sourceUrl);

const ghcrHttpChecks = [];
for (const url of [
  "https://ghcr.io/v2/memi-design/memi/tags/list",
  "https://ghcr.io/token?scope=repository:memi-design/memi:pull",
  "https://ghcr.io/token?scope=repository:memi-design/memi:pull&service=ghcr.io",
  "https://ghcr.io/token?scope=repository:memi-design/memi:pull&service=ghcr",
]) {
  const response = await fetchJson(url, { headers: githubHeaders });
  ghcrHttpChecks.push({
    url,
    status: response.status,
    body: response.text.trim(),
  });
}

const ghcrDockerVersion = runCommand(
  "docker",
  ["manifest", "inspect", `${subject.ghcrRepository}:${subject.version}`],
  repoRoot,
);
const ghcrDockerLatest = runCommand(
  "docker",
  ["manifest", "inspect", `${subject.ghcrRepository}:latest`],
  repoRoot,
);

const releaseBinariesWorkflow = await readFile(resolve(repoRoot, ".github/workflows/release-binaries.yml"), "utf8");
const promoteReleaseWorkflow = await readFile(resolve(repoRoot, ".github/workflows/promote-release.yml"), "utf8");

const publicReleaseGate = runJsonCommand("node", ["scripts/check-public-release-gate.mjs"], repoRoot);

const githubReleaseAssets = (githubRelease.json?.assets ?? []).map((asset) => ({
  name: asset.name,
  size: asset.size,
  digest: asset.digest ?? null,
  downloadUrl: asset.browser_download_url,
  checksumMatchesAggregate:
    asset.name.endsWith(".sha256") || asset.name === "SHA256SUMS.txt"
      ? null
      : githubChecksumMap[asset.name] === (asset.digest ?? "").replace(/^sha256:/, ""),
  checksumMatchesHomebrew:
    homebrewParsed.assets[asset.name]
      ? homebrewParsed.assets[asset.name] === (asset.digest ?? "").replace(/^sha256:/, "")
      : null,
}));

const channels = {
  npm: {
    status:
      npmMetadata.json?.["dist-tags"]?.latest === subject.version &&
      npmTarball.status === 200 &&
      npmVersion?.dist?.integrity === localNpmRelease.integrity &&
      npmVersion?.dist?.shasum === localNpmRelease.shasum
        ? "verified"
        : "failed",
    commands: [
      "GET https://registry.npmjs.org/@memi-design/cli",
      `GET ${npmTarballUrl}`,
      "GET https://registry.npmjs.org/-/npm/v1/attestations/@memi-design%2fcli@2.7.3",
    ],
    observedAt: now,
    observations: {
      latest: npmMetadata.json?.["dist-tags"]?.latest ?? null,
      modified: npmMetadata.json?.time?.modified ?? null,
      publishedAt: localNpmRelease.publishedAt,
      shasum: npmVersion?.dist?.shasum ?? null,
      integrity: npmVersion?.dist?.integrity ?? null,
      tarballBytes: npmTarball.body.length,
      tarballSha1: sha(npmTarball.body, "sha1"),
      tarballSha256: sha(npmTarball.body, "sha256"),
      tarballSha512Hex: sha(npmTarball.body, "sha512"),
      attestationStatus: npmAttestation.status,
      attestations: npmAttestationSubjects,
    },
    matches: {
      latestVersion: npmMetadata.json?.["dist-tags"]?.latest === subject.version,
      localShasum: npmVersion?.dist?.shasum === localNpmRelease.shasum,
      localIntegrity: npmVersion?.dist?.integrity === localNpmRelease.integrity,
      localTarballSha512Hex: sha(npmTarball.body, "sha512") === localNpmRelease.tarball.sha512,
      attestedSourceCommit: npmAttestationSubjects.some(
        (entry) => entry.resolvedGitCommit === localReleaseManifest.releaseGroups.engine.sourceCommit,
      ),
      attestedTarballDigest: npmAttestationSubjects.some(
        (entry) => entry.subject?.digest?.sha512 === sha(npmTarball.body, "sha512"),
      ),
    },
    failures: [],
  },
  githubRelease: {
    status:
      githubRelease.status === 200 &&
      githubAnnotatedTag.json?.object?.sha === localReleaseManifest.releaseGroups.engine.sourceCommit &&
      githubActionRef.json?.object?.sha === localReleaseManifest.releaseGroups.engine.sourceCommit
        ? "verified"
        : "failed",
    commands: [
      `GET https://api.github.com/repos/${subject.githubRepository}/releases/tags/${subject.githubTag}`,
      `GET https://api.github.com/repos/${subject.githubRepository}/git/ref/tags/${subject.githubTag}`,
      `GET https://api.github.com/repos/${subject.githubRepository}/git/tags/${githubTagRef.json?.object?.sha}`,
      `GET https://api.github.com/repos/${subject.githubRepository}/git/ref/tags/${subject.githubActionMajorTag}`,
      checksumsAsset ? `GET ${checksumsAsset.browser_download_url}` : null,
    ].filter(Boolean),
    observedAt: now,
    observations: {
      releaseId: githubRelease.json?.id ?? null,
      createdAt: githubRelease.json?.created_at ?? null,
      publishedAt: githubRelease.json?.published_at ?? null,
      author: githubRelease.json?.author?.login ?? null,
      targetCommitish: githubRelease.json?.target_commitish ?? null,
      assets: githubReleaseAssets,
      aggregateChecksums: githubChecksums ? githubChecksums.body.toString("utf8").trim().split("\n") : [],
      annotatedTagVerification: githubAnnotatedTag.json?.verification ?? null,
    },
    matches: {
      annotatedTagSourceCommit:
        githubAnnotatedTag.json?.object?.sha === localReleaseManifest.releaseGroups.engine.sourceCommit,
      majorActionTagSourceCommit:
        githubActionRef.json?.object?.sha === localReleaseManifest.releaseGroups.engine.sourceCommit,
      assetChecksumsMatchAggregate: githubReleaseAssets.every((asset) =>
        asset.checksumMatchesAggregate === null ? true : asset.checksumMatchesAggregate,
      ),
      homebrewChecksumsMatchRelease: githubReleaseAssets.every((asset) =>
        asset.checksumMatchesHomebrew === null ? true : asset.checksumMatchesHomebrew,
      ),
    },
    failures: [],
  },
  githubAction: {
    status:
      githubActionRef.status === 200 &&
      githubActionRef.json?.object?.type === "commit" &&
      githubActionRef.json?.object?.sha === localReleaseManifest.releaseGroups.engine.sourceCommit
        ? "verified"
        : "failed",
    commands: [
      `GET https://api.github.com/repos/${subject.githubRepository}/git/ref/tags/${subject.githubActionMajorTag}`,
    ],
    observedAt: now,
    observations: {
      objectType: githubActionRef.json?.object?.type ?? null,
      sourceCommit: githubActionRef.json?.object?.sha ?? null,
    },
    matches: {
      declaredSourceCommit:
        githubActionRef.json?.object?.sha === localReleaseManifest.releaseGroups.engine.sourceCommit,
    },
    failures: [],
  },
  homebrew: {
    status:
      homebrewFormula.status === 200 &&
      homebrewParsed.version === subject.version &&
      Object.entries(homebrewParsed.assets).every(([assetName, digest]) => githubChecksumMap[assetName] === digest)
        ? "verified"
        : "failed",
    commands: [
      "GET https://raw.githubusercontent.com/memi-design/homebrew-memi/main/Formula/memoire.rb",
      "GET https://formulae.brew.sh/api/formula/memoire.json",
    ],
    observedAt: now,
    observations: {
      formulaSha256: sha(homebrewFormula.body, "sha256"),
      formulaVersion: homebrewParsed.version,
      assetChecksums: homebrewParsed.assets,
      coreApiStatus: homebrewCore.status,
      coreApiNote: homebrewCore.status === 404 ? "tap-only formula; no Homebrew core listing" : null,
    },
    matches: {
      declaredVersion: homebrewParsed.version === subject.version,
      releaseChecksums: Object.entries(homebrewParsed.assets).every(
        ([assetName, digest]) => githubChecksumMap[assetName] === digest,
      ),
    },
    failures: [],
  },
  ghcr: {
    status: "blocked",
    commands: [
      "GET https://ghcr.io/v2/memi-design/memi/tags/list",
      "GET https://ghcr.io/token?scope=repository:memi-design/memi:pull",
      "GET https://ghcr.io/token?scope=repository:memi-design/memi:pull&service=ghcr.io",
      "GET https://ghcr.io/token?scope=repository:memi-design/memi:pull&service=ghcr",
      `docker manifest inspect ${subject.ghcrRepository}:${subject.version}`,
      `docker manifest inspect ${subject.ghcrRepository}:latest`,
    ],
    observedAt: now,
    observations: {
      expectedRepository: subject.ghcrRepository,
      workflowEvidence: {
        releaseBinariesMentionsVersionTag: releaseBinariesWorkflow.includes(
          `tags: ${subject.ghcrRepository}:${"${{ env.RELEASE_TAG }}"}`,
        ),
        releaseBinariesMentionsLatestTag: releaseBinariesWorkflow.includes(
          `docker buildx imagetools create --tag ${subject.ghcrRepository}:latest`,
        ),
        promoteReleaseMentionsLatestTag: promoteReleaseWorkflow.includes(
          `docker buildx imagetools create --tag ${subject.ghcrRepository}:latest`,
        ),
      },
      httpResponses: ghcrHttpChecks,
      dockerManifestInspectVersion: ghcrDockerVersion,
      dockerManifestInspectLatest: ghcrDockerLatest,
    },
    matches: {
      expectedRepositoryReferencedInWorkflows:
        releaseBinariesWorkflow.includes(subject.ghcrRepository) &&
        promoteReleaseWorkflow.includes(subject.ghcrRepository),
      versionDigestRetrievable: false,
      latestDigestRetrievable: false,
    },
    failures: [
      "Public GHCR endpoints returned 401 UNAUTHORIZED for tags and token discovery.",
      "Local docker manifest inspect for version and latest could not retrieve a public manifest digest without authentication.",
    ],
  },
  mcpRegistry: {
    status:
      mcpRegistry.status === 200 &&
      mcpRegistryJson.packageName === subject.packageName &&
      !("version" in mcpRegistryJson)
        ? "partial"
        : "verified",
    commands: [
      "GET https://raw.githubusercontent.com/toolsdk-ai/toolsdk-mcp-registry/main/packages/developer-tools/memi.json",
    ],
    observedAt: now,
    observations: {
      registrySha256: sha(mcpRegistry.body, "sha256"),
      name: mcpRegistryJson.name ?? null,
      packageName: mcpRegistryJson.packageName ?? null,
      binArgs: mcpRegistryJson.binArgs ?? [],
      url: mcpRegistryJson.url ?? null,
      explicitVersionField: Object.hasOwn(mcpRegistryJson, "version") ? mcpRegistryJson.version : null,
    },
    matches: {
      packageName: mcpRegistryJson.packageName === subject.packageName,
      serverNameByReleaseManifest: localReleaseManifest.surfaces.mcp.serverName === "io.github.sarveshsea/memi",
      explicitVersionPinned: Object.hasOwn(mcpRegistryJson, "version"),
    },
    failures: Object.hasOwn(mcpRegistryJson, "version")
      ? []
      : ["The registry entry exposes the package name but does not pin an explicit version field for 2.7.3."],
  },
  website: {
    status:
      websiteArtifact.status === 200 &&
      websiteSourceManifest.status === 200 &&
      websiteArtifact.json?.publicTruth?.engine?.version === subject.version &&
      websiteArtifact.json?.publicTruth?.engine?.sourceCommit ===
        localReleaseManifest.releaseGroups.engine.sourceCommit &&
      sha(websiteSourceManifest.body, "sha256") === websiteArtifact.json?.provenance?.manifestSha256
        ? "verified"
        : "failed",
    commands: [
      "HEAD https://www.memoire.cv/",
      `HEAD ${subject.websiteReleaseArtifactUrl}`,
      `GET ${subject.websiteReleaseArtifactUrl}`,
      `GET ${websiteArtifact.json?.provenance?.sourceUrl}`,
    ],
    observedAt: now,
    observations: {
      rootHeaders: {
        status: websiteRootHead.status,
        cacheControl: pickHeader(websiteRootHead.headers, "cache-control"),
        etag: pickHeader(websiteRootHead.headers, "etag"),
        lastModified: pickHeader(websiteRootHead.headers, "last-modified"),
        server: pickHeader(websiteRootHead.headers, "server"),
        xVercelCache: pickHeader(websiteRootHead.headers, "x-vercel-cache"),
        xVercelId: pickHeader(websiteRootHead.headers, "x-vercel-id"),
      },
      releaseArtifactHeaders: {
        status: websiteArtifactHead.status,
        cacheControl: pickHeader(websiteArtifactHead.headers, "cache-control"),
        etag: pickHeader(websiteArtifactHead.headers, "etag"),
        lastModified: pickHeader(websiteArtifactHead.headers, "last-modified"),
        server: pickHeader(websiteArtifactHead.headers, "server"),
        xVercelCache: pickHeader(websiteArtifactHead.headers, "x-vercel-cache"),
        xVercelId: pickHeader(websiteArtifactHead.headers, "x-vercel-id"),
      },
      publicTruth: websiteArtifact.json?.publicTruth ?? null,
      provenance: websiteArtifact.json?.provenance ?? null,
      sourceManifestSha256: sha(websiteSourceManifest.body, "sha256"),
      orchestrationVerification:
        websiteArtifact.json?.orchestration?.releaseGroups?.engine?.verification ?? null,
    },
    matches: {
      publicArtifactVersion: websiteArtifact.json?.publicTruth?.engine?.version === subject.version,
      publicArtifactSourceCommit:
        websiteArtifact.json?.publicTruth?.engine?.sourceCommit ===
        localReleaseManifest.releaseGroups.engine.sourceCommit,
      publicArtifactManifestSha256:
        sha(websiteSourceManifest.body, "sha256") === websiteArtifact.json?.provenance?.manifestSha256,
      localWebsiteReleaseRecord:
        websiteArtifact.json?.provenance?.manifestSha256 === localWebsiteRelease.provenance.manifestSha256 &&
        websiteArtifact.json?.provenance?.sourceCommit === localWebsiteRelease.provenance.sourceCommit,
      publicArtifactParityFlag:
        websiteArtifact.json?.orchestration?.releaseGroups?.engine?.verification?.eligibleForParity === true,
    },
    failures: [],
  },
  publicReleaseGate: {
    status: publicReleaseGate.status === "passed" ? "verified" : "failed",
    commands: ["node scripts/check-public-release-gate.mjs"],
    observedAt: now,
    observed: publicReleaseGate,
    matches: {
      expectedVersion: publicReleaseGate.expectedVersion === subject.version,
      npmVerified: publicReleaseGate.evidence?.npm?.verified === true,
      githubReleaseVerified: publicReleaseGate.evidence?.githubRelease?.verified === true,
      githubActionVerified: publicReleaseGate.evidence?.githubAction?.verified === true,
      mcpVerified: publicReleaseGate.evidence?.mcp?.verified === true,
      websiteVerified: publicReleaseGate.evidence?.website?.verified === true,
      parityEligible: publicReleaseGate.parityEligible === true,
    },
    failures: publicReleaseGate.failures ?? [],
  },
};

const audit = {
  schemaVersion: 1,
  auditedAt: now,
  auditDate: now.slice(0, 10),
  generator: {
    script: "docs/research/memi-2.7-prospective-study/v15-2.7.3-confirmatory/verify-release-2.7.3-channels.mjs",
    command:
      "node docs/research/memi-2.7-prospective-study/v15-2.7.3-confirmatory/verify-release-2.7.3-channels.mjs",
    wrote: "docs/research/memi-2.7-prospective-study/v15-2.7.3-confirmatory/release-2.7.3-channel-provenance.json",
    workspaceHead: currentAuditCommit,
  },
  subject,
  expectations: {
    engineVersion: localReleaseManifest.releaseGroups.engine.version,
    engineSourceCommit: localReleaseManifest.releaseGroups.engine.sourceCommit,
    npmReleaseRecord: localNpmRelease,
    websiteReleaseRecord: localWebsiteRelease.provenance,
    declaredParityFromReleaseManifest:
      localReleaseManifest.releaseGroups.engine.verification.eligibleForParity,
  },
  channels,
  summary: {
    verified: Object.entries(channels)
      .filter(([, value]) => value.status === "verified")
      .map(([key]) => key),
    partial: Object.entries(channels)
      .filter(([, value]) => value.status === "partial")
      .map(([key]) => key),
    blocked: Object.entries(channels)
      .filter(([, value]) => value.status === "blocked")
      .map(([key]) => key),
    mismatches: summarizeFailures(channels),
  },
};

await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
console.log(outputPath);
