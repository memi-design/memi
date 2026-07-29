import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerTraceCommand } from "../trace.js";
import { FileEventJournal } from "../../studio/journal/event-journal.js";
import { asId } from "../../studio/contracts/ids.js";
import { captureLogs, lastLog } from "./test-helpers.js";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "memi-trace-command-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("trace command", () => {
  it("inspects and exports a metadata-only reproducible receipt", async () => {
    const sessionId = asId("SessionId", "ses_nate");
    const journal = new FileEventJournal(projectRoot);
    await journal.append(sessionId, {
      schemaVersion: 1,
      eventId: asId("EventId", "evt_1"),
      seq: 1,
      harnessId: asId("HarnessId", "hns_codex"),
      providerInstanceId: asId("ProviderInstanceId", "prv_1"),
      sessionId,
      createdAt: "2026-07-29T12:00:00.000Z",
      type: "message.user",
      text: "Private Nate product prompt",
    });
    await journal.append(sessionId, {
      schemaVersion: 1,
      eventId: asId("EventId", "evt_2"),
      seq: 2,
      harnessId: asId("HarnessId", "hns_codex"),
      providerInstanceId: asId("ProviderInstanceId", "prv_1"),
      sessionId,
      createdAt: "2026-07-29T12:00:01.000Z",
      type: "usage.updated",
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 30,
      reasoningTokens: 10,
      estimatedCostUsd: 0.1,
    });

    const program = new Command();
    registerTraceCommand(program, engine() as never);
    const logs = captureLogs();
    await program.parseAsync(["trace", "inspect", sessionId, "--json"], { from: "user" });
    const inspected = JSON.parse(lastLog(logs));
    expect(inspected.receipt).toMatchObject({
      sessionId,
      eventCount: 2,
      contentIncluded: false,
      usage: {
        inputTokens: 100,
        cachedInputTokens: 20,
        totalTokens: 140,
      },
    });
    expect(JSON.stringify(inspected)).not.toContain("Private Nate");

    const outputPath = join(projectRoot, "trace-export.json");
    await program.parseAsync([
      "trace",
      "export",
      sessionId,
      "--out",
      outputPath,
      "--json",
    ], { from: "user" });
    const exported = JSON.parse(await readFile(outputPath, "utf-8"));
    expect(exported.receipt.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(exported)).not.toContain("Private Nate");
  });
});

function engine() {
  return {
    config: { projectRoot },
    async init() {},
  };
}
