import { describe, expect, it } from "vitest";
import { resolveComplexityFromSpec } from "../services/spec-generation.service.js";

describe("multi-agent trigger — end-to-end resolver", () => {
  it("LLM saying decompose + benign prompt routes complex", () => {
    const r = resolveComplexityFromSpec({
      promptText: "a 10mm cube",
      interpretation: "a tiny cube",
      requiresDecomposition: true,
    });
    expect(r).toEqual({ complexity: "complex", reason: "spec_llm_decision" });
  });

  it("LLM saying no + multi-part regex match still routes complex (safety net)", () => {
    const r = resolveComplexityFromSpec({
      promptText: "a box with a snap-fit lid",
      interpretation: "small enclosure",
      requiresDecomposition: false,
    });
    expect(r).toEqual({ complexity: "complex", reason: "multi_part_pattern" });
  });

  it("LLM saying no + no regex match routes simple (default)", () => {
    const r = resolveComplexityFromSpec({
      promptText: "a fillet on a 50mm cube",
      interpretation: "cube with rounded edges",
      requiresDecomposition: false,
    });
    expect(r).toEqual({ complexity: "simple", reason: "single_agent_default" });
  });

  it("LLM unavailable (requiresDecomposition undefined) + regex match still routes complex", () => {
    const r = resolveComplexityFromSpec({
      promptText: "a clamshell case",
      requiresDecomposition: undefined,
    });
    expect(r.complexity).toBe("complex");
    expect(r.reason).toBe("multi_part_pattern");
  });
});
