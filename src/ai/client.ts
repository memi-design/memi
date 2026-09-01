/**
 * Provider-neutral AI client entry point with an Anthropic implementation.
 *
 * Provides structured completion, streaming, and JSON extraction.
 * Gracefully degrades when no API key is set — Memoire works
 * as a Claude Code tool without it, but gets stronger with it.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { createLogger } from "../engine/logger.js";
import { getExecutionPolicy } from "../security/execution-policy.js";
import { TokenTracker } from "./token-tracker.js";
import { getModelId, getMaxOutput } from "./model-config.js";
import { OpenAICompatibleClient } from "./openai-compatible.js";
import { resolveAIProviderConfig } from "./provider-config.js";
import type {
  AIClient,
  AIProviderCapabilities,
  AIProviderConfig,
  AIResponse,
  AICompletionOptions,
  AIContentBlock,
  ModelTier,
  TokenUsage,
} from "./types.js";

const log = createLogger("ai");
const ANTHROPIC_INSTALL_COMMAND = "npm install --save-exact @anthropic-ai/sdk@0.112.3";

type AnthropicLoader = () => Promise<typeof import("@anthropic-ai/sdk")>;

let instance: AIClient | null = null;
let instanceKey: string | null = null;

export class AnthropicClient implements AIClient {
  private sdk: Anthropic | null = null;
  private readonly apiKey: string;
  private readonly anthropicLoader: AnthropicLoader;
  private readonly models: Record<ModelTier, string>;
  readonly provider = "anthropic" as const;
  readonly capabilities: AIProviderCapabilities = {
    text: true,
    vision: true,
    streaming: true,
    json: true,
    tools: false,
  };
  readonly tracker: TokenTracker;

  constructor(
    apiKey: string,
    config?: AIProviderConfig,
    anthropicLoader: AnthropicLoader = () => import("@anthropic-ai/sdk"),
  ) {
    this.apiKey = apiKey;
    this.anthropicLoader = anthropicLoader;
    this.models = config?.models ?? {
      fast: getModelId("fast"),
      deep: getModelId("deep"),
    };
    this.tracker = new TokenTracker();
    log.info("Anthropic AI client initialized");
  }

  async complete(opts: AICompletionOptions): Promise<AIResponse> {
    const sdk = await this.loadSdk();
    const tier: ModelTier = opts.model || "fast";
    const modelId = this.models[tier];
    const maxTokens = opts.maxTokens || getMaxOutput(tier);

    const maxRetries = 3;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await sdk.messages.create({
          model: modelId,
          max_tokens: maxTokens,
          temperature: opts.temperature ?? 0.3,
          system: serializeSystem(opts.system),
          messages: opts.messages.map(m => ({
            role: m.role,
            content: serializeContent(m.content),
          })),
        });

        const content = response.content
          .filter(b => b.type === "text")
          .map(b => (b as Anthropic.TextBlock).text)
          .join("");

        const usage: TokenUsage = {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        };

        this.tracker.record(usage, tier, modelId);

        return {
          content,
          model: modelId,
          provider: this.provider,
          usage,
          stopReason: response.stop_reason || "end_turn",
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const status = (err as { status?: number }).status;

        // Don't retry client errors (400, 401, 403, 404) — only transient/server errors
        if (status && status >= 400 && status < 500) throw lastError;

        if (attempt < maxRetries - 1) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 8000);
          log.warn({ attempt: attempt + 1, backoff, error: lastError.message }, "API call failed, retrying");
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }

    throw lastError ?? new Error("AI completion failed after retries");
  }

  async *stream(opts: AICompletionOptions): AsyncGenerator<string, AIResponse> {
    const sdk = await this.loadSdk();
    const tier: ModelTier = opts.model || "fast";
    const modelId = this.models[tier];
    const maxTokens = opts.maxTokens || getMaxOutput(tier);

    const stream = sdk.messages.stream({
      model: modelId,
      max_tokens: maxTokens,
      temperature: opts.temperature ?? 0.3,
      system: serializeSystem(opts.system),
      messages: opts.messages.map(m => ({
        role: m.role,
        content: serializeContent(m.content),
      })),
    });

    let fullContent = "";

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullContent += event.delta.text;
        yield event.delta.text;
      }
    }

    const finalMessage = await stream.finalMessage();
    const usage: TokenUsage = {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    };

    this.tracker.record(usage, tier, modelId);

    return {
      content: fullContent,
      model: modelId,
      provider: this.provider,
      usage,
      stopReason: finalMessage.stop_reason || "end_turn",
    };
  }

  /**
   * Analyze an image with a text prompt — multimodal vision.
   * Returns structured text analysis of the provided screenshot.
   */
  async vision(opts: {
    system: string;
    prompt: string;
    imageBase64: string;
    mediaType?: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
    model?: ModelTier;
    maxTokens?: number;
    temperature?: number;
  }): Promise<AIResponse> {
    return this.complete({
      system: opts.system,
      model: opts.model ?? "deep",
      maxTokens: opts.maxTokens,
      temperature: opts.temperature ?? 0.2,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: opts.mediaType ?? "image/png",
              data: opts.imageBase64,
            },
          },
          { type: "text", text: opts.prompt },
        ],
      }],
    });
  }

  /**
   * Analyze an image and return structured JSON — multimodal + JSON extraction.
   */
  async visionJSON<T = unknown>(opts: {
    system: string;
    prompt: string;
    imageBase64: string;
    mediaType?: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
    schema?: import("zod").ZodSchema<T>;
    model?: ModelTier;
    maxTokens?: number;
  }): Promise<T> {
    const systemWithJSON = (opts.system || "") + "\n\nIMPORTANT: Return your response as valid JSON. No markdown fencing, no explanation — just the JSON object.";

    const response = await this.vision({
      ...opts,
      system: systemWithJSON,
      temperature: 0.1,
    });

    let parsed: unknown;
    try {
      parsed = parseJSONFromResponse(response.content);
    } catch {
      log.warn("Vision JSON parse failed, retrying");
      // Text-only correction — re-sending the base64 image would double the
      // most expensive part of the request for no accuracy gain.
      const retry = await this.complete({
        system: systemWithJSON,
        model: opts.model ?? "deep",
        maxTokens: opts.maxTokens,
        messages: [
          { role: "user", content: opts.prompt },
          { role: "assistant", content: response.content },
          { role: "user", content: "That was not valid JSON. Return ONLY valid JSON with the same analysis." },
        ],
      });
      parsed = parseJSONFromResponse(retry.content);
    }

    if (opts.schema) return opts.schema.parse(parsed) as T;
    return parsed as T;
  }

  async completeJSON<T = unknown>(
    opts: AICompletionOptions & { schema?: import("zod").ZodSchema<T> }
  ): Promise<T> {
    const systemWithJSON = (opts.system || "") + "\n\nIMPORTANT: Return your response as valid JSON. No markdown fencing, no explanation — just the JSON object.";

    const response = await this.complete({
      ...opts,
      system: systemWithJSON,
    });

    let parsed: unknown;
    try {
      parsed = parseJSONFromResponse(response.content);
    } catch {
      log.warn("JSON parse failed, retrying with error context");
      const retry = await this.complete({
        ...opts,
        system: systemWithJSON,
        messages: [
          ...opts.messages,
          { role: "assistant", content: response.content },
          { role: "user", content: "That was not valid JSON. Please return ONLY valid JSON with no markdown fencing." },
        ],
      });
      parsed = parseJSONFromResponse(retry.content);
    }

    if (opts.schema) {
      return opts.schema.parse(parsed) as T;
    }
    return parsed as T;
  }

  private async loadSdk(): Promise<Anthropic> {
    getExecutionPolicy().assert("host-integration-code", "load the optional Anthropic SDK");
    if (this.sdk) return this.sdk;
    try {
      const { default: AnthropicSdk } = await this.anthropicLoader();
      this.sdk = new AnthropicSdk({ apiKey: this.apiKey });
      return this.sdk;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `MEMI_OPTIONAL_INTEGRATION_MISSING: Anthropic AI requires an optional SDK. Run \`${ANTHROPIC_INSTALL_COMMAND}\`. ${detail}`,
      );
    }
  }
}

/**
 * Serialize the system prompt, opting large prompts into Anthropic prompt
 * caching — design-system context is resent verbatim across calls, so a
 * cache_control breakpoint cuts repeat input cost and latency.
 */
function serializeSystem(system: string | undefined): Anthropic.MessageCreateParams["system"] {
  if (!system) return undefined;
  if (system.length < 4096) return system;
  return [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }];
}

/** Convert AIMessage content to Anthropic SDK format (handles multimodal). */
function serializeContent(content: string | AIContentBlock[]): string | Anthropic.MessageCreateParams["messages"][0]["content"] {
  if (typeof content === "string") return content;
  return content.map((block) => {
    if (block.type === "text") return { type: "text" as const, text: block.text };
    if (block.type === "image") return {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: block.source.media_type,
        data: block.source.data,
      },
    };
    return { type: "text" as const, text: "" };
  });
}

function parseJSONFromResponse(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch?.[1]) {
      return JSON.parse(fenceMatch[1].trim());
    }
    const objMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (objMatch?.[1]) {
      return JSON.parse(objMatch[1]);
    }
    throw new Error(`Could not extract JSON from response: ${trimmed.slice(0, 200)}...`);
  }
}

export function getAI(): AIClient | null {
  const config = resolveAIProviderConfig();
  if (!config) {
    instance = null;
    instanceKey = null;
    return null;
  }
  const nextInstanceKey = JSON.stringify({
    provider: config.provider,
    baseUrl: config.baseUrl,
    models: config.models,
    credentialFingerprint: config.apiKey
      ? createHash("sha256").update(config.apiKey).digest("hex").slice(0, 16)
      : null,
  });
  if (instance && instanceKey === nextInstanceKey) return instance;
  instance = config.provider === "anthropic"
    ? new AnthropicClient(config.apiKey!, config)
    : new OpenAICompatibleClient(config);
  instanceKey = nextInstanceKey;
  return instance;
}

export function hasAI(): boolean {
  return resolveAIProviderConfig() !== null;
}

export function getTracker(): TokenTracker | null {
  return instance?.tracker || null;
}
