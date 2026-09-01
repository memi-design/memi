import type { MemiCapability, MemiExecutionPolicy, MemiExecutionProfile } from "./execution-policy.js";

export interface MetadataReceiptInput {
  command: string;
  version: string;
  commit: string;
  policy: MemiExecutionPolicy;
  ruleIds?: readonly string[];
  counts?: Readonly<Record<string, number>>;
  hashes?: Readonly<Record<string, string>>;
  durationMs?: number;
  decisions?: readonly {
    capability: MemiCapability;
    allowed: boolean;
    reason: string;
  }[];
}

export interface MetadataReceipt {
  schemaVersion: "memi.receipt.v1";
  generatedAt: string;
  command: string;
  artifact: {
    version: string;
    commit: string;
  };
  policy: {
    profile: MemiExecutionProfile;
    effectiveCapabilities: readonly MemiCapability[];
    decisions: readonly {
      capability: MemiCapability;
      allowed: boolean;
      reason: string;
    }[];
  };
  evidence: {
    ruleIds: readonly string[];
    counts: Readonly<Record<string, number>>;
    hashes: Readonly<Record<string, string>>;
    durationMs: number;
  };
}

const METADATA_KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const HASH_VALUE = /^[A-Fa-f0-9]{16,128}$/;

export function createMetadataReceipt(input: MetadataReceiptInput): Readonly<MetadataReceipt> {
  const receipt: MetadataReceipt = {
    schemaVersion: "memi.receipt.v1",
    generatedAt: new Date().toISOString(),
    command: metadataString(input.command, "command"),
    artifact: Object.freeze({
      version: metadataString(input.version, "version"),
      commit: metadataString(input.commit, "commit"),
    }),
    policy: Object.freeze({
      profile: input.policy.profile,
      effectiveCapabilities: Object.freeze([...input.policy.effectiveCapabilities]),
      decisions: Object.freeze((input.decisions ?? []).map((decision) => Object.freeze({
        capability: decision.capability,
        allowed: decision.allowed,
        reason: metadataString(decision.reason, "decision reason"),
      }))),
    }),
    evidence: Object.freeze({
      ruleIds: Object.freeze((input.ruleIds ?? []).map((ruleId) => metadataString(ruleId, "rule ID"))),
      counts: Object.freeze(sanitizeCounts(input.counts ?? {})),
      hashes: Object.freeze(sanitizeHashes(input.hashes ?? {})),
      durationMs: finiteNonNegative(input.durationMs ?? 0, "durationMs"),
    }),
  };

  return Object.freeze(receipt);
}

export function serializeMetadataReceipt(receipt: Readonly<MetadataReceipt>): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

export async function writeMetadataReceipt(
  outputPath: string | undefined,
  receipt: Readonly<MetadataReceipt>,
  policy: MemiExecutionPolicy,
): Promise<void> {
  if (!outputPath) {
    throw new Error("An explicit receipt output path is required");
  }
  const handle = await policy.openProjectWriteExclusive(outputPath, "persist metadata receipt");
  try {
    await handle.writeFile(serializeMetadataReceipt(receipt), { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function metadataString(value: string, label: string): string {
  if (!METADATA_KEY.test(value)) {
    throw new Error(`Invalid ${label}: expected a metadata identifier`);
  }
  return value;
}

function sanitizeCounts(counts: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).map(([key, value]) => [
    metadataString(key, "count key"),
    finiteNonNegative(value, `count ${key}`),
  ]));
}

function sanitizeHashes(hashes: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(hashes).map(([key, value]) => {
    const safeKey = metadataString(key, "hash key");
    if (!HASH_VALUE.test(value)) {
      throw new Error(`Invalid hash ${safeKey}: expected 16-128 hexadecimal characters`);
    }
    return [safeKey, value.toLowerCase()];
  }));
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${label}: expected a finite non-negative number`);
  }
  return value;
}
