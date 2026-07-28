export type ModelCapability =
  | "chat.text"
  | "input.image"
  | "output.json_schema"
  | "tool.call"
  | "tool.parallel"
  | "stream.delta"
  | "usage.tokens"
  | "reasoning.summary"
  | "interrupt"
  | "resume"
  | "mcp.client"
  | "seed.deterministic";

export interface ModelDescriptor {
  readonly providerId: string;
  readonly modelId: string;
  readonly capabilities: readonly ModelCapability[];
  readonly contextWindowTokens?: number;
}

export interface CapabilityRequirements {
  readonly required: readonly ModelCapability[];
  readonly preferredModelId?: string;
  readonly preferredProviderId?: string;
}

export type ModelNegotiationResult =
  | {
    readonly ok: true;
    readonly model: ModelDescriptor;
    readonly reason: "preferred" | "capability_match";
  }
  | {
    readonly ok: false;
    readonly missingCapabilities: readonly ModelCapability[];
  };

export function negotiateModel(
  models: readonly ModelDescriptor[],
  requirements: CapabilityRequirements,
): ModelNegotiationResult {
  const eligible = models.filter((model) =>
    requirements.required.every((capability) => model.capabilities.includes(capability)));

  const preferred = eligible.find((model) =>
    (!requirements.preferredModelId || model.modelId === requirements.preferredModelId)
    && (!requirements.preferredProviderId || model.providerId === requirements.preferredProviderId));

  if (preferred) {
    return Object.freeze({ ok: true, model: preferred, reason: "preferred" });
  }
  if (eligible[0]) {
    return Object.freeze({ ok: true, model: eligible[0], reason: "capability_match" });
  }

  const supported = new Set(models.flatMap((model) => model.capabilities));
  return Object.freeze({
    ok: false,
    missingCapabilities: requirements.required.filter((capability) => !supported.has(capability)),
  });
}
