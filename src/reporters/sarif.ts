/**
 * SARIF 2.1.0 serializer — turns app-quality issues into the format GitHub
 * code scanning ingests, so findings appear as native PR annotations.
 *
 * Annotation-noise control: only severities at or above the gate threshold
 * map to SARIF "error"; everything else is "warning"/"note". A PR reviewer
 * drowning in notes stops reading — the gate severity is the attention line.
 */

import type { AppQualityIssue, AppQualitySeverity } from "../app-quality/engine.js";

const SEVERITY_RANK: Record<AppQualitySeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export interface SarifOptions {
  toolVersion: string;
  /** Severities at or above this map to SARIF "error" (gate-eligible). */
  failOn?: AppQualitySeverity | "none";
  /** Base URI for rule help links. */
  helpBaseUri?: string;
}

function sarifLevel(severity: AppQualitySeverity, failOn: SarifOptions["failOn"]): "error" | "warning" | "note" {
  if (failOn && failOn !== "none" && SEVERITY_RANK[severity] >= SEVERITY_RANK[failOn]) return "error";
  if (severity === "high" || severity === "critical") return "warning";
  return "note";
}

export function toSarif(issues: AppQualityIssue[], options: SarifOptions): object {
  const ruleIds = [...new Set(issues.map((issue) => issue.id))];
  const helpBase = options.helpBaseUri ?? "https://github.com/memi-design/memi/blob/main/docs/README.md";

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: {
        driver: {
          name: "memi",
          informationUri: "https://github.com/memi-design/memi",
          version: options.toolVersion,
          rules: ruleIds.map((ruleId) => {
            const sample = issues.find((issue) => issue.id === ruleId);
            return {
              id: ruleId,
              name: ruleId.replace(/[.\-](\w)/g, (_, char: string) => char.toUpperCase()),
              shortDescription: { text: sample?.title ?? ruleId },
              fullDescription: { text: sample?.detail ?? "" },
              helpUri: helpBase,
              help: { text: sample?.recommendation ?? "" },
            };
          }),
        },
      },
      results: issues.flatMap((issue) => {
        const level = sarifLevel(issue.severity, options.failOn);
        const locations = (issue.evidenceLocations ?? []).slice(0, 20);
        if (locations.length === 0) {
          // Aggregate whole-tree issue: one result anchored to the repo root.
          return [{
            ruleId: issue.id,
            level,
            message: { text: `${issue.title} — ${issue.detail} Fix: ${issue.recommendation}` },
            locations: [{
              physicalLocation: {
                artifactLocation: { uri: issue.affectedFiles?.[0] ?? "README.md" },
                region: { startLine: 1 },
              },
            }],
          }];
        }
        return locations.map((location) => ({
          ruleId: issue.id,
          level,
          message: { text: `${issue.title} — ${issue.detail} Fix: ${issue.recommendation}` },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: location.file },
              region: { startLine: Math.max(1, location.line ?? 1) },
            },
          }],
        }));
      }),
    }],
  };
}
