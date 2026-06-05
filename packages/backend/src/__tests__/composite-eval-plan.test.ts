import { describe, expect, it } from "vitest";
import {
  resolveCodeEvalWeight,
  computeCompositeScore,
} from "../services/code-eval-composite.service.js";
import type { EvalPlan } from "../utils/eval-plan.js";

describe("resolveCodeEvalWeight", () => {
  const annotatedCriteria = null;

  it("returns evalPlan.suggestedCodeWeight when present", () => {
    const plan: EvalPlan = {
      systemPrompt: "x",
      inspectionPlan: { angles: ["front"] },
      suggestedCodeWeight: 0.85,
    };
    const r = resolveCodeEvalWeight({
      globalDefault: 0.4,
      evalPlan: plan,
      annotatedCriteria,
      adaptiveWeightRange: 0.2,
    });
    expect(r.weight).toBe(0.85);
    expect(r.source).toBe("eval_plan");
  });

  it("clamps suggestedCodeWeight to [0, 1]", () => {
    const plan: EvalPlan = {
      systemPrompt: "x",
      inspectionPlan: { angles: ["front"] },
      // @ts-expect-error - intentionally testing runtime clamp
      suggestedCodeWeight: 1.7,
    };
    expect(resolveCodeEvalWeight({ globalDefault: 0.4, evalPlan: plan, annotatedCriteria, adaptiveWeightRange: 0.2 }).weight).toBe(1);
  });

  it("falls back to adaptive when evalPlan is null and criteria are annotated", () => {
    const criteria = [{ description: "x", visibility: "code" as const }];
    const r = resolveCodeEvalWeight({
      globalDefault: 0.4,
      evalPlan: null,
      annotatedCriteria: criteria,
      adaptiveWeightRange: 0.2,
    });
    expect(r.source).toBe("adaptive");
  });

  it("falls back to global when both evalPlan and annotated criteria are null", () => {
    const r = resolveCodeEvalWeight({
      globalDefault: 0.4,
      evalPlan: null,
      annotatedCriteria: null,
      adaptiveWeightRange: 0.2,
    });
    expect(r.weight).toBe(0.4);
    expect(r.source).toBe("global");
  });
});

describe("computeCompositeScore clamp gating", () => {
  it("applies the ±4 clamp at low effective weight", () => {
    // visual=8, code=2: |gap| >= 4 → clamp at min+1 = 3
    const r = computeCompositeScore(8, 2, null, 0.4 /* low */);
    expect(r.compositeScore).toBeLessThanOrEqual(3);
  });

  it("does NOT apply the ±4 clamp when effective weight >= 0.75", () => {
    // visual=8, code=2, code-weight=0.8 → weighted = 8*0.2 + 2*0.8 = 3.2; clamp would force ≤3
    const r = computeCompositeScore(8, 2, null, 0.8);
    expect(r.compositeScore).toBeCloseTo(3.2, 1);
  });

  it("still applies the clamp at code-weight exactly below threshold (0.74)", () => {
    const r = computeCompositeScore(8, 2, null, 0.74);
    expect(r.compositeScore).toBeLessThanOrEqual(3);
  });
});

describe("computeCompositeScore clamp suppression by weightSource", () => {
  it("suppresses ±4 clamp when weightSource = eval_plan, even at low weight", () => {
    // visual=8, code=4, weight=0.40 (assembly band), gap=4
    // Without v3 fix: clamp fires → min(8,4)+1 = 5
    // With v3 fix: weighted average = 8*0.60 + 4*0.40 = 6.4
    const r = computeCompositeScore(8, 4, null, 0.40, undefined, undefined, "eval_plan");
    expect(r.compositeScore).toBeCloseTo(6.4, 1);
  });

  it("still applies the clamp when weightSource = adaptive", () => {
    const r = computeCompositeScore(8, 4, null, 0.40, undefined, undefined, "adaptive");
    expect(r.compositeScore).toBeLessThanOrEqual(5);
  });

  it("still applies the clamp when weightSource = global", () => {
    const r = computeCompositeScore(8, 4, null, 0.40, undefined, undefined, "global");
    expect(r.compositeScore).toBeLessThanOrEqual(5);
  });
});
