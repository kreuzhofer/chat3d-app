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
