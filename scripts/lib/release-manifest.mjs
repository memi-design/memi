import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;

export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function loadReleaseManifest(root) {
  const path = join(root, "release-manifest.json");
  return JSON.parse(await readFile(path, "utf8"));
}

export function validateReleaseManifest(manifest) {
  const failures = [];
  if (manifest?.schemaVersion !== 1) failures.push("release-manifest.json schemaVersion must be 1");

  const groups = manifest?.releaseGroups ?? {};
  for (const name of ["engine", "studio", "site"]) {
    if (!SEMVER.test(groups[name]?.version ?? "")) {
      failures.push(`release-manifest.json releaseGroups.${name}.version must be exact semver`);
    }
  }
  if (!COMMIT_SHA.test(groups.engine?.sourceCommit ?? "")) {
    failures.push("release-manifest.json releaseGroups.engine.sourceCommit must be a 40-character commit SHA");
  }

  for (const [name, surface] of Object.entries(manifest?.surfaces ?? {})) {
    if (!groups[surface?.releaseGroup]) {
      failures.push(`release-manifest.json surfaces.${name}.releaseGroup does not exist`);
    }
  }

  const expected = {
    npm: "engine",
    githubRelease: "engine",
    githubAction: "engine",
    mcp: "engine",
    studio: "studio",
    website: "site",
  };
  for (const [surface, releaseGroup] of Object.entries(expected)) {
    if (manifest?.surfaces?.[surface]?.releaseGroup !== releaseGroup) {
      failures.push(`release-manifest.json surfaces.${surface}.releaseGroup must be ${releaseGroup}`);
    }
  }

  const engineVersion = groups.engine?.version;
  const githubRelease = manifest?.surfaces?.githubRelease;
  const expectedGithubReleaseUrl =
    `https://github.com/${githubRelease?.repository}/releases/tag/${githubRelease?.tagPrefix}${engineVersion}`;
  if (githubRelease?.url !== expectedGithubReleaseUrl) {
    failures.push(`release-manifest.json GitHub release URL must be ${expectedGithubReleaseUrl}`);
  }
  const engineMajor = engineVersion?.split(".")[0];
  if (manifest?.surfaces?.githubAction?.majorTag !== `v${engineMajor}`) {
    failures.push(`release-manifest.json GitHub Action majorTag must be v${engineMajor}`);
  }
  for (const field of ["arm64Asset", "x64Asset"]) {
    if (!manifest?.surfaces?.studio?.[field]?.includes("{version}")) {
      failures.push(`release-manifest.json Studio ${field} must include {version}`);
    }
  }
  if (!manifest?.surfaces?.studio?.checksumAsset) {
    failures.push("release-manifest.json Studio checksumAsset is required");
  }

  return failures;
}

export function buildWebReleaseArtifact(manifest, sourceCommit) {
  const canonical = serializeJson(manifest);
  return {
    schemaVersion: 1,
    provenance: {
      repository: "https://github.com/sarveshsea/memi",
      path: "release-manifest.json",
      sourceCommit,
      sourceUrl:
        `https://raw.githubusercontent.com/sarveshsea/memi/${sourceCommit}/release-manifest.json`,
      manifestSha256: createHash("sha256").update(canonical).digest("hex"),
    },
    release: manifest,
  };
}

export function validateWebReleaseArtifact(manifest, artifact) {
  const failures = [];
  const provenance = artifact?.provenance;
  const canonical = serializeJson(manifest);
  const expectedDigest = createHash("sha256").update(canonical).digest("hex");

  if (artifact?.schemaVersion !== 1) {
    failures.push("release-artifacts/memoire-web.release.json schemaVersion must be 1");
  }
  if (serializeJson(artifact?.release) !== canonical) {
    failures.push("release-artifacts/memoire-web.release.json payload does not match release-manifest.json");
  }
  if (provenance?.repository !== "https://github.com/sarveshsea/memi"
    || provenance?.path !== "release-manifest.json") {
    failures.push("website release artifact provenance must identify the canonical Memi manifest");
  }
  if (!COMMIT_SHA.test(provenance?.sourceCommit ?? "")) {
    failures.push("website release artifact provenance must include an exact source commit");
  }
  const expectedSourceUrl =
    `https://raw.githubusercontent.com/sarveshsea/memi/${provenance?.sourceCommit}/release-manifest.json`;
  if (provenance?.sourceUrl !== expectedSourceUrl) {
    failures.push(`website release artifact source URL must be ${expectedSourceUrl}`);
  }
  if (provenance?.manifestSha256 !== expectedDigest) {
    failures.push("website release artifact SHA-256 does not match release-manifest.json");
  }

  return failures;
}

export function resolveManifestSourceCommit(root, manifest) {
  const sourceCommit = execFileSync(
    "git",
    ["log", "-1", "--format=%H", "--", "release-manifest.json"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  if (!COMMIT_SHA.test(sourceCommit)) {
    throw new Error("release-manifest.json must be committed before generating its website artifact");
  }
  const committed = execFileSync(
    "git",
    ["show", `${sourceCommit}:release-manifest.json`],
    { cwd: root, encoding: "utf8" },
  );
  if (serializeJson(JSON.parse(committed)) !== serializeJson(manifest)) {
    throw new Error("release-manifest.json changed after its source commit; commit it before generating artifacts");
  }
  return sourceCommit;
}

export async function verifyCoreReleaseSurfaces(root, manifest) {
  const failures = validateReleaseManifest(manifest);
  const version = manifest?.releaseGroups?.engine?.version;
  const npm = manifest?.surfaces?.npm;
  const mcp = manifest?.surfaces?.mcp;

  const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
  const packageJson = await readJson("package.json");
  const packageLock = await readJson("package-lock.json");
  const server = await readJson("server.json");
  const mcpb = await readJson("mcpb/manifest.json");
  const codexPlugin = await readJson("plugins/memoire/.codex-plugin/plugin.json");
  const claudePlugin = await readJson("plugins/memi-claude/.claude-plugin/plugin.json");
  const widget = await readJson("plugin/widget-meta.json");
  const action = await readFile(join(root, "action.yml"), "utf8");

  const exactVersions = [
    ["package.json", packageJson.version],
    ["package-lock.json", packageLock.version],
    ["package-lock.json root", packageLock.packages?.[""]?.version],
    ["server.json", server.version],
    ["server.json npm package", server.packages?.find((entry) => entry.registryType === "npm")?.version],
    ["mcpb/manifest.json", mcpb.version],
    ["Codex plugin", codexPlugin.version],
    ["Claude plugin", claudePlugin.version],
    ["Figma widget metadata", widget.packageVersion],
  ];
  for (const [surface, actual] of exactVersions) {
    if (actual !== version) failures.push(`${surface} version ${actual ?? "missing"} does not match release manifest ${version}`);
  }

  if (packageJson.name !== npm?.packageName) {
    failures.push(`package.json name ${packageJson.name} does not match release manifest ${npm?.packageName}`);
  }
  if (packageJson.mcpName !== mcp?.serverName || server.name !== mcp?.serverName) {
    failures.push("package.json and server.json MCP names must match the release manifest");
  }
  if (!action.includes(`default: "${version}"`)) {
    failures.push(`action.yml default CLI version does not match release manifest ${version}`);
  }
  if (!action.includes(`reviewed ${version} pin`)) {
    failures.push(`action.yml version description does not match release manifest ${version}`);
  }
  for (const scriptName of ["build:mcpb", "publish:smithery"]) {
    if (!packageJson.scripts?.[scriptName]?.includes(`memi-${version}.mcpb`)) {
      failures.push(`package.json ${scriptName} does not use release manifest ${version}`);
    }
  }

  const artifactPath = join(root, "release-artifacts", "memoire-web.release.json");
  const artifact = await readFile(artifactPath, "utf8")
    .then((content) => JSON.parse(content))
    .catch(() => null);
  failures.push(...validateWebReleaseArtifact(manifest, artifact));

  return failures;
}
