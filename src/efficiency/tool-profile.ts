import { createHash } from "node:crypto";

export interface WorkflowToolProfile {
  readonly schemaVersion: 1;
  readonly provider: "codex" | "claude" | "unknown";
  readonly totalCalls: number;
  readonly preEditCalls: number;
  readonly postEditCalls: number;
  readonly categories: {
    readonly search: number;
    readonly read: number;
    readonly verification: number;
    readonly status: number;
    readonly other: number;
  };
  readonly batchedReadCalls: number;
  readonly repeatedVerificationCalls: number;
  readonly commandSequenceHash: string;
}

type Category = keyof WorkflowToolProfile["categories"];

interface ProfileCall {
  readonly category: Category;
  readonly mutation: boolean;
  readonly batchedRead: boolean;
  readonly verificationKey: string | null;
  readonly privateDigestInput: string;
  readonly afterEdit: boolean;
}

export function profileWorkflowTools(
  adapterId: string,
  trace: string,
): Readonly<WorkflowToolProfile> {
  const provider = adapterId.startsWith("codex:")
    ? "codex" as const
    : adapterId.startsWith("claude:")
      ? "claude" as const
      : "unknown" as const;
  const calls = provider === "codex"
    ? parseCodexCalls(trace)
    : provider === "claude"
      ? parseClaudeCalls(trace)
      : [];
  const categories = {
    search: 0,
    read: 0,
    verification: 0,
    status: 0,
    other: 0,
  };
  const verificationCounts = new Map<string, number>();
  let batchedReadCalls = 0;
  for (const call of calls) {
    categories[call.category] += 1;
    if (call.batchedRead) batchedReadCalls += 1;
    if (call.verificationKey) {
      verificationCounts.set(
        call.verificationKey,
        (verificationCounts.get(call.verificationKey) ?? 0) + 1,
      );
    }
  }
  const repeatedVerificationCalls = [...verificationCounts.values()]
    .reduce((total, count) => total + Math.max(0, count - 1), 0);
  const preEditCalls = calls.filter((call) => !call.afterEdit && !call.mutation).length;
  const digest = createHash("sha256");
  for (const call of calls) {
    digest.update(call.privateDigestInput);
    digest.update("\0");
  }
  return deepFreeze({
    schemaVersion: 1,
    provider,
    totalCalls: calls.length,
    preEditCalls,
    postEditCalls: calls.length - preEditCalls,
    categories,
    batchedReadCalls,
    repeatedVerificationCalls,
    commandSequenceHash: `sha256:${digest.digest("hex")}`,
  });
}

function parseCodexCalls(trace: string): ProfileCall[] {
  const calls: ProfileCall[] = [];
  let afterEdit = false;
  for (const event of parseJsonLines(trace)) {
    const item = record(event.item);
    if (event.type !== "item.completed" || !item) continue;
    if (item.type === "file_change") {
      afterEdit = true;
      continue;
    }
    if (item.type !== "command_execution") continue;
    const command = typeof item.command === "string" ? item.command : "";
    calls.push(profileCommand(command, afterEdit));
  }
  return calls;
}

function parseClaudeCalls(trace: string): ProfileCall[] {
  const calls: ProfileCall[] = [];
  let afterEdit = false;
  for (const event of parseJsonLines(trace)) {
    if (event.type !== "assistant") continue;
    const message = record(event.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const rawBlock of content) {
      const block = record(rawBlock);
      if (block?.type !== "tool_use") continue;
      const name = typeof block.name === "string" ? block.name : "unknown";
      const input = record(block.input) ?? {};
      const mutation = /^(edit|write)$/i.test(name);
      const command = name.toLowerCase() === "bash" && typeof input.command === "string"
        ? input.command
        : "";
      const category = directClaudeCategory(name) ?? classifyCommand(command);
      const callAfterEdit = afterEdit || mutation;
      calls.push({
        category,
        mutation,
        batchedRead: command !== "" && countReadOperations(command) > 1,
        verificationKey: category === "verification"
          ? normalizedHash(command || name)
          : null,
        privateDigestInput: JSON.stringify({ name, input }),
        afterEdit: callAfterEdit,
      });
      if (mutation) afterEdit = true;
    }
  }
  return calls;
}

function profileCommand(command: string, afterEdit: boolean): ProfileCall {
  const category = classifyCommand(command);
  return {
    category,
    mutation: false,
    batchedRead: countReadOperations(command) > 1,
    verificationKey: category === "verification" ? normalizedHash(command) : null,
    privateDigestInput: command,
    afterEdit,
  };
}

function directClaudeCategory(name: string): Category | null {
  if (/^(glob|grep)$/i.test(name)) return "search";
  if (/^read$/i.test(name)) return "read";
  return null;
}

function classifyCommand(command: string): Category {
  const normalized = command.toLowerCase();
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|typecheck|lint|build|check|web:export)\b/.test(normalized)
    || /\b(?:vitest|playwright|xcodebuild|gradle|cargo\s+test|swift\s+test)\b/.test(normalized)) {
    return "verification";
  }
  if (/\bgit\s+(?:status|diff|log|show)\b|\b(?:shasum|sha256sum)\b/.test(normalized)) {
    return "status";
  }
  const readOperations = countReadOperations(command);
  const searchOperations = countSearchOperations(command);
  if (searchOperations > 0 && searchOperations >= readOperations) return "search";
  if (readOperations > 0) return "read";
  return "other";
}

function countReadOperations(command: string): number {
  return [
    /\bsed\s+-n\b/g,
    /\bcat\s+/g,
    /\bnl\s+-ba\b/g,
    /\b(?:head|tail)\s+/g,
  ].reduce(
    (count, pattern) => count + [...command.toLowerCase().matchAll(pattern)].length,
    0,
  );
}

function countSearchOperations(command: string): number {
  return [
    /\brg\b/g,
    /\bgrep\b/g,
    /\bfind\b/g,
    /\bfd\b/g,
    /\bls\b/g,
    /\bpwd\b/g,
  ].reduce(
    (count, pattern) => count + [...command.toLowerCase().matchAll(pattern)].length,
    0,
  );
}

function normalizedHash(value: string): string {
  return createHash("sha256")
    .update(value.trim().replace(/\s+/g, " "))
    .digest("hex");
}

function parseJsonLines(trace: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of trace.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      const item = record(parsed);
      if (item) events.push(item);
    } catch {
      // Provider stdout may include non-JSON diagnostics. They are not tool calls.
    }
  }
  return events;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
