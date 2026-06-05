import { describe, expect, it } from "vitest";
import {
  EvalPlanSchema,
  parseEvalPlan,
  type EvalPlan,
  RENDER_ANGLE_NAMES,
} from "../utils/eval-plan.js";

describe("EvalPlanSchema", () => {
  const valid: EvalPlan = {
    systemPrompt: "Evaluate the rendered enclosure against the prompt's exact dimensions.",
    inspectionPlan: {
      angles: ["isometric", "back", "top"],
    },
    suggestedCodeWeight: 0.8,
  };

  it("accepts a valid plan with required fields only", () => {
    const result = EvalPlanSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts a plan with optional focus", () => {
    const plan = {
      ...valid,
      inspectionPlan: {
        angles: ["isometric_back"],
        focus: { isometric_back: "verify port cutouts on the +Y wall" },
      },
    };
    expect(EvalPlanSchema.safeParse(plan).success).toBe(true);
  });

  it("rejects empty systemPrompt", () => {
    expect(EvalPlanSchema.safeParse({ ...valid, systemPrompt: "" }).success).toBe(false);
  });

  it("rejects unknown angles", () => {
    const bad = { ...valid, inspectionPlan: { angles: ["close_up"] } };
    expect(EvalPlanSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects suggestedCodeWeight outside [0,1]", () => {
    expect(EvalPlanSchema.safeParse({ ...valid, suggestedCodeWeight: 1.5 }).success).toBe(false);
    expect(EvalPlanSchema.safeParse({ ...valid, suggestedCodeWeight: -0.1 }).success).toBe(false);
  });

  it("rejects focus keys that are not in angles", () => {
    const bad = {
      ...valid,
      inspectionPlan: {
        angles: ["top"],
        focus: { bottom: "stranger" },
      },
    };
    expect(EvalPlanSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty angles array", () => {
    expect(EvalPlanSchema.safeParse({ ...valid, inspectionPlan: { angles: [] } }).success).toBe(false);
  });
});

describe("parseEvalPlan", () => {
  it("returns the parsed plan when input is valid", () => {
    const plan = parseEvalPlan({
      systemPrompt: "x".repeat(50),
      inspectionPlan: { angles: ["front"] },
      suggestedCodeWeight: 0.5,
    });
    expect(plan).not.toBeNull();
    expect(plan?.suggestedCodeWeight).toBe(0.5);
  });

  it("returns null on invalid input (fail-open)", () => {
    expect(parseEvalPlan(null)).toBeNull();
    expect(parseEvalPlan(undefined)).toBeNull();
    expect(parseEvalPlan({})).toBeNull();
    expect(parseEvalPlan({ systemPrompt: "" })).toBeNull();
    expect(parseEvalPlan("garbage")).toBeNull();
  });
});

describe("RENDER_ANGLE_NAMES", () => {
  it("has exactly the 10 stored angles", () => {
    expect(new Set(RENDER_ANGLE_NAMES)).toEqual(new Set([
      "front", "back", "left", "right",
      "top", "bottom", "ortho_45", "ortho_45_bottom",
      "isometric", "isometric_back",
    ]));
  });
});
