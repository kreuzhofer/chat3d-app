/**
 * calculateCostUsd must not charge reasoning tokens the provider already
 * counted inside its completion total (issue #23).
 */
import { describe, it, expect } from "vitest";

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

describe("calculateCostUsd reasoning accounting", () => {
  // Priced like the local vLLM models: $0.035/1M in, $0.89/1M out.
  const priced = cfg({ costPer1mInput: 0.035, costPer1mOutput: 0.89 });
  const outRate = (tokens: number) => (tokens / 1_000_000) * 0.89;
  const inRate = (tokens: number) => (tokens / 1_000_000) * 0.035;

  it("does not bill reasoning tokens that are already inside the completion count", () => {
    // Every provider in use (Anthropic, Bedrock, OpenAI, vLLM) counts thinking
    // tokens inside completion_tokens and exposes reasoning only as a
    // breakdown. Billing it again double-charges the thinking portion.
    const withReasoning = calculateCostUsd(priced, 480, 205, 185);
    const outputOnly = calculateCostUsd(priced, 480, 205, 0);
    expect(withReasoning).toBe(outputOnly);
    expect(withReasoning).toBeCloseTo(inRate(480) + outRate(205), 10);
  });

  it("still bills reasoning the provider left out of the completion count", () => {
    // Safety net: when a provider reports no completion tokens at all, the
    // reasoning estimate is the only signal of work done and must be charged.
    expect(calculateCostUsd(priced, 0, 0, 185)).toBeCloseTo(outRate(185), 10);
  });

  it("bills only the excess when reasoning exceeds the reported completion count", () => {
    expect(calculateCostUsd(priced, 0, 100, 185)).toBeCloseTo(outRate(100) + outRate(85), 10);
  });

  it("leaves plain input/output pricing untouched", () => {
    expect(calculateCostUsd(priced, 1000, 500)).toBeCloseTo(inRate(1000) + outRate(500), 10);
  });

  it("keeps cache read/write pricing untouched", () => {
    // reads 0.1x input, writes 1.25x input, non-cached remainder at 1x
    const cost = calculateCostUsd(priced, 1000, 0, 0, 400, 200);
    expect(cost).toBeCloseTo(inRate(400) + inRate(400) * 0.1 + inRate(200) * 1.25, 10);
  });
});
