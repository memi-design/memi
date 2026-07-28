export const DESIGN_AGENT_BRIEF_MODES = ["local", "figma", "research", "full"] as const;
export const DESIGN_AGENT_BRIEF_DETAIL_LEVELS = ["compact", "standard", "full"] as const;

export type DesignAgentBriefMode = typeof DESIGN_AGENT_BRIEF_MODES[number];
export type DesignAgentBriefDetail = typeof DESIGN_AGENT_BRIEF_DETAIL_LEVELS[number];

export interface DesignAgentBriefOptions {
  projectRoot: string;
  target?: string;
  intent?: string;
  mode?: DesignAgentBriefMode;
  agent?: string;
  detail?: DesignAgentBriefDetail;
}

export interface DesignAgentBriefCommand {
  id: string;
  command: string;
  why: string;
  cost: "free-local" | "network" | "model-optional" | "requires-figma";
}

export interface DesignAgentBrief {
  action: "brief";
  schemaVersion: 1;
  projectRoot: string;
  target: string;
  intent: string;
  agent: string;
  mode: DesignAgentBriefMode;
  detail: DesignAgentBriefDetail;
  mission: string;
  evidenceCommands: DesignAgentBriefCommand[];
  designRules: string[];
  costControls: string[];
  tokenEfficiency: {
    profile: DesignAgentBriefDetail;
    intent: string;
    expandWith: string;
  };
  compatibility: {
    installs: string[];
    mcp: string;
    skill: string;
    suite: string;
  };
  handoffChecklist: string[];
}

export function buildDesignAgentBrief(options: DesignAgentBriefOptions): DesignAgentBrief {
  const target = options.target?.trim() || ".";
  const intent = options.intent?.trim() || "Improve the product interface with Memoire design evidence.";
  const mode = options.mode ?? "local";
  const agent = options.agent?.trim() || "design-agent";
  const detail = options.detail ?? "standard";
  const evidenceCommands = applyDetailToEvidenceCommands(buildEvidenceCommands({ target, intent, mode }), detail);

  return {
    action: "brief",
    schemaVersion: 1,
    projectRoot: options.projectRoot,
    target,
    intent,
    agent,
    mode,
    detail,
    mission: "Act as a design agent that gathers interface evidence and interface craft critique before editing UI, maps the product surface into Atomic Design, preserves shadcn/Tailwind compatibility, and hands off verifiable design decisions.",
    evidenceCommands,
    designRules: [
      "Start from interface evidence: app-quality diagnosis, UX tenets/traps, interface craft, tokens, registry state, and route or screenshot context.",
      "Treat interface craft as a first-class gate: name the focusing mechanism, visual hierarchy, spacing rhythm, visual weight, conventions, responsive resilience, and user context before patching.",
      "Use shadcn/ui primitives before inventing custom controls.",
      "Use Tailwind tokens and CSS variables; do not introduce raw one-off colors when a token can express the decision.",
      "Classify every UI change by Atomic Design level: atom, molecule, organism, template, or page.",
      "Prefer dense, task-focused product surfaces over generic landing-page composition unless the route is explicitly marketing.",
      "Keep accessibility, keyboard flow, focus states, responsive overflow, empty states, and error recovery in the first patch plan.",
      "When research is available, turn it into a design package and specs before implementation.",
    ],
    costControls: [
      "Start local-first: no model, Figma, browser, or daemon work until local evidence says it is needed.",
      "Use --dry-run and --json commands before writing agent kits, MCP config, registry files, or specs.",
      "Use REST Figma pulls only when FIGMA_TOKEN and FIGMA_FILE_KEY are intentionally configured.",
      "Avoid long-running daemon or MCP processes in CI; use stdio MCP only when the client is launching the server.",
      "Escalate to browser screenshots or live Figma only for visual ambiguity that static code evidence cannot resolve.",
    ],
    tokenEfficiency: {
      profile: detail,
      intent: detail === "compact"
        ? "Keep the first agent turn small; expand only after local evidence is needed."
        : "Carry enough command detail for direct execution while still avoiding live Figma, browser, or model work by default.",
      expandWith: "Call prepare_design_agent_brief again with detail=full or run the listed evidence commands only after the local preflight is useful.",
    },
    compatibility: {
      installs: detail === "compact" ? buildCompatibilityInstalls(agent).slice(0, 1) : buildCompatibilityInstalls(agent),
      mcp: "memi mcp start --no-figma",
      skill: "npx skills add memi-design/memi --skill memoire-design-tooling",
      suite: "memi suite run design-audit --project . --json",
    },
    handoffChecklist: [
      "List the exact evidence commands run and summarize the resulting design risks.",
      "Summarize craft dimensions that need work, including the focusing mechanism and visual hierarchy.",
      "Name the Atomic Design level and shadcn primitives touched.",
      "Call out token, accessibility, responsive, empty-state, and error-state decisions.",
      "Separate confirmed evidence from assumptions and skipped checks.",
      "End with the verification commands needed before merge or publish.",
    ],
  };
}

export function normalizeDesignAgentBriefMode(mode: string | undefined): DesignAgentBriefMode {
  const normalized = (mode ?? "local").trim().toLowerCase();
  if (DESIGN_AGENT_BRIEF_MODES.includes(normalized as DesignAgentBriefMode)) {
    return normalized as DesignAgentBriefMode;
  }
  throw new Error(`Invalid design agent brief mode "${mode}". Use: ${DESIGN_AGENT_BRIEF_MODES.join(", ")}`);
}

export function normalizeDesignAgentBriefDetail(detail: string | undefined): DesignAgentBriefDetail {
  const normalized = (detail ?? "standard").trim().toLowerCase();
  if (DESIGN_AGENT_BRIEF_DETAIL_LEVELS.includes(normalized as DesignAgentBriefDetail)) {
    return normalized as DesignAgentBriefDetail;
  }
  throw new Error(`Invalid design agent brief detail "${detail}". Use: ${DESIGN_AGENT_BRIEF_DETAIL_LEVELS.join(", ")}`);
}

function buildEvidenceCommands(input: {
  target: string;
  intent: string;
  mode: DesignAgentBriefMode;
}): DesignAgentBriefCommand[] {
  const targetArg = input.target;
  const commands: DesignAgentBriefCommand[] = [
    {
      id: "diagnose",
      command: `memi diagnose ${targetArg} --json`,
      why: "Build the app-quality graph, file evidence, issue list, and UX summary before patching UI.",
      cost: "free-local",
    },
    {
      id: "ux-audit",
      command: `memi ux audit ${targetArg} --json`,
      why: "Score UX tenets and trap risks for clarity, control, accessibility, recovery, workflow fit, and trust.",
      cost: "free-local",
    },
    {
      id: "craft-audit",
      command: `memi craft audit ${targetArg} --json`,
      why: "Score interface craft across visual design, interface design, conventions, responsive resilience, and user context.",
      cost: "free-local",
    },
    {
      id: "tokens",
      command: "memi tokens --from ./src --report",
      why: "Surface design-token coverage and Tailwind drift before introducing visual changes.",
      cost: "free-local",
    },
    {
      id: "shadcn",
      command: "memi shadcn validate",
      why: "Check that registry output and component context stay compatible with shadcn-native workflows.",
      cost: "free-local",
    },
    {
      id: "agent-install-plan",
      command: "memi agent install --dry-run --json --project .",
      why: "Show which Agent Skills and MCP files would be installed without writing anything.",
      cost: "free-local",
    },
    {
      id: "scaffold-preview",
      command: "memi scaffold component <Name> --json",
      why: "Preview a spec-first Atomic Design file scaffold before any registry write.",
      cost: "free-local",
    },
  ];

  if (isUrl(input.target)) {
    commands.push({
      id: "design-doc",
      command: `memi design-doc ${input.target} --spec`,
      why: "Extract route-level design-system evidence and a spec from the public surface.",
      cost: "model-optional",
    });
  }

  if (input.mode === "research" || input.mode === "full") {
    commands.push(
      {
        id: "research-synthesize",
        command: "memi research synthesize",
        why: "Collect existing research evidence and contradictions before product-design changes.",
        cost: "free-local",
      },
      {
        id: "research-design",
        command: `memi research design --intent ${JSON.stringify(input.intent)} --write-specs --mermaid-jam --json`,
        why: "Turn research into Atomic Design specs and FigJam-ready planning source.",
        cost: "model-optional",
      },
    );
  }

  if (input.mode === "figma" || input.mode === "full") {
    commands.push({
      id: "figma-rest",
      command: "memi pull --rest",
      why: "Pull Figma tokens and components without requiring the desktop plugin when REST credentials are configured.",
      cost: "requires-figma",
    });
  }

  return commands;
}

function applyDetailToEvidenceCommands(
  commands: DesignAgentBriefCommand[],
  detail: DesignAgentBriefDetail,
): DesignAgentBriefCommand[] {
  if (detail !== "compact") return commands;
  const compactIds = new Set(["diagnose", "ux-audit", "craft-audit", "scaffold-preview"]);
  return commands.filter((command) => compactIds.has(command.id));
}

function buildCompatibilityInstalls(agent: string): string[] {
  const installs = [
    "memi agent install universal --project .",
    "npx skills add memi-design/memi --skill memoire-design-tooling",
    "memi agent install claude-code --project .",
    "memi agent install cursor --project .",
    "memi agent install codex",
    "memi agent install codex-plugin",
    "memi agent install grok-build --project .",
    "memi agent install opencode --project .",
    "memi agent install openclaw --project .",
    "memi agent install hermes",
  ];
  const agentMatch = installs.find((command) => command.includes(` ${agent}`) || command.includes(` ${agent} `));
  return agentMatch ? [agentMatch, ...installs.filter((command) => command !== agentMatch)] : installs;
}

function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
