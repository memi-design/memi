import { describe, expect, it } from "vitest";
import type { AgentContext } from "../plan-builder.js";
import { AGENT_PROMPTS } from "../prompts.js";
import type { DesignSystem, DesignToken } from "../../engine/registry.js";
import {
  ComponentSpecSchema,
  DataVizSpecSchema,
  PageSpecSchema,
  type AnySpec,
} from "../../specs/types.js";

const colorToken: DesignToken = {
  name: "color.primary",
  collection: "semantic",
  type: "color",
  values: { Light: "#ff5470", Dark: "#ff8094" },
  cssVariable: "--color-primary",
};
const motionToken: DesignToken = {
  name: "motion.duration.fast",
  collection: "motion",
  type: "other",
  values: { default: "120ms" },
  cssVariable: "--motion-duration-fast",
};
const designSystem: DesignSystem = {
  tokens: [colorToken, motionToken],
  components: [{
    name: "ActionButton",
    key: "action-button",
    description: "Primary action",
    variants: ["default", "quiet"],
    properties: { label: { type: "string" } },
    figmaNodeId: "1:2",
  }],
  styles: [{ name: "Ruby", type: "fill", value: { color: "#ff5470" } }],
  lastSync: "2026-07-29T00:00:00.000Z",
};
const componentSpec = ComponentSpecSchema.parse({
  name: "ActionButton",
  type: "component",
  level: "atom",
  purpose: "Submit the current workflow",
  variants: ["default", "quiet"],
  props: { label: "string", loading: "boolean?" },
  shadcnBase: ["Button"],
  accessibility: {
    role: "button",
    ariaLabel: "required",
    keyboardNav: true,
    focusStyle: "ring",
    touchTarget: "min-44",
    reducedMotion: true,
    colorIndependent: true,
  },
});
const pageSpec = PageSpecSchema.parse({
  name: "Dashboard",
  type: "page",
  purpose: "Review product health",
  sections: [{ name: "Primary action", component: "ActionButton" }],
});
const dataVizSpec = DataVizSpecSchema.parse({
  name: "QualityTrend",
  type: "dataviz",
  purpose: "Show quality over time",
  chartType: "line",
  dataShape: { x: "date", y: "score" },
});
const specs: AnySpec[] = [componentSpec, pageSpec, dataVizSpec];
const context: AgentContext = {
  designSystem,
  specs,
  figmaConnected: true,
  projectFramework: "Next.js",
};

describe("AGENT_PROMPTS", () => {
  it("builds every routed prompt with concrete product context", () => {
    const intent = "Improve the dashboard interaction while preserving the design system";
    const prompts = [
      AGENT_PROMPTS.colorAnalysis(intent, [colorToken]),
      AGENT_PROMPTS.colorGeneration(intent, [colorToken]),
      AGENT_PROMPTS.spacingAnalysis(intent, []),
      AGENT_PROMPTS.spacingGeneration(intent, []),
      AGENT_PROMPTS.typographyAnalysis(intent, []),
      AGENT_PROMPTS.typographyGeneration(intent, []),
      AGENT_PROMPTS.themeAnalysis(intent, designSystem),
      AGENT_PROMPTS.themeGeneration(intent, designSystem),
      AGENT_PROMPTS.themeModeUpdate(intent),
      AGENT_PROMPTS.themeCodegen(intent, specs),
      AGENT_PROMPTS.tokenParse(intent, designSystem.tokens),
      AGENT_PROMPTS.tokenApplication("color", intent),
      AGENT_PROMPTS.componentAnalysis(intent, designSystem, specs),
      AGENT_PROMPTS.componentDesign(intent, designSystem),
      AGENT_PROMPTS.componentCodegen(intent),
      AGENT_PROMPTS.componentIdentify(intent, specs),
      AGENT_PROMPTS.componentModify(intent),
      AGENT_PROMPTS.pageAnalysis(intent, specs),
      AGENT_PROMPTS.pageDesign(intent, designSystem, specs),
      AGENT_PROMPTS.pageCodegen(intent),
      AGENT_PROMPTS.datavizAnalysis(intent),
      AGENT_PROMPTS.datavizDesign(intent, designSystem),
      AGENT_PROMPTS.datavizCodegen(intent),
      AGENT_PROMPTS.responsiveAudit(intent, specs),
      AGENT_PROMPTS.responsiveUpdate(intent),
      AGENT_PROMPTS.figmaSync("design-system", intent),
      AGENT_PROMPTS.figmaConnect(),
      AGENT_PROMPTS.figmaPull(),
      AGENT_PROMPTS.figmaDiff(),
      AGENT_PROMPTS.figmaComponentCreate(intent),
      AGENT_PROMPTS.figmaPageCompose(intent),
      AGENT_PROMPTS.auditTokens(designSystem),
      AGENT_PROMPTS.auditSpecs(specs),
      AGENT_PROMPTS.auditAccessibility(designSystem, specs),
      AGENT_PROMPTS.auditReport(intent),
      AGENT_PROMPTS.a11yContrast(designSystem),
      AGENT_PROMPTS.a11yAria(specs),
      AGENT_PROMPTS.a11yKeyboard(specs),
      AGENT_PROMPTS.a11yCognitive(specs),
      AGENT_PROMPTS.a11yMotion(designSystem, specs),
      AGENT_PROMPTS.initTokens(intent),
      AGENT_PROMPTS.initComponents(intent),
      AGENT_PROMPTS.initCodegen(),
      AGENT_PROMPTS.generalAnalysis(intent, context),
      AGENT_PROMPTS.generalExecute(intent),
      AGENT_PROMPTS.specValidation(specs),
      AGENT_PROMPTS.specCodegen(componentSpec),
      AGENT_PROMPTS.motionAnalysis(intent, specs),
      AGENT_PROMPTS.motionTokens(intent, designSystem),
      AGENT_PROMPTS.motionSpecify(intent, ["ActionButton", "Dashboard"]),
      AGENT_PROMPTS.motionCodegen(intent),
    ];

    expect(prompts).toHaveLength(Object.keys(AGENT_PROMPTS).length);
    for (const prompt of prompts) {
      expect(prompt.length).toBeGreaterThan(80);
      expect(prompt).not.toContain("undefined");
    }
    expect(prompts.join("\n")).toContain("ActionButton");
    expect(prompts.join("\n")).toContain("WCAG");
    expect(prompts.join("\n")).toContain("prefers-reduced-motion");
  });

  it("renders explicit empty-state context instead of inventing unavailable assets", () => {
    const emptySystem: DesignSystem = {
      tokens: [],
      components: [],
      styles: [],
      lastSync: "never",
    };

    expect(AGENT_PROMPTS.themeAnalysis("Create a theme", emptySystem)).toContain("(none)");
    expect(AGENT_PROMPTS.auditSpecs([])).toContain("(none)");
    expect(AGENT_PROMPTS.a11yAria([])).toContain("(none)");
    expect(AGENT_PROMPTS.motionTokens("Add motion", emptySystem)).toContain("none");
  });
});
