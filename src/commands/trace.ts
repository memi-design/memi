import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import type { MemoireEngine } from "../engine/core.js";
import { buildTraceReceipt } from "../efficiency/trace-receipt.js";
import { asId } from "../studio/contracts/ids.js";
import {
  collectReplay,
  FileEventJournal,
} from "../studio/journal/event-journal.js";
import { ui } from "../tui/format.js";

export function registerTraceCommand(program: Command, engine: MemoireEngine): void {
  const trace = program
    .command("trace")
    .description("Inspect and export privacy-safe ProviderRuntime trace receipts");

  trace
    .command("list")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      await engine.init("minimal");
      const sessions = await new FileEventJournal(engine.config.projectRoot).list();
      if (opts.json) console.log(JSON.stringify({ sessions }, null, 2));
      else sessions.forEach((session) => console.log(String(session)));
    });

  trace
    .command("inspect <session>")
    .option("--json", "Output JSON")
    .action(async (session: string, opts: { json?: boolean }) => {
      await engine.init("minimal");
      const result = await receiptFor(engine.config.projectRoot, session);
      if (opts.json) console.log(JSON.stringify({ receipt: result.receipt }, null, 2));
      else {
        console.log(ui.section("TRACE RECEIPT"));
        console.log(ui.dots("Session", result.receipt.sessionId));
        console.log(ui.dots("Events", String(result.receipt.eventCount)));
        console.log(ui.dots("Tokens", String(result.receipt.usage.totalTokens)));
        console.log(ui.dots("SHA-256", result.receipt.sha256));
      }
    });

  trace
    .command("export <session>")
    .requiredOption("--out <path>", "Output JSON path")
    .option("--json", "Output JSON")
    .action(async (session: string, opts: { out: string; json?: boolean }) => {
      await engine.init("minimal");
      const result = await receiptFor(engine.config.projectRoot, session);
      const out = resolve(opts.out);
      await mkdir(dirname(out), { recursive: true, mode: 0o700 });
      await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, {
        encoding: "utf-8",
        mode: 0o600,
      });
      const payload = { status: "exported", path: out, receipt: result.receipt };
      if (opts.json) console.log(JSON.stringify(payload, null, 2));
      else console.log(ui.ok(`Trace exported: ${out}`));
    });
}

async function receiptFor(projectRoot: string, session: string) {
  const sessionId = asId("SessionId", session);
  const events = await collectReplay(new FileEventJournal(projectRoot), sessionId);
  if (events.length === 0) throw new Error(`No trace events found for ${session}`);
  return buildTraceReceipt(session, events);
}
