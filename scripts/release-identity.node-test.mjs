import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

async function readJson(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

test("2.7.7 records the organization registry identity and pending Smithery migration", async () => {
  const identity = await readJson("release-artifacts/identity/2.7.7.identity.json");

  assert.equal(identity.release.version, "2.7.7");
  assert.equal(identity.publisher.organization, "memi-design");
  assert.deepEqual(identity.surfaces.mcpRegistry, {
    identifier: "io.github.memi-design/memi",
    status: "published",
    version: "2.7.7",
    url: "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.memi-design%2Fmemi",
    legacy: {
      identifier: "io.github.sarveshsea/memi",
      status: "deprecated",
      provenanceOnly: true,
    },
  });
  assert.equal(identity.surfaces.smithery.identifier, "memi-design/memi");
  assert.equal(identity.surfaces.smithery.status, "migration_pending");
  assert.equal(identity.surfaces.smithery.publishTarget, "memi-design/memi");
  assert.equal(identity.surfaces.smithery.legacy.status, "deprecated_compatibility");
  assert.equal(
    identity.surfaces.smithery.legacy.operationalUrl,
    "https://smithery.ai/servers/sarveshsea/memi",
  );
});

test("current publisher metadata targets memi-design", async () => {
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
  assert.equal(claudePlugin.author.url, "https://github.com/memi-design");
  assert.equal(claudePlugin.repository, "https://github.com/memi-design/memi");
  assert.equal(glama.homepage, "https://www.memoire.cv");
  assert.equal(glama.author, "memi-design");
});

test("current documentation separates canonical, pending, and deprecated identities", async () => {
  const [readme, officialMcp, identityGuide] = await Promise.all([
    readFile(join(root, "README.md"), "utf8"),
    readFile(join(root, "docs", "OFFICIAL_MCP_REGISTRY.md"), "utf8"),
    readFile(join(root, "docs", "ECOSYSTEM_IDENTITY.md"), "utf8"),
  ]);

  assert.match(readme, /io\.github\.memi-design\/memi/);
  assert.match(readme, /Smithery migration pending/);
  assert.match(officialMcp, /io\.github\.sarveshsea\/memi` is deprecated/);
  assert.doesNotMatch(officialMcp, /login must match the `io\.github\.sarveshsea\/\*` namespace/);
  assert.match(identityGuide, /`memi-design\/memi` is the intended Smithery publish target/);
  assert.match(
    identityGuide,
    /`sarveshsea\/memi` remains operational only as a deprecated compatibility alias/,
  );
});
