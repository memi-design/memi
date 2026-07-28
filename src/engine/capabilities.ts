/**
 * Capability Matrix — Declares what each command needs to run.
 *
 * Every command has required and optional capabilities. When a required
 * capability is missing, the user gets a clear error with recovery steps.
 * When an optional capability is missing, the command runs in degraded mode.
 */

import { createLogger } from "./logger.js";
import { hasConfiguredAIProvider } from "../ai/provider-config.js";

const log = createLogger("capabilities");

export type Capability = "figma" | "ai" | "specs" | "generated-code" | "research" | "daemon";

export interface CapabilityCheck {
  ok: boolean;
  available: Capability[];
  missing: Capability[];
  messages: string[];
  degraded: Capability[];
}

const RECOVERY: Record<Capability, string> = {
  figma: "Connect to Figma: memi connect\n  Or use offline mode: most commands work without Figma",
  ai: "Configure Anthropic, OpenAI, an OpenAI-compatible endpoint, or explicit Ollama via MEMI_AI_PROVIDER.\n  Run memi doctor for provider-specific requirements.\n  Without AI, agents use heuristic fallbacks (still functional)",
  specs: "Create specs first: memi spec component <name>\n  Or pull from Figma: memi pull (auto-generates specs from components)",
  "generated-code": "Generate code first: memi generate\n  This requires specs — run memi pull or memi spec first",
  research: "Import research data: memi research from-file <file>\n  Or from Figma stickies: memi research from-stickies",
  daemon: "Start the daemon: memi daemon start\n  The daemon runs the reactive pipeline in the background",
};

interface CommandDef {
  required: Capability[];
  optional: Capability[];
}

const COMMANDS: Record<string, CommandDef> = {
  // Figma-dependent
  connect:    { required: [],        optional: ["figma"] },
  pull:       { required: ["figma"], optional: ["ai"] },

  // Spec-dependent
  generate:   { required: ["specs"], optional: [] },
  validate:   { required: ["specs"], optional: [] },
  export:     { required: ["specs"], optional: [] },
  watch:      { required: ["specs"], optional: ["figma"] },

  // AI-dependent (with fallbacks)
  compose:    { required: [],        optional: ["ai", "figma"] },
  agent:      { required: [],        optional: ["ai", "figma"] },

  // Research-dependent
  "research-synthesize": { required: ["research"], optional: ["ai"] },
  "research-report":     { required: ["research"], optional: ["ai"] },

  // No dependencies
  init:       { required: [],        optional: [] },
  spec:       { required: [],        optional: [] },
  preview:    { required: [],        optional: ["generated-code"] },
  status:     { required: [],        optional: ["figma"] },
  doctor:     { required: [],        optional: ["figma", "ai"] },
  tokens:     { required: [],        optional: ["figma"] },
  dashboard:  { required: [],        optional: ["figma"] },
  ia:         { required: [],        optional: ["specs"] },
  notes:      { required: [],        optional: [] },
  list:       { required: [],        optional: [] },
  mcp:        { required: [],        optional: ["figma"] },

  // Daemon/sync
  daemon:     { required: [],        optional: ["figma", "ai"] },
  sync:       { required: ["figma"], optional: ["ai"] },
};

/** Check capabilities for a command against the current environment. */
export function checkCapabilities(
  command: string,
  env: { figma: boolean; ai: boolean; specs: boolean; generatedCode: boolean; research: boolean; daemon: boolean },
): CapabilityCheck {
  const def = COMMANDS[command];
  if (!def) {
    // Unknown command — allow everything
    return { ok: true, available: [], missing: [], messages: [], degraded: [] };
  }

  const capMap: Record<Capability, boolean> = {
    figma: env.figma,
    ai: env.ai,
    specs: env.specs,
    "generated-code": env.generatedCode,
    research: env.research,
    daemon: env.daemon,
  };

  const available: Capability[] = [];
  const missing: Capability[] = [];
  const degraded: Capability[] = [];
  const messages: string[] = [];

  for (const cap of def.required) {
    if (capMap[cap]) {
      available.push(cap);
    } else {
      missing.push(cap);
      messages.push(`Required: ${cap}\n  ${RECOVERY[cap]}`);
    }
  }

  for (const cap of def.optional) {
    if (capMap[cap]) {
      available.push(cap);
    } else {
      degraded.push(cap);
    }
  }

  const ok = missing.length === 0;

  if (!ok) {
    log.warn({ command, missing }, "Command missing required capabilities");
  } else if (degraded.length > 0) {
    log.info({ command, degraded }, "Command running with degraded capabilities");
  }

  return { ok, available, missing, messages, degraded };
}

/** Format a capability check result for terminal output. */
export function formatCapabilityError(check: CapabilityCheck, command: string): string {
  const lines: string[] = [];
  lines.push(`  Cannot run '${command}' — missing requirements:\n`);

  for (const msg of check.messages) {
    lines.push(`  ${msg}\n`);
  }

  if (check.degraded.length > 0) {
    lines.push(`  Available without: ${check.degraded.join(", ")}`);
    lines.push(`  (some features will be limited)\n`);
  }

  lines.push(`  Run 'memi doctor' for a full system diagnostic.`);
  return lines.join("\n");
}

/** Get the current environment's capability state. */
export function detectCapabilities(engine: {
  figma: { isConnected: boolean };
  registry: { designSystem: { tokens: { length: number } }; getAllSpecs: () => Promise<unknown[]> };
  research: { getStore: () => { findings: unknown[] } };
}): { figma: boolean; ai: boolean; specs: boolean; generatedCode: boolean; research: boolean; daemon: boolean } {
  return {
    figma: engine.figma.isConnected,
    ai: hasConfiguredAIProvider(),
    specs: engine.registry.designSystem.tokens.length > 0,
    generatedCode: false, // checked lazily per command
    research: engine.research.getStore().findings.length > 0,
    daemon: false, // checked by daemon command
  };
}
