import { getMaxOutput, getModelId } from "./model-config.js";
import type {
  AIProviderCapabilities,
  AIProviderConfig,
  AIProviderId,
  ModelTier,
} from "./types.js";

const DEFAULT_OPENAI_MODELS: Record<ModelTier, string> = {
  fast: "gpt-4.1-mini",
  deep: "gpt-4.1",
};

const VALID_PROVIDERS = new Set<AIProviderId>([
  "anthropic",
  "openai",
  "openai-compatible",
  "ollama",
]);

export function resolveAIProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): AIProviderConfig | null {
  const explicitProvider = normalized(env.MEMI_AI_PROVIDER);
  const provider = explicitProvider
    ? parseProvider(explicitProvider)
    : inferProvider(env);
  if (!provider) return null;

  const sharedModel = normalized(env.MEMI_AI_MODEL);
  const modelOverrides = {
    fast: normalized(env.MEMI_AI_MODEL_FAST) ?? sharedModel,
    deep: normalized(env.MEMI_AI_MODEL_DEEP) ?? sharedModel,
  };

  if (provider === "anthropic") {
    const apiKey = normalized(env.ANTHROPIC_API_KEY);
    if (!apiKey) return null;
    return {
      provider,
      apiKey,
      models: {
        fast: modelOverrides.fast ?? getModelId("fast"),
        deep: modelOverrides.deep ?? getModelId("deep"),
      },
      capabilities: providerCapabilities(provider, env),
    };
  }

  if (provider === "openai") {
    const apiKey = normalized(env.OPENAI_API_KEY) ?? normalized(env.MEMI_AI_API_KEY);
    if (!apiKey) return null;
    const baseUrl = parseHttpBaseUrl(env.MEMI_AI_BASE_URL ?? "https://api.openai.com/v1");
    if (!baseUrl) return null;
    if (baseUrl !== "https://api.openai.com/v1") return null;
    return {
      provider,
      baseUrl,
      apiKey,
      models: {
        fast: modelOverrides.fast ?? DEFAULT_OPENAI_MODELS.fast,
        deep: modelOverrides.deep ?? DEFAULT_OPENAI_MODELS.deep,
      },
      capabilities: providerCapabilities(provider, env),
    };
  }

  if (provider === "openai-compatible") {
    const baseUrl = parseHttpBaseUrl(env.MEMI_AI_BASE_URL);
    if (!baseUrl || !modelOverrides.fast || !modelOverrides.deep) return null;
    return {
      provider,
      baseUrl,
      apiKey: normalized(env.MEMI_AI_API_KEY),
      models: {
        fast: modelOverrides.fast,
        deep: modelOverrides.deep,
      },
      capabilities: providerCapabilities(provider, env),
    };
  }

  const baseUrl = parseHttpBaseUrl(env.MEMI_AI_BASE_URL ?? "http://127.0.0.1:11434/v1");
  if (!baseUrl || !modelOverrides.fast || !modelOverrides.deep) return null;
  return {
    provider,
    baseUrl,
    apiKey: normalized(env.MEMI_AI_API_KEY),
    models: {
      fast: modelOverrides.fast,
      deep: modelOverrides.deep,
    },
    capabilities: providerCapabilities(provider, env),
  };
}

export function hasConfiguredAIProvider(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveAIProviderConfig(env) !== null;
}

export function maxOutputForProvider(
  config: AIProviderConfig,
  tier: ModelTier,
): number {
  const configured = Number(process.env.MEMI_AI_MAX_OUTPUT);
  if (Number.isSafeInteger(configured) && configured > 0) return configured;
  if (config.provider === "anthropic") return getMaxOutput(tier);
  return tier === "deep" ? 16_384 : 8_192;
}

function inferProvider(env: NodeJS.ProcessEnv): AIProviderId | null {
  if (normalized(env.ANTHROPIC_API_KEY)) return "anthropic";
  if (normalized(env.OPENAI_API_KEY)) return "openai";
  return null;
}

function parseProvider(value: string): AIProviderId | null {
  return VALID_PROVIDERS.has(value as AIProviderId)
    ? value as AIProviderId
    : null;
}

function providerCapabilities(
  provider: AIProviderId,
  env: NodeJS.ProcessEnv,
): AIProviderCapabilities {
  if (provider === "anthropic" || provider === "openai") {
    return {
      text: true,
      vision: true,
      streaming: true,
      json: true,
      tools: false,
    };
  }

  const declared = new Set(
    (env.MEMI_AI_CAPABILITIES ?? "text")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  return {
    text: true,
    vision: declared.has("vision"),
    streaming: declared.has("streaming"),
    json: declared.has("json"),
    tools: declared.has("tools"),
  };
}

function parseHttpBaseUrl(value: string | undefined): string | null {
  const candidate = normalized(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) return null;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "[::1]"
    || hostname === "localhost";
}

function normalized(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
