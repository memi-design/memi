import { describe, expect, it } from "vitest";
import {
  classifyIntent,
  classifyIntentSignals,
} from "../intent-classifier.js";

describe("multi-signal intent classifier", () => {
  it.each([
    ["Change the color palette", "color-palette"],
    ["Update the spacing scale", "spacing-system"],
    ["Modify the typography system", "typography-system"],
    ["Change the brand theme", "theme-change"],
    ["Update a CSS variable token", "token-update"],
    ["Create a button component", "component-create"],
    ["Modify a card component", "component-modify"],
    ["Build a responsive page layout", "page-layout"],
    ["Create responsive breakpoints", "responsive-layout"],
    ["Audit WCAG accessibility", "accessibility-check"],
    ["Extract the design doc from https://example.com", "design-extract"],
    ["Sync the Figma canvas", "figma-sync"],
    ["Generate TypeScript code", "code-generate"],
    ["Initialize the design system", "design-system-init"],
  ] as const)("keeps the compatibility category for %s", (intent, category) => {
    expect(classifyIntent(intent)).toBe(category);
  });

  it("resolves action, family, platform, surface, and required states independently", () => {
    const result = classifyIntentSignals(
      "Audit and repair the existing SwiftUI settings screen for keyboard focus, dark mode, empty states, and reduced motion",
    );

    expect(result).toMatchObject({
      schemaVersion: 1,
      category: "page-layout",
      action: "modify",
      taskFamily: "layout",
      platforms: ["swiftui"],
      targetSurfaces: ["screen"],
      ambiguous: false,
      abstain: false,
    });
    expect(result.requiredStates).toEqual(expect.arrayContaining([
      "accessibility",
      "dark",
      "empty",
      "focus",
      "keyboard",
      "reduced-motion",
    ]));
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.requiredStates)).toBe(true);
    expect(Object.isFrozen(result.evidence)).toBe(true);
  });

  it("uses compound evidence instead of the first matching regex", () => {
    const intent = "Create a responsive dashboard chart for an Expo screen with loading, empty, error, and reduced-motion states";
    const first = classifyIntentSignals(intent);
    const second = classifyIntentSignals(intent);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      category: "dataviz-create",
      action: "create",
      taskFamily: "dataviz",
      platforms: ["react-native"],
      targetSurfaces: ["dataviz", "screen"],
      ambiguous: false,
      abstain: false,
    });
    expect(first.requiredStates).toEqual(expect.arrayContaining([
      "empty",
      "error",
      "loading",
      "reduced-motion",
      "responsive",
    ]));
    expect(classifyIntent(intent)).toBe("dataviz-create");
  });

  it("exposes low-confidence ambiguity while preserving classifyIntent compatibility", () => {
    const result = classifyIntentSignals("Review the interface");

    expect(result).toMatchObject({
      category: "design-audit",
      action: "audit",
      taskFamily: "general",
      ambiguous: true,
      abstain: true,
    });
    expect(result.confidence).toBeLessThan(0.7);
    expect(classifyIntent("Review the interface")).toBe("design-audit");
  });

  it("abstains when a single request contains conflicting platform evidence", () => {
    const result = classifyIntentSignals(
      "Build an Expo settings screen and a SwiftUI settings screen",
    );

    expect(result.platforms).toEqual(["react-native", "swiftui"]);
    expect(result.ambiguous).toBe(true);
    expect(result.abstain).toBe(true);
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("fails closed on oversized input", () => {
    const result = classifyIntentSignals("x".repeat(5_001));

    expect(result).toMatchObject({
      category: "general",
      action: null,
      taskFamily: "general",
      confidence: 0,
      ambiguous: true,
      abstain: true,
    });
    expect(classifyIntent("x".repeat(5_001))).toBe("general");
  });
});
