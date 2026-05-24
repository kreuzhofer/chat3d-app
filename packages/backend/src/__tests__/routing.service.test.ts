import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock the decomposition decider before importing the router under test.
// Use vi.hoisted() so the mock is initialized before vi.mock() runs
// (vi.mock is hoisted to the top of the file by the vitest transformer).
const { mockDecideDecomposition } = vi.hoisted(() => ({
  mockDecideDecomposition: vi.fn(),
}));
vi.mock("../services/decomposition-decision.service.js", () => ({
  decideDecomposition: (...args: unknown[]) => mockDecideDecomposition(...args),
}));

import { routeGeneration } from "../services/routing.service.js";

beforeEach(() => {
  mockDecideDecomposition.mockReset();
});

describe("routeGeneration", () => {
  it("returns useMultiAgent=true with forced_override when routingOverride=force_decompose", async () => {
    const r = await routeGeneration({
      promptId: "p1",
      promptText: "a 10mm cube",
      modelId: "m1",
      modelTier: "frontier",
      routingOverride: "force_decompose",
    });
    expect(r).toEqual({ useMultiAgent: true, triggerReason: "forced_override", reasoning: undefined });
    expect(mockDecideDecomposition).not.toHaveBeenCalled();
  });

  it("returns useMultiAgent=false with forced_override when routingOverride=force_single", async () => {
    const r = await routeGeneration({
      promptId: "p2",
      promptText: "a box with a snap-fit lid",  // regex would match but override wins
      modelId: "m1",
      modelTier: "mid",
      routingOverride: "force_single",
    });
    expect(r).toEqual({ useMultiAgent: false, triggerReason: "forced_override", reasoning: undefined });
    expect(mockDecideDecomposition).not.toHaveBeenCalled();
  });

  it("fires multi-part regex (auto override) without calling the decider", async () => {
    const r = await routeGeneration({
      promptId: "p3",
      promptText: "a box with a snap-fit lid",
      modelId: "m1",
      modelTier: "mid",
      routingOverride: "auto",
    });
    expect(r.useMultiAgent).toBe(true);
    expect(r.triggerReason).toBe("multi_part_pattern");
    expect(mockDecideDecomposition).not.toHaveBeenCalled();
  });

  it("calls the decider when regex doesn't match (auto override)", async () => {
    mockDecideDecomposition.mockResolvedValue({
      decompose: true,
      reasoning: "lathe + grooves warrant decomposition",
      triggerReason: "live_decider",
      deciderVersion: "v1.0.0",
    });
    const r = await routeGeneration({
      promptId: "p4",
      promptText: "A lathe-turned handle: complex profile with gripping grooves",
      modelId: "m1",
      modelTier: "mid",
      routingOverride: "auto",
    });
    expect(r.useMultiAgent).toBe(true);
    expect(r.triggerReason).toBe("live_decider");
    expect(r.reasoning).toBe("lathe + grooves warrant decomposition");
    expect(mockDecideDecomposition).toHaveBeenCalledTimes(1);
  });

  it("propagates live_decider_cached trigger reason from decider", async () => {
    mockDecideDecomposition.mockResolvedValue({
      decompose: false,
      reasoning: "cached: simple primitive",
      triggerReason: "live_decider_cached",
      deciderVersion: "v1.0.0",
    });
    const r = await routeGeneration({
      promptId: "p5",
      promptText: "a 10mm cube",
      modelId: "m1",
      modelTier: "frontier",
      routingOverride: "auto",
    });
    expect(r.useMultiAgent).toBe(false);
    expect(r.triggerReason).toBe("live_decider_cached");
    expect(r.reasoning).toBe("cached: simple primitive");
  });

  it("falls back to useMultiAgent=false + spec_unavailable when decider errors", async () => {
    mockDecideDecomposition.mockRejectedValue(new Error("decider exploded"));
    const r = await routeGeneration({
      promptId: "p6",
      promptText: "A lathe-turned handle",
      modelId: "m1",
      modelTier: "mid",
      routingOverride: "auto",
    });
    expect(r).toEqual({ useMultiAgent: false, triggerReason: "spec_unavailable", reasoning: undefined });
  });

  it("treats omitted routingOverride as 'auto'", async () => {
    mockDecideDecomposition.mockResolvedValue({
      decompose: false,
      reasoning: "simple",
      triggerReason: "live_decider",
      deciderVersion: "v1.0.0",
    });
    const r = await routeGeneration({
      promptId: "p7",
      promptText: "a simple cube",
      modelId: "m1",
      modelTier: "frontier",
      // routingOverride omitted
    });
    expect(r.useMultiAgent).toBe(false);
    expect(r.triggerReason).toBe("live_decider");
  });

  it("passes specInterpretation through to the decider", async () => {
    mockDecideDecomposition.mockResolvedValue({
      decompose: true,
      reasoning: "x",
      triggerReason: "live_decider",
      deciderVersion: "v1.0.0",
    });
    await routeGeneration({
      promptId: "p8",
      promptText: "thing",
      modelId: "m1",
      modelTier: "mid",
      routingOverride: "auto",
      specInterpretation: "A complex thing.",
    });
    const call = mockDecideDecomposition.mock.calls[0]![0] as { specInterpretation?: string };
    expect(call.specInterpretation).toBe("A complex thing.");
  });
});
