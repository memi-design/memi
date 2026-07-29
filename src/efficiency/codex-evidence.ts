import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  benchmarkRunRecordSchema,
  type BenchmarkRunRecord,
} from "./contracts.js";

export interface ParsedCodexTrace {
  readonly finalResponse: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly outputTokens: number;
    readonly reasoningTokens: number;
  };
  readonly tools: {
    readonly calls: number;
    readonly errors: number;
    readonly retries: number;
  };
}

export interface CaseStudyGradeInput {
  readonly repositoryRoot: string;
  readonly response: string;
  readonly minimumValidCitations: number;
  readonly requiredTerms: readonly string[];
}

export interface CaseStudyCitation {
  readonly path: string;
  readonly line: number;
}

export interface InvalidCaseStudyCitation extends CaseStudyCitation {
  readonly reason: "outside-repository" | "missing-file" | "line-out-of-range";
}

export interface CaseStudyGrade {
  readonly accepted: boolean;
  readonly qualityScore: number;
  readonly defects: number;
  readonly validCitations: readonly CaseStudyCitation[];
  readonly invalidCitations: readonly InvalidCaseStudyCitation[];
  readonly missingTerms: readonly string[];
  readonly hasGapDisclosure: boolean;
  readonly hasVerificationCommands: boolean;
}

export interface CreateRegradeAmendmentInput {
  readonly original: BenchmarkRunRecord;
  readonly grade: CaseStudyGrade;
  readonly graderVersion: string;
  readonly receiptRef: string;
}

interface CodexEvent {
  readonly type?: string;
  readonly item?: {
    readonly type?: string;
    readonly text?: string;
    readonly command?: string;
    readonly exit_code?: number | null;
    readonly status?: string;
  };
  readonly usage?: {
    readonly input_tokens?: number;
    readonly cached_input_tokens?: number;
    readonly output_tokens?: number;
    readonly reasoning_output_tokens?: number;
  };
}

const MARKDOWN_LINE_CITATION = /\]\(<?([^)\n>]+):(\d+)>?\)/g;
const MARKDOWN_ANCHOR_CITATION =
  /\]\(<?([^)\n>#]+)#L(\d+)(?:-L?\d+)?>?\)/g;

export function parseCodexJsonl(jsonl: string): Readonly<ParsedCodexTrace> {
  let finalResponse = "";
  let usage: ParsedCodexTrace["usage"] = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  const completedCommands: Array<{ command: string; failed: boolean }> = [];

  for (const rawLine of jsonl.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let event: CodexEvent;
    try {
      event = JSON.parse(line) as CodexEvent;
    } catch {
      continue;
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      finalResponse = event.item.text ?? finalResponse;
    }
    if (event.type === "item.completed" && event.item?.type === "command_execution") {
      completedCommands.push({
        command: event.item.command ?? "",
        failed: event.item.status === "failed"
          || (event.item.exit_code != null && event.item.exit_code !== 0),
      });
    }
    if (event.type === "turn.completed" && event.usage) {
      usage = {
        inputTokens: event.usage.input_tokens ?? 0,
        cachedInputTokens: event.usage.cached_input_tokens ?? 0,
        outputTokens: event.usage.output_tokens ?? 0,
        reasoningTokens: event.usage.reasoning_output_tokens ?? 0,
      };
    }
  }

  const commandCounts = new Map<string, number>();
  for (const entry of completedCommands) {
    commandCounts.set(entry.command, (commandCounts.get(entry.command) ?? 0) + 1);
  }
  const retries = [...commandCounts.values()]
    .reduce((sum, count) => sum + Math.max(0, count - 1), 0);

  return deepFreeze({
    finalResponse,
    usage,
    tools: {
      calls: completedCommands.length,
      errors: completedCommands.filter((entry) => entry.failed).length,
      retries,
    },
  });
}

export async function gradeCaseStudyResponse(
  input: CaseStudyGradeInput,
): Promise<Readonly<CaseStudyGrade>> {
  if (!Number.isInteger(input.minimumValidCitations) || input.minimumValidCitations <= 0) {
    throw new Error("minimumValidCitations must be positive");
  }
  const lexicalRoot = path.resolve(input.repositoryRoot);
  const root = await realpath(input.repositoryRoot);
  const citations = extractCitations(input.response);
  const validCitations: CaseStudyCitation[] = [];
  const invalidCitations: InvalidCaseStudyCitation[] = [];

  for (const citation of citations) {
    const candidate = path.isAbsolute(citation.path)
      ? path.resolve(citation.path)
      : path.resolve(lexicalRoot, citation.path);
    const lexicalRelative = path.relative(lexicalRoot, candidate);
    let content: string;
    try {
      const canonical = await realpath(candidate);
      const canonicalRelative = path.relative(root, canonical);
      if (canonicalRelative.startsWith("..") || path.isAbsolute(canonicalRelative)) {
        invalidCitations.push({ ...citation, reason: "outside-repository" });
        continue;
      }
      content = await readFile(canonical, "utf8");
    } catch {
      const outsideLexically = lexicalRelative.startsWith("..")
        || path.isAbsolute(lexicalRelative);
      invalidCitations.push({
        ...citation,
        reason: outsideLexically ? "outside-repository" : "missing-file",
      });
      continue;
    }
    const lineCount = content.split(/\r?\n/).length;
    if (citation.line > lineCount) {
      invalidCitations.push({ ...citation, reason: "line-out-of-range" });
      continue;
    }
    validCitations.push(citation);
  }

  const normalizedResponse = input.response.toLowerCase();
  const missingTerms = input.requiredTerms.filter(
    (term) => !normalizedResponse.includes(term.toLowerCase()),
  );
  const hasGapDisclosure =
    /\b(gap|gaps|unknown|unresolved|unassessed|not assessed|could not verify|cannot verify)\b/i
      .test(input.response);
  const hasVerificationCommands =
    /\bverification commands?\b/i.test(input.response)
    && /```(?:sh|bash|zsh)?[\s\S]*?```/i.test(input.response);
  const citationShortfall = Math.max(
    0,
    input.minimumValidCitations - validCitations.length,
  );
  const defects = invalidCitations.length
    + missingTerms.length
    + citationShortfall
    + (hasGapDisclosure ? 0 : 1)
    + (hasVerificationCommands ? 0 : 1);
  const accepted = defects === 0;
  const qualityScore = accepted
    ? 100
    : Math.max(0, Math.min(99,
      40
      + Math.min(30, validCitations.length * 5)
      + Math.round(20 * (
        (input.requiredTerms.length - missingTerms.length)
        / Math.max(1, input.requiredTerms.length)
      ))
      + (hasGapDisclosure ? 5 : 0)
      + (hasVerificationCommands ? 5 : 0)
      - invalidCitations.length * 10,
    ));

  return deepFreeze({
    accepted,
    qualityScore,
    defects,
    validCitations,
    invalidCitations,
    missingTerms,
    hasGapDisclosure,
    hasVerificationCommands,
  });
}

export function createRegradeAmendment(
  input: CreateRegradeAmendmentInput,
): Readonly<BenchmarkRunRecord> {
  const graderVersion = input.graderVersion.trim();
  if (!graderVersion) throw new Error("graderVersion must not be empty");
  if (!input.receiptRef.trim()) throw new Error("receiptRef must not be empty");
  const runIdSuffix = graderVersion.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return deepFreeze(benchmarkRunRecordSchema.parse({
    ...input.original,
    runId: `${input.original.runId}-regrade-${runIdSuffix}`,
    graderVersion,
    amendsRunId: input.original.runId,
    outcome: {
      ...input.original.outcome,
      accepted: input.grade.accepted,
      testsPassed: input.grade.accepted,
      qualityScore: input.grade.qualityScore,
      defects: input.grade.defects,
    },
    evidenceRefs: [...input.original.evidenceRefs, input.receiptRef],
  }));
}

function extractCitations(response: string): CaseStudyCitation[] {
  const citations = new Map<string, CaseStudyCitation>();
  for (const match of [
    ...response.matchAll(MARKDOWN_LINE_CITATION),
    ...response.matchAll(MARKDOWN_ANCHOR_CITATION),
  ]) {
    const citation = {
      path: match[1],
      line: Number.parseInt(match[2], 10),
    };
    citations.set(`${citation.path}:${citation.line}`, citation);
  }
  return [...citations.values()];
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
