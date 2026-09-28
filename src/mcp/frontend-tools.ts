import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPolicyTool } from "./policy-tools.js";

export function registerFrontendTools(server: McpServer, projectRoot: string): void {
  registerPolicyTool(server, {
    name: "prepare_frontend_brief",
    description: "Inspect existing components, props, tokens and stories before editing frontend code. Optionally resolve supplied Figma/Paper evidence; no network, model, config execution or writes. Unknown behavior remains unassessed.",
    capabilities: [],
    inputSchema: {
      intent: z.string().min(1).max(1024),
      designEvidence: z.unknown().optional(),
      verificationEvidence: z.unknown().optional(),
      maxBytes: z.number().int().min(2048).max(16384).default(16384),
    },
    handler: async (input, signal) => {
      signal.throwIfAborted();
      const { buildFrontendBrief } = await import("../frontend/index.js");
      const brief = await buildFrontendBrief({ ...input, projectRoot, signal });
      signal.throwIfAborted();
      return { content: [{ type: "text", text: JSON.stringify(brief) }] };
    },
  });
}
