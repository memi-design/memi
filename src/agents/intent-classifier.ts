/**
 * Intent Classifier — deterministic, multi-signal design intent analysis.
 *
 * `classifyIntent()` remains the compatibility entry point. New callers can
 * use `classifyIntentSignals()` to inspect the independent routing facets and
 * fail closed when the request is ambiguous.
 */

import type { FrontendTaskContractV1 } from "../frontend/task-contract.js";

// ── Compatibility category ──────────────────────────────

export type IntentCategory =
  | "token-update"
  | "component-create"
  | "component-modify"
  | "page-layout"
  | "dataviz-create"
  | "theme-change"
  | "spacing-system"
  | "typography-system"
  | "color-palette"
  | "figma-sync"
  | "code-generate"
  | "design-audit"
  | "design-system-init"
  | "responsive-layout"
  | "accessibility-check"
  | "design-extract"
  | "general";

export type IntentAction =
  | "create"
  | "modify"
  | "audit"
  | "extract"
  | "sync"
  | "generate"
  | "initialize";

export type IntentTaskFamily =
  | "tokens"
  | "component"
  | "layout"
  | "dataviz"
  | "accessibility"
  | "design-system"
  | "design-extraction"
  | "code"
  | "figma"
  | "general";

export type IntentPlatform = "web" | "react-native" | "swiftui" | "figma";

export type IntentTargetSurface =
  | "component"
  | "screen"
  | "navigation"
  | "form"
  | "dataviz"
  | "design-system"
  | "repository"
  | "figma-canvas";

export type IntentRequiredState =
  | "accessibility"
  | "responsive"
  | "mobile"
  | "tablet"
  | "desktop"
  | "light"
  | "dark"
  | "empty"
  | "error"
  | "loading"
  | "reduced-motion"
  | "keyboard"
  | "focus";

export interface IntentSignalEvidence {
  readonly action: readonly string[];
  readonly taskFamily: readonly string[];
  readonly platform: readonly string[];
  readonly targetSurface: readonly string[];
  readonly requiredState: readonly string[];
}

export interface IntentSignalClassification {
  readonly schemaVersion: 1;
  readonly category: IntentCategory;
  readonly action: IntentAction | null;
  readonly taskFamily: IntentTaskFamily;
  readonly platforms: readonly IntentPlatform[];
  readonly targetSurfaces: readonly IntentTargetSurface[];
  readonly requiredStates: readonly IntentRequiredState[];
  readonly inferredTaskClass: FrontendTaskContractV1["taskClass"] | null;
  readonly confidence: number;
  readonly ambiguous: boolean;
  readonly abstain: boolean;
  readonly evidence: Readonly<IntentSignalEvidence>;
}

interface SignalRule<T extends string> {
  readonly value: T;
  readonly pattern: RegExp;
  readonly weight?: number;
}

interface FamilyMatch {
  readonly family: IntentTaskFamily;
  readonly score: number;
  readonly evidence: readonly string[];
}

const MAXIMUM_INTENT_LENGTH = 5_000;
const CONFIDENCE_THRESHOLD = 0.6;

const ACTION_RULES: readonly SignalRule<IntentAction>[] = [
  { value: "modify", pattern: /\b(repair|fix|update|modify|change|edit|refactor|improve|polish)\b/iu },
  { value: "generate", pattern: /\b(generate|codegen|compile)\b/iu },
  { value: "initialize", pattern: /\b(init|initialize|setup|bootstrap|scaffold)\b/iu },
  { value: "extract", pattern: /\b(extract|scrape|grab|import)\b/iu },
  { value: "sync", pattern: /\b(sync|push|pull)\b/iu },
  {
    value: "create",
    pattern: /\b(create|add|build|implement|make|new)\b|(?:^\s*|\b(?:can|could|would|will|should)\s+you\s+|\bplease\s+|\b(?:want|need)\s+(?:you\s+)?to\s+|\bhelp\s+me\s+)design\b/iu,
  },
  { value: "audit", pattern: /\b(analyze|audit|check|inspect|lint|review|test|validate|verify)\b/iu },
];

const FAMILY_RULES: readonly SignalRule<Exclude<IntentTaskFamily, "general">>[] = [
  { value: "dataviz", pattern: /\b(dataviz|chart|graph|visuali[sz]ation)\b/iu, weight: 5 },
  { value: "dataviz", pattern: /\bdashboard\b/iu, weight: 2 },
  { value: "design-extraction", pattern: /\b(design\s*doc|scrape|extract)\b/iu, weight: 4 },
  { value: "design-extraction", pattern: /https?:\/\//iu, weight: 4 },
  { value: "tokens", pattern: /\b(tokens?|variables?|css\s*vars?|palette|hue|shade|tint)\b/iu, weight: 7 },
  { value: "tokens", pattern: /\b(color|spacing|space|gap|padding|margin|font|typography|type\s*scale|theme)\b/iu, weight: 4 },
  { value: "component", pattern: /\b(components?|widgets?|elements?)\b/iu, weight: 7 },
  { value: "component", pattern: /\b(button|card|input|modal|dialog|table|header|footer|sidebar|row)\b/iu, weight: 3 },
  { value: "layout", pattern: /\b(page|layout|screen|view)\b/iu, weight: 4 },
  { value: "layout", pattern: /\b(adaptive|interaction)\b/iu, weight: 4 },
  { value: "layout", pattern: /\b(responsive|breakpoint|mobile|tablet|desktop)\b/iu, weight: 1 },
  { value: "accessibility", pattern: /\b(accessibility|a11y|wcag|aria|voiceover|screen\s*reader)\b/iu, weight: 5 },
  { value: "accessibility", pattern: /\b(keyboard|focus|contrast)\b/iu, weight: 1 },
  { value: "design-system", pattern: /\b(design\s*system|component\s*library|pattern\s*library)\b/iu, weight: 5 },
  { value: "code", pattern: /\b(code|codegen|compile|typescript|javascript|swift)\b/iu, weight: 3 },
  { value: "figma", pattern: /\bfigma\b/iu, weight: 5 },
];

const PLATFORM_RULES: readonly SignalRule<IntentPlatform>[] = [
  { value: "web", pattern: /\b(web|website|browser|chromium|playwright|next\.?js|astro|html|css)\b/iu },
  { value: "react-native", pattern: /\b(react[ -]?native|expo|android)\b/iu },
  { value: "swiftui", pattern: /\b(swiftui|xcode|ios|iphone|ipad|xcuitest)\b/iu },
  { value: "figma", pattern: /\bfigma\b/iu },
];

const SURFACE_RULES: readonly SignalRule<IntentTargetSurface>[] = [
  { value: "component", pattern: /\b(component|widget|element|button|card|input|modal|dialog|row)\b/iu },
  { value: "dataviz", pattern: /\b(dataviz|chart|graph|visuali[sz]ation|dashboard)\b/iu },
  { value: "screen", pattern: /\b(screen|page|view)\b/iu },
  { value: "navigation", pattern: /\b(nav|navigation|tab|sidebar|breadcrumb|menu)\b/iu },
  { value: "form", pattern: /\b(form|input|field|validation)\b/iu },
  { value: "design-system", pattern: /\b(design\s*system|component\s*library|token)\b/iu },
  { value: "repository", pattern: /\b(repository|repo|codebase)\b/iu },
  { value: "figma-canvas", pattern: /\b(figma|canvas|frame)\b/iu },
];

const STATE_RULES: readonly SignalRule<IntentRequiredState>[] = [
  { value: "accessibility", pattern: /\b(accessibility|accessible|a11y|wcag|aria|voiceover|screen\s*reader|keyboard|focus)\b/iu },
  { value: "responsive", pattern: /\b(responsive|adaptive|breakpoint)\b/iu },
  { value: "mobile", pattern: /\bmobile\b/iu },
  { value: "tablet", pattern: /\btablet\b/iu },
  { value: "desktop", pattern: /\bdesktop\b/iu },
  { value: "light", pattern: /\blight(?:\s*mode|\s*theme)?\b/iu },
  { value: "dark", pattern: /\bdark(?:\s*mode|\s*theme)?\b/iu },
  { value: "empty", pattern: /\bempty(?:\s*state|\s*states)?\b/iu },
  { value: "error", pattern: /\berror(?:\s*state|\s*states)?\b/iu },
  { value: "loading", pattern: /\b(?:loading|skeleton)(?:\s*state|\s*states)?\b/iu },
  { value: "reduced-motion", pattern: /\b(?:reduced[ -]?motion|prefers-reduced-motion)\b/iu },
  { value: "keyboard", pattern: /\bkeyboard\b/iu },
  { value: "focus", pattern: /\bfocus\b/iu },
];

// Retained as a public compatibility table for callers that inspect it.
export const INTENT_PATTERNS: [RegExp, IntentCategory][] = [
  [/\b(color|palette|hue|shade|tint)\b/i, "color-palette"],
  [/\b(spacing|space|gap|padding|margin)\b/i, "spacing-system"],
  [/\b(font|typography|text|type\s?scale|heading)\b/i, "typography-system"],
  [/\b(theme|dark\s?mode|light\s?mode|brand)\b/i, "theme-change"],
  [/\b(token|variable|css\s?var)\b/i, "token-update"],
  [/\b(create|new|add)\b.*\b(component|widget|element)\b/i, "component-create"],
  [/\b(update|modify|change|edit)\b.*\b(component|widget)\b/i, "component-modify"],
  [/\b(button|card|input|form|modal|dialog|table|nav|header|footer|sidebar)\b/i, "component-create"],
  [/\b(page|layout|screen|view)\b/i, "page-layout"],
  [/\b(responsive|breakpoint|mobile|tablet|desktop)\b/i, "responsive-layout"],
  [/\b(chart|graph|visualization|dataviz|dashboard\s?chart)\b/i, "dataviz-create"],
  [/\b(extract|design.?doc|design\s+system\s+from|grab|scrape)\b.*\b(url|site|website|http)\b/i, "design-extract"],
  [/\bhttps?:\/\//i, "design-extract"],
  [/\b(sync|push|figma)\b/i, "figma-sync"],
  [/\b(generate|build|code|compile)\b/i, "code-generate"],
  [/\b(audit|review|check|lint|validate)\b/i, "design-audit"],
  [/\b(accessibility|a11y|wcag|aria)\b/i, "accessibility-check"],
  [/\b(init|setup|bootstrap|scaffold)\b/i, "design-system-init"],
];

export function classifyIntentSignals(intent: string): IntentSignalClassification {
  if (intent.length === 0 || intent.length > MAXIMUM_INTENT_LENGTH) {
    return frozenClassification({
      category: "general",
      action: null,
      taskFamily: "general",
      platforms: [],
      targetSurfaces: [],
      requiredStates: [],
      inferredTaskClass: null,
      confidence: 0,
      ambiguous: true,
      abstain: true,
      evidence: emptyEvidence(),
    });
  }

  const actionMatches = matchedRules(intent, ACTION_RULES);
  const action = actionMatches[0]?.value ?? null;
  const familyMatches = scoreTaskFamilies(intent);
  const leadingFamily = familyMatches[0];
  const secondFamily = familyMatches[1];
  const taskFamily = leadingFamily?.family ?? "general";
  const familyAmbiguous = !leadingFamily
    || (secondFamily !== undefined
      && leadingFamily.score - secondFamily.score <= 1);
  const platforms = valuesForMatches(matchedRules(intent, PLATFORM_RULES));
  const platformAmbiguous = platforms.length > 1;
  const targetSurfaces = valuesForMatches(matchedRules(intent, SURFACE_RULES));
  const requiredStates = valuesForMatches(matchedRules(intent, STATE_RULES));
  const confidence = calculateConfidence({
    action,
    taskFamily,
    platforms,
    targetSurfaces,
    requiredStates,
    familyAmbiguous,
    platformAmbiguous,
  });
  const ambiguous = familyAmbiguous || platformAmbiguous;
  const abstain = ambiguous || confidence < CONFIDENCE_THRESHOLD;
  const category = compatibilityCategory(intent, action, taskFamily);
  const inferredTaskClass = inferFrontendTaskClass({
    action,
    taskFamily,
    platforms,
    targetSurfaces,
    requiredStates,
    ambiguous,
  });

  return frozenClassification({
    category,
    action,
    taskFamily,
    platforms,
    targetSurfaces,
    requiredStates,
    inferredTaskClass,
    confidence,
    ambiguous,
    abstain,
    evidence: {
      action: actionMatches.map((match) => match.match),
      taskFamily: leadingFamily?.evidence ?? [],
      platform: matchedEvidence(intent, PLATFORM_RULES),
      targetSurface: matchedEvidence(intent, SURFACE_RULES),
      requiredState: matchedEvidence(intent, STATE_RULES),
    },
  });
}

function inferFrontendTaskClass(input: {
  readonly action: IntentAction | null;
  readonly taskFamily: IntentTaskFamily;
  readonly platforms: readonly IntentPlatform[];
  readonly targetSurfaces: readonly IntentTargetSurface[];
  readonly requiredStates: readonly IntentRequiredState[];
  readonly ambiguous: boolean;
}): FrontendTaskContractV1["taskClass"] | null {
  if (input.ambiguous || input.platforms.length !== 1 || input.action === null) {
    return null;
  }

  const states = new Set(input.requiredStates);
  const surfaces = new Set(input.targetSurfaces);
  if (input.action === "audit") {
    if (states.has("keyboard") || states.has("focus")) {
      return "keyboard-focus-verification";
    }
    if (input.taskFamily === "accessibility" || states.has("accessibility")) {
      return "accessibility-check";
    }
    if (input.taskFamily === "tokens") return "token-map";
    if (input.taskFamily === "design-system") return "design-system-map";
    if (input.taskFamily === "component") return "component-map";
    return null;
  }

  if (input.action === "extract") {
    if (input.taskFamily === "tokens") return "token-map";
    if (input.taskFamily === "design-system" || input.taskFamily === "design-extraction") {
      return "design-system-map";
    }
    if (input.taskFamily === "component") return "component-map";
    return null;
  }

  if (input.action !== "create" && input.action !== "modify") return null;
  if (states.has("empty") || states.has("error") || states.has("loading")) {
    return "interface-state-implementation";
  }
  if (
    states.has("responsive")
    || states.has("mobile")
    || states.has("tablet")
    || states.has("desktop")
  ) {
    return "responsive-layout";
  }
  if (surfaces.has("navigation") || surfaces.has("form")) {
    return "adaptive-interaction";
  }
  return null;
}

export function classifyIntent(intent: string): IntentCategory {
  return classifyIntentSignals(intent).category;
}

function compatibilityCategory(
  intent: string,
  action: IntentAction | null,
  taskFamily: IntentTaskFamily,
): IntentCategory {
  if (taskFamily === "design-extraction" || action === "extract") return "design-extract";
  if (taskFamily === "dataviz") return "dataviz-create";
  if (taskFamily === "tokens") {
    if (/\b(color|palette|hue|shade|tint)\b/iu.test(intent)) return "color-palette";
    if (/\b(spacing|space|gap|padding|margin)\b/iu.test(intent)) return "spacing-system";
    if (/\b(font|typography|text|type\s*scale|heading)\b/iu.test(intent)) return "typography-system";
    if (/\b(theme|dark\s*mode|light\s*mode|brand)\b/iu.test(intent)) return "theme-change";
    return "token-update";
  }
  if (taskFamily === "component") {
    return action === "modify" ? "component-modify" : "component-create";
  }
  if (taskFamily === "layout") {
    return /\b(page|layout|screen|view)\b/iu.test(intent)
      ? "page-layout"
      : "responsive-layout";
  }
  if (taskFamily === "accessibility") return "accessibility-check";
  if (taskFamily === "figma" || action === "sync") return "figma-sync";
  if (taskFamily === "code" || action === "generate") return "code-generate";
  if (taskFamily === "design-system" || action === "initialize") return "design-system-init";
  return action === "audit" ? "design-audit" : "general";
}

function scoreTaskFamilies(intent: string): readonly FamilyMatch[] {
  const scores = new Map<IntentTaskFamily, { score: number; evidence: string[] }>();
  for (const rule of FAMILY_RULES) {
    const match = rule.pattern.exec(intent);
    if (!match) continue;
    const existing = scores.get(rule.value) ?? { score: 0, evidence: [] };
    scores.set(rule.value, {
      score: existing.score + (rule.weight ?? 1),
      evidence: [...existing.evidence, match[0]!.toLowerCase()],
    });
  }
  return [...scores.entries()]
    .map(([family, value]) => ({ family, ...value }))
    .sort((left, right) =>
      right.score - left.score || left.family.localeCompare(right.family));
}

function matchedRules<T extends string>(
  intent: string,
  rules: readonly SignalRule<T>[],
): readonly { value: T; match: string }[] {
  return rules.flatMap((rule) => {
    const match = rule.pattern.exec(intent);
    return match ? [{ value: rule.value, match: match[0]!.toLowerCase() }] : [];
  });
}

function matchedEvidence<T extends string>(
  intent: string,
  rules: readonly SignalRule<T>[],
): readonly string[] {
  return matchedRules(intent, rules).map((match) => match.match);
}

function valuesForMatches<T extends string>(
  matches: readonly { value: T; match: string }[],
): readonly T[] {
  return [...new Set(matches.map((match) => match.value))];
}

function calculateConfidence(input: {
  readonly action: IntentAction | null;
  readonly taskFamily: IntentTaskFamily;
  readonly platforms: readonly IntentPlatform[];
  readonly targetSurfaces: readonly IntentTargetSurface[];
  readonly requiredStates: readonly IntentRequiredState[];
  readonly familyAmbiguous: boolean;
  readonly platformAmbiguous: boolean;
}): number {
  const value = (input.action ? 0.2 : 0)
    + (input.taskFamily !== "general" ? 0.35 : 0)
    + (input.platforms.length > 0 ? 0.1 : 0)
    + (input.targetSurfaces.length > 0 ? 0.15 : 0)
    + (input.requiredStates.length > 0 ? 0.1 : 0)
    + (!input.familyAmbiguous && input.taskFamily !== "general" ? 0.1 : 0)
    - (input.platformAmbiguous ? 0.35 : 0);
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function emptyEvidence(): IntentSignalEvidence {
  return {
    action: [],
    taskFamily: [],
    platform: [],
    targetSurface: [],
    requiredState: [],
  };
}

function frozenClassification(
  value: Omit<IntentSignalClassification, "schemaVersion">,
): IntentSignalClassification {
  return deepFreeze({ schemaVersion: 1 as const, ...value });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
