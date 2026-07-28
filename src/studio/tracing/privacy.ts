import type { ProviderRuntimeEvent } from "../contracts/provider-runtime.js";
import { parseProviderRuntimeEvent } from "../contracts/provider-runtime.js";
import { redactSecrets, redactSensitiveValue } from "../redact.js";
import type { TracePrivacyMode } from "./contracts.js";

export interface TracePrivacyPolicy {
  readonly captureMode: TracePrivacyMode;
  readonly maxStringLength: number;
  readonly includeReasoning: false;
}

export const DEFAULT_TRACE_PRIVACY_POLICY: Readonly<TracePrivacyPolicy> = Object.freeze({
  captureMode: "metadata_only",
  maxStringLength: 4_096,
  includeReasoning: false,
});

const OMITTED = "[content omitted]";
const REASONING_OMITTED = "[reasoning omitted]";

function cleanString(value: string, policy: TracePrivacyPolicy): string {
  const redacted = redactSecrets(value);
  return redacted.length > policy.maxStringLength
    ? `${redacted.slice(0, policy.maxStringLength)}…[truncated]`
    : redacted;
}

function cleanUnknown(value: unknown): unknown {
  return redactSensitiveValue(value);
}

export function sanitizeRuntimeEvent(
  input: ProviderRuntimeEvent,
  policy: TracePrivacyPolicy = DEFAULT_TRACE_PRIVACY_POLICY,
): ProviderRuntimeEvent {
  const metadataOnly = policy.captureMode === "off" || policy.captureMode === "metadata_only";
  let output: ProviderRuntimeEvent;

  switch (input.type) {
    case "turn.created":
      output = { ...input, promptPreview: metadataOnly ? OMITTED : cleanString(input.promptPreview, policy) };
      break;
    case "message.user":
    case "message.assistant.complete":
      output = { ...input, text: metadataOnly ? OMITTED : cleanString(input.text, policy) };
      break;
    case "message.assistant.delta":
      output = { ...input, delta: metadataOnly ? OMITTED : cleanString(input.delta, policy) };
      break;
    case "reasoning.delta":
      output = { ...input, delta: REASONING_OMITTED };
      break;
    case "reasoning.complete":
      output = { ...input, text: REASONING_OMITTED };
      break;
    case "tool.call.started":
      output = { ...input, args: metadataOnly ? OMITTED : cleanUnknown(input.args) };
      break;
    case "tool.call.output":
      output = { ...input, chunk: metadataOnly ? OMITTED : cleanString(input.chunk, policy) };
      break;
    case "tool.call.completed":
      output = {
        ...input,
        result: input.result === undefined
          ? undefined
          : metadataOnly ? OMITTED : cleanUnknown(input.result),
        error: input.error ? cleanString(input.error, policy) : undefined,
      };
      break;
    case "approval.requested":
      output = {
        ...input,
        args: metadataOnly ? OMITTED : cleanUnknown(input.args),
        reason: cleanString(input.reason, policy),
      };
      break;
    case "diagnostic.warn":
    case "diagnostic.error":
      output = {
        ...input,
        message: cleanString(input.message, policy),
        data: input.data === undefined
          ? undefined
          : metadataOnly ? OMITTED : cleanUnknown(input.data),
      };
      break;
    case "session.state.changed":
      output = { ...input, reason: input.reason ? cleanString(input.reason, policy) : undefined };
      break;
    case "turn.completed":
      output = { ...input, error: input.error ? cleanString(input.error, policy) : undefined };
      break;
    case "approval.resolved":
    case "model.handoff":
      output = { ...input, reason: input.reason ? cleanString(input.reason, policy) : undefined };
      break;
    case "model.changed":
      output = { ...input, reason: cleanString(input.reason, policy) };
      break;
    case "auth.status.updated":
    case "mcp.status.updated":
      output = { ...input, message: input.message ? cleanString(input.message, policy) : undefined };
      break;
    case "mcp.tool.registered":
      output = {
        ...input,
        description: input.description ? cleanString(input.description, policy) : undefined,
      };
      break;
    default:
      output = { ...input };
  }

  return parseProviderRuntimeEvent(output);
}
