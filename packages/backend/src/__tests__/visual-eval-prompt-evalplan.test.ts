import { describe, expect, it } from "vitest";
import { buildEvaluationSystemPrompt } from "../services/visual-eval-prompt.service.js";
import type { EvalPlan } from "../utils/eval-plan.js";

const fakeChecklist = ["Does the block have a hole?"];
const fakeAngles = ["front", "top", "isometric"];

describe("buildEvaluationSystemPrompt", () => {
  it("uses legacy template when evalPlan is null", () => {
    const text = buildEvaluationSystemPrompt({
      userPrompt: "A block with a hole",
      categoryName: "Primitives",
      complexity: 1,
      checklist: fakeChecklist,
      hasZoomTool: false,
      providedAngles: fakeAngles,
      constructionSpec: "",
      evalPreamble: "",
      evalPlan: null,
    });
    // Legacy template mentions the category name in the rubric line
    expect(text).toContain("Category: Primitives");
  });

  it("uses dynamic block when evalPlan.systemPrompt is set", () => {
    const plan: EvalPlan = {
      systemPrompt: "DYNAMIC_MARKER_XYZ verify the block.",
      inspectionPlan: { angles: ["front"] },
      suggestedCodeWeight: 0.5,
    };
    const text = buildEvaluationSystemPrompt({
      userPrompt: "A block with a hole",
      categoryName: "Primitives",
      complexity: 1,
      checklist: fakeChecklist,
      hasZoomTool: false,
      providedAngles: fakeAngles,
      constructionSpec: "",
      evalPreamble: "",
      evalPlan: plan,
    });
    expect(text).toContain("DYNAMIC_MARKER_XYZ");
    // Static scaffolds still appear
    expect(text).toMatch(/score|rubric/i); // score band scaffold
    expect(text).toContain("JSON"); // JSON output scaffold
    // Legacy category line should NOT appear in dynamic mode
    expect(text).not.toContain("Category: Primitives");
  });
});
