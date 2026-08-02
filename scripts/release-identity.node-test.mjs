import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  loadAndValidateEcosystemIdentity,
  validateEcosystemIdentity,
} from "./lib/ecosystem-identity.mjs";

const root = process.cwd();

async function readJson(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

test("current release derives and validates its packaged ecosystem identity receipt", async () => {
  const context = await loadAndValidateEcosystemIdentity(root);
  const { identity, identityPath, packageJson, releaseManifest } = context;
  const version = packageJson.version;

  assert.equal(version, releaseManifest.releaseGroups.engine.version);
  assert.equal(identityPath, `release-artifacts/identity/${version}.identity.json`);
  assert.equal(identity.release.version, version);
  assert.equal(identity.release.npmReceipt, releaseManifest.releaseGroups.engine.releaseRecord.path);
  assert.equal(identity.publisher.organization, "memi-design");
  assert.deepEqual(identity.surfaces.mcpRegistry, {
    identifier: "io.github.memi-design/memi",
    status: "published",
    version,
    url: "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.memi-design%2Fmemi",
    legacy: {
      identifier: "io.github.sarveshsea/memi",
      policyStatus: "deprecated",
      observedStatus: "active",
      latestObservedVersion: "2.7.4",
      observedVersions: [
        "1.0.1",
        "1.1.0",
        "1.1.1",
        "2.3.1",
        "2.4.0",
        "2.4.1",
        "2.5.0",
        "2.6.0",
        "2.6.1",
        "2.6.3",
        "2.7.3",
        "2.7.4",
      ],
      observedAt: "2026-08-02",
    },
  });
  assert.deepEqual(identity.verification.mcpRegistryLegacyRecord, {
    httpStatus: 200,
    observedStatus: "active",
    resultCount: 12,
    latestObservedVersion: "2.7.4",
    claimBoundary: "The registry status is observed upstream state; Memi policy deprecates this identity for new integrations.",
  });
});

test("identity validation rejects stale versions, paths, and npm receipt digests", async () => {
  const context = await loadAndValidateEcosystemIdentity(root);
  assert.deepEqual(validateEcosystemIdentity(context), []);

  const staleIdentity = structuredClone(context.identity);
  staleIdentity.release.version = "2.7.6";
  assert.match(
    validateEcosystemIdentity({ ...context, identity: staleIdentity }).join("\n"),
    /identity release version must match package\.json/,
  );

  const stalePackage = structuredClone(context.packageJson);
  stalePackage.files.push("release-artifacts/identity/2.7.6.identity.json");
  assert.match(
    validateEcosystemIdentity({ ...context, packageJson: stalePackage }).join("\n"),
    /package\.json must package only the current ecosystem identity receipt/,
  );

  const staleReceipt = structuredClone(context.identity);
  staleReceipt.release.npmReceiptSha256 = "f".repeat(64);
  assert.match(
    validateEcosystemIdentity({ ...context, identity: staleReceipt }).join("\n"),
    /npm receipt SHA-256 does not match the committed receipt bytes/,
  );
});

test("current publisher metadata targets memi-design and working legal routes", async () => {
  const [packageJson, mcpb, codexPlugin, claudePlugin, glama] = await Promise.all([
    readJson("package.json"),
    readJson("mcpb/manifest.json"),
    readJson("plugins/memoire/.codex-plugin/plugin.json"),
    readJson("plugins/memi-claude/.claude-plugin/plugin.json"),
    readJson("glama.json"),
  ]);

  assert.match(packageJson.scripts["publish:smithery"], /-n memi-design\/memi(?:\s|$)/);
  assert.doesNotMatch(packageJson.scripts["publish:smithery"], /-n sarveshsea\/memi(?:\s|$)/);
  assert.deepEqual(mcpb.author, {
    name: "Memi Design",
    url: "https://github.com/memi-design",
  });
  assert.equal(mcpb.repository.url, "https://github.com/memi-design/memi.git");
  assert.equal(codexPlugin.author.url, "https://github.com/memi-design");
  assert.equal(codexPlugin.repository, "https://github.com/memi-design/memi");
  assert.equal(codexPlugin.privacyPolicyURL, "https://www.memoire.cv/legal");
  assert.equal(codexPlugin.termsOfServiceURL, "https://www.memoire.cv/legal");
  assert.equal(codexPlugin.interface.privacyPolicyURL, "https://www.memoire.cv/legal");
  assert.equal(codexPlugin.interface.termsOfServiceURL, "https://www.memoire.cv/legal");
  assert.equal(claudePlugin.author.url, "https://github.com/memi-design");
  assert.equal(claudePlugin.repository, "https://github.com/memi-design/memi");
  assert.equal(glama.homepage, "https://www.memoire.cv");
  assert.equal(glama.author, "memi-design");
});

test("operational automation has no personal owner or scope references", async () => {
  const paths = [
    ".github/workflows/promote-release.yml",
    ".github/workflows/release-binaries.yml",
    "scripts/lib/growth-status.mjs",
    "scripts/publish-ready.mjs",
  ];
  const sources = await Promise.all(paths.map(async (path) => [
    path,
    await readFile(join(root, path), "utf8"),
  ]));
  const forbidden = [
    "sarveshsea/homebrew-memi",
    "sarveshsea-bot",
    "from sarveshsea/memi",
    "@sarveshsea scope",
  ];

  for (const [path, source] of sources) {
    for (const legacy of forbidden) {
      assert.doesNotMatch(source, new RegExp(legacy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${path}: ${legacy}`);
    }
  }
  assert.match(sources[0][1], /github\.com\/memi-design\/homebrew-memi\.git/);
  assert.match(sources[1][1], /github\.com\/memi-design\/homebrew-memi\.git/);
  assert.match(sources[2][1], /raw\.githubusercontent\.com\/memi-design\/homebrew-memi/);
  assert.match(sources[3][1], /@memi-design scope/);
});

test("current documentation separates policy from observed legacy registry state", async () => {
  const [readme, officialMcp, identityGuide] = await Promise.all([
    readFile(join(root, "README.md"), "utf8"),
    readFile(join(root, "docs", "OFFICIAL_MCP_REGISTRY.md"), "utf8"),
    readFile(join(root, "docs", "ECOSYSTEM_IDENTITY.md"), "utf8"),
  ]);

  assert.match(readme, /io\.github\.memi-design\/memi/);
  assert.match(readme, /Smithery migration pending/);
  assert.match(officialMcp, /policy is deprecated/);
  assert.match(officialMcp, /registry still reports .*`active`.*`2\.7\.4`/s);
  assert.match(identityGuide, /`memi-design\/memi` is the intended Smithery publish target/);
  assert.match(
    identityGuide,
    /`sarveshsea\/memi` remains operational only as a deprecated compatibility alias/,
  );
});
