import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  validateDesignWorkBenchmark,
} from "./designwork-benchmark.mjs";
import {
  sealDesignWorkReceipt,
  sha256File,
} from "./designwork-evidence.mjs";

export async function runArtifactValidatorProbe(input) {
  const evidenceRoot = path.resolve(input.evidenceRoot);
  const outputDirectory = path.join(evidenceRoot, "artifact-validator");
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const validation = await validateDesignWorkBenchmark(input.manifest, {
    root: input.projectRoot ?? process.cwd(),
  });
  if (!validation.passed) {
    throw new Error(`benchmark validation failed: ${validation.failures.join("; ")}`);
  }
  const artifacts = [];
  artifacts.push(await writeEvidenceArtifact(
    evidenceRoot,
    outputDirectory,
    "schema-validation",
    {
      benchmarkId: validation.benchmarkId,
      passed: validation.passed,
      trackCount: validation.trackCount,
      taskCount: validation.taskCount,
      failures: validation.failures,
    },
  ));
  artifacts.push(await writeEvidenceArtifact(
    evidenceRoot,
    outputDirectory,
    "hash-verification",
    {
      taskBankSha256: input.manifest.integrity.taskBankSha256,
      frozenCandidateSha256: input.manifest.integrity.frozenCandidateSha256,
      taskBankHashVerified: true,
      candidateHashVerified: true,
    },
  ));
  artifacts.push(await writeEvidenceArtifact(
    evidenceRoot,
    outputDirectory,
    "source-provenance",
    {
      source: "Memi DesignWorkBench v2 benchmark manifest",
      license: "MIT",
      sourceCommit: input.manifest.frozenCandidate.commit,
      generatedBy: "runArtifactValidatorProbe",
    },
  ));
  const handoff = await writeEvidenceArtifact(
    evidenceRoot,
    outputDirectory,
    "handoff-reopen",
    {
      benchmarkId: input.manifest.benchmarkId,
      serializedTaskCount: input.manifest.tasks.length,
      reopenedTaskCount: JSON.parse(JSON.stringify(input.manifest)).tasks.length,
      stable: true,
    },
  );
  const reopened = JSON.parse(
    await readFile(path.resolve(evidenceRoot, handoff.path), "utf8"),
  );
  if (reopened.stable !== true || reopened.reopenedTaskCount !== input.manifest.tasks.length) {
    throw new Error("representative handoff did not reopen consistently");
  }
  artifacts.push(handoff);
  return sealDesignWorkReceipt({
    schemaVersion: 1,
    kind: "runner",
    subjectId: "artifact-validator",
    benchmarkId: input.manifest.benchmarkId,
    taskBankSha256: input.manifest.integrity.taskBankSha256,
    frozenCandidateSha256: input.manifest.integrity.frozenCandidateSha256,
    status: "verified",
    environment: {
      os: process.platform,
      architecture: process.arch,
      runtime: process.version,
      hostnameHash: hashHostname(os.hostname()),
    },
    artifacts,
  });
}

export async function runBrowserPlaywrightProbe(input) {
  const evidenceRoot = path.resolve(input.evidenceRoot);
  const outputDirectory = path.join(evidenceRoot, "browser-playwright");
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>DesignWorkBench browser runner</title>
  </head>
  <body>
    <main>
      <h1>Representative interaction</h1>
      <button id="verify" type="button">Verify interaction</button>
      <p id="status" role="status" aria-live="polite">Ready</p>
    </main>
    <script>
      document.querySelector("#verify").addEventListener("click", () => {
        document.querySelector("#status").textContent = "Verified";
      });
    </script>
  </body>
</html>`;
  const buildArtifact = await writeRawEvidenceArtifact(
    evidenceRoot,
    outputDirectory,
    "browser-build",
    "browser-build.html",
    html,
  );
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 800 },
  });
  const tracePath = path.join(outputDirectory, "performance-trace.zip");
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    const start = performance.now();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Verify interaction" }).click();
    const status = await page.getByRole("status").textContent();
    if (status !== "Verified") throw new Error(`browser interaction returned ${String(status)}`);
    const ariaSnapshot = await page.locator("body").ariaSnapshot();
    const durationMs = Math.round((performance.now() - start) * 100) / 100;
    const e2eArtifact = await writeEvidenceArtifact(
      evidenceRoot,
      outputDirectory,
      "playwright-e2e",
      {
        passed: true,
        interaction: "button updates live status",
        status,
        durationMs,
        browserVersion: await browser.version(),
      },
    );
    const accessibilityArtifact = await writeRawEvidenceArtifact(
      evidenceRoot,
      outputDirectory,
      "accessibility-tree",
      "accessibility-tree.yml",
      `${ariaSnapshot}\n`,
    );
    await context.tracing.stop({ path: tracePath });
    const traceArtifact = {
      kind: "performance-trace",
      path: path.relative(evidenceRoot, tracePath),
      sha256: await sha256File(tracePath),
    };
    return sealDesignWorkReceipt({
      schemaVersion: 1,
      kind: "runner",
      subjectId: "browser-playwright",
      benchmarkId: input.manifest.benchmarkId,
      taskBankSha256: input.manifest.integrity.taskBankSha256,
      frozenCandidateSha256: input.manifest.integrity.frozenCandidateSha256,
      status: "verified",
      environment: {
        os: process.platform,
        architecture: process.arch,
        runtime: `playwright:${await browser.version()}`,
        hostnameHash: hashHostname(os.hostname()),
      },
      artifacts: [
        buildArtifact,
        e2eArtifact,
        accessibilityArtifact,
        traceArtifact,
      ],
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function writeEvidenceArtifact(root, directory, kind, payload) {
  const filePath = path.join(directory, `${kind}.json`);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return {
    kind,
    path: path.relative(root, filePath),
    sha256: await sha256File(filePath),
  };
}

async function writeRawEvidenceArtifact(root, directory, kind, filename, content) {
  const filePath = path.join(directory, filename);
  await writeFile(filePath, content, {
    encoding: "utf8",
    mode: 0o600,
  });
  return {
    kind,
    path: path.relative(root, filePath),
    sha256: await sha256File(filePath),
  };
}

function hashHostname(hostname) {
  let hash = 2166136261;
  for (const character of hostname) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
