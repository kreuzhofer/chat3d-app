import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock prisma before importing the service under test.
// Use vi.hoisted() so the mock object is initialized before vi.mock() runs
// (vi.mock is hoisted to the top of the file by the vitest transformer).
const { mockPrismaDecomp } = vi.hoisted(() => ({
  mockPrismaDecomp: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock("../db/prisma.js", () => ({
  prisma: { decompositionDecision: mockPrismaDecomp },
}));

import {
  DECIDER_VERSION,
  lookupCachedDecision,
  upsertDecision,
} from "../services/decomposition-decision.service.js";

beforeEach(() => {
  mockPrismaDecomp.findUnique.mockReset();
  mockPrismaDecomp.upsert.mockReset();
});

describe("decomposition-decision cache helpers", () => {
  it("lookupCachedDecision returns null when no row exists", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue(null);
    const result = await lookupCachedDecision("prompt-1", "model-1");
    expect(result).toBeNull();
    expect(mockPrismaDecomp.findUnique).toHaveBeenCalledWith({
      where: { promptId_modelId: { promptId: "prompt-1", modelId: "model-1" } },
    });
  });

  it("lookupCachedDecision returns null on decider_version mismatch (stale row)", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue({
      decompose: true,
      reasoning: "old reason",
      deciderVersion: "v0.9.0",
    });
    const result = await lookupCachedDecision("prompt-1", "model-1");
    expect(result).toBeNull();
  });

  it("lookupCachedDecision returns row when decider_version matches current", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue({
      decompose: true,
      reasoning: "lathe profile + grooves; small tier benefits from decomposition",
      deciderVersion: DECIDER_VERSION,
    });
    const result = await lookupCachedDecision("prompt-1", "model-1");
    expect(result).toEqual({
      decompose: true,
      reasoning: "lathe profile + grooves; small tier benefits from decomposition",
    });
  });

  it("upsertDecision writes via Prisma upsert with the current decider version", async () => {
    mockPrismaDecomp.upsert.mockResolvedValue({});
    await upsertDecision({
      promptId: "prompt-1",
      modelId: "model-1",
      decompose: false,
      reasoning: "simple cube",
    });
    expect(mockPrismaDecomp.upsert).toHaveBeenCalledWith({
      where: { promptId_modelId: { promptId: "prompt-1", modelId: "model-1" } },
      create: {
        promptId: "prompt-1",
        modelId: "model-1",
        deciderVersion: DECIDER_VERSION,
        decompose: false,
        reasoning: "simple cube",
      },
      update: {
        deciderVersion: DECIDER_VERSION,
        decompose: false,
        reasoning: "simple cube",
      },
    });
  });
});

import { parseDeciderResponse } from "../services/decomposition-decision.service.js";

describe("parseDeciderResponse", () => {
  it("parses well-formed JSON", () => {
    const r = parseDeciderResponse('{"decompose": true, "reasoning": "multi-part with mating hinge"}');
    expect(r).toEqual({ decompose: true, reasoning: "multi-part with mating hinge" });
  });

  it("strips markdown code fences before parsing", () => {
    const r = parseDeciderResponse('```json\n{"decompose": false, "reasoning": "simple primitive"}\n```');
    expect(r).toEqual({ decompose: false, reasoning: "simple primitive" });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseDeciderResponse("not json")).toThrow(/decider response/i);
  });

  it("throws when 'decompose' is missing or non-boolean", () => {
    expect(() => parseDeciderResponse('{"reasoning": "no decompose field"}')).toThrow(/decompose/);
    expect(() => parseDeciderResponse('{"decompose": "yes", "reasoning": "x"}')).toThrow(/decompose/);
  });

  it("falls back to empty reasoning when missing", () => {
    const r = parseDeciderResponse('{"decompose": true}');
    expect(r).toEqual({ decompose: true, reasoning: "" });
  });
});

import { decideDecomposition } from "../services/decomposition-decision.service.js";

// Mock the LLM call layer + model resolver
const { mockTrackedGenerateText, mockGetModelForPurpose, mockCreateProviderModel } = vi.hoisted(() => ({
  mockTrackedGenerateText: vi.fn(),
  mockGetModelForPurpose: vi.fn(),
  mockCreateProviderModel: vi.fn(() => ({ __sentinel: "stub-model" })),
}));
vi.mock("../services/tracked-llm.service.js", () => ({
  trackedGenerateText: (...args: unknown[]) => mockTrackedGenerateText(...args),
}));
vi.mock("../services/llm-config.service.js", async () => {
  const actual = await vi.importActual<typeof import("../services/llm-config.service.js")>(
    "../services/llm-config.service.js",
  );
  return {
    ...actual,
    getModelForPurpose: (...args: unknown[]) => mockGetModelForPurpose(...args),
    createProviderModel: (...args: unknown[]) => mockCreateProviderModel(...args),
  };
});

beforeEach(() => {
  mockTrackedGenerateText.mockReset();
  mockGetModelForPurpose.mockReset();
  mockGetModelForPurpose.mockResolvedValue({
    id: "decider-model-id",
    provider: "bedrock",
    modelName: "claude-haiku-4-5",
    label: "Haiku 4.5",
    costPer1mInput: 0.25,
    costPer1mOutput: 1.25,
    maxConcurrent: 5,
  });
});

describe("decideDecomposition orchestrator", () => {
  it("returns cached result with live_decider_cached when row matches version", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue({
      decompose: true,
      reasoning: "cached: snap-fit lid",
      deciderVersion: DECIDER_VERSION,
    });
    const r = await decideDecomposition({
      promptId: "p1",
      promptText: "a box with a snap-fit lid",
      modelId: "m1",
      modelTier: "frontier",
    });
    expect(r.decompose).toBe(true);
    expect(r.reasoning).toBe("cached: snap-fit lid");
    expect(r.triggerReason).toBe("live_decider_cached");
    expect(r.deciderVersion).toBe(DECIDER_VERSION);
    expect(mockTrackedGenerateText).not.toHaveBeenCalled();
  });

  it("calls LLM and upserts on cache miss, returns live_decider", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue(null);
    mockPrismaDecomp.upsert.mockResolvedValue({});
    mockTrackedGenerateText.mockResolvedValue({
      text: '{"decompose": true, "reasoning": "lathe + grooves on small tier"}',
      usage: { inputTokens: 200, outputTokens: 30 },
    });
    const r = await decideDecomposition({
      promptId: "p2",
      promptText: "A lathe-turned handle: complex profile with gripping grooves",
      modelId: "m1",
      modelTier: "small",
    });
    expect(r).toEqual({
      decompose: true,
      reasoning: "lathe + grooves on small tier",
      triggerReason: "live_decider",
      deciderVersion: DECIDER_VERSION,
    });
    expect(mockTrackedGenerateText).toHaveBeenCalledTimes(1);
    expect(mockPrismaDecomp.upsert).toHaveBeenCalledTimes(1);
  });

  it("treats null modelTier as 'mid' in the user-message payload", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue(null);
    mockPrismaDecomp.upsert.mockResolvedValue({});
    mockTrackedGenerateText.mockResolvedValue({
      text: '{"decompose": false, "reasoning": "simple primitive"}',
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    await decideDecomposition({
      promptId: "p3",
      promptText: "a 10mm cube",
      modelId: "m1",
      modelTier: null,
    });
    const llmCall = mockTrackedGenerateText.mock.calls[0]![0] as { prompt: string };
    expect(llmCall.prompt).toMatch(/TIER: mid/);
  });

  it("includes spec_interpretation in the user message when provided", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue(null);
    mockPrismaDecomp.upsert.mockResolvedValue({});
    mockTrackedGenerateText.mockResolvedValue({
      text: '{"decompose": false, "reasoning": "single piece"}',
      usage: { inputTokens: 150, outputTokens: 20 },
    });
    await decideDecomposition({
      promptId: "p4",
      promptText: "lathe handle",
      modelId: "m1",
      modelTier: "frontier",
      specInterpretation: "A turned cylindrical handle with surface grooves.",
    });
    const llmCall = mockTrackedGenerateText.mock.calls[0]![0] as { prompt: string };
    expect(llmCall.prompt).toMatch(/Spec interpretation:/);
    expect(llmCall.prompt).toMatch(/A turned cylindrical handle with surface grooves\./);
  });

  it("rethrows when the LLM call fails (router handles fallback)", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue(null);
    mockTrackedGenerateText.mockRejectedValue(new Error("upstream timeout"));
    await expect(
      decideDecomposition({
        promptId: "p5",
        promptText: "x",
        modelId: "m1",
        modelTier: "mid",
      }),
    ).rejects.toThrow(/upstream timeout/);
  });

  it("rethrows when the LLM response is unparseable", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue(null);
    mockTrackedGenerateText.mockResolvedValue({
      text: "I'm sorry I can't help with that.",
      usage: { inputTokens: 100, outputTokens: 10 },
    });
    await expect(
      decideDecomposition({
        promptId: "p6",
        promptText: "x",
        modelId: "m1",
        modelTier: "mid",
      }),
    ).rejects.toThrow(/JSON/);
  });
});
