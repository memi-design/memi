import { describe, expect, it } from "vitest";
import {
  detectResearchSentiment,
  extractResearchEntities,
  extractResearchSignals,
  formatResearchSignal,
  inferResearchCategory,
  normalizeResearchSignal,
  stripFindingPrefix,
} from "../analysis.js";

describe("research analysis", () => {
  it.each([
    ["The workflow is clear, fast, and helpful.", "positive"],
    ["The workflow is slow, broken, and confusing.", "negative"],
    ["The workflow is helpful but slow and frustrating.", "mixed"],
    ["The workflow exists.", "neutral"],
  ] as const)("classifies sentiment in %s", (text, expected) => {
    expect(detectResearchSentiment(text)).toBe(expected);
  });

  it.each([
    ["I am blocked by a slow navigation workflow", [], "pain-point"],
    ["We need persistent labels", [], "goal"],
    ["I usually search every time", [], "behavior"],
    ["This feature should have export", [], "feature-request"],
    ["Our workaround is a manual spreadsheet", [], "workaround"],
    ["WCAG compliance is required", [], "regulatory"],
    ["API latency is too high", [], "technical-constraint"],
    ["Adoption growth is the benchmark", [], "market-data"],
    ["Any text", ["best-practice"], "best-practice"],
    ["Unclassified observation", [], "general"],
  ] as const)("infers a stable category for %s", (text, tags, expected) => {
    expect(inferResearchCategory(text, [...tags])).toBe(expected);
  });

  it("extracts product, organization, standard, percentage, and currency entities", () => {
    expect(extractResearchEntities(
      "Sarah Chen compared React and Figma against WCAG at 42.5% adoption and $1.2M revenue.",
    )).toEqual(expect.arrayContaining([
      "Sarah Chen",
      "React",
      "Figma",
      "WCAG",
      "42.5%",
      "$1.2M",
    ]));
  });

  it("ranks explicit tags and entities above normalized text signals", () => {
    const signals = extractResearchSignals(
      "Pain point: Navigation labels disappeared while navigating settings pages.",
      ["pain-point", "survey"],
      ["Figma"],
      6,
    );
    expect(signals[0]).toBe("pain-point");
    expect(signals).toContain("figma");
    expect(signals).toContain("navigation label");
    expect(new Set(signals).size).toBe(signals.length);
  });

  it("normalizes, stems, formats, and strips finding prefixes", () => {
    expect(normalizeResearchSignal("  Navigation   Settings! ")).toBe("navigation setting");
    expect(normalizeResearchSignal("surveys")).toBe("");
    expect(normalizeResearchSignal("")).toBe("");
    expect(formatResearchSignal("navigation setting")).toBe("Navigation Setting");
    expect(stripFindingPrefix("Feature request: Add export controls")).toBe("Add export controls");
  });
});
