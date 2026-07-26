import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowsDir = join(process.cwd(), ".github", "workflows");

const EXPECTED_REFS = new Map<string, string>([
  ["actions/checkout", "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1"],
  ["actions/setup-node", "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020"],
  ["actions/upload-artifact", "actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f"],
  ["actions/download-artifact", "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"],
  ["github/codeql-action/upload-sarif", "github/codeql-action/upload-sarif@1b168cd39490f61582a9beae412bb7057a6b2c4e"],
  ["oven-sh/setup-bun", "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6"],
  ["softprops/action-gh-release", "softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228"],
  ["docker/setup-buildx-action", "docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c"],
  ["docker/login-action", "docker/login-action@abd2ef45e78c5afb21d64d4ca52ee8550d9572c7"],
  ["docker/build-push-action", "docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a"],
  ["hashgraph-online/ai-plugin-scanner-action", "hashgraph-online/ai-plugin-scanner-action@8f0a503ca2a70c1968a9a883e11fdff5737b7909"],
]);

async function workflowFiles(): Promise<string[]> {
  return (await readdir(workflowsDir))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
}

function thirdPartyUses(source: string): string[] {
  return [...source.matchAll(/^\s+-?\s*uses:\s+([^\s#]+)(?:\s+#.*)?$/gm)]
    .map(([, ref]) => ref)
    .filter((ref) => !ref.startsWith("./"));
}

function jobSource(workflow: string, jobId: string): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${jobId}:`);
  if (start === -1) return "";
  const endOffset = lines.slice(start + 1).findIndex((line) => /^ {2}[a-zA-Z0-9_-]+:\s*$/.test(line));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  return lines.slice(start, end).join("\n");
}

describe("workflow third-party action pins", () => {
  it("defaults every workflow to read-only repository contents", async () => {
    for (const name of await workflowFiles()) {
      const workflow = await readFile(join(workflowsDir, name), "utf8");
      const jobsOffset = workflow.search(/^jobs:\s*$/m);
      expect(jobsOffset, `${name}: jobs block`).toBeGreaterThan(0);
      const workflowDefaults = workflow.slice(0, jobsOffset);
      expect(workflowDefaults, `${name}: top-level contents permission`).toMatch(
        /^permissions:\s*\n {2}contents:\s*read\s*$/m,
      );
      expect(workflowDefaults, `${name}: top-level write permission`).not.toMatch(
        /^ {2}[a-z-]+:\s*write\s*$/m,
      );
    }
  });

  it("retains the job-scoped write permissions required by publishing and SARIF upload", async () => {
    const expected = [
      ["ci.yml", "memi-ci", ["contents: read", "security-events: write"]],
      ["hol-plugin-scanner.yml", "scan", ["contents: read", "security-events: write"]],
      ["publish.yml", "publish", ["contents: read", "id-token: write"]],
      ["publish-mcp-registry.yml", "publish", ["contents: read", "id-token: write"]],
      ["release-binaries.yml", "build", ["contents: write"]],
      ["release-binaries.yml", "publish-checksums", ["contents: write"]],
      ["release-binaries.yml", "publish-docker", ["contents: read", "packages: write"]],
      ["runtime-release.yml", "publish-release", ["contents: write"]],
    ] as const;

    for (const [name, jobId, permissions] of expected) {
      const workflow = await readFile(join(workflowsDir, name), "utf8");
      const job = jobSource(workflow, jobId);
      expect(job, `${name}: jobs.${jobId}`).not.toBe("");
      for (const permission of permissions) {
        expect(job, `${name}: jobs.${jobId}.permissions.${permission}`).toMatch(
          new RegExp(`^ {6}${permission.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
        );
      }
    }
  });

  it("pins every workflow action to an immutable commit", async () => {
    for (const name of await workflowFiles()) {
      const workflow = await readFile(join(workflowsDir, name), "utf8");
      for (const ref of thirdPartyUses(workflow)) {
        expect(ref, `${name}: ${ref}`).toMatch(/^[^@]+@[0-9a-f]{40}$/);
      }
    }
  });

  it("uses the current audited action refs across workflow files", async () => {
    for (const name of await workflowFiles()) {
      const workflow = await readFile(join(workflowsDir, name), "utf8");
      for (const ref of thirdPartyUses(workflow)) {
        const action = ref.slice(0, ref.indexOf("@"));
        const expected = EXPECTED_REFS.get(action);
        if (!expected) continue;
        expect(ref, `${name}: ${action}`).toBe(expected);
      }
    }
  });
});
