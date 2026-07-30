import { describe, expect, it } from "vitest";
import { renderBadgeSvg } from "../badge.js";

describe("design-health badge", () => {
  it.each([
    [95, "#3fb950"],
    [80, "#d29922"],
    [65, "#f0883e"],
    [40, "#f85149"],
  ])("renders score %i with the expected deterministic color", (score, color) => {
    const first = renderBadgeSvg({ score });
    const second = renderBadgeSvg({ score });
    expect(first).toBe(second);
    expect(first).toContain(color);
    expect(first).toContain(`design health: ${score}/100`);
    expect(first).toContain("role=\"img\"");
  });

  it("supports an explicit label and suffix", () => {
    const svg = renderBadgeSvg({ label: "interface quality", score: 88, suffix: "%" });
    expect(svg).toContain("interface quality: 88%");
    expect(svg).toContain(">interface quality<");
    expect(svg).toContain(">88%<");
  });
});
