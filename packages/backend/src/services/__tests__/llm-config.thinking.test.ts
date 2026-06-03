import { describe, expect, it } from "vitest";
import { useAdaptiveThinking } from "../llm-config.service.js";

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
