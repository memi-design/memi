import { describe, expect, it } from "vitest";
import {
  negotiateModel,
  type ModelDescriptor,
} from "../../runtime/model-capabilities.js";

const MODELS: readonly ModelDescriptor[] = [
  {
    providerId: "local",
    modelId: "text-only",
    capabilities: ["chat.text"],
  },
  {
    providerId: "openai-compatible",
    modelId: "designer",
    capabilities: ["chat.text", "input.image", "tool.call", "output.json_schema"],
  },
];

describe("runtime/model-capabilities", () => {
  it("selects by declared capabilities instead of provider-name branching", () => {
    const result = negotiateModel(MODELS, {
      required: ["chat.text", "input.image", "tool.call"],
      preferredModelId: "designer",
    });
    expect(result).toMatchObject({
      ok: true,
      model: {
        providerId: "openai-compatible",
        modelId: "designer",
      },
    });
  });

  it("fails closed and reports missing capabilities", () => {
    const result = negotiateModel(MODELS, {
      required: ["chat.text", "mcp.client", "resume"],
    });
    expect(result).toEqual({
      ok: false,
      missingCapabilities: ["mcp.client", "resume"],
    });
  });
});
