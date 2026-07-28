import { z } from "zod";
import { createLogger } from "../engine/logger.js";
import { TokenTracker } from "./token-tracker.js";
import { maxOutputForProvider } from "./provider-config.js";
import type {
  AIClient,
  AICompletionOptions,
  AIContentBlock,
  AIMessage,
  AIProviderConfig,
  AIResponse,
  AIVisionOptions,
  ModelTier,
  TokenUsage,
} from "./types.js";

const log = createLogger("openai-compatible");
const MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_STREAM_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_STREAM_BUFFER_BYTES = 1024 * 1024;

const ChatCompletionSchema = z.object({
  model: z.string().min(1),
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable(),
      refusal: z.string().nullable().optional(),
    }).passthrough(),
    finish_reason: z.string().nullable().optional(),
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().default(0),
    completion_tokens: z.number().int().nonnegative().default(0),
    prompt_tokens_details: z.object({
      cached_tokens: z.number().int().nonnegative().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

const StreamChunkSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    delta: z.object({
      content: z.string().nullable().optional(),
      refusal: z.string().nullable().optional(),
    }).passthrough(),
    finish_reason: z.string().nullable().optional(),
  }).passthrough()).default([]),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().default(0),
    completion_tokens: z.number().int().nonnegative().default(0),
    prompt_tokens_details: z.object({
      cached_tokens: z.number().int().nonnegative().optional(),
    }).passthrough().optional(),
  }).passthrough().nullable().optional(),
}).passthrough();

export class OpenAICompatibleClient implements AIClient {
  readonly provider;
  readonly capabilities;
  readonly tracker = new TokenTracker();
  private readonly config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    if (config.provider === "anthropic") {
      throw new Error("OpenAICompatibleClient cannot use the Anthropic provider");
    }
    if (!config.baseUrl) {
      throw new Error("OpenAI-compatible provider requires an HTTP base URL");
    }
    this.config = Object.freeze({
      ...config,
      models: Object.freeze({ ...config.models }),
      capabilities: Object.freeze({ ...config.capabilities }),
    });
    this.provider = config.provider;
    this.capabilities = this.config.capabilities;
    log.info({ provider: this.provider }, "Provider-neutral AI client initialized");
  }

  async complete(opts: AICompletionOptions): Promise<AIResponse> {
    const tier = opts.model ?? "fast";
    const response = await this.request({
      ...this.requestBody(opts, tier),
      stream: false,
    });
    const responseText = await readBoundedResponseText(response, MAX_JSON_RESPONSE_BYTES);
    const raw = safeParseJSON(responseText);
    const parsed = ChatCompletionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("Invalid chat completion response from configured AI provider");
    }

    const choice = parsed.data.choices[0];
    const content = choice.message.content ?? choice.message.refusal;
    if (!content) {
      throw new Error("Configured AI provider returned neither content nor a refusal");
    }
    const usage = usageFromCompatible(parsed.data.usage);
    this.tracker.record(usage, tier, parsed.data.model, null);

    return {
      content,
      model: parsed.data.model,
      provider: this.provider,
      usage,
      stopReason: choice.finish_reason ?? (choice.message.refusal ? "refusal" : "end_turn"),
    };
  }

  async *stream(opts: AICompletionOptions): AsyncGenerator<string, AIResponse> {
    if (!this.capabilities.streaming) {
      throw new Error(`AI provider '${this.provider}' has not declared streaming capability`);
    }

    const tier = opts.model ?? "fast";
    const requestedModel = this.config.models[tier];
    const response = await this.request({
      ...this.requestBody(opts, tier),
      stream: true,
      stream_options: { include_usage: true },
    });
    if (!response.body) throw new Error("Configured AI provider returned an empty stream");

    let content = "";
    let model = requestedModel;
    let stopReason = "end_turn";
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    for await (const data of readServerSentData(
      response.body,
      MAX_STREAM_RESPONSE_BYTES,
      MAX_STREAM_BUFFER_BYTES,
    )) {
      if (data === "[DONE]") break;
      const raw = safeParseJSON(data);
      const parsed = StreamChunkSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("Invalid streaming chunk from configured AI provider");
      }
      model = parsed.data.model ?? model;
      if (parsed.data.usage) usage = usageFromCompatible(parsed.data.usage);
      const choice = parsed.data.choices[0];
      if (!choice) continue;
      const delta = choice.delta.content ?? choice.delta.refusal;
      if (delta) {
        content += delta;
        yield delta;
      }
      if (choice.finish_reason) stopReason = choice.finish_reason;
    }

    this.tracker.record(usage, tier, model, null);
    return {
      content,
      model,
      provider: this.provider,
      usage,
      stopReason,
    };
  }

  async vision(opts: AIVisionOptions): Promise<AIResponse> {
    if (!this.capabilities.vision) {
      throw new Error(`AI provider '${this.provider}' has not declared vision capability`);
    }
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

  async visionJSON<T = unknown>(
    opts: AIVisionOptions & { schema?: z.ZodSchema<T> },
  ): Promise<T> {
    if (!this.capabilities.json) {
      throw new Error(`AI provider '${this.provider}' has not declared JSON capability`);
    }
    const response = await this.vision({
      ...opts,
      system: requireJSON(opts.system),
      temperature: 0.1,
    });
    return parseAndValidateJSON(response.content, opts.schema);
  }

  async completeJSON<T = unknown>(
    opts: AICompletionOptions & { schema?: z.ZodSchema<T> },
  ): Promise<T> {
    if (!this.capabilities.json) {
      throw new Error(`AI provider '${this.provider}' has not declared JSON capability`);
    }
    const response = await this.complete({
      ...opts,
      system: requireJSON(opts.system),
    });
    return parseAndValidateJSON(response.content, opts.schema);
  }

  private requestBody(opts: AICompletionOptions, tier: ModelTier): Record<string, unknown> {
    return {
      model: this.config.models[tier],
      max_tokens: opts.maxTokens ?? maxOutputForProvider(this.config, tier),
      temperature: opts.temperature ?? 0.3,
      messages: serializeMessages(opts.system, opts.messages),
    };
  }

  private async request(body: Record<string, unknown>): Promise<Response> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
        if (response.ok) return response;
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new NonRetryableProviderError(
            `AI provider request failed with HTTP ${response.status}`,
          );
        }
        lastError = new Error(`AI provider request failed with HTTP ${response.status}`);
      } catch (error) {
        if (error instanceof NonRetryableProviderError) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      if (attempt < 2) {
        const delayMs = Math.min(500 * (2 ** attempt), 2_000);
        log.warn(
          { provider: this.provider, attempt: attempt + 1, delayMs },
          "AI provider request failed; retrying",
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError ?? new Error("AI provider request failed after retries");
  }
}

class NonRetryableProviderError extends Error {}

function serializeMessages(
  system: string,
  messages: AIMessage[],
): Array<Record<string, unknown>> {
  const serialized = messages.map((message) => ({
    role: message.role,
    content: serializeContent(message.content),
  }));
  return system
    ? [{ role: "system", content: system }, ...serialized]
    : serialized;
}

function serializeContent(
  content: string | AIContentBlock[],
): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  return content.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text };
    return {
      type: "image_url",
      image_url: {
        url: `data:${block.source.media_type};base64,${block.source.data}`,
      },
    };
  });
}

function usageFromCompatible(
  usage: z.infer<typeof ChatCompletionSchema>["usage"],
): TokenUsage {
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    ...(usage?.prompt_tokens_details?.cached_tokens !== undefined
      ? { cacheReadTokens: usage.prompt_tokens_details.cached_tokens }
      : {}),
  };
}

function requireJSON(system: string): string {
  return `${system}\n\nIMPORTANT: Return only valid JSON without markdown fencing or explanation.`.trim();
}

function parseAndValidateJSON<T>(
  content: string,
  schema?: z.ZodSchema<T>,
): T {
  const parsed = parseJSONFromResponse(content);
  return schema ? schema.parse(parsed) : parsed as T;
}

function parseJSONFromResponse(content: string): unknown {
  const trimmed = content.trim();
  const direct = safeParseJSON(trimmed);
  if (direct !== undefined) return direct;
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const fenced = fenceMatch?.[1] ? safeParseJSON(fenceMatch[1].trim()) : undefined;
  if (fenced !== undefined) return fenced;
  const objectMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  const embedded = objectMatch?.[1] ? safeParseJSON(objectMatch[1]) : undefined;
  if (embedded !== undefined) return embedded;
  throw new Error("Could not extract JSON from AI provider response");
}

function safeParseJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function* readServerSentData(
  stream: ReadableStream<Uint8Array>,
  maxResponseBytes: number,
  maxBufferBytes: number,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      totalBytes += value?.byteLength ?? 0;
      if (totalBytes > maxResponseBytes) {
        throw new Error(`AI provider stream exceeded ${maxResponseBytes} bytes`);
      }
      buffer += decoder.decode(value, { stream: !done });
      if (Buffer.byteLength(buffer) > maxBufferBytes) {
        throw new Error(`AI provider stream buffer exceeded ${maxBufferBytes} bytes`);
      }
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) {
        if (Buffer.byteLength(event) > maxBufferBytes) {
          throw new Error(`AI provider stream event exceeded ${maxBufferBytes} bytes`);
        }
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield data;
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const data = buffer
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      totalBytes += value?.byteLength ?? 0;
      if (totalBytes > maxBytes) {
        throw new Error(`AI provider response exceeded ${maxBytes} bytes`);
      }
      body += decoder.decode(value, { stream: !done });
      if (done) return body;
    }
  } finally {
    reader.releaseLock();
  }
}
