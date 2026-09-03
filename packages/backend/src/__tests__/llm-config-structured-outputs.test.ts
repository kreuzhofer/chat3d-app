/**
 * The OpenAI-compatible provider (vLLM) must be created with structured
 * outputs enabled: without the flag the SDK silently downgrades a JSON
 * schema to `response_format: json_object`, and the judge's answer is no
 * longer constrained to the evaluation schema (issue #53).
 */
import { describe, it, expect } from "vitest";
import { createProviderModel, type LlmModelConfig } from "../services/llm-config.service.js";

function cfg(overrides: Partial<LlmModelConfig> = {}): LlmModelConfig {
  return {
    id: "m1", provider: "vllm-dgx-14", providerType: "openai-compatible",
    modelName: "glm-5.3-flash", displayName: "glm", label: "vllm-dgx-14/glm-5.3-flash",
    costPer1mInput: 0, costPer1mOutput: 0, maxOutputTokens: null, maxContextTokens: null,
    supportsThinking: true, thinkingEffort: "high", supportsVision: true, supportsEmbeddings: false,
    streamingEnabled: true, vlmEvalPreamble: null, endpointUrl: "http://vllm.local/v1", apiKey: null,
    maxConcurrent: null,
    ...overrides,
  };
}

describe("createProviderModel — structured outputs", () => {
  it("enables json_schema response formats on the OpenAI-compatible (vLLM) path", () => {
    const model = createProviderModel(cfg()) as { supportsStructuredOutputs?: boolean };
    expect(model.supportsStructuredOutputs).toBe(true);
  });

  it("leaves the Anthropic model untouched", () => {
    const model = createProviderModel(cfg({ provider: "anthropic", providerType: null, apiKey: "k" })) as Record<string, unknown>;
    expect(model.provider).toMatch(/^anthropic/);
    expect("supportsStructuredOutputs" in model).toBe(false);
  });
});
