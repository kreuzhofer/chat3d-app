import { describe, expect, it } from "vitest";
import { buildGenerateOptions, useAdaptiveThinking, type LlmModelConfig } from "../llm-config.service.js";

function cfg(overrides: Partial<LlmModelConfig>): LlmModelConfig {
  return {
    id: "test-id",
    provider: "bedrock",
    providerType: null,
    modelName: "global.anthropic.claude-opus-4-6-v1",
    displayName: "test",
    label: "test/label",
    costPer1mInput: 0,
    costPer1mOutput: 0,
    maxOutputTokens: 4096,
    maxContextTokens: 200000,
    supportsThinking: true,
    thinkingEffort: "medium",
    supportsVision: false,
    supportsEmbeddings: false,
    streamingEnabled: true,
    vlmEvalPreamble: null,
    endpointUrl: null,
    apiKey: "test",
    maxConcurrent: null,
    ...overrides,
  };
}

describe("useAdaptiveThinking", () => {
  it("returns true for Claude Opus 4.7 (bedrock global tag)", () => {
    expect(useAdaptiveThinking("global.anthropic.claude-opus-4-7")).toBe(true);
  });

  it("returns true for Claude Opus 4.8 (bedrock global tag)", () => {
    expect(useAdaptiveThinking("global.anthropic.claude-opus-4-8")).toBe(true);
  });

  it("returns true for Claude Sonnet 4.7 direct (anthropic SDK id)", () => {
    expect(useAdaptiveThinking("claude-sonnet-4-7")).toBe(true);
  });

  it("returns true for Claude Haiku 4.10 (future double-digit minor)", () => {
    expect(useAdaptiveThinking("claude-haiku-4-10")).toBe(true);
  });

  it("returns false for Claude Opus 4.6 (legacy enabled style)", () => {
    expect(useAdaptiveThinking("global.anthropic.claude-opus-4-6-v1")).toBe(false);
  });

  it("returns false for Claude Sonnet 4.6", () => {
    expect(useAdaptiveThinking("global.anthropic.claude-sonnet-4-6")).toBe(false);
  });

  it("returns false for Claude 4.5 / 4.0 / 3.x", () => {
    expect(useAdaptiveThinking("claude-opus-4-5-20251101")).toBe(false);
    expect(useAdaptiveThinking("claude-sonnet-4-20250514")).toBe(false);
    expect(useAdaptiveThinking("claude-3-7-sonnet-20250219-v1:0")).toBe(false);
  });

  it("returns false for non-Claude model names", () => {
    expect(useAdaptiveThinking("gpt-oss-120b")).toBe(false);
    expect(useAdaptiveThinking("Qwen3.5-397B-A17B-int4")).toBe(false);
    expect(useAdaptiveThinking("")).toBe(false);
  });
});

describe("buildGenerateOptions — thinking config", () => {
  it("Bedrock 4.6 → reasoningConfig.type=enabled with budgetTokens", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "bedrock", modelName: "global.anthropic.claude-opus-4-6-v1", thinkingEffort: "medium" }),
    );
    expect(opts.providerOptions).toEqual({
      bedrock: { reasoningConfig: { type: "enabled", budgetTokens: 4096 } },
    });
  });

  it("Bedrock 4.7 → reasoningConfig.type=adaptive with maxReasoningEffort", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "bedrock", modelName: "global.anthropic.claude-opus-4-7", thinkingEffort: "medium" }),
    );
    expect(opts.providerOptions).toEqual({
      bedrock: { reasoningConfig: { type: "adaptive", maxReasoningEffort: "medium" } },
    });
  });

  it("Bedrock 4.8 with high effort → maxReasoningEffort=high", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "bedrock", modelName: "global.anthropic.claude-opus-4-8", thinkingEffort: "high" }),
    );
    expect(opts.providerOptions).toEqual({
      bedrock: { reasoningConfig: { type: "adaptive", maxReasoningEffort: "high" } },
    });
  });

  it("Anthropic direct 4.6 → thinking.type=enabled with budgetTokens", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "anthropic", modelName: "claude-opus-4-6", thinkingEffort: "low" }),
    );
    expect(opts.providerOptions).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 1024 } },
    });
  });

  it("Anthropic direct 4.7 → thinking.type=adaptive + top-level effort", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "anthropic", modelName: "claude-opus-4-7", thinkingEffort: "max" }),
    );
    expect(opts.providerOptions).toEqual({
      anthropic: { thinking: { type: "adaptive" }, effort: "max" },
    });
  });

  it("thinking disabled (no effort) → no thinking provider option", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "bedrock", modelName: "global.anthropic.claude-opus-4-7", thinkingEffort: null }),
    );
    expect(opts.providerOptions).toBeUndefined();
  });

  it("supportsThinking=false → no thinking provider option even with 4.7 name", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "bedrock", modelName: "global.anthropic.claude-opus-4-7", supportsThinking: false }),
    );
    expect(opts.providerOptions).toBeUndefined();
  });

  it("unknown effort string → no thinking provider option (budget=0)", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "bedrock", modelName: "global.anthropic.claude-opus-4-7", thinkingEffort: "bogus" }),
    );
    expect(opts.providerOptions).toBeUndefined();
  });
});
