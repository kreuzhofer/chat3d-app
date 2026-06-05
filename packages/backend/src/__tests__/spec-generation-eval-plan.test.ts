import { describe, expect, it } from "vitest";
import { parseSpecResponse } from "../services/spec-generation.service.js";

describe("parseSpecResponse evalPlan", () => {
  it("extracts a valid evalPlan when LLM returns it", () => {
    const json = JSON.stringify({
      interpretation: "x",
      verificationChecklist: [],
      codeAssertions: [],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
      requiresDecomposition: false,
      decompositionReasoning: "",
      evalPlan: {
        systemPrompt: "Verify dimensions visually.",
        inspectionPlan: { angles: ["isometric", "front"] },
        suggestedCodeWeight: 0.7,
      },
    });
    const parsed = parseSpecResponse(json);
    expect(parsed.evalPlan).not.toBeNull();
    expect(parsed.evalPlan?.suggestedCodeWeight).toBe(0.7);
    expect(parsed.evalPlan?.inspectionPlan.angles).toEqual(["isometric", "front"]);
  });

  it("returns null evalPlan when omitted by LLM", () => {
    const json = JSON.stringify({
      interpretation: "x",
      verificationChecklist: [],
      codeAssertions: [],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
      requiresDecomposition: false,
      decompositionReasoning: "",
    });
    const parsed = parseSpecResponse(json);
    expect(parsed.evalPlan).toBeNull();
  });

  it("returns null evalPlan when LLM returns malformed eval_plan (fail-open)", () => {
    const json = JSON.stringify({
      interpretation: "x",
      verificationChecklist: [],
      codeAssertions: [],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
      requiresDecomposition: false,
      decompositionReasoning: "",
      evalPlan: {
        systemPrompt: "",
        inspectionPlan: { angles: [] },
        suggestedCodeWeight: 2.5,
      },
    });
    const parsed = parseSpecResponse(json);
    expect(parsed.evalPlan).toBeNull();
  });
});
