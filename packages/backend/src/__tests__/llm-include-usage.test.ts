/**
 * OpenAI-compatible servers (vLLM, ollama) emit NO usage chunk on streaming
 * responses unless `stream_options.include_usage` is requested, and the SDK
 * only sends it when `includeUsage` is set. Without it every streamed call
 * records zero prompt/completion tokens (issue #23).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the config handed to createOpenAICompatible so we can assert that
// usage reporting is requested. vLLM (and OpenAI-compatible servers generally)
// emit NO usage chunk on streaming responses unless stream_options.include_usage
// is set, which the SDK only sends when includeUsage is true.
interface CompatConfig { includeUsage?: boolean; name?: string; baseURL?: string }

const createOpenAICompatibleMock = vi.fn((_config: CompatConfig) => ({
  chatModel: (name: string) => ({ modelId: name }),
  embeddingModel: (name: string) => ({ modelId: name }),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: (config: CompatConfig) => createOpenAICompatibleMock(config),
}));

const { createProviderModel, calculateCostUsd } = await import("../services/llm-config.service.js");
type LlmModelConfig = Parameters<typeof createProviderModel>[0];

function cfg(overrides: Partial<LlmModelConfig> = {}): LlmModelConfig {
  return {
    id: "m1",
    provider: "vllm-dgx-14",
    providerType: "openai-compatible",
    modelName: "qwen3.8-27b-bf16",
    displayName: "Qwen3.8-27B BF16",
    label: "vllm-dgx-14/qwen3.8-27b-bf16",
    costPer1mInput: 0,
    costPer1mOutput: 0,
    maxOutputTokens: 32768,
    maxContextTokens: 262144,
    supportsThinking: true,
    thinkingEffort: "high",
    supportsVision: true,
    supportsEmbeddings: false,
    streamingEnabled: true,
    vlmEvalPreamble: null,
    endpointUrl: "http://example.invalid:4000/v1/",
    apiKey: null,
    maxConcurrent: null,
    ...overrides,
  } as LlmModelConfig;
}

describe("openai-compatible usage reporting", () => {
  beforeEach(() => createOpenAICompatibleMock.mockClear());

  it("requests usage on streaming responses (stream_options.include_usage)", () => {
    createProviderModel(cfg());
    expect(createOpenAICompatibleMock).toHaveBeenCalledTimes(1);
    expect(createOpenAICompatibleMock.mock.calls[0]?.[0]?.includeUsage).toBe(true);
  });

  it("still requests usage when thinking is disabled (custom fetch path)", () => {
    createProviderModel(cfg({ thinkingEffort: "off" }));
    expect(createOpenAICompatibleMock.mock.calls[0]?.[0]?.includeUsage).toBe(true);
  });

  it("requests usage on the ollama chat model too", () => {
    // Built through its own createOpenAICompatible call with a vision fetch
    // wrapper, and it streams — so it needs the flag just as much.
    createProviderModel(cfg({ providerType: "ollama", provider: "ollama" }));
    expect(createOpenAICompatibleMock.mock.calls[0]?.[0]?.includeUsage).toBe(true);
  });
});
