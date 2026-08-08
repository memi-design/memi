import { mkdtemp, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  WEB_VERIFICATION_REQUIREMENTS,
  runWebVerificationAdapter,
  type WebArtifactCandidate,
  type WebVerificationDriver,
} from "../web-adapter.js";

const STARTED_AT = "2026-08-06T12:00:00.000Z";
const COMPLETED_AT = "2026-08-06T12:01:00.000Z";
const CAPTURED_AT = "2026-08-06T12:00:10.000Z";

describe("web frontend verification adapter", () => {
  it("admits a complete immutable Chromium evidence set with deterministic hashes", async () => {
    const root = await evidenceRoot();
    const candidates = await writeCompleteEvidence(root);
    const driver = fixtureDriver([...candidates].reverse());

    const result = await runWebVerificationAdapter({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, driver);

    expect(driver.capture).toHaveBeenCalledWith(WEB_VERIFICATION_REQUIREMENTS);
    expect(result.status).toBe("passed");
    expect(result.reasons).toEqual([]);
    expect(result.artifacts).toHaveLength(WEB_VERIFICATION_REQUIREMENTS.length);
    expect(result.artifacts.map((artifact) => artifact.requirementId)).toEqual(
      WEB_VERIFICATION_REQUIREMENTS.map((requirement) => requirement.id),
    );
    expect(result.artifacts.every((artifact) =>
      /^sha256:[a-f0-9]{64}$/.test(artifact.sha256))).toBe(true);
    expect(result.manifestSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.evidenceRootSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.artifacts)).toBe(true);
    expect(Object.isFrozen(result.artifacts[0])).toBe(true);

    const repeated = await runWebVerificationAdapter({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, fixtureDriver(candidates));
    expect(repeated.manifestSha256).toBe(result.manifestSha256);
  });

  it("rejects missing evidence without creating an imputed receipt", async () => {
    const root = await evidenceRoot();
    const candidates = await writeCompleteEvidence(root);
    const missingId = "state-error";

    const result = await runWebVerificationAdapter({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, fixtureDriver(candidates.filter((candidate) =>
      candidate.requirementId !== missingId)));

    expect(result.status).toBe("rejected");
    expect(result.reasons).toContain(`artifact-missing:${missingId}`);
    expect(result.artifacts.some((artifact) =>
      artifact.requirementId === missingId)).toBe(false);
  });

  it("rejects stale evidence", async () => {
    const root = await evidenceRoot();
    const candidates = await writeCompleteEvidence(root);
    const target = candidates.find((candidate) =>
      candidate.requirementId === "desktop-default")!;
    const stale = candidates.map((candidate) =>
      candidate === target
        ? { ...candidate, capturedAt: "2026-08-06T11:59:59.000Z" }
        : candidate);

    const result = await runWebVerificationAdapter({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, fixtureDriver(stale));

    expect(result.status).toBe("rejected");
    expect(result.reasons).toContain("artifact-stale:desktop-default");
  });

  it("rejects a file whose filesystem timestamp predates the run", async () => {
    const root = await evidenceRoot();
    const candidates = await writeCompleteEvidence(root);
    const target = candidates.find((candidate) =>
      candidate.requirementId === "desktop-default")!;
    const staleTimestamp = new Date("2026-08-06T11:59:59.000Z");
    await utimes(join(root, target.path), staleTimestamp, staleTimestamp);

    const result = await runWebVerificationAdapter({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, fixtureDriver(candidates));

    expect(result.status).toBe("rejected");
    expect(result.reasons).toContain("artifact-stale:desktop-default");
  });

  it("rejects artifacts that resolve outside the evidence root", async () => {
    const root = await evidenceRoot();
    const outside = await evidenceRoot();
    const candidates = await writeCompleteEvidence(root);
    const target = candidates.find((candidate) =>
      candidate.requirementId === "desktop-default")!;
    await writeFile(join(outside, "escaped.png"), pngBytes());
    await symlink(join(outside, "escaped.png"), join(root, "escaped.png"));
    const escaped = candidates.map((candidate) =>
      candidate === target ? { ...candidate, path: "escaped.png" } : candidate);

    const result = await runWebVerificationAdapter({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, fixtureDriver(escaped));

    expect(result.status).toBe("rejected");
    expect(result.reasons).toContain(
      "artifact-outside-evidence-root:desktop-default",
    );
  });

  it("rejects duplicate and corrupt artifacts", async () => {
    const root = await evidenceRoot();
    const candidates = await writeCompleteEvidence(root);
    const target = candidates.find((candidate) =>
      candidate.requirementId === "mobile-default")!;
    await writeFile(join(root, target.path), "not-a-png");
    await setFresh(join(root, target.path));

    const result = await runWebVerificationAdapter({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, fixtureDriver([...candidates, target]));

    expect(result.status).toBe("rejected");
    expect(result.reasons).toContain("artifact-duplicate:mobile-default");
    expect(result.reasons).toContain("artifact-invalid-content:mobile-default");
  });

  it("rejects truncated files that only contain a valid format signature", async () => {
    const root = await evidenceRoot();
    const candidates = await writeCompleteEvidence(root);
    const screenshot = candidates.find((candidate) =>
      candidate.requirementId === "desktop-default")!;
    const trace = candidates.find((candidate) =>
      candidate.requirementId === "interaction-trace")!;
    await writeFile(
      join(root, screenshot.path),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    await writeFile(
      join(root, trace.path),
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );
    await setFresh(join(root, screenshot.path));
    await setFresh(join(root, trace.path));

    const result = await runWebVerificationAdapter({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, fixtureDriver(candidates));

    expect(result.status).toBe("rejected");
    expect(result.reasons).toContain("artifact-invalid-content:desktop-default");
    expect(result.reasons).toContain("artifact-invalid-content:interaction-trace");
  });

  it("distinguishes complete failing checks from inadmissible evidence", async () => {
    const root = await evidenceRoot();
    const candidates = await writeCompleteEvidence(root, {
      axe: {
        schemaVersion: 1,
        completed: true,
        violations: [{ id: "color-contrast", impact: "serious", nodes: 2 }],
      },
      focus: {
        schemaVersion: 1,
        completed: true,
        interactions: 4,
        failures: ["submit control has no visible focus indicator"],
      },
    });

    const result = await runWebVerificationAdapter({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, fixtureDriver(candidates));

    expect(result.status).toBe("failed");
    expect(result.reasons).toContain("axe-blocking-violations:serious=1:critical=0");
    expect(result.reasons).toContain("keyboard-focus-failures:1");
    expect(result.artifacts).toHaveLength(WEB_VERIFICATION_REQUIREMENTS.length);
  });

  it("fails closed when the capture driver fails", async () => {
    const root = await evidenceRoot();
    const driver: WebVerificationDriver = {
      capture: vi.fn(async () => {
        throw new Error("browser crashed with token=do-not-persist");
      }),
    };

    const result = await runWebVerificationAdapter({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, driver);

    expect(result.status).toBe("rejected");
    expect(result.reasons).toEqual(["capture-failed:Error"]);
    expect(JSON.stringify(result)).not.toContain("do-not-persist");
    expect(result.artifacts).toEqual([]);
  });

  it("fails closed when a driver returns a malformed candidate collection", async () => {
    const root = await evidenceRoot();
    const driver = {
      capture: vi.fn(async () => null),
    } as unknown as WebVerificationDriver;

    const result = await runWebVerificationAdapter({
      evidenceRoot: root,
      runStartedAt: STARTED_AT,
      runCompletedAt: COMPLETED_AT,
    }, driver);

    expect(result.status).toBe("rejected");
    expect(result.reasons).toEqual(["capture-invalid:candidates-must-be-an-array"]);
    expect(result.artifacts).toEqual([]);
  });
});

function fixtureDriver(
  candidates: readonly WebArtifactCandidate[],
): WebVerificationDriver & { capture: ReturnType<typeof vi.fn> } {
  return {
    capture: vi.fn(async () => candidates),
  };
}

async function evidenceRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "memi-web-verification-"));
}

async function writeCompleteEvidence(
  root: string,
  overrides: {
    readonly axe?: unknown;
    readonly focus?: unknown;
  } = {},
): Promise<readonly WebArtifactCandidate[]> {
  const candidates: WebArtifactCandidate[] = [];
  for (const requirement of WEB_VERIFICATION_REQUIREMENTS) {
    const extension = requirement.kind === "screenshot"
      ? "png"
      : requirement.kind === "interaction-trace" ? "zip" : "json";
    const relativePath = `${requirement.id}.${extension}`;
    const absolutePath = join(root, relativePath);
    const bytes = requirement.kind === "screenshot"
      ? pngBytes()
      : requirement.kind === "interaction-trace"
      ? zipBytes()
      : Buffer.from(JSON.stringify(
        requirement.kind === "axe"
          ? overrides.axe ?? { schemaVersion: 1, completed: true, violations: [] }
          : overrides.focus ?? {
            schemaVersion: 1,
            completed: true,
            interactions: 4,
            failures: [],
          },
      ));
    await writeFile(absolutePath, bytes);
    await setFresh(absolutePath);
    candidates.push({
      requirementId: requirement.id,
      browser: "chromium",
      path: relativePath,
      capturedAt: CAPTURED_AT,
    });
  }
  return candidates;
}

async function setFresh(path: string): Promise<void> {
  const timestamp = new Date(CAPTURED_AT);
  await utimes(path, timestamp, timestamp);
}

function pngBytes(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}

function zipBytes(): Buffer {
  // Empty ZIP archive with a complete end-of-central-directory record.
  return Buffer.from([
    0x50, 0x4b, 0x05, 0x06,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00,
  ]);
}
