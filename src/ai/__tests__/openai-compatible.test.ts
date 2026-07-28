import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleClient } from "../openai-compatible.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleClient", () => {
  it("sends a provider-neutral chat completion and validates the response", async () => {
    const requestBodies: unknown[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        id: "chatcmpl_test",
        model: "resolved-design-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "Use an 8px spacing rhythm.", refusal: null },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20,
          prompt_tokens_details: { cached_tokens: 3 },
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleClient({
      provider: "openai-compatible",
      baseUrl: "https://models.example.test/v1",
      apiKey: "secret-test-key",
      models: { fast: "requested-fast-model", deep: "requested-deep-model" },
      capabilities: { text: true, vision: true, streaming: true, json: true, tools: false },
    });

    const result = await client.complete({
      system: "You are a design reviewer.",
      messages: [{ role: "user", content: "Review this layout." }],
      model: "fast",
      maxTokens: 200,
      temperature: 0.2,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://models.example.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-test-key",
        }),
      }),
    );
    expect(requestBodies[0]).toMatchObject({
      model: "requested-fast-model",
      max_tokens: 200,
      messages: [
        { role: "system", content: "You are a design reviewer." },
        { role: "user", content: "Review this layout." },
      ],
    });
    expect(result).toEqual({
      content: "Use an 8px spacing rhythm.",
      model: "resolved-design-model",
      provider: "openai-compatible",
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        cacheReadTokens: 3,
      },
      stopReason: "stop",
    });
  });

  it("serializes base64 images through the compatible image_url shape", async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        model: "vision-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "The hierarchy is clear.", refusal: null },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
      }), { status: 200 });
    }));

    const client = new OpenAICompatibleClient({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret-test-key",
      models: { fast: "text-model", deep: "vision-model" },
      capabilities: { text: true, vision: true, streaming: true, json: true, tools: true },
    });

    await client.vision({
      system: "Review visual craft.",
      prompt: "Assess hierarchy.",
      imageBase64: "aGVsbG8=",
      mediaType: "image/png",
    });

    expect(requestBody).toMatchObject({
      model: "vision-model",
      messages: [
        { role: "system", content: "Review visual craft." },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
            { type: "text", text: "Assess hierarchy." },
          ],
        },
      ],
    });
  });

  it("rejects malformed provider responses instead of guessing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ choices: [] }),
      { status: 200 },
    )));

    const client = new OpenAICompatibleClient({
      provider: "openai-compatible",
      baseUrl: "https://models.example.test/v1",
      models: { fast: "model", deep: "model" },
      capabilities: { text: true, vision: false, streaming: false, json: true, tools: false },
    });

    await expect(client.complete({
      system: "",
      messages: [{ role: "user", content: "Hello" }],
    })).rejects.toThrow(/invalid chat completion response/i);
  });
});
