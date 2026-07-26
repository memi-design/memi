import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditScorecard } from "../scorecard.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const script = join(repoRoot, "scripts", "render-audit-scorecard.ts");
const tsx = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memi-scorecard-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "docs", "audits"), { recursive: true });
  const proof = `${JSON.stringify({ status: "passed" })}\n`;
  const proofHash = createHash("sha256").update(proof).digest("hex");
  await writeFile(join(root, "docs", "audits", "proof.json"), proof, "utf8");
  const ledger: AuditScorecard = {
    schemaVersion: 1,
    auditId: "fixture-audit",
    title: "Fixture audit",
    targetScore: 100,
    assessedAt: "2026-07-26T12:00:00.000Z",
    subject: {
      repository: "https://github.com/sarveshsea/memi",
      commit: "29a620569723565597837415d5947bc36a042c20",
    },
    evidence: [
      {
        id: "verified-proof",
        kind: "implementation",
        status: "passed",
        capturedAt: "2026-07-26T10:00:00.000Z",
        artifact: { location: "proof.json", sha256: proofHash },
        producer: "builder",
        verifier: "reviewer",
        environment: "fixture",
      },
    ],
    dimensions: [
      {
        id: "activation",
        title: "Activation",
        maximum: 100,
        owner: "core",
        criteria: [
          {
            id: "proof",
            title: "Proof",
            points: 100,
            assessment: "passed",
            evidenceIds: ["verified-proof"],
            requiresIndependentVerification: true,
          },
        ],
      },
    ],
    caps: [],
  };
  await writeFile(
    join(root, "docs", "audits", "ledger.json"),
    `${JSON.stringify(ledger, null, 2)}\n`,
    "utf8",
  );
  return root;
}

function run(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [
    tsx,
    script,
    "--root",
    root,
    "--input",
    "docs/audits/ledger.json",
    "--output",
    "docs/audits/report.md",
    ...args,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

describe("render-audit-scorecard", () => {
  it("writes deterministic Markdown with only the ledger hash as report provenance", async () => {
    const root = await fixtureRoot();

    const first = run(root);
    const firstReport = await readFile(join(root, "docs", "audits", "report.md"), "utf8");
    const second = run(root);
    const secondReport = await readFile(join(root, "docs", "audits", "report.md"), "utf8");

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(secondReport).toBe(firstReport);
    expect(firstReport).toContain("**Verified score: 100/100**");
    expect(firstReport).toMatch(/Ledger SHA-256: `[a-f0-9]{64}`/);
    expect(firstReport).not.toContain("Report SHA-256");
  });

  it("checks byte parity without writing and rejects report drift", async () => {
    const root = await fixtureRoot();
    expect(run(root).status).toBe(0);
    expect(run(root, "--check").status).toBe(0);

    await writeFile(join(root, "docs", "audits", "report.md"), "manually edited\n", "utf8");
    const drifted = run(root, "--check");

    expect(drifted.status).toBe(1);
    expect(drifted.stderr).toContain("Generated audit report is stale");
    expect(await readFile(join(root, "docs", "audits", "report.md"), "utf8")).toBe("manually edited\n");
  });

  it("rejects input and output paths outside docs/audits", async () => {
    const root = await fixtureRoot();
    const escaped = spawnSync(process.execPath, [
      tsx,
      script,
      "--root",
      root,
      "--input",
      "../ledger.json",
      "--output",
      "docs/audits/report.md",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(escaped.status).toBe(1);
    expect(escaped.stderr).toContain("must stay inside docs/audits");
  });

  it("recomputes evidence digests and fails closed when an artifact changes", async () => {
    const root = await fixtureRoot();
    expect(run(root).status).toBe(0);
    await writeFile(join(root, "docs", "audits", "proof.json"), "tampered\n", "utf8");

    const tampered = run(root, "--check");

    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toContain("Artifact digest mismatch for verified-proof");
  });
});
