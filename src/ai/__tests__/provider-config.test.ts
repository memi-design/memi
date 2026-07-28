import { afterEach, describe, expect, it } from "vitest";
import { getAI, hasAI } from "../client.js";
import { OpenAICompatibleClient } from "../openai-compatible.js";
import { resolveAIProviderConfig } from "../provider-config.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveAIProviderConfig", () => {
  it("preserves Anthropic as the backward-compatible automatic provider", () => {
    process.env = {
      ...ORIGINAL_ENV,
      ANTHROPIC_API_KEY: "test-anthropic-key",
      OPENAI_API_KEY: "test-openai-key",
    };

    expect(resolveAIProviderConfig()).toMatchObject({
      provider: "anthropic",
      apiKey: "test-anthropic-key",
      capabilities: {
        text: true,
        vision: true,
        streaming: true,
      },
    });
  });

  it("supports an explicit OpenAI provider with model-tier overrides", () => {
    process.env = {
      ...ORIGINAL_ENV,
      MEMI_AI_PROVIDER: "openai",
      OPENAI_API_KEY: "test-openai-key",
      MEMI_AI_MODEL_FAST: "fast-model",
      MEMI_AI_MODEL_DEEP: "deep-model",
    };

    expect(resolveAIProviderConfig()).toMatchObject({
      provider: "openai",
      apiKey: "test-openai-key",
      baseUrl: "https://api.openai.com/v1",
      models: {
        fast: "fast-model",
        deep: "deep-model",
      },
    });
  });

  it("never sends an OpenAI credential to a custom provider hostname", () => {
    process.env = {
      ...ORIGINAL_ENV,
      MEMI_AI_PROVIDER: "openai",
      OPENAI_API_KEY: "test-openai-key",
      MEMI_AI_BASE_URL: "https://credential-capture.example.test/v1",
    };

    expect(resolveAIProviderConfig()).toBeNull();
  });

  it("supports explicit OpenAI-compatible endpoints without assuming a vendor", () => {
    process.env = {
      ...ORIGINAL_ENV,
      MEMI_AI_PROVIDER: "openai-compatible",
      MEMI_AI_BASE_URL: "https://models.example.test/v1/",
      MEMI_AI_API_KEY: "test-compatible-key",
      MEMI_AI_MODEL: "design-model",
    };

    expect(resolveAIProviderConfig()).toMatchObject({
      provider: "openai-compatible",
      apiKey: "test-compatible-key",
      baseUrl: "https://models.example.test/v1",
      models: {
        fast: "design-model",
        deep: "design-model",
      },
    });
  });

  it("only contacts a local Ollama endpoint when explicitly selected", () => {
    process.env = {
      ...ORIGINAL_ENV,
      MEMI_AI_PROVIDER: "ollama",
      MEMI_AI_MODEL: "local-design-model",
    };

    expect(resolveAIProviderConfig()).toMatchObject({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      models: {
        fast: "local-design-model",
        deep: "local-design-model",
      },
    });
  });

  it("fails closed for incomplete or invalid explicit configuration", () => {
    process.env = {
      ...ORIGINAL_ENV,
      MEMI_AI_PROVIDER: "openai-compatible",
      MEMI_AI_BASE_URL: "file:///tmp/not-an-api",
      MEMI_AI_MODEL: "model",
    };

    expect(resolveAIProviderConfig()).toBeNull();
  });

  it("mounts the configured provider behind the shared AI client interface", () => {
    process.env = {
      ...ORIGINAL_ENV,
      MEMI_AI_PROVIDER: "openai",
      OPENAI_API_KEY: "test-openai-key",
      MEMI_AI_MODEL: "design-model",
    };

    expect(hasAI()).toBe(true);
    expect(getAI()).toBeInstanceOf(OpenAICompatibleClient);
  });

  it("rebinds the shared client when a credential rotates", () => {
    process.env = {
      ...ORIGINAL_ENV,
      MEMI_AI_PROVIDER: "openai",
      OPENAI_API_KEY: "test-openai-key-one",
      MEMI_AI_MODEL: "design-model",
    };
    const first = getAI();
    process.env.OPENAI_API_KEY = "test-openai-key-two";
    const second = getAI();

    expect(second).not.toBe(first);
  });

  it("does not silently probe a localhost model endpoint", () => {
    process.env = {
      ...ORIGINAL_ENV,
      MEMI_AI_MODEL: "local-design-model",
    };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MEMI_AI_PROVIDER;

    expect(hasAI()).toBe(false);
    expect(getAI()).toBeNull();
  });
});
