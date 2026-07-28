/**
 * AI Module Types — Shared types for Anthropic SDK integration.
 */

export interface AIResponse {
  content: string;
  model: string;
  provider?: AIProviderId;
  usage: TokenUsage;
  stopReason: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export type ModelTier = "fast" | "deep";

export type AIProviderId = "anthropic" | "openai" | "openai-compatible" | "ollama";

export interface AIProviderCapabilities {
  text: boolean;
  vision: boolean;
  streaming: boolean;
  json: boolean;
  tools: boolean;
}

export interface AIProviderConfig {
  provider: AIProviderId;
  baseUrl?: string;
  apiKey?: string;
  models: Record<ModelTier, string>;
  capabilities: AIProviderCapabilities;
}

export interface AICompletionOptions {
  system: string;
  messages: AIMessage[];
  model?: ModelTier;
  maxTokens?: number;
  temperature?: number;
}

export interface AITextContent {
  type: "text";
  text: string;
}

export interface AIImageContent {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
    data: string;
  };
}

export type AIContentBlock = AITextContent | AIImageContent;

export interface AIMessage {
  role: "user" | "assistant";
  content: string | AIContentBlock[];
}

export interface AIVisionOptions {
  system: string;
  prompt: string;
  imageBase64: string;
  mediaType?: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  model?: ModelTier;
  maxTokens?: number;
  temperature?: number;
}

export interface AIClient {
  readonly provider: AIProviderId;
  readonly capabilities: AIProviderCapabilities;
  readonly tracker: import("./token-tracker.js").TokenTracker;
  complete(opts: AICompletionOptions): Promise<AIResponse>;
  stream(opts: AICompletionOptions): AsyncGenerator<string, AIResponse>;
  vision(opts: AIVisionOptions): Promise<AIResponse>;
  visionJSON<T = unknown>(
    opts: AIVisionOptions & { schema?: import("zod").ZodSchema<T> },
  ): Promise<T>;
  completeJSON<T = unknown>(
    opts: AICompletionOptions & { schema?: import("zod").ZodSchema<T> },
  ): Promise<T>;
}
