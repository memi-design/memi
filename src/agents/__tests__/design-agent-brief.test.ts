import { describe, expect, it } from "vitest";
import { buildDesignAgentBrief } from "../design-agent-brief.js";

describe("design agent brief", () => {
  it("can emit a compact brief for token-sensitive agent contexts", () => {
    const brief = buildDesignAgentBrief({
      projectRoot: "/tmp/product",
      target: ".",
      intent: "Fix dashboard hierarchy",
      agent: "codex",
      detail: "compact",
    });

    expect(brief.detail).toBe("compact");
    expect(brief.tokenEfficiency).toMatchObject({
      profile: "compact",
      intent: "Keep the first agent turn small; expand only after local evidence is needed.",
    });
    expect(brief.evidenceCommands.map((command) => command.id)).toEqual([
      "diagnose",
      "ux-audit",
      "craft-audit",
      "scaffold-preview",
    ]);
    expect(brief.compatibility.installs).toEqual([
      "memi agent install codex",
    ]);
  });

  it("builds a local-first brief with evidence commands and handoff requirements", () => {
    const brief = buildDesignAgentBrief({
      projectRoot: "/tmp/product",
      target: ".",
      intent: "Polish the dashboard table and empty state",
      mode: "local",
      agent: "codex",
    });

    expect(brief).toMatchObject({
      action: "brief",
      schemaVersion: 1,
      mode: "local",
      agent: "codex",
      target: ".",
      intent: "Polish the dashboard table and empty state",
    });
    expect(brief.mission).toContain("interface evidence");
    expect(brief.evidenceCommands.map((command) => command.command)).toEqual(expect.arrayContaining([
      "memi diagnose . --json",
      "memi ux audit . --json",
      "memi craft audit . --json",
      "memi tokens --from ./src --report",
      "memi shadcn validate",
      "memi agent install --dry-run --json --project .",
    ]));
    expect(brief.designRules).toContain("Use shadcn/ui primitives before inventing custom controls.");
    expect(brief.costControls).toContain("Start local-first: no model, Figma, browser, or daemon work until local evidence says it is needed.");
    expect(brief.handoffChecklist).toContain("List the exact evidence commands run and summarize the resulting design risks.");
  });

  it("adds URL, research, and Figma evidence when the mode requires it", () => {
    const brief = buildDesignAgentBrief({
      projectRoot: "/tmp/product",
      target: "https://example.com",
      intent: "Research-backed redesign from Figma",
      mode: "full",
      agent: "hermes",
    });

    expect(brief.evidenceCommands.map((command) => command.command)).toEqual(expect.arrayContaining([
      "memi design-doc https://example.com --spec",
      "memi research synthesize",
      "memi research design --intent \"Research-backed redesign from Figma\" --write-specs --mermaid-jam --json",
      "memi pull --rest",
    ]));
    expect(brief.compatibility.installs).toEqual(expect.arrayContaining([
      "memi agent install hermes",
      "memi agent install universal --project .",
      "npx skills add memi-design/memi --skill memoire-design-tooling",
    ]));
  });
});
