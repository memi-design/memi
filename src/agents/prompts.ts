/**
 * Agent Prompts — Rich, structured prompts for Claude-powered design agents.
 *
 * Each prompt is designed to maximize Claude's reasoning by providing:
 *   1. Clear role and expertise framing
 *   2. Structured context (current state, constraints)
 *   3. Specific deliverables and output format
 *   4. Design system best practices
 *   5. shadcn/ui + Tailwind conventions
 */

import type { DesignToken, DesignSystem, DesignComponent } from "../engine/registry.js";
import type { AnySpec, ComponentSpec, PageSpec, DataVizSpec } from "../specs/types.js";
import type { AgentContext } from "./plan-builder.js";

// ── Prompt Builder Helpers ───────────────────────────────

function tokenSummary(tokens: DesignToken[]): string {
  const byType = new Map<string, number>();
  for (const t of tokens) byType.set(t.type, (byType.get(t.type) || 0) + 1);
  return Array.from(byType.entries()).map(([k, v]) => `${v} ${k}`).join(", ");
}

function specSummary(specs: AnySpec[]): string {
  if (specs.length === 0) return "(none)";
  const byType = new Map<string, string[]>();
  for (const s of specs) {
    if (!byType.has(s.type)) byType.set(s.type, []);
    byType.get(s.type)!.push(s.name);
  }
  return Array.from(byType.entries()).map(([k, v]) => `${k}: ${v.join(", ")}`).join("; ");
}

function tokenTable(tokens: DesignToken[]): string {
  if (tokens.length === 0) return "(none)";
  return tokens
    .slice(0, 30)
    .map((t) => `  ${t.name}: ${JSON.stringify(Object.values(t.values)[0] ?? "(empty)")} [${t.type}/${t.collection}]`)
    .join("\n");
}

// ── Color Prompts ────────────────────────────────────────

function colorAnalysis(intent: string, colorTokens: DesignToken[]): string {
  return `You are a Senior Color Systems Architect specializing in design system token architecture.

## Task
Analyze the current color token system and identify how to fulfill this request:
"${intent}"

## Current Color Tokens (${colorTokens.length} total)
${tokenTable(colorTokens)}

## Analysis Framework
1. **Semantic Mapping**: Which tokens serve as primary, secondary, accent, background, foreground, muted, destructive, etc.?
2. **Scale Coherence**: Do the colors follow a consistent lightness/saturation scale?
3. **Contrast Compliance**: Which pairs meet WCAG AA (4.5:1) and AAA (7:1) contrast ratios?
4. **Missing Gaps**: What semantic roles are missing? (e.g., no warning color, no success state)
5. **Dark Mode Readiness**: Are there paired light/dark values for each semantic token?

## shadcn/ui Color Convention
shadcn/ui expects these CSS variables:
- --background, --foreground (base)
- --card, --card-foreground
- --popover, --popover-foreground
- --primary, --primary-foreground
- --secondary, --secondary-foreground
- --muted, --muted-foreground
- --accent, --accent-foreground
- --destructive, --destructive-foreground
- --border, --input, --ring
- --chart-1 through --chart-5

## Output
Provide a structured analysis identifying:
1. Current coverage vs shadcn/ui expectations
2. Recommended additions/modifications to fulfill "${intent}"
3. Specific hex values with contrast ratios`;
}

function colorGeneration(intent: string, colorTokens: DesignToken[]): string {
  return `You are a Color Engineer generating design tokens for a shadcn/ui + Tailwind CSS system.

## Request
"${intent}"

## Current Palette
${tokenTable(colorTokens)}

## Requirements
1. Generate tokens as JSON objects: { name, collection, type: "color", values: { "Mode 1": "#hex" }, cssVariable: "--name" }
2. All colors must work in HSL format for Tailwind: "210 40% 98%"
3. Ensure WCAG AA contrast (4.5:1) between foreground/background pairs
4. Follow the 60-30-10 rule: 60% primary/neutral, 30% secondary, 10% accent
5. Support both light and dark modes

## Color Scale Convention
For each base hue, generate a full scale:
- 50 (lightest), 100, 200, 300, 400, 500 (mid), 600, 700, 800, 900, 950 (darkest)

## Output Format
Return an array of DesignToken objects ready for direct insertion into the design system.`;
}

// ── Spacing Prompts ──────────────────────────────────────

function spacingAnalysis(intent: string, spacingTokens: DesignToken[]): string {
  return `You are a Spatial Design Engineer analyzing spacing token architecture.

## Request: "${intent}"

## Current Spacing Tokens (${spacingTokens.length})
${tokenTable(spacingTokens)}

## Analysis
1. **Scale Type**: Is this a linear scale (4, 8, 12, 16...), geometric (2, 4, 8, 16...), or custom?
2. **Base Unit**: What's the base unit? (typically 4px or 8px for modern design systems)
3. **Gaps**: Which spacing values are missing for common use cases?
4. **Tailwind Mapping**: How do these map to Tailwind's spacing scale (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24...)?

## Recommendation
The ideal spacing system uses a 4px base with these semantic tokens:
- space-xs: 4px (tight elements)
- space-sm: 8px (compact spacing)
- space-md: 16px (default spacing)
- space-lg: 24px (section spacing)
- space-xl: 32px (major sections)
- space-2xl: 48px (page-level)
- space-3xl: 64px (hero sections)`;
}

function spacingGeneration(intent: string, spacingTokens: DesignToken[]): string {
  return `You are a Spacing System Engineer. Generate spacing tokens for: "${intent}"

## Current State
${tokenTable(spacingTokens)}

## Generate
Output DesignToken[] with type: "spacing", values in px units.
Follow a geometric progression with 4px base unit.
Include both raw scale (1-20) and semantic names (xs, sm, md, lg, xl).`;
}

// ── Typography Prompts ───────────────────────────────────

function typographyAnalysis(intent: string, typoTokens: DesignToken[]): string {
  return `You are a Typography Architect designing type systems for web applications.

## Request: "${intent}"

## Current Typography Tokens (${typoTokens.length})
${tokenTable(typoTokens)}

## Type Scale Best Practices
1. **Major Third (1.25)**: 12, 15, 18.75, 23.4, 29.3 — warm, readable
2. **Perfect Fourth (1.333)**: 12, 16, 21.3, 28.4, 37.9 — strong hierarchy
3. **Minor Third (1.2)**: 12, 14.4, 17.3, 20.7, 24.9 — subtle, elegant

## Font Stack Conventions (shadcn/ui)
- --font-sans: system-ui, -apple-system, sans-serif
- --font-mono: 'SF Mono', 'Fira Code', monospace
- Line heights: tight (1.25), normal (1.5), relaxed (1.75)
- Font weights: normal (400), medium (500), semibold (600), bold (700)

## Semantic Typography Tokens
- text-xs: 12px/16px — captions, labels
- text-sm: 14px/20px — body small
- text-base: 16px/24px — body default
- text-lg: 18px/28px — lead text
- text-xl: 20px/28px — h4
- text-2xl: 24px/32px — h3
- text-3xl: 30px/36px — h2
- text-4xl: 36px/40px — h1`;
}

function typographyGeneration(intent: string, typoTokens: DesignToken[]): string {
  return `You are a Typography Engineer. Generate type scale tokens for: "${intent}"

## Current: ${tokenTable(typoTokens)}

Output DesignToken[] with type: "typography".
Include font-size, line-height, font-weight, and letter-spacing values.
Use rem units (1rem = 16px).`;
}

// ── Theme Prompts ────────────────────────────────────────

function themeAnalysis(intent: string, ds: DesignSystem): string {
  return `You are a Theme Systems Architect reviewing a design system for theme modification.

## Request: "${intent}"

## Current Design System
- Tokens: ${tokenSummary(ds.tokens)}
- Components: ${ds.components.map((c) => c.name).join(", ") || "(none)"}
- Styles: ${ds.styles.length} styles
- Last synced: ${ds.lastSync}

## Full Token List
${tokenTable(ds.tokens)}

## Theme Architecture Principles
1. **Token Layering**: Reference tokens → Semantic tokens → Component tokens
2. **Mode Support**: Every visual token needs light + dark mode values
3. **Consistency**: Tokens should follow naming conventions (--{category}-{property}-{variant})
4. **shadcn/ui Compatibility**: Must map to shadcn's CSS variable system

Analyze the current theme state and recommend changes for "${intent}".`;
}

function themeGeneration(intent: string, ds: DesignSystem): string {
  return `You are a Theme Builder generating a complete theme token set.

## Request: "${intent}"

## Existing tokens: ${ds.tokens.length}

Generate a complete theme with:
1. Color tokens (background, foreground, primary, secondary, accent, muted, destructive, border, input, ring, chart-1..5)
2. Both light and dark mode values
3. Radius tokens (sm, md, lg, xl, full)
4. Shadow tokens (sm, md, lg)

Output as DesignToken[] with multi-mode values: { "Light": "#val", "Dark": "#val" }`;
}

function themeModeUpdate(intent: string): string {
  return `Update all token modes to reflect the theme change: "${intent}".
Ensure light/dark mode pairs maintain WCAG AA contrast ratios.
Output the updated token values.`;
}

function themeCodegen(intent: string, specs: AnySpec[]): string {
  return `Regenerate component code for ${specs.length} specs after theme change: "${intent}".
Ensure all components use CSS variables (var(--token-name)) rather than hardcoded values.
Specs: ${specs.map((s) => s.name).join(", ")}`;
}

// ── Token General Prompts ────────────────────────────────

function tokenParse(intent: string, tokens: DesignToken[]): string {
  return `Parse this design token update request: "${intent}"

## Available Tokens (${tokens.length})
${tokenTable(tokens)}

Identify:
1. Which token(s) to modify
2. What the new value(s) should be
3. Whether this creates new tokens or modifies existing ones`;
}

function tokenApplication(tokenType: string, intent: string): string {
  return `Apply ${tokenType} token changes for: "${intent}".
Write the updated DesignToken objects and persist to the registry.
Validate all values match their declared type (color → hex/hsl, spacing → px/rem, etc.)`;
}

// ── Component Prompts ────────────────────────────────────

function componentAnalysis(intent: string, ds: DesignSystem, specs: AnySpec[]): string {
  return `You are a Component Architect analyzing requirements for a new shadcn/ui component.

## IMPORTANT: Check Code Connect First
Before designing a new component, verify it doesn't already exist in the codebase via Code Connect.
Call get_code_connect_map to check for existing Figma→code mappings.
If a mapped component already exists, use it instead of creating a duplicate.

## Request: "${intent}"

## Existing Components
${specs.filter((s) => s.type === "component").map((s) => {
  const cs = s as ComponentSpec;
  const ccStatus = cs.codeConnect?.mapped ? " [Code Connect: MAPPED]" : "";
  return `- ${cs.name}: ${cs.purpose} (base: ${cs.shadcnBase.join(", ")})${ccStatus}`;
}).join("\n") || "(none)"}

## Design Tokens Available
${tokenSummary(ds.tokens)}

## shadcn/ui Component Library
Available base components: Accordion, Alert, AlertDialog, Avatar, Badge, Breadcrumb, Button,
Calendar, Card, Carousel, Chart, Checkbox, Collapsible, Combobox, Command, ContextMenu,
DataTable, DatePicker, Dialog, Drawer, DropdownMenu, Form, HoverCard, Input, InputOTP,
Label, Menubar, NavigationMenu, Pagination, Popover, Progress, RadioGroup, Resizable,
ScrollArea, Select, Separator, Sheet, Sidebar, Skeleton, Slider, Sonner, Switch, Table,
Tabs, Textarea, Toast, Toggle, ToggleGroup, Tooltip

## Analysis Required
1. Which shadcn/ui base components best serve this need?
2. What custom props are needed beyond the base?
3. What variants should be supported?
4. What design tokens should it consume?
5. How does it relate to existing components?`;
}

function componentDesign(intent: string, ds: DesignSystem): string {
  return `You are a Component Architect designing a ComponentSpec.

## Request: "${intent}"

## Available Design Tokens
${tokenSummary(ds.tokens)}

## Output: ComponentSpec JSON
{
  name: "PascalCase",
  type: "component",
  purpose: "Clear one-line description",
  researchBacking: [],
  designTokens: { source: "figma" | "manual", mapped: true },
  variants: ["default", ...],
  props: { propName: "TypeScript type" },
  shadcnBase: ["shadcn/ui component names"],
  accessibility: { role: "ARIA role", ariaLabel: "description", keyboardNav: true },
  dataviz: null,
  tags: ["relevant", "tags"],
  createdAt: ISO8601,
  updatedAt: ISO8601
}

## Design Principles
- Composition over configuration (prefer composable props)
- Accessible by default (ARIA, keyboard, screen reader)
- Token-driven (all visual properties from design tokens)
- Variant-aware (support multiple visual variants)`;
}

function componentCodegen(intent: string): string {
  return `Generate shadcn/ui + Tailwind React component code.

## Request: "${intent}"

## Code Connect
Only generate code for UNMAPPED components. If a component has codeConnect.mapped === true,
the codebase already has the implementation — use the existing code at codeConnect.codebasePath.
After generation, establish Code Connect mapping with add_code_connect_map.

## Code Requirements
1. "use client" directive at top
2. Import from @/components/ui/* (shadcn/ui)
3. Use cn() utility from @/lib/utils for className merging
4. TypeScript interface for props (extending React.HTMLAttributes)
5. Forward ref pattern
6. All styling via Tailwind classes using CSS variables
7. Accessible: ARIA attributes, keyboard handlers
8. Export both named component and default`;
}

function componentIdentify(intent: string, specs: AnySpec[]): string {
  return `Identify which component to modify based on: "${intent}"

## Available Components
${specs.filter((s) => s.type === "component").map((s) => `- ${s.name}: ${s.purpose}`).join("\n") || "(none)"}

Return the component name and what modifications are needed.`;
}

function componentModify(intent: string): string {
  return `Modify the identified component spec based on: "${intent}"
Update props, variants, shadcnBase, or accessibility as needed.
Preserve existing spec structure — only modify what the intent requires.`;
}

// ── Page Layout Prompts ──────────────────────────────────

function pageAnalysis(intent: string, specs: AnySpec[]): string {
  return `You are a Layout Designer analyzing page layout requirements.

## Request: "${intent}"

## Available Components for Composition
${specs.filter((s) => s.type === "component").map((s) => `- ${s.name}: ${s.purpose}`).join("\n") || "(none)"}

## Available DataViz
${specs.filter((s) => s.type === "dataviz").map((s) => `- ${s.name}: ${s.purpose}`).join("\n") || "(none)"}

## Layout Types (shadcn/ui)
1. sidebar-main: AppSidebar + SidebarInset (most dashboard pages)
2. full-width: Container spanning viewport
3. centered: Flexbox centered, max-width container
4. dashboard: Sidebar + grid of cards/charts
5. split: Two-column grid
6. marketing: Hero sections with CTA flow

Recommend the best layout and section composition.`;
}

function pageDesign(intent: string, ds: DesignSystem, specs: AnySpec[]): string {
  return `Design a PageSpec for: "${intent}"

## Available Components
${specs.filter((s) => s.type === "component").map((s) => s.name).join(", ") || "(none)"}

## Output: PageSpec JSON
{
  name: "PageName",
  type: "page",
  purpose: "description",
  layout: "sidebar-main" | "full-width" | "centered" | "dashboard" | "split" | "marketing",
  sections: [
    { name: "section-name", component: "ComponentName", layout: "full-width" | "grid-2" | "grid-3" | "grid-4", repeat: 1, props: {} }
  ],
  shadcnLayout: ["SidebarProvider", "AppSidebar", ...],
  responsive: { mobile: "stack", tablet: "grid-2", desktop: "grid-4" },
  meta: { title: "Page Title", description: "Meta desc" },
  tags: [],
  createdAt: ISO8601,
  updatedAt: ISO8601
}`;
}

function pageCodegen(intent: string): string {
  return `Generate page layout code for: "${intent}"
Use shadcn/ui layout primitives (SidebarProvider, AppSidebar, SidebarInset).
Tailwind responsive classes: max-sm: (mobile), sm: (tablet), lg: (desktop).
Import all section components from their generated paths.`;
}

// ── DataViz Prompts ──────────────────────────────────────

function datavizAnalysis(intent: string): string {
  return `You are a Data Visualization Specialist.

## Request: "${intent}"

## Chart Type Selection Guide
- **Line**: Trends over time, continuous data
- **Bar**: Comparisons between categories
- **Area**: Volume/magnitude over time
- **Pie/Donut**: Part-to-whole relationships (max 6 slices)
- **Scatter**: Correlation between two variables
- **Radar**: Multi-dimensional comparison
- **Composed**: Multiple chart types overlaid

## Recharts Best Practices
1. Responsive container: <ResponsiveContainer width="100%" height={400}>
2. Tooltip + Legend always included
3. CartesianGrid with strokeDasharray="3 3"
4. Color palette: hsl(var(--chart-1)) through hsl(var(--chart-5))
5. Accessible: data table fallback via <details>

Recommend chart type, data shape, and interactions.`;
}

function datavizDesign(intent: string, ds: DesignSystem): string {
  return `Design a DataVizSpec for: "${intent}"

## Output: DataVizSpec JSON
{
  name: "ChartName",
  type: "dataviz",
  purpose: "description",
  chartType: "line" | "bar" | "area" | "pie" | "donut" | "scatter" | "radar" | "composed",
  library: "recharts",
  dataShape: { x: "fieldName", y: "fieldName", series: ["field1", "field2"], groupBy: "field" },
  interactions: ["hover-tooltip", "click", "zoom", "brush"],
  accessibility: { altText: "", keyboardNav: true, dataTableFallback: true },
  responsive: { mobile: { height: 200, simplify: true }, desktop: { height: 400 } },
  shadcnWrapper: "Card",
  sampleData: [...],
  tags: [],
  createdAt: ISO8601,
  updatedAt: ISO8601
}`;
}

function datavizCodegen(intent: string): string {
  return `Generate Recharts component code for: "${intent}"
Wrap in shadcn/ui Card. Use ResponsiveContainer.
Include sample data rendering. Accessible data table fallback.
Color tokens from CSS variables.`;
}

// ── Responsive Prompts ───────────────────────────────────

function responsiveAudit(intent: string, specs: AnySpec[]): string {
  return `Audit responsive design coverage for: "${intent}"

## Page Specs
${specs.filter((s) => s.type === "page").map((s) => {
  const ps = s as PageSpec;
  return `- ${ps.name}: mobile=${ps.responsive.mobile}, tablet=${ps.responsive.tablet}, desktop=${ps.responsive.desktop}`;
}).join("\n") || "(none)"}

Check:
1. All pages have mobile, tablet, desktop breakpoints defined
2. Grid columns reduce appropriately (grid-4 → grid-2 → stack)
3. Font sizes scale down on mobile
4. Touch targets are 44x44px minimum on mobile
5. No horizontal scroll on mobile`;
}

function responsiveUpdate(intent: string): string {
  return `Update responsive specs for: "${intent}"
Ensure Tailwind breakpoint classes:
- Default (mobile-first)
- sm: 640px (tablet)
- md: 768px
- lg: 1024px (desktop)
- xl: 1280px
- 2xl: 1536px`;
}

// ── Figma Sync Prompts ───────────────────────────────────

function figmaSync(scope: string, intent: string): string {
  return `Sync ${scope} to Figma for: "${intent}"

## Figma Plugin API
- figma.variables.getLocalVariableCollectionsAsync() → collections
- collection.variableIds → variable IDs
- figma.variables.getVariableByIdAsync(id) → variable
- variable.setValueForMode(modeId, value) → update value
- figma.variables.createVariable(name, collectionId, resolvedType) → new var

## Color Format
Figma uses {r, g, b, a} where each is 0-1 float.
Convert hex: r = parseInt(hex.slice(1,3), 16) / 255

## Sync Strategy
1. Match local tokens to Figma variables by name
2. Update existing variables with new values
3. Create new variables for tokens without Figma counterparts
4. Respect multi-mode structure (Light/Dark)`;
}

function figmaConnect(): string {
  return `Connect to Figma Desktop Bridge.
1. Start WebSocket server on port 9223-9232
2. Wait for Figma plugin to connect
3. Verify bridge-hello handshake
4. Return connection status`;
}

function figmaPull(): string {
  return `Pull the latest design system from Figma.
1. Extract all variable collections (tokens)
2. Extract all local components
3. Extract all local styles
4. Parse into DesignToken[], DesignComponent[], DesignStyle[]
5. Update local registry`;
}

function figmaDiff(): string {
  return `Compare local design system state with Figma state.
Identify:
- Tokens modified locally but not in Figma
- Tokens modified in Figma but not locally
- New tokens on either side
- Conflicting changes (modified on both sides)`;
}

function figmaComponentCreate(intent: string): string {
  return `Create a Figma component for: "${intent}"

Use the Figma Plugin API:
1. figma.createFrame() for the base
2. Set layout mode (AUTO_LAYOUT)
3. Add child elements (text, shapes, instances)
4. figma.createComponentFromNode(frame) to make it a component
5. Set component properties for variants

Ensure the component matches the spec's design tokens.`;
}

function figmaPageCompose(intent: string): string {
  return `Compose a page layout in Figma for: "${intent}"

1. Create a Frame per viewport (Desktop: 1440px, Tablet: 768px, Mobile: 375px)
2. Set auto-layout for responsive behavior
3. Instantiate component instances for each section
4. Apply spacing tokens between sections
5. Add dev annotations for handoff`;
}

// ── Audit Prompts ────────────────────────────────────────

function auditTokens(ds: DesignSystem): string {
  return `Audit design token system for consistency and completeness.

## Tokens (${ds.tokens.length})
${tokenTable(ds.tokens)}

## Check
1. Naming consistency: all tokens follow {category}/{property}/{variant} convention
2. Value validity: colors are valid hex/hsl, spacing is valid px/rem
3. Coverage: all shadcn/ui expected tokens are present
4. Mode parity: every token has values for all defined modes
5. No orphaned tokens (tokens not used by any component)`;
}

function auditSpecs(specs: AnySpec[]): string {
  return `Audit all specs for completeness and cross-reference validity.

## Specs (${specs.length})
${specSummary(specs)}

## Check
1. Every spec has a non-empty purpose
2. ComponentSpecs have at least one shadcnBase
3. PageSpec sections reference existing ComponentSpecs
4. ComponentSpec dataviz field references existing DataVizSpecs
5. No circular dependencies`;
}

function auditAccessibility(ds: DesignSystem, specs: AnySpec[]): string {
  const components = specs.filter((s) => s.type === "component") as ComponentSpec[];
  const pages = specs.filter((s) => s.type === "page") as PageSpec[];
  const dataviz = specs.filter((s) => s.type === "dataviz") as DataVizSpec[];
  return `You are a Senior Accessibility Engineer conducting a WCAG 2.2 compliance audit.

## Design System
- ${ds.tokens.length} tokens, ${ds.components.length} components
- ${components.length} component specs, ${pages.length} page specs, ${dataviz.length} dataviz specs

## WCAG 2.2 Audit Checklist (Level AA)

### Perceivable
1. **1.1.1 Non-text Content**: All images have alt text, decorative images use aria-hidden
2. **1.3.1 Info and Relationships**: Semantic HTML (headings, lists, tables, landmarks)
3. **1.3.5 Identify Input Purpose**: Form fields use autocomplete attributes for personal data
4. **1.4.1 Use of Color**: Information not conveyed by color alone — check ${components.filter(c => c.accessibility?.colorIndependent === false).length} components flagged as color-dependent
5. **1.4.3 Contrast Minimum**: All fg/bg pairs meet 4.5:1 (normal text), 3:1 (large text)
6. **1.4.11 Non-text Contrast**: UI components and graphical objects meet 3:1

### Operable
7. **2.1.1 Keyboard**: All interactive elements reachable via Tab, operable via Enter/Space
8. **2.4.3 Focus Order**: Tab order matches visual layout order
9. **2.4.7 Focus Visible**: All interactive elements have visible focus indicators
10. **2.4.11 Focus Appearance** (2.2): Focus indicator >= 2px, contrasts 3:1 with adjacent colors
11. **2.4.12 Focus Not Obscured** (2.2): Focused elements not fully hidden by sticky/fixed elements
12. **2.5.5 Target Size**: Interactive targets >= 44x44px (AAA) or 24x24px (AA per 2.5.8)
13. **2.5.7 Dragging Movements** (2.2): Drag operations have non-dragging alternatives
14. **2.5.8 Target Size Minimum** (2.2): All targets >= 24x24 CSS px or 24px spacing between

### Understandable
15. **3.2.3 Consistent Navigation**: Nav order consistent across pages — ${pages.filter(p => p.accessibility?.consistentNav !== false).length}/${pages.length} pages compliant
16. **3.2.6 Consistent Help** (2.2): Help mechanisms in same relative position across pages
17. **3.3.1 Error Identification**: Errors described in text, not color alone
18. **3.3.2 Labels or Instructions**: All form inputs have visible labels
19. **3.3.7 Redundant Entry** (2.2): Previously entered info auto-populated in multi-step flows
20. **3.3.8 Accessible Authentication** (2.2): No cognitive function tests as sole auth method

### Robust
21. **4.1.2 Name, Role, Value**: All components expose correct ARIA name, role, state
22. **4.1.3 Status Messages**: Dynamic updates use role="status" or aria-live

## Components Missing A11y Properties
${components.filter(c => !c.accessibility?.role && c.accessibility?.ariaLabel !== "none").map(c => `- ${c.name}: no ARIA role defined`).join("\n") || "(all have roles)"}

## Scoring
Rate each criterion: PASS / FAIL / PARTIAL / N/A
Calculate overall percentage. Critical failures (any criterion that blocks access) must be listed separately.

## Output
For each finding, produce JSON: { id, rule, level, severity, component, element, issue, remediation, effort, automated }`;
}

function auditReport(intent: string): string {
  return `Generate a comprehensive design system audit report for: "${intent}"

## Report Structure
1. **Executive Summary**: Overall health score (0-100)
2. **Token Coverage**: Which token types are present/missing
3. **Component Quality**: Spec completeness scores
4. **Accessibility Score**: WCAG compliance percentage
5. **Figma Parity**: Local vs Figma sync status
6. **Recommendations**: Prioritized list of improvements`;
}

// ── Accessibility Prompts ────────────────────────────────

function a11yContrast(ds: DesignSystem): string {
  const colors = ds.tokens.filter((t) => t.type === "color");
  return `You are a Color Accessibility Specialist. Audit all color token pairs for WCAG 2.2 contrast compliance.

## Color Tokens (${colors.length} total)
${tokenTable(colors)}

## Audit Protocol
1. **Build pair matrix**: For each foreground token, pair with every plausible background token
2. **Calculate contrast ratio** using relative luminance:
   - L = 0.2126*R + 0.7152*G + 0.0722*B (linearized sRGB)
   - ratio = (L_lighter + 0.05) / (L_darker + 0.05)
3. **Apply thresholds**:
   - Normal text (< 18px / < 14px bold): 4.5:1 AA, 7:1 AAA
   - Large text (>= 18px or >= 14px bold): 3:1 AA, 4.5:1 AAA
   - UI components, icons, borders: 3:1 AA
   - Disabled elements: exempt
4. **Check all states**: default, hover, active, focus, selected, error, disabled
5. **Color-blind safety**: Flag red/green-only distinctions, suggest pattern/icon alternatives

## Non-text Contrast (WCAG 1.4.11)
- Form input borders must contrast 3:1 against background
- Icon buttons must contrast 3:1 (the icon itself against its background)
- Chart series must be distinguishable without color alone (pattern fills, labels)
- Focus indicators must contrast 3:1 against adjacent colors

## Output
For each failing pair:
\`\`\`json
{ "fg": "#hex", "bg": "#hex", "ratio": "X.X:1", "threshold": "4.5:1", "level": "AA", "usage": "where used", "fix": "suggested replacement with passing ratio" }
\`\`\``;
}

function a11yAria(specs: AnySpec[]): string {
  const components = specs.filter((s) => s.type === "component") as ComponentSpec[];
  const dataviz = specs.filter((s) => s.type === "dataviz") as DataVizSpec[];
  return `You are an ARIA Specialist. Audit all component and dataviz specs for correct ARIA usage.

## Component Specs (${components.length})
${components.map((c) => `- ${c.name} [${c.level}]: role=${c.accessibility?.role || "MISSING"}, ariaLabel=${c.accessibility?.ariaLabel || "MISSING"}, liveRegion=${c.accessibility?.liveRegion || "off"}, colorIndependent=${c.accessibility?.colorIndependent ?? "UNKNOWN"}`).join("\n") || "(none)"}

## DataViz Specs (${dataviz.length})
${dataviz.map((d) => `- ${d.name} [${d.chartType}]: altText=${d.accessibility?.altText || "MISSING"}, dataTableFallback=${d.accessibility?.dataTableFallback ?? false}, patternFill=${d.accessibility?.patternFill ?? false}`).join("\n") || "(none)"}

## ARIA Audit Checklist
1. **Roles**: Every interactive component has an appropriate ARIA role matching WAI-ARIA patterns
   - Buttons: role="button" (or native <button>)
   - Dialogs: role="dialog" + aria-modal
   - Tabs: role="tablist" > role="tab" + role="tabpanel"
   - Menus: role="menu" > role="menuitem"
2. **Names**: All components have accessible names via aria-label, aria-labelledby, or visible text
3. **States**: Dynamic components expose aria-expanded, aria-selected, aria-checked, aria-pressed
4. **Live regions**: Components with dynamic content (toasts, counters, status) use aria-live
5. **Relationships**: aria-describedby for supplementary info, aria-controls for controlling elements
6. **Form patterns**: All inputs have <label> or aria-label, error messages use aria-describedby + aria-invalid
7. **DataViz**: Charts have alt text description, data table fallback in <details>, pattern fills for color independence
8. **Status messages** (WCAG 4.1.3): Non-intrusive updates use role="status"

## Common Mistakes to Flag
- Using role="button" on a <div> without tabindex="0" and keyboard handler
- aria-label on non-interactive elements (screen readers may ignore it)
- Redundant aria-label that duplicates visible text
- Missing aria-expanded on expandable triggers
- Live regions created dynamically (must exist in DOM before content changes)

## Output
For each finding: { component, issue, pattern (WAI-ARIA pattern name), fix, severity }`;
}

function a11yKeyboard(specs: AnySpec[]): string {
  const components = specs.filter((s) => s.type === "component") as ComponentSpec[];
  return `You are a Keyboard Accessibility Specialist. Audit all components for keyboard navigation compliance.

## Components (${components.length})
${components.map((c) => `- ${c.name} [${c.level}]: keyboardNav=${c.accessibility?.keyboardNav ?? "UNKNOWN"}, focusStyle=${c.accessibility?.focusStyle || "default"}, touchTarget=${c.accessibility?.touchTarget || "default"}`).join("\n")}

## WCAG 2.2 Keyboard Audit

### 2.1.1 Keyboard Accessible
- All functionality available via keyboard (Tab, Enter, Space, Arrow, Escape)
- No keyboard traps — user can always Tab away (except intentional modal traps)
- Custom widgets follow WAI-ARIA keyboard patterns:
  | Widget | Keys | Pattern |
  |--------|------|---------|
  | Button | Enter, Space | Activates |
  | Menu | Arrow Up/Down, Enter, Escape | Navigate items, select, close |
  | Tabs | Arrow Left/Right, Home, End | Switch tabs within tablist |
  | Dialog | Tab (trapped), Escape | Focus trapped, Escape closes |
  | Combobox | Arrow Down, Enter, Escape | Open list, select, close |
  | Slider | Arrow Left/Right/Up/Down | Adjust value |
  | Tree | Arrow Up/Down/Left/Right | Navigate, expand/collapse |

### 2.4.7 Focus Visible
- Every interactive element shows a visible focus indicator
- Focus ring: minimum 2px, solid outline, contrasts 3:1 with adjacent colors (WCAG 2.4.11)

### 2.4.11 Focus Appearance (WCAG 2.2)
- Focus indicator area >= 2px perimeter around the element
- Indicator contrasts at least 3:1 between focused and unfocused states
- Not fully obscured by author-created content (sticky headers, overlays)

### 2.4.12 Focus Not Obscured (WCAG 2.2)
- When an element receives focus, it is not entirely hidden by sticky/fixed positioned elements
- Partially visible is acceptable — fully hidden is a failure

### 2.5.8 Target Size Minimum (WCAG 2.2)
- All interactive targets >= 24x24 CSS pixels, or 24px spacing between adjacent targets
- Inline text links are exempt
- Components with touchTarget="min-44" should be verified at >= 44x44px

## Focus Management Scenarios
1. Modal open → focus moves to first focusable element inside
2. Modal close → focus returns to trigger element
3. Item deleted → focus moves to next item (or previous if last)
4. Route change (SPA) → focus moves to main heading or main landmark
5. Form error → focus moves to first invalid field
6. Accordion toggle → focus stays on trigger

## Output
For each finding: { component, issue, wcagCriterion, keys (expected keyboard interaction), fix, severity }`;
}

function a11yCognitive(specs: AnySpec[]): string {
  const pages = specs.filter((s) => s.type === "page") as PageSpec[];
  const components = specs.filter((s) => s.type === "component") as ComponentSpec[];
  return `You are a Cognitive Accessibility Specialist. Audit specs for WCAG 2.2 cognitive accessibility criteria.

## Page Specs (${pages.length})
${pages.map((p) => `- ${p.name}: consistentNav=${p.accessibility?.consistentNav ?? "UNKNOWN"}, consistentHelp=${p.accessibility?.consistentHelp ?? "UNKNOWN"}, skipLink=${p.accessibility?.skipLink ?? "UNKNOWN"}`).join("\n") || "(none)"}

## Component Specs (${components.length})
${components.map((c) => `- ${c.name} [${c.level}]: reducedMotion=${c.accessibility?.reducedMotion ?? false}`).join("\n")}

## WCAG 2.2 Cognitive Criteria

### 3.2.6 Consistent Help (New in 2.2)
- Help mechanisms (chat widget, FAQ link, contact info, self-help option) must appear in the same relative order on every page
- Check: Do all page specs reference help components in the same section position?

### 3.3.7 Redundant Entry (New in 2.2)
- Information previously entered in a multi-step process must be auto-populated or selectable
- Check: Are there multi-step flows where users must re-enter the same data?
- Exceptions: security re-authentication, data changed since initial entry

### 3.3.8 Accessible Authentication (New in 2.2)
- No cognitive function test (transcription, memorization, puzzle) as the sole authentication mechanism
- Password fields must allow paste (no onPaste prevention)
- Verification code fields must allow paste
- Check: Are there auth components that block paste or require cognitive tests?

### 2.5.7 Dragging Movements (New in 2.2)
- Any functionality achievable by dragging has a non-dragging alternative
- Drag-to-reorder → provide up/down buttons or keyboard arrows
- Drag-to-resize → provide resize handle with keyboard support

### 2.5.8 Target Size Minimum (New in 2.2)
- All interactive targets at least 24x24 CSS px
- Or at least 24px of spacing between adjacent targets
- Inline links in text paragraphs are exempt

### Motion & Reduced Motion
- Components flagged with reducedMotion=true: verify they respect prefers-reduced-motion
- Components with animations: ${components.filter(c => c.accessibility?.reducedMotion).length} flagged
- All auto-playing content must have pause/stop controls

## Output
For each finding: { criterion (e.g. "3.2.6"), page/component, issue, recommendation, severity }`;
}

function a11yMotion(ds: DesignSystem, specs: AnySpec[]): string {
  const components = specs.filter((s) => s.type === "component") as ComponentSpec[];
  const motionTokens = ds.tokens.filter(t => t.cssVariable?.includes("motion") || t.cssVariable?.includes("duration") || t.cssVariable?.includes("animation"));
  const motionComponents = components.filter(c => c.accessibility?.reducedMotion);
  return `You are a Motion Accessibility Specialist. Audit all animation and motion for WCAG compliance.

## Motion Tokens (${motionTokens.length})
${tokenTable(motionTokens)}

## Components with Animations (${motionComponents.length})
${motionComponents.map((c) => `- ${c.name}: reducedMotion=true`).join("\n") || "(none flagged)"}

## WCAG Motion Criteria

### 2.3.1 Three Flashes or Below Threshold
- No content flashes more than 3 times per second
- Flash = pair of opposing luminance changes (>10% combined area, or red flash)
- Automated check: scan for rapid opacity/color transitions

### 2.3.3 Animation from Interactions
- Motion triggered by interaction can be disabled via prefers-reduced-motion
- Essential animations (progress bars, loading spinners) are exempt but should still reduce

### 2.2.2 Pause, Stop, Hide
- Auto-playing content (carousels, animations, videos) must have visible pause/stop controls
- Moving content that starts automatically and lasts > 5 seconds needs a mechanism to pause

## prefers-reduced-motion Compliance
Every animation must have a reduced-motion fallback:
1. CSS transitions → instant (duration: 0.01ms)
2. CSS animations → single iteration, instant
3. JS animations (Framer Motion, GSAP) → duration: 0 or skip
4. Scroll-linked effects (parallax) → static fallback
5. Page transitions → instant cut

## Implementation Patterns
- Global CSS: @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
- Tailwind: motion-reduce:animate-none, motion-reduce:transition-none
- React hook: usePrefersReducedMotion() for JS-driven animations
- Framer Motion: useReducedMotion() hook

## Output
For each finding: { component/token, animation type, issue, reduced-motion fix, severity }`;
}

// ── Init Prompts ─────────────────────────────────────────

function initTokens(intent: string): string {
  return `Scaffold a complete design token foundation for: "${intent}"

## Foundation Tokens
1. **Colors**: Primary, secondary, accent, background, foreground, muted, destructive, border, input, ring + 5 chart colors
2. **Spacing**: 4px base, geometric scale (0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24)
3. **Typography**: Font families (sans, mono), type scale (xs through 4xl), weights, line-heights
4. **Radius**: sm (2px), md (6px), lg (8px), xl (12px), full (9999px)
5. **Shadows**: sm, md, lg, xl

All tokens in shadcn/ui CSS variable format with light + dark mode values.`;
}

function initComponents(intent: string): string {
  return `Create base component specs for: "${intent}"

## Recommended Starter Components
1. **Button**: Primary action trigger (shadcnBase: ["Button"])
2. **Card**: Content container (shadcnBase: ["Card", "CardHeader", "CardContent"])
3. **Input**: Text input field (shadcnBase: ["Input", "Label"])
4. **Badge**: Status/tag indicator (shadcnBase: ["Badge"])
5. **Avatar**: User representation (shadcnBase: ["Avatar"])
6. **Table**: Data display (shadcnBase: ["Table"])

Each spec should have:
- At least 2 variants
- TypeScript props interface
- Accessibility attributes
- Relevant tags`;
}

function initCodegen(): string {
  return `Generate initial code for all scaffolded specs.
Create the generated/ directory structure:
- generated/components/{Name}/{Name}.tsx + index.ts
- generated/pages/{Name}/{Name}.tsx + index.ts
- generated/dataviz/{Name}/{Name}.tsx + index.ts`;
}

// ── General Prompts ──────────────────────────────────────

function generalAnalysis(intent: string, ctx: AgentContext): string {
  return `You are a Design Intelligence Agent analyzing a design system request.

## Request: "${intent}"

## Current State
- Design Tokens: ${tokenSummary(ctx.designSystem.tokens)}
- Specs: ${specSummary(ctx.specs)}
- Figma Connected: ${ctx.figmaConnected}
- Framework: ${ctx.projectFramework || "unknown"}

## Your Task
1. Classify what type of design operation this requires
2. Identify which parts of the design system are affected
3. Determine if Figma sync is needed
4. Propose a concrete action plan

Be specific. Name exact tokens, specs, and components.`;
}

function generalExecute(intent: string): string {
  return `Execute the design operation: "${intent}"

Follow the action plan from the analysis step.
Make concrete changes to specs, tokens, or code as needed.
Report what was changed and any follow-up actions required.`;
}

// ── Spec Validation & Codegen ────────────────────────────

function specValidation(specs: AnySpec[]): string {
  return `Validate ${specs.length} specs before code generation.

## Specs
${specSummary(specs)}

Check each spec for:
1. Required fields are non-empty
2. Type-specific fields are valid
3. Cross-references resolve
4. No naming conflicts`;
}

function specCodegen(spec: AnySpec): string {
  return `Generate code for spec "${spec.name}" (${spec.type}).

## Spec
${JSON.stringify(spec, null, 2)}

## Code Standards
- TypeScript strict mode
- "use client" directive
- shadcn/ui imports from @/components/ui/*
- cn() for className merging
- Tailwind CSS only
- CSS variables for all design tokens
- Barrel export (index.ts)`;
}

// ── Motion & Animation Prompts ────────────────────────────

function motionAnalysis(intent: string, specs: AnySpec[]): string {
  const components = specs.filter(s => s.type === "component").map(s => s.name);
  const pages = specs.filter(s => s.type === "page").map(s => s.name);
  return `You are a **Motion Design Specialist** analyzing animation needs.

Intent: "${intent}"

Existing components: ${components.join(", ") || "none"}
Existing pages: ${pages.join(", ") || "none"}

Classify every motion candidate using this decision tree:
- User interaction feedback → Micro-interaction (100-350ms)
- Navigation/state change → Macro-transition (300-500ms)
- Feature showcase/first impression → Hero animation (800-1200ms)
- Data presentation → Data viz animation (500ms+)
- Portfolio/marketing → Full video pipeline (30-60s)

For each candidate, specify:
1. Element name and type
2. Motion category (micro/macro/hero/dataviz/video)
3. Trigger (hover, click, scroll, load, intersection)
4. Duration range
5. Easing recommendation (ease-out for entrances, ease-in for exits, spring for interactions)
6. Accessibility: respect prefers-reduced-motion`;
}

function motionTokens(intent: string, ds: DesignSystem): string {
  const existingTokens = ds.tokens.filter(t => t.cssVariable.includes("motion"));
  return `You are a **Motion Token Engineer** creating a motion design token system.

Intent: "${intent}"

Existing motion tokens: ${existingTokens.length > 0 ? existingTokens.map(t => `${t.name}: ${JSON.stringify(t.values)}`).join("\n") : "none"}

Create a complete motion token set as CSS custom properties:

**Durations:**
- --motion-instant: 100ms (micro-feedback)
- --motion-fast: 160ms (hover states, toggles)
- --motion-normal: 240ms (standard transitions)
- --motion-slow: 400ms (page transitions, modals)
- --motion-slower: 600ms (hero reveals)
- --motion-cinematic: 1000ms (showcase animations)

**Easings (cubic-bezier):**
- --ease-default: cubic-bezier(0.25, 0.1, 0.25, 1)
- --ease-in: cubic-bezier(0.55, 0.055, 0.675, 0.19)
- --ease-out: cubic-bezier(0.215, 0.61, 0.355, 1)
- --ease-in-out: cubic-bezier(0.645, 0.045, 0.355, 1)
- --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)
- --ease-bounce: cubic-bezier(0.34, 1.3, 0.64, 1)

**Staggers:**
- --stagger-fast: 30ms
- --stagger-normal: 50ms
- --stagger-slow: 80ms

Output each as a DesignToken with type "other", collection "motion".`;
}

function motionSpecify(intent: string, components: string[]): string {
  return `You are a **Motion Spec Writer** creating animation specifications.

Intent: "${intent}"
Target components: ${components.join(", ") || "all"}

For each component, write a motion spec that includes:

1. **States**: idle, hover, active, focus, enter, exit, loading
2. **Transitions**: Which properties animate between states
3. **Timing**: Duration token + easing token for each transition
4. **Stagger**: If children animate, specify stagger delay
5. **Scroll triggers**: IntersectionObserver threshold for scroll-driven animations
6. **Reduced motion**: Fallback behavior (instant state change, no animation)

Format as a structured spec that maps directly to:
- Tailwind classes: transition-*, duration-*, ease-*
- CSS @keyframes for complex sequences
- Framer Motion variants for React components

Key rules:
- Entrance: always ease-out (decelerating into rest)
- Exit: always ease-in (accelerating away)
- Hover/interaction: ease-spring for satisfying feedback
- Never animate layout properties (width/height) — use transform/opacity
- GPU-only: transform, opacity, filter, clip-path`;
}

function motionCodegen(intent: string): string {
  return `You are a **Motion Code Generator** producing animation code.

Intent: "${intent}"

Generate production-ready motion code using:

1. **CSS approach** (preferred for simple transitions):
   - Tailwind transition utilities
   - CSS custom properties for tokens
   - @media (prefers-reduced-motion: reduce) override

2. **Framer Motion** (for complex sequences):
   - AnimatePresence for mount/unmount
   - variants object pattern
   - useInView for scroll triggers
   - layout animations for list reorder

3. **CSS @keyframes** (for hero/showcase):
   - Named keyframes with token-based timing
   - animation-play-state for scroll-driven control

Output format:
- "use client" directive
- Import from framer-motion if needed
- Tailwind classes for simple transitions
- Utility hook: useReducedMotion()
- All durations reference motion tokens`;
}

// ── Export ────────────────────────────────────────────────

export const AGENT_PROMPTS = {
  // Color
  colorAnalysis,
  colorGeneration,

  // Spacing
  spacingAnalysis,
  spacingGeneration,

  // Typography
  typographyAnalysis,
  typographyGeneration,

  // Theme
  themeAnalysis,
  themeGeneration,
  themeModeUpdate,
  themeCodegen,

  // Token
  tokenParse,
  tokenApplication,

  // Component
  componentAnalysis,
  componentDesign,
  componentCodegen,
  componentIdentify,
  componentModify,

  // Page
  pageAnalysis,
  pageDesign,
  pageCodegen,

  // DataViz
  datavizAnalysis,
  datavizDesign,
  datavizCodegen,

  // Responsive
  responsiveAudit,
  responsiveUpdate,

  // Figma
  figmaSync,
  figmaConnect,
  figmaPull,
  figmaDiff,
  figmaComponentCreate,
  figmaPageCompose,

  // Audit
  auditTokens,
  auditSpecs,
  auditAccessibility,
  auditReport,

  // Accessibility
  a11yContrast,
  a11yAria,
  a11yKeyboard,
  a11yCognitive,
  a11yMotion,

  // Init
  initTokens,
  initComponents,
  initCodegen,

  // General
  generalAnalysis,
  generalExecute,

  // Spec
  specValidation,
  specCodegen,

  // Motion & Animation
  motionAnalysis,
  motionTokens,
  motionSpecify,
  motionCodegen,
};
