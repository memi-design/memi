import { createHash } from "node:crypto";
import {
  serializeJson,
  validateWebReleaseArtifact,
  validateWebReleaseArtifactSourceBytes,
} from "./release-manifest.mjs";

export async function runPublicReleaseGate(options, dependencies) {
  const {
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
  } = options;
  const {
    fetchJson,
    runSiteSmoke,
    runInstallSmoke,
  } = dependencies;

  const [registrySmoke, siteSmoke, installSmoke] = await Promise.all([
    captureRegistrySmoke({
      fetchJson,
      registryUrl,
      expectedVersion,
      expectedPhrase,
      expectedInstall,
    }),
    skipSite ? null : captureSiteSmoke(() => runSiteSmoke({
      siteUrl: expectedSiteUrl,
      packageName,
      expectedVersion,
      expectedStudioVersion,
      expectedCommunityNotes,
      minCommunityCatalogDate,
    })),
    skipInstall
      ? null
      : captureInstallSmoke(() => runInstallSmoke(packageName, expectedVersion)),
  ]);

  const stageFailures = [
    ...registrySmoke.failures,
    ...(siteSmoke?.failures ?? []),
    ...installFailures(installSmoke),
  ];
  const skippedFailures = [
    ...(skipSite ? ["required site smoke was skipped"] : []),
    ...(skipInstall ? ["required install smoke was skipped"] : []),
  ];
  const failures = [...stageFailures, ...skippedFailures];

  return {
    packageName,
    expectedVersion,
    latest: registrySmoke.latest,
    expectedPhrase,
    expectedInstall,
    registrySmoke,
    siteSmoke,
    installSmoke,
    status:
      stageFailures.length > 0
        ? "failed"
        : skippedFailures.length > 0
          ? "diagnostic"
          : "passed",
    failures,
  };
}

export async function verifyWebsiteArtifactEvidence(options, dependencies) {
  const { manifest, url } = options;
  const { fetchJson, fetchText } = dependencies;
  if (!url) throw new Error("releaseArtifactUrl is not configured");

  const artifact = await fetchJson(url);
  const artifactFailures = validateWebReleaseArtifact(manifest, artifact);
  if (artifactFailures.length > 0) {
    throw new Error(`deployed website release artifact is invalid: ${artifactFailures.join("; ")}`);
  }

  const sourceManifestText = await fetchText(artifact.provenance.sourceUrl);
  const sourceFailures = validateWebReleaseArtifactSourceBytes(
    manifest,
    artifact,
    sourceManifestText,
  );
  if (sourceFailures.length > 0) {
    throw new Error(
      `deployed website release artifact provenance is invalid: ${sourceFailures.join("; ")}`,
    );
  }
  if (serializeJson(artifact.release) !== serializeJson(manifest)) {
    throw new Error("deployed website release payload does not match the canonical manifest");
  }

  const manifestSha256 = createHash("sha256").update(serializeJson(manifest)).digest("hex");
  if (artifact.provenance.manifestSha256 !== manifestSha256) {
    throw new Error("deployed website release artifact has the wrong manifest SHA-256");
  }
  return {
    verified: true,
    manifestSha256,
    sourceCommit: artifact.provenance.sourceCommit,
    sourceUrl: artifact.provenance.sourceUrl,
    url,
  };
}

async function captureRegistrySmoke({
  fetchJson,
  registryUrl,
  expectedVersion,
  expectedPhrase,
  expectedInstall,
}) {
  try {
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
    return {
      ok: failures.length === 0,
      registryUrl,
      latest: latest ?? null,
      error: null,
      failures,
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      ok: false,
      registryUrl,
      latest: null,
      error: message,
      failures: [`npm registry check failed: ${message}`],
    };
  }
}

async function captureSiteSmoke(run) {
  try {
    const result = await run();
    if (
      !result
      || typeof result !== "object"
      || typeof result.ok !== "boolean"
      || !Array.isArray(result.failures)
    ) {
      throw new Error("site smoke returned an invalid result");
    }
    const failures = result.failures.length > 0
      ? result.failures
      : result.ok
        ? []
        : ["site smoke failed without a reason"];
    return {
      ...result,
      ok: failures.length === 0,
      failures,
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      ok: false,
      error: message,
      failures: [`site smoke failed: ${message}`],
    };
  }
}

async function captureInstallSmoke(run) {
  try {
    const result = await run();
    if (
      !result
      || typeof result !== "object"
      || typeof result.ok !== "boolean"
      || (result.ok && typeof result.version !== "string")
      || (!result.ok && typeof result.error !== "string")
    ) {
      throw new Error("install smoke returned an invalid result");
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error),
    };
  }
}

function installFailures(installSmoke) {
  if (!installSmoke || installSmoke.ok) return [];
  const message = String(installSmoke.error || "unknown install smoke failure");
  return [
    message.startsWith("install smoke failed:")
      ? message
      : `install smoke failed: ${message}`,
  ];
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
