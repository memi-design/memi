import { normalizeAuditFindingId } from "../audit/evidence.js";
import type { AppQualityIssue } from "./engine.js";

export interface SwiftUiSource {
  path: string;
  content: string;
}

export interface SwiftUiStaticAnalysis {
  swiftUiFiles: SwiftUiSource[];
  issues: AppQualityIssue[];
  assessedChecks: string[];
}

const MOTION_PATTERN = /\.(?:keyframeAnimator|phaseAnimator|animation|repeatForever)\b|withAnimation\s*\(/;
const SPATIAL_TAP_PATTERN = /\.onSpatialTap\b/;
const ACCESSIBILITY_ACTION_PATTERN = /\.accessibilityAction\b/;
const REDUCED_MOTION_ENVIRONMENT_PATTERN =
  /@Environment\s*\(\s*\\\.accessibilityReduceMotion\s*\)\s*(?:private\s+)?var\s+([A-Za-z_][A-Za-z0-9_]*)/g;

export function analyzeSwiftUiSources(sources: readonly SwiftUiSource[]): SwiftUiStaticAnalysis {
  const swiftUiFiles = sources.filter((source) =>
    /\bimport\s+SwiftUI\b/.test(source.content)
    && /\b(?:View|ViewModifier|App)\b/.test(source.content),
  );
  if (swiftUiFiles.length === 0) {
    return { swiftUiFiles: [], issues: [], assessedChecks: [] };
  }

  const sanitized = swiftUiFiles.map((source) => ({
    source,
    content: stripCommentsAndStrings(source.content),
  }));
  const motionLocations = sanitized.flatMap(({ source, content }) =>
    locationsForMotionPattern(source, content, MOTION_PATTERN),
  );
  const uncoveredMotionLocations = motionLocations.filter((location) =>
    !hasDirectReducedMotionGate(location.content, location.offset),
  );
  const gestureFiles = sanitized.filter(({ content }) => SPATIAL_TAP_PATTERN.test(content));
  const issues: AppQualityIssue[] = [];

  if (uncoveredMotionLocations.length > 0) {
    issues.push(nativeIssue({
      id: "swiftui.reduced-motion-missing",
      severity: "high",
      title: "SwiftUI motion has no reduced-motion branch",
      detail: "Motion APIs were found without an accessibilityReduceMotion value from the same SwiftUI source file directly gating the motion invocation. Unrelated branches in the file do not count as evidence.",
      evidence: [`${uncoveredMotionLocations.length} SwiftUI motion location(s) without a directly detected reduced-motion gate`],
      recommendation: "Use accessibilityReduceMotion in the motion invocation to select a static trigger or disable animation, then verify the rendered fallback in a simulator.",
      locations: uncoveredMotionLocations.map(({ content, offset, ...location }) => location),
    }));
  }

  const uncoveredGestures = gestureFiles.filter(({ content }) => !ACCESSIBILITY_ACTION_PATTERN.test(content));
  if (uncoveredGestures.length > 0) {
    const gestureLocations = locationsForPattern(uncoveredGestures, SPATIAL_TAP_PATTERN);
    issues.push(nativeIssue({
      id: "swiftui.gesture-accessibility-action-missing",
      severity: "medium",
      title: "SwiftUI spatial gesture has no explicit accessibility action",
      detail: "A spatial tap gesture was found without an accessibilityAction in the same SwiftUI source file.",
      evidence: [`${gestureLocations.length} spatial gesture location(s) without a detected accessibility action`],
      recommendation: "Expose the gesture outcome through an explicit accessibilityAction or an equivalent standard control.",
      locations: gestureLocations,
    }));
  }

  return {
    swiftUiFiles,
    issues,
    assessedChecks: [
      "swiftui.gesture-accessibility-action",
      "swiftui.reduced-motion",
    ],
  };
}

function hasDirectReducedMotionGate(content: string, motionOffset: number): boolean {
  const variables = [...content.matchAll(REDUCED_MOTION_ENVIRONMENT_PATTERN)].map((match) => match[1]);
  if (variables.length === 0) return false;
  const invocation = extractMotionInvocation(content, motionOffset);
  return variables.some((variable) => {
    const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(invocation)
      || hasEnclosingReducedMotionGate(content, motionOffset, escaped);
  });
}

function hasEnclosingReducedMotionGate(
  content: string,
  motionOffset: number,
  escapedVariable: string,
): boolean {
  const branchPattern = new RegExp(`\\bif\\s+(!\\s*)?${escapedVariable}\\s*\\{`, "g");
  for (const match of content.matchAll(branchPattern)) {
    if (match.index === undefined || match.index > motionOffset) continue;
    const bodyOpen = content.indexOf("{", match.index);
    const bodyClose = findMatchingBrace(content, bodyOpen);
    if (bodyClose === -1) continue;
    const negated = Boolean(match[1]);
    if (negated && motionOffset > bodyOpen && motionOffset < bodyClose) return true;
    if (negated) continue;

    const suffix = content.slice(bodyClose + 1);
    const elseMatch = suffix.match(/^\s*else\s*\{/);
    if (!elseMatch) continue;
    const elseOpen = bodyClose + 1 + (elseMatch.index ?? 0) + elseMatch[0].lastIndexOf("{");
    const elseClose = findMatchingBrace(content, elseOpen);
    if (elseClose !== -1 && motionOffset > elseOpen && motionOffset < elseClose) return true;
  }
  return false;
}

function findMatchingBrace(content: string, openOffset: number): number {
  if (openOffset < 0 || content[openOffset] !== "{") return -1;
  let depth = 0;
  for (let index = openOffset; index < content.length; index += 1) {
    if (content[index] === "{") depth += 1;
    if (content[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function extractMotionInvocation(content: string, motionOffset: number): string {
  const open = content.indexOf("(", motionOffset);
  if (open === -1 || open - motionOffset > 80) {
    return content.slice(motionOffset, Math.min(content.length, motionOffset + 160));
  }
  let depth = 0;
  const limit = Math.min(content.length, open + 4_000);
  for (let index = open; index < limit; index += 1) {
    if (content[index] === "(") depth += 1;
    if (content[index] !== ")") continue;
    depth -= 1;
    if (depth === 0) return content.slice(motionOffset, index + 1);
  }
  return content.slice(motionOffset, limit);
}

function locationsForMotionPattern(
  source: SwiftUiSource,
  content: string,
  pattern: RegExp,
): Array<{ file: string; line: number; excerpt: string; content: string; offset: number }> {
  const locations: Array<{ file: string; line: number; excerpt: string; content: string; offset: number }> = [];
  const sanitizedLines = content.split(/\r?\n/);
  const originalLines = source.content.split(/\r?\n/);
  let lineOffset = 0;
  for (let index = 0; index < sanitizedLines.length; index += 1) {
    const match = sanitizedLines[index].match(pattern);
    if (match?.index !== undefined) {
      locations.push({
        file: source.path,
        line: index + 1,
        excerpt: originalLines[index].trim().slice(0, 160),
        content,
        offset: lineOffset + match.index,
      });
    }
    const newline = content.indexOf("\n", lineOffset);
    lineOffset = newline === -1 ? content.length : newline + 1;
  }
  return locations;
}

function locationsForPattern(
  files: ReadonlyArray<{ source: SwiftUiSource; content: string }>,
  pattern: RegExp,
): Array<{ file: string; line: number; excerpt: string }> {
  const locations: Array<{ file: string; line: number; excerpt: string }> = [];
  for (const { source, content } of files) {
    const sanitizedLines = content.split(/\r?\n/);
    const originalLines = source.content.split(/\r?\n/);
    for (let index = 0; index < sanitizedLines.length; index += 1) {
      if (!pattern.test(sanitizedLines[index])) continue;
      pattern.lastIndex = 0;
      locations.push({
        file: source.path,
        line: index + 1,
        excerpt: originalLines[index].trim().slice(0, 160),
      });
      break;
    }
  }
  return locations;
}

function nativeIssue(input: {
  id: string;
  severity: AppQualityIssue["severity"];
  title: string;
  detail: string;
  evidence: string[];
  recommendation: string;
  locations: Array<{ file: string; line: number; excerpt: string }>;
}): AppQualityIssue {
  const affectedFiles = Array.from(new Set(input.locations.map((location) => location.file)));
  return {
    id: input.id,
    normalizedId: normalizeAuditFindingId(input.id),
    category: "accessibility",
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    evidence: [...input.evidence],
    recommendation: input.recommendation,
    evidenceLocations: input.locations.slice(0, 5).map((location) => ({ ...location })),
    affectedFiles,
    confidence: 0.94,
    estimatedEffort: affectedFiles.length > 3 ? "medium" : "small",
    fixCategory: "accessibility",
  };
}

function stripCommentsAndStrings(content: string): string {
  let result = "";
  let state: "code" | "line-comment" | "block-comment" | "string" = "code";
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const current = content[index];
    const next = content[index + 1];
    if (state === "code" && current === "/" && next === "/") {
      state = "line-comment";
      result += "  ";
      index += 1;
      continue;
    }
    if (state === "code" && current === "/" && next === "*") {
      state = "block-comment";
      result += "  ";
      index += 1;
      continue;
    }
    if (state === "code" && current === "\"") {
      state = "string";
      result += " ";
      continue;
    }
    if (state === "line-comment" && current === "\n") state = "code";
    if (state === "block-comment" && current === "*" && next === "/") {
      state = "code";
      result += "  ";
      index += 1;
      continue;
    }
    if (state === "string") {
      if (!escaped && current === "\"") state = "code";
      escaped = !escaped && current === "\\";
      if (current !== "\\") escaped = false;
    }
    result += current === "\n" ? "\n" : state === "code" ? current : " ";
  }
  return result;
}
