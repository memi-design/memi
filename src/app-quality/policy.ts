/**
 * Memoire Policy — one committed, versioned file (memoire.policy.json at the
 * repo root) that pins how strict every checker is, so a team's gate is
 * reproducible: same code + same policy = same findings, byte for byte.
 *
 * The policy hash is stamped into every report/diagnosis so a score is always
 * traceable to the thresholds that produced it — trend comparisons are only
 * meaningful between runs with the same policy hash.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { AppQualityIssue, AppQualitySeverity } from "./engine.js";

export type PolicyPreset = "memi-recommended" | "strict" | "lenient";
export type FailOnSeverity = "critical" | "high" | "medium" | "low" | "none";

/** Tunable thresholds for the 13 deterministic app-quality rules. */
export interface PolicyThresholds {
  /** Below this many CSS variables (with real UI present) → system.tokens.missing. */
  minCssVariables: number;
  /** More than this many unique raw hex colors promotes color.raw-hex from medium to high. */
  rawHexHighThreshold: number;
  /** More than this many unique color utilities → color.scale-wide. */
  maxColorUtilities: number;
  /** More than this many text size utilities → type.scale-wide. */
  maxTextSizes: number;
  /** More than this many spacing utilities → spacing.scale-wide. */
  maxSpacingUtilities: number;
  /** More than this many radius utilities → shape.radius-drift. */
  maxRadiusUtilities: number;
  /** More than this many shadow utilities → depth.shadow-drift. */
  maxShadowUtilities: number;
  /** More than this many arbitrary Tailwind values → maintainability.arbitrary-tailwind. */
  maxArbitraryValues: number;
}

export interface PolicyRuleOverride {
  enabled?: boolean;
  severity?: AppQualitySeverity;
}

export interface PolicyGates {
  /** Severity threshold for exit-1 gating. CLI flags override this. */
  failOn?: FailOnSeverity;
  /** Fail when the overall score drops below this. */
  minScore?: number;
  /** Fail when the overall score drops more than this vs the last comparable run (used by --fail-on-regression). */
  regressionBudget?: number;
}

/** Shape of memoire.policy.json as written by teams. All fields optional except schemaVersion. */
export interface MemoirePolicyFile {
  schemaVersion: 1;
  preset?: PolicyPreset;
  rules?: Record<string, PolicyRuleOverride>;
  thresholds?: Partial<PolicyThresholds>;
  gates?: PolicyGates;
  /** Severity for skill-compliance findings in the codegen gate: "critical" blocks, "warning" advises. */
  skillComplianceSeverity?: "critical" | "warning";
}

/** Fully-resolved policy every checker consumes. */
export interface ResolvedPolicy {
  schemaVersion: 1;
  preset: PolicyPreset;
  thresholds: PolicyThresholds;
  rules: Record<string, PolicyRuleOverride>;
  gates: Required<Pick<PolicyGates, "failOn">> & Omit<PolicyGates, "failOn">;
  skillComplianceSeverity: "critical" | "warning";
  /** sha256 of the canonicalized resolved policy — stamped into reports. */
  policyHash: string;
  /** Where this policy came from. */
  source: "default" | "file";
  path?: string;
}

export const POLICY_FILE_NAME = "memoire.policy.json";

export const DEFAULT_THRESHOLDS: PolicyThresholds = {
  minCssVariables: 8,
  rawHexHighThreshold: 4,
  maxColorUtilities: 28,
  maxTextSizes: 7,
  maxSpacingUtilities: 22,
  maxRadiusUtilities: 5,
  maxShadowUtilities: 4,
  maxArbitraryValues: 12,
};

const PRESETS: Record<PolicyPreset, { thresholds: Partial<PolicyThresholds>; gates: PolicyGates; skillComplianceSeverity: "critical" | "warning" }> = {
  "memi-recommended": {
    thresholds: {},
    gates: { failOn: "high" },
    skillComplianceSeverity: "warning",
  },
  strict: {
    thresholds: {
      rawHexHighThreshold: 0,
      maxColorUtilities: 20,
      maxTextSizes: 6,
      maxSpacingUtilities: 16,
      maxRadiusUtilities: 4,
      maxShadowUtilities: 3,
      maxArbitraryValues: 6,
    },
    gates: { failOn: "medium", regressionBudget: 0 },
    skillComplianceSeverity: "critical",
  },
  lenient: {
    thresholds: {
      maxColorUtilities: 40,
      maxTextSizes: 10,
      maxSpacingUtilities: 32,
      maxArbitraryValues: 24,
    },
    gates: { failOn: "critical" },
    skillComplianceSeverity: "warning",
  },
};

const KNOWN_RULE_IDS = new Set([
  "scan.empty",
  "system.tokens.missing",
  "color.raw-hex",
  "color.scale-wide",
  "type.scale-wide",
  "spacing.scale-wide",
  "shape.radius-drift",
  "depth.shadow-drift",
  "components.default-shadcn",
  "maintainability.arbitrary-tailwind",
  "responsive.coverage-low",
  "a11y.image-alt",
  "a11y.focus-missing",
  "swiftui.gesture-accessibility-action-missing",
  "swiftui.reduced-motion-missing",
]);

/** Resolve the default policy (no file present). */
export function defaultPolicy(): ResolvedPolicy {
  return resolvePolicy({ schemaVersion: 1 }, "default");
}

/**
 * Load memoire.policy.json from the project root, falling back to the default
 * policy when absent. A malformed policy file is an ERROR, not a silent
 * fallback — a team that committed a policy must never be silently ungated.
 */
export async function loadPolicy(projectRoot: string): Promise<ResolvedPolicy> {
  const path = join(projectRoot, POLICY_FILE_NAME);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return defaultPolicy();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${POLICY_FILE_NAME} is not valid JSON: ${(err as Error).message}`);
  }
  const file = validatePolicyFile(parsed);
  const resolved = resolvePolicy(file, "file");
  resolved.path = path;
  return resolved;
}

function validatePolicyFile(parsed: unknown): MemoirePolicyFile {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${POLICY_FILE_NAME} must be a JSON object`);
  }
  const file = parsed as Record<string, unknown>;
  if (file.schemaVersion !== 1) {
    throw new Error(`${POLICY_FILE_NAME} schemaVersion must be 1 (got ${JSON.stringify(file.schemaVersion)})`);
  }
  if (file.preset !== undefined && !(file.preset === "memi-recommended" || file.preset === "strict" || file.preset === "lenient")) {
    throw new Error(`${POLICY_FILE_NAME} preset must be one of: memi-recommended, strict, lenient`);
  }
  if (file.rules !== undefined) {
    if (typeof file.rules !== "object" || file.rules === null) throw new Error(`${POLICY_FILE_NAME} rules must be an object`);
    for (const [ruleId, override] of Object.entries(file.rules as Record<string, PolicyRuleOverride>)) {
      if (!KNOWN_RULE_IDS.has(ruleId)) {
        throw new Error(`${POLICY_FILE_NAME} references unknown rule "${ruleId}". Known rules: ${[...KNOWN_RULE_IDS].join(", ")}`);
      }
      if (override.severity !== undefined && !["critical", "high", "medium", "low"].includes(override.severity)) {
        throw new Error(`${POLICY_FILE_NAME} rule "${ruleId}" has invalid severity "${override.severity}"`);
      }
    }
  }
  if (file.gates !== undefined) {
    const gates = file.gates as PolicyGates;
    if (gates.failOn !== undefined && !["critical", "high", "medium", "low", "none"].includes(gates.failOn)) {
      throw new Error(`${POLICY_FILE_NAME} gates.failOn must be one of: critical, high, medium, low, none`);
    }
  }
  if (file.skillComplianceSeverity !== undefined && !["critical", "warning"].includes(file.skillComplianceSeverity as string)) {
    throw new Error(`${POLICY_FILE_NAME} skillComplianceSeverity must be "critical" or "warning"`);
  }
  return file as unknown as MemoirePolicyFile;
}

function resolvePolicy(file: MemoirePolicyFile, source: "default" | "file"): ResolvedPolicy {
  const preset = file.preset ?? "memi-recommended";
  const presetConfig = PRESETS[preset];
  const thresholds: PolicyThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...presetConfig.thresholds,
    ...(file.thresholds ?? {}),
  };
  const gates = {
    failOn: file.gates?.failOn ?? presetConfig.gates.failOn ?? "high",
    minScore: file.gates?.minScore ?? presetConfig.gates.minScore,
    regressionBudget: file.gates?.regressionBudget ?? presetConfig.gates.regressionBudget,
  };
  const resolved: Omit<ResolvedPolicy, "policyHash"> = {
    schemaVersion: 1,
    preset,
    thresholds,
    rules: file.rules ?? {},
    gates,
    skillComplianceSeverity: file.skillComplianceSeverity ?? presetConfig.skillComplianceSeverity,
    source,
  };
  return { ...resolved, policyHash: hashPolicy(resolved) };
}

/** Canonical, key-sorted hash so semantically-equal policies hash identically. */
function hashPolicy(policy: Omit<ResolvedPolicy, "policyHash">): string {
  const canonical = JSON.stringify(sortKeysDeep({
    schemaVersion: policy.schemaVersion,
    preset: policy.preset,
    thresholds: policy.thresholds,
    rules: policy.rules,
    gates: policy.gates,
    skillComplianceSeverity: policy.skillComplianceSeverity,
  }));
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, entry]) => [key, sortKeysDeep(entry)]),
    );
  }
  return value;
}

/**
 * Apply per-rule enablement and severity overrides to issues after they're
 * built. Disabled rules are removed; overridden severities replace the
 * engine's defaults.
 */
export function applyPolicyToIssues(issues: AppQualityIssue[], policy: ResolvedPolicy): AppQualityIssue[] {
  return issues
    .filter((issue) => policy.rules[issue.id]?.enabled !== false)
    .map((issue) => {
      const override = policy.rules[issue.id];
      if (override?.severity && override.severity !== issue.severity) {
        return { ...issue, severity: override.severity };
      }
      return issue;
    });
}
