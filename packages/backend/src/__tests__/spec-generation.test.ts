import { describe, expect, it } from "vitest";
import { parseSpecResponse, formatDisambiguationResponse, resolveComplexityFromSpec, type SpecResult } from "../services/spec-generation.service.js";

// ── parseSpecResponse — decomposition fields ──────────────────────────────────

describe("parseSpecResponse — decomposition fields", () => {
  it("parses requiresDecomposition + decompositionReasoning", () => {
    const json = JSON.stringify({
      interpretation: "A snap-fit enclosure with a base and a lid.",
      verificationChecklist: ["Is there a base?", "Is there a lid?"],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
      semanticContext: "Enclosure",
      constructionSpec: "- base 50×30×20mm\n- lid 50×30×3mm",
      verificationCriteria: [{ text: "Two distinct parts", visibility: "visual" }],
      requiresDecomposition: true,
      decompositionReasoning: "Two distinct parts (base + lid) with mating geometry; benefit from independent design before assembly.",
    });
    const result = parseSpecResponse(json);
    expect(result.requiresDecomposition).toBe(true);
    expect(result.decompositionReasoning).toContain("Two distinct parts");
  });

  it("defaults requiresDecomposition to false when missing", () => {
    const json = JSON.stringify({
      interpretation: "A 10mm cube.",
      verificationChecklist: ["Is it a cube?"],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
      semanticContext: "Cube",
      constructionSpec: "- 10×10×10mm box",
      verificationCriteria: [],
    });
    const result = parseSpecResponse(json);
    expect(result.requiresDecomposition).toBe(false);
    expect(result.decompositionReasoning).toBe("");
  });
});

// ── parseSpecResponse ─────────────────────────────────────────────────────────

describe("parseSpecResponse", () => {
  it("parses valid JSON with all fields", () => {
    const json = JSON.stringify({
      interpretation: "A rectangular box with four holes on top.",
      verificationChecklist: [
        "Does the model have exactly 4 through-holes?",
        "Is the box rectangular?",
      ],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
    });

    const result = parseSpecResponse(json);
    expect(result.interpretation).toBe("A rectangular box with four holes on top.");
    expect(result.verificationChecklist).toHaveLength(2);
    expect(result.disambiguationNeeded).toBe(false);
    expect(result.disambiguationQuestions).toHaveLength(0);
  });

  it("parses JSON with disambiguation needed", () => {
    const json = JSON.stringify({
      interpretation: "A container with a lid.",
      verificationChecklist: ["Is there a container?", "Is there a lid?"],
      disambiguationNeeded: true,
      disambiguationQuestions: [
        "Should the lid be hinged, threaded, or snap-fit? (hinge/thread/snap)",
        "Should the container be round or rectangular? (round/rectangular)",
      ],
    });

    const result = parseSpecResponse(json);
    expect(result.disambiguationNeeded).toBe(true);
    expect(result.disambiguationQuestions).toHaveLength(2);
    expect(result.disambiguationQuestions[0]).toContain("hinged");
  });

  it("parses JSON wrapped in code fence", () => {
    const content = `Here is the analysis:

\`\`\`json
{
  "interpretation": "A simple cube.",
  "verificationChecklist": ["Is the model a cube?"],
  "disambiguationNeeded": false,
  "disambiguationQuestions": []
}
\`\`\``;

    const result = parseSpecResponse(content);
    expect(result.interpretation).toBe("A simple cube.");
    expect(result.verificationChecklist).toHaveLength(1);
    expect(result.disambiguationNeeded).toBe(false);
  });

  it("parses code fence without json language tag", () => {
    const content = `\`\`\`
{
  "interpretation": "A cylinder with a hole.",
  "verificationChecklist": ["Is there a cylinder?"],
  "disambiguationNeeded": false,
  "disambiguationQuestions": []
}
\`\`\``;

    const result = parseSpecResponse(content);
    expect(result.interpretation).toBe("A cylinder with a hole.");
    expect(result.disambiguationNeeded).toBe(false);
  });

  it("falls back to regex extraction for unstructured text", () => {
    const content = `interpretation: "A box with rounded edges"
disambiguationNeeded: true`;

    const result = parseSpecResponse(content);
    expect(result.interpretation).toBe("A box with rounded edges");
    expect(result.disambiguationNeeded).toBe(true);
  });

  it("returns fail-open defaults for empty content", () => {
    const result = parseSpecResponse("");
    expect(result.disambiguationNeeded).toBe(false);
    expect(result.verificationChecklist).toHaveLength(0);
    expect(result.interpretation).toBe("");
  });

  it("returns fail-open defaults for null-ish content", () => {
    const result = parseSpecResponse(null as unknown as string);
    expect(result.disambiguationNeeded).toBe(false);
  });

  it("returns fail-open defaults for completely garbled text", () => {
    const result = parseSpecResponse("This is not JSON at all and has no recognizable fields");
    expect(result.disambiguationNeeded).toBe(false);
    expect(result.verificationChecklist).toHaveLength(0);
  });

  it("filters out non-string items from arrays", () => {
    const json = JSON.stringify({
      interpretation: "A box.",
      verificationChecklist: ["Valid question", 123, null, "", "Another valid"],
      disambiguationNeeded: false,
      disambiguationQuestions: [null, "Valid question"],
    });

    const result = parseSpecResponse(json);
    expect(result.verificationChecklist).toEqual(["Valid question", "Another valid"]);
    expect(result.disambiguationQuestions).toEqual(["Valid question"]);
  });

  it("defaults disambiguationNeeded to false when missing", () => {
    const json = JSON.stringify({
      interpretation: "A box.",
      verificationChecklist: [],
    });

    const result = parseSpecResponse(json);
    expect(result.disambiguationNeeded).toBe(false);
    expect(result.disambiguationQuestions).toHaveLength(0);
  });

  it("defaults disambiguationNeeded to false when not strictly true", () => {
    const json = JSON.stringify({
      interpretation: "A box.",
      verificationChecklist: [],
      disambiguationNeeded: "yes", // not boolean true
      disambiguationQuestions: [],
    });

    const result = parseSpecResponse(json);
    expect(result.disambiguationNeeded).toBe(false);
  });
});

// ── formatDisambiguationResponse ──────────────────────────────────────────────

describe("formatDisambiguationResponse", () => {
  it("formats questions correctly with conversation text", () => {
    const spec: SpecResult = {
      interpretation: "A container with a lid.",
      verificationChecklist: [],
      codeAssertions: [],
      disambiguationNeeded: true,
      disambiguationQuestions: [
        "Should the lid be hinged or removable?",
        "Should the container be round or rectangular?",
      ],
      complexity: "simple",
      promptTokens: 100,
      completionTokens: 50,
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
      requiresDecomposition: false,
      decompositionReasoning: "",
    };

    const result = formatDisambiguationResponse("I'd be happy to help you create that!", spec);

    expect(result).not.toContain("I'd be happy to help you create that!");
    expect(result).toContain("I'd like to create this 3D model");
    expect(result).toContain("1. Should the lid be hinged or removable?");
    expect(result).toContain("2. Should the container be round or rectangular?");
    expect(result).toContain("Please answer these questions");
  });

  it("handles single question", () => {
    const spec: SpecResult = {
      interpretation: "A bracket.",
      verificationChecklist: [],
      codeAssertions: [],
      disambiguationNeeded: true,
      disambiguationQuestions: ["Should the bracket be L-shaped or U-shaped?"],
      complexity: "simple",
      promptTokens: 50,
      completionTokens: 25,
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
      requiresDecomposition: false,
      decompositionReasoning: "",
    };

    const result = formatDisambiguationResponse("Let me help.", spec);
    expect(result).toContain("1. Should the bracket be L-shaped or U-shaped?");
    expect(result).not.toContain("2.");
  });
});

// ── resolveComplexityFromSpec ─────────────────────────────────────────────────

describe("resolveComplexityFromSpec", () => {
  it("returns complex+spec_llm_decision when requiresDecomposition is true", () => {
    const result = resolveComplexityFromSpec({
      promptText: "a 10mm cube",
      interpretation: "a tiny cube",
      requiresDecomposition: true,
    });
    expect(result.complexity).toBe("complex");
    expect(result.reason).toBe("spec_llm_decision");
  });

  it("returns complex+multi_part_pattern when regex matches even if LLM says no", () => {
    const result = resolveComplexityFromSpec({
      promptText: "a box with a snap-fit lid",
      interpretation: "a small enclosure",
      requiresDecomposition: false,
    });
    expect(result.complexity).toBe("complex");
    expect(result.reason).toBe("multi_part_pattern");
  });

  it("returns simple+single_agent_default for ordinary single-piece prompts", () => {
    const result = resolveComplexityFromSpec({
      promptText: "a 10mm cube with a 3mm hole through the centre",
      interpretation: "a small cube with a through-hole",
      requiresDecomposition: false,
    });
    expect(result.complexity).toBe("simple");
    expect(result.reason).toBe("single_agent_default");
  });
});
