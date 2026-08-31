/**
 * Usage-event accounting at the boundary the tracked wrappers actually write.
 *
 * Three rules are pinned here (issue #23):
 *   1. Reasoning is read from where AI SDK v7 actually puts it —
 *      `usage.outputTokenDetails.reasoningTokens`. There is no top-level
 *      `reasoningTokens`, so `usage()` below builds the real shape; a test
 *      using the flat key would pin a path production never takes.
 *   2. Reasoning tokens are estimated from reasoning text when the provider
 *      reports none — via the one shared helper, not a local copy.
 *   3. Reasoning already inside the completion count is not added again, in
 *      either `estimatedCostUsd` or `totalTokens`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface RecordedEvent {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  isEstimated: boolean;
}

const recorded: RecordedEvent[] = [];
const generateTextMock = vi.fn();
const streamTextMock = vi.fn();

/** A usage payload shaped the way AI SDK v7 actually emits one. */
function usage(inputTokens: number, outputTokens: number, reasoningTokens = 0) {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outputTokenDetails: { textTokens: outputTokens - reasoningTokens, reasoningTokens },
  };
}

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: (opts: unknown) => generateTextMock(opts),
  streamText: (opts: unknown) => streamTextMock(opts),
}));

vi.mock("../services/usage-tracking.service.js", () => ({
  recordUsageEvent: (params: RecordedEvent) => { recorded.push(params); },
}));

const { trackedGenerateText, trackedStreamText } = await import("../services/tracked-llm.service.js");

// Priced like the local vLLM models: $0.035/1M in, $0.89/1M out.
const tracking = {
  purpose: "agent_orchestration" as const,
  providerName: "vllm-dgx-14",
  modelName: "qwen3.8-27b-bf16",
  modelConfig: { costPer1mInput: 0.035, costPer1mOutput: 0.89 },
};
const outRate = (t: number) => (t / 1_000_000) * 0.89;
const inRate = (t: number) => (t / 1_000_000) * 0.035;

async function callWith(result: Record<string, unknown>): Promise<RecordedEvent> {
  generateTextMock.mockResolvedValueOnce(result);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await trackedGenerateText({ model: {} as any, prompt: "hi" }, tracking);
  expect(recorded).toHaveLength(1);
  return recorded[0];
}

describe("trackedGenerateText usage accounting", () => {
  beforeEach(() => { recorded.length = 0; generateTextMock.mockReset(); streamTextMock.mockReset(); });

  it("excludes provider-counted reasoning from totalTokens and cost", async () => {
    const event = await callWith({ usage: usage(480, 205, 185) });

    expect(event.reasoningTokens).toBe(185);
    // 205 completion already contains the 185 thinking tokens.
    expect(event.totalTokens).toBe(480 + 205);
    expect(event.estimatedCostUsd).toBeCloseTo(inRate(480) + outRate(205), 10);
  });

  it("estimates reasoning from reasoning text when the provider reports zero", async () => {
    const event = await callWith({
      usage: usage(100, 300),
      reasoningText: "x".repeat(600),
    });

    expect(event.reasoningTokens).toBe(150); // 600 chars / 4
    expect(event.isEstimated).toBe(true);
    // Still inside the 300 completion tokens, so nothing extra is billed.
    expect(event.estimatedCostUsd).toBeCloseTo(inRate(100) + outRate(300), 10);
  });

  it("bills and totals reasoning the provider left out of the completion count", async () => {
    const event = await callWith({
      usage: usage(100, 0),
      reasoningText: "x".repeat(600),
    });

    expect(event.reasoningTokens).toBe(150);
    expect(event.totalTokens).toBe(100 + 0 + 150);
    expect(event.estimatedCostUsd).toBeCloseTo(inRate(100) + outRate(150), 10);
  });

  it("leaves a plain no-reasoning call untouched", async () => {
    const event = await callWith({ usage: usage(1000, 500) });

    expect(event.reasoningTokens).toBe(0);
    expect(event.isEstimated).toBe(false);
    expect(event.totalTokens).toBe(1500);
    expect(event.estimatedCostUsd).toBeCloseTo(inRate(1000) + outRate(500), 10);
  });
});

describe("trackedStreamText usage accounting", () => {
  beforeEach(() => { recorded.length = 0; streamTextMock.mockReset(); });

  /** Drive the wrapper's onFinish the way streamText would, and return the event. */
  async function finishStream(event: Record<string, unknown>): Promise<RecordedEvent> {
    let captured: ((e: unknown) => Promise<void> | void) | undefined;
    streamTextMock.mockImplementation((opts: { onFinish?: (e: unknown) => Promise<void> | void }) => {
      captured = opts.onFinish;
      return { fullStream: (async function* () { /* not consumed here */ })() };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedStreamText({ model: {} as any, prompt: "hi" }, tracking);
    await captured!(event);
    expect(recorded).toHaveLength(1);
    return recorded[0];
  }

  it("excludes provider-counted reasoning from totalTokens and cost", async () => {
    const event = await finishStream({ totalUsage: usage(480, 205, 185), text: "done" });

    expect(event.reasoningTokens).toBe(185);
    expect(event.totalTokens).toBe(480 + 205);
    expect(event.estimatedCostUsd).toBeCloseTo(inRate(480) + outRate(205), 10);
  });

  it("does not double-count reasoning when recovering usage from per-step data", async () => {
    // totalUsage empty (the Bedrock/vLLM streaming case) so the per-step
    // recovery path runs; its 185 reasoning tokens sit inside the 205 output.
    const event = await finishStream({
      totalUsage: usage(0, 0),
      text: "done",
      steps: [{ usage: usage(480, 205, 185) }],
    });

    expect(event.inputTokens).toBe(480);
    expect(event.outputTokens).toBe(205);
    expect(event.reasoningTokens).toBe(185);
    expect(event.totalTokens).toBe(480 + 205);
    expect(event.estimatedCostUsd).toBeCloseTo(inRate(480) + outRate(205), 10);
  });
});
