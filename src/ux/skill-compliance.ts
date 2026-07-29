/**
 * Skill Compliance Checker — post-hoc, deterministic verification that real
 * source files follow the checkable rules described in skills/ATOMIC_DESIGN.md
 * and skills/MOTION_VIDEO_DESIGN.md.
 *
 * No LLM reads these docs at check time — the checkable rules are hand-extracted
 * into the regex/string checks below (each cites the doc line it came from), so
 * this stays fast and deterministic like specs/validator.ts. This does not make
 * an agent obey markdown — it is the same mechanism a linter uses to enforce a
 * style guide: run after the fact, over real files, independent of whether the
 * agent read the doc, generated the file via memi, or hand-wrote it.
 *
 * skills/DESIGN_SYSTEM_REFERENCE.md contributes nothing checkable — it is a
 * pure component-name-to-external-URL catalog with zero required props, states,
 * durations, or naming rules. getReferenceCoverage() below surfaces it as a
 * read-only benchmark annotation, never a pass/fail input.
 */

export type ComplianceSeverity = "critical" | "warning";

export interface ComplianceFinding {
  severity: ComplianceSeverity;
  rule: string;
  file: string;
  message: string;
  fix?: string;
  docRef: string;
}

export interface ComplianceReport {
  version: 1;
  target: string;
  generatedAt: string;
  findings: ComplianceFinding[];
  summary: { critical: number; warning: number; filesChecked: number };
}

export interface ReferenceCoverageNote {
  component: string;
  systemsCatalogued: number;
  note: string;
}

interface SourceFile {
  path: string;
  content: string;
}

type Ruleset = "atomic" | "motion";

const ATOMIC_UI_DIR = /(^|\/)components\/ui\//;
const ATOMIC_MOLECULE_DIR = /(^|\/)components\/molecules\//;
const ATOMIC_ORGANISM_DIR = /(^|\/)components\/organisms\//;
const ATOMIC_TEMPLATE_DIR = /(^|\/)components\/templates\//;

/**
 * Run the requested rule families over already-in-memory source files.
 * Accepts either a full-project scan (RawFile[]-shaped, extra fields ignored)
 * or a single memi-generated file, since only `path`/`content` are read.
 */
export function checkSkillCompliance(
  files: SourceFile[],
  opts?: { rulesets?: Ruleset[]; target?: string },
): ComplianceReport {
  const rulesets = opts?.rulesets ?? ["atomic", "motion"];
  const findings: ComplianceFinding[] = [];

  for (const file of files) {
    if (!/\.(tsx|jsx|ts|js|css)$/.test(file.path)) continue;
    if (rulesets.includes("atomic")) findings.push(...checkAtomicComposition(file));
    if (rulesets.includes("motion")) findings.push(...checkMotionTokens(file));
  }

  return {
    version: 1,
    target: opts?.target ?? "",
    generatedAt: new Date().toISOString(),
    findings,
    summary: {
      critical: findings.filter((f) => f.severity === "critical").length,
      warning: findings.filter((f) => f.severity === "warning").length,
      filesChecked: files.length,
    },
  };
}

/**
 * Atomic Design composition/placement rules extracted from
 * skills/ATOMIC_DESIGN.md (composition-level table + anti-patterns section).
 * Single-file checks only — cross-file import-count rules (a molecule must
 * compose 2-5 atoms) need a resolved import graph and are NOT checked here;
 * they require app-graph.ts's resolver and are out of scope for a per-file
 * or per-generation check. This function only checks what a single file's
 * own content/imports/hooks reveal about itself.
 */
function checkAtomicComposition(file: SourceFile): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  const isAtom = ATOMIC_UI_DIR.test(file.path);
  const isTemplate = ATOMIC_TEMPLATE_DIR.test(file.path);
  const isMolecule = ATOMIC_MOLECULE_DIR.test(file.path);
  const isOrganism = ATOMIC_ORGANISM_DIR.test(file.path);
  if (!isAtom && !isTemplate && !isMolecule && !isOrganism) return findings;

  // ATOMIC_DESIGN.md: atoms have no internal state — they receive everything via props.
  if (isAtom && /\buse(State|Reducer|Context)\s*\(/.test(file.content)) {
    findings.push({
      severity: "warning",
      rule: "atomic-no-state-in-atoms",
      file: file.path,
      message: "Component under components/ui/ (atom level) uses React state (useState/useReducer/useContext) — atoms should be fully controlled via props.",
      fix: "Lift state to the molecule/organism that composes this atom, or move this file out of components/ui/ if it genuinely needs internal state.",
      docRef: "skills/ATOMIC_DESIGN.md — atomic level decision table",
    });
  }

  // ATOMIC_DESIGN.md: atoms/templates don't own data fetching — that's organism/page territory.
  const fetchesData = /\b(fetch\(|axios\.|useQuery\(|useSWR\(|"use server"|['"]use server['"])/.test(file.content);
  if ((isAtom || isTemplate) && fetchesData) {
    findings.push({
      severity: "warning",
      rule: "atomic-no-data-fetching-in-atoms-or-templates",
      file: file.path,
      message: `Component under ${isAtom ? "components/ui/ (atom)" : "components/templates/ (template)"} appears to fetch data directly — data fetching belongs at the organism/page level.`,
      fix: "Move the fetch/query call to the organism or page that composes this component, and pass data down as props.",
      docRef: "skills/ATOMIC_DESIGN.md — composition rules",
    });
  }

  // ATOMIC_DESIGN.md naming: exported component identifiers are PascalCase.
  const exportedNonPascal = [...file.content.matchAll(/export\s+(?:function|const)\s+([a-z][A-Za-z0-9_]*)/g)]
    .map((m) => m[1])
    .filter((name) => !/^use[A-Z]/.test(name)); // exclude hooks, which are camelCase by convention
  if (exportedNonPascal.length > 0) {
    findings.push({
      severity: "warning",
      rule: "atomic-component-naming",
      file: file.path,
      message: `Exported component-like identifier(s) not PascalCase: ${exportedNonPascal.join(", ")}.`,
      fix: "Rename exported components to PascalCase per Atomic Design naming conventions.",
      docRef: "skills/ATOMIC_DESIGN.md — naming conventions",
    });
  }

  return findings;
}

const MOTION_TOKEN_PATTERN = /var\(--motion-|MOTION_TOKENS|motionTokens\.|durations\./;

/**
 * Motion/animation rules extracted from skills/MOTION_VIDEO_DESIGN.md.
 * Single-file, regex-based — deliberately conservative (warning severity by
 * default) since false positives are easy here (e.g. a legitimate one-off
 * marquee using linear easing). Only the doc's own "cleanest, most
 * mechanically verifiable rule" (hardcoded duration literals) is a candidate
 * for stricter treatment; it still ships as warning here and is promoted to
 * critical only when the caller passes strict mode upstream.
 */
function checkMotionTokens(file: SourceFile): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  const hasAnimation = /\b(transition|animation|keyframes|animate\(|framer-motion|motion\.)/i.test(file.content);
  if (!hasAnimation) return findings;

  // MOTION_VIDEO_DESIGN.md: durations/easings should reference motion tokens,
  // not raw literals — catches both object-property style (transitionDuration:
  // "250ms") and CSS shorthand (transition: "opacity 250ms ease").
  const hardcodedDurations = [...file.content.matchAll(/\b(\d{2,4})ms\b/g)]
    .filter((m) => !MOTION_TOKEN_PATTERN.test(file.content.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 60)));
  if (hardcodedDurations.length > 0) {
    findings.push({
      severity: "warning",
      rule: "motion-hardcoded-duration",
      file: file.path,
      message: `${hardcodedDurations.length} hardcoded animation duration value(s) not referencing a motion token.`,
      fix: "Reference a --motion-* CSS variable or shared duration token instead of a raw millisecond literal.",
      docRef: "skills/MOTION_VIDEO_DESIGN.md — motion token system",
    });
  }

  // MOTION_VIDEO_DESIGN.md: custom animations must respect prefers-reduced-motion.
  const hasReducedMotionGuard = /prefers-reduced-motion/.test(file.content);
  if (!hasReducedMotionGuard) {
    findings.push({
      severity: "warning",
      rule: "motion-missing-reduced-motion",
      file: file.path,
      message: "File defines animation/transition/keyframes with no prefers-reduced-motion accommodation found in the same file.",
      fix: "Add a @media (prefers-reduced-motion: reduce) override, or gate the animation behind a usePrefersReducedMotion-style check.",
      docRef: "skills/MOTION_VIDEO_DESIGN.md — accessibility and reduced motion",
    });
  }

  // MOTION_VIDEO_DESIGN.md: animate transform/opacity, not layout-triggering properties.
  const nonGpuAnimated = /(?:transition|animate)[^;{}]*\b(width|height|top|left|margin)\b/i.test(file.content);
  if (nonGpuAnimated) {
    findings.push({
      severity: "warning",
      rule: "motion-non-gpu-property",
      file: file.path,
      message: "Animation/transition targets a layout-triggering property (width/height/top/left/margin) instead of transform/opacity.",
      fix: "Animate transform (translate/scale) and opacity instead of layout properties for smooth, GPU-accelerated motion.",
      docRef: "skills/MOTION_VIDEO_DESIGN.md — performance",
    });
  }

  return findings;
}

/**
 * Read-only lookup into the external design-skills reference catalog.
 * Informational only, never contributes to ComplianceReport.summary and never
 * gates anything. The npm package omits the 56 KB source catalog; agents can
 * search and pull the governed catalog only when this evidence is relevant.
 */
const REFERENCE_COMPONENT_COUNTS: Record<string, number> = {
  accordion: 18, alert: 22, avatar: 19, badge: 17, breadcrumbs: 12,
  button: 24, "button group": 9, card: 20, carousel: 14, checkbox: 16,
  "color picker": 8, combobox: 11, "date input": 9, datepicker: 13,
  drawer: 12, "dropdown menu": 15,
};

export function getReferenceCoverage(componentKind: string): ReferenceCoverageNote[] {
  const key = componentKind.trim().toLowerCase();
  const count = REFERENCE_COMPONENT_COUNTS[key];
  if (count === undefined) {
    return [{ component: componentKind, systemsCatalogued: 0, note: "Not indexed in the external design-skills reference catalog." }];
  }
  return [{
    component: componentKind,
    systemsCatalogued: count,
    note: `${count} external design systems document a "${componentKind}" pattern in the design-skills reference catalog. This is informational only, not a compliance input.`,
  }];
}
