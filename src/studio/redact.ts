const ENV_SECRET_NAMES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "FIGMA_TOKEN",
  "GITHUB_TOKEN",
  "SUPABASE_ACCESS_TOKEN",
  "VERCEL_TOKEN",
];

const SENSITIVE_KEY = /(?:^|_)(?:api[_-]?key|token|secret|password|passwd|authorization|cookie|session|credential|private[_-]?key)(?:$|_)/i;
const MAX_REDACTED_STRING_LENGTH = 16_384;

export function redactSecrets(input: string): string {
  let output = input;
  for (const name of ENV_SECRET_NAMES) {
    output = output.replace(new RegExp(`(${name}=)[^\\s]+`, "g"), "$1[redacted]");
  }
  output = output.replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, "$1[redacted]");
  output = output.replace(/((?:Cookie|Set-Cookie):\s*)[^\r\n]+/gi, "$1[redacted]");
  output = output.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted-private-key]");
  output = output.replace(/\b(sk-(?:ant|proj|live|test|openai)[A-Za-z0-9_\-]+)\b/g, "[redacted]");
  output = output.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]");
  output = output.replace(/(?:\/Users\/|\/home\/)[^/\s]+/g, "[redacted-home]");
  if (output.length > MAX_REDACTED_STRING_LENGTH) {
    output = `${output.slice(0, MAX_REDACTED_STRING_LENGTH)}…[truncated]`;
  }
  return output;
}

export function redactSensitiveValue(
  value: unknown,
  key?: string,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return redactSecrets(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item, undefined, seen));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      redactSensitiveValue(entryValue, entryKey, seen),
    ]),
  );
}
