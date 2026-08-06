import { describe, expect, it } from "vitest";
import {
  classifyIntent,
  classifyIntentSignals,
} from "../intent-classifier.js";

describe("multi-signal intent classifier", () => {
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
