/**
 * Tests for the code evaluation service.
 *
 * Tests the assertion checker (deterministic) and composite score computation.
 * LLM-based code review is not tested here (requires live LLM calls).
 */

import { describe, it, expect } from "vitest";
import { computeCompositeScore } from "../services/code-eval-composite.service.js";
import { parseSpecResponse } from "../services/spec-generation.service.js";

// ── computeCompositeScore ──────────────────────────────────────────────────

describe("computeCompositeScore", () => {
  it("returns visual score when only visual is available", () => {
    const result = computeCompositeScore(8, null, null, 0.4);
    expect(result.compositeScore).toBe(8);
    expect(result.source).toBe("visual_only");
  });

  it("returns code score when only code is available", () => {
    const result = computeCompositeScore(null, 7, null, 0.4);
    expect(result.compositeScore).toBe(7);
    expect(result.source).toBe("code_only");
  });

  it("blends visual and code scores with given weight as float", () => {
    // visual=8, code=6, weight=0.4 → 8*0.6 + 6*0.4 = 4.8 + 2.4 = 7.2
    const result = computeCompositeScore(8, 6, null, 0.4);
    expect(result.compositeScore).toBe(7.2);
    expect(result.source).toBe("composite");
  });

  it("caps composite when visual and code strongly disagree", () => {
    // visual=9, code=3, weight=0.4 → blend = 9*0.6 + 3*0.4 = 6.6
    // But disagreement ≥ 4, so cap at min(9,3)+1 = 4
    const result = computeCompositeScore(9, 3, null, 0.4);
    expect(result.compositeScore).toBe(4);
  });

  it("does not cap when disagreement is less than 4", () => {
    // visual=8, code=5, diff=3, blend = 8*0.6 + 5*0.4 = 6.8
    const result = computeCompositeScore(8, 5, null, 0.4);
    expect(result.compositeScore).toBe(6.8);
  });

  // ── Assertion hard-fail behavior ──────────────────────────────────────

  it("hard-caps at 2 when any assertion fails (composite)", () => {
    const result = computeCompositeScore(8, 8, 0.5, 0.4);
    expect(result.compositeScore).toBe(2);
    expect(result.source).toBe("assertion_fail");
  });

  it("hard-caps at 2 when all assertions fail", () => {
    const result = computeCompositeScore(8, null, 0, 0.4);
    expect(result.compositeScore).toBe(2);
    expect(result.source).toBe("assertion_fail");
  });

  it("hard-caps at 2 even with high scores when assertions fail", () => {
    const result = computeCompositeScore(10, 10, 0.8, 0.4);
    expect(result.compositeScore).toBe(2);
    expect(result.source).toBe("assertion_fail");
  });

  it("does not cap when all assertions pass", () => {
    const result = computeCompositeScore(8, 8, 1, 0.4);
    expect(result.compositeScore).toBe(8);
    expect(result.source).toBe("composite");
  });

  it("does not cap when assertion pass rate is null (no assertions)", () => {
    const result = computeCompositeScore(8, 8, null, 0.4);
    expect(result.compositeScore).toBe(8);
    expect(result.source).toBe("composite");
  });

  it("returns 1 when both null", () => {
    const result = computeCompositeScore(null, null, null, 0.4);
    expect(result.compositeScore).toBe(1);
  });

  it("clamps composite to 1-10 range", () => {
    const result = computeCompositeScore(10, 10, 1, 0.4);
    expect(result.compositeScore).toBeLessThanOrEqual(10);
    expect(result.compositeScore).toBeGreaterThanOrEqual(1);
  });

  it("handles edge case: zero code weight (visual-only equivalent)", () => {
    const result = computeCompositeScore(7, 3, null, 0);
    // blend = 7*1.0 + 3*0.0 = 7, but diff ≥ 4, cap = 3+1 = 4
    expect(result.compositeScore).toBe(4);
  });

  it("handles edge case: full code weight", () => {
    const result = computeCompositeScore(3, 9, null, 1);
    // blend = 3*0 + 9*1 = 9; at full code weight (>= HIGH_CODE_WEIGHT_THRESHOLD)
    // the ±4 disagreement clamp is suppressed and the weighted blend stands.
    expect(result.compositeScore).toBe(9);
  });

  it("assertion fail with low base score caps at base score", () => {
    // visual=1, code=1, assertions=0.5 → base=1, min(2,1)=1
    const result = computeCompositeScore(1, 1, 0.5, 0.4);
    expect(result.compositeScore).toBe(1);
    expect(result.source).toBe("assertion_fail");
  });

  it("returns 1-decimal precision for blended scores", () => {
    // visual=7, code=9, weight=0.3 → 7*0.7 + 9*0.3 = 4.9 + 2.7 = 7.6
    const result = computeCompositeScore(7, 9, null, 0.3);
    expect(result.compositeScore).toBe(7.6);
  });
});

// ── parseSpecResponse with codeAssertions ──────────────────────────────────

describe("parseSpecResponse with codeAssertions", () => {
  it("parses codeAssertions from JSON response", () => {
    const json = JSON.stringify({
      interpretation: "A cylinder with specific dimensions",
      verificationChecklist: ["Is it a cylinder?"],
      codeAssertions: [
        {
          parameter: "diameter",
          aliases: ["d", "dia"],
          operator: "==",
          value: 15,
          description: "Cylinder diameter should be 15mm",
        },
        {
          parameter: "height",
          aliases: ["h"],
          operator: "==",
          value: 30,
          description: "Height should be 30mm",
        },
      ],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
    });

    const result = parseSpecResponse(json);
    expect(result.codeAssertions).toHaveLength(2);
    expect(result.codeAssertions[0].parameter).toBe("diameter");
    expect(result.codeAssertions[0].value).toBe(15);
    expect(result.codeAssertions[0].aliases).toEqual(["d", "dia"]);
    expect(result.codeAssertions[1].parameter).toBe("height");
  });

  it("returns empty array when codeAssertions is missing", () => {
    const json = JSON.stringify({
      interpretation: "A box",
      verificationChecklist: [],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
    });

    const result = parseSpecResponse(json);
    expect(result.codeAssertions).toEqual([]);
  });

  it("filters invalid assertions", () => {
    const json = JSON.stringify({
      interpretation: "test",
      verificationChecklist: [],
      codeAssertions: [
        { parameter: "valid", value: 10, aliases: [], operator: "==", description: "ok" },
        { parameter: "no_value" }, // missing value
        { value: 5 }, // missing parameter
        "not an object",
      ],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
    });

    const result = parseSpecResponse(json);
    expect(result.codeAssertions).toHaveLength(1);
    expect(result.codeAssertions[0].parameter).toBe("valid");
  });

  it("defaults operator to == when invalid", () => {
    const json = JSON.stringify({
      interpretation: "test",
      verificationChecklist: [],
      codeAssertions: [
        { parameter: "x", value: 5, aliases: [], operator: "invalid", description: "test" },
      ],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
    });

    const result = parseSpecResponse(json);
    expect(result.codeAssertions[0].operator).toBe("==");
  });

  it("parses from code-fenced JSON", () => {
    const fenced = "Here is the spec:\n```json\n" + JSON.stringify({
      interpretation: "A cylinder",
      verificationChecklist: ["Is cylindrical?"],
      codeAssertions: [{ parameter: "r", aliases: [], operator: "==", value: 7.5, description: "radius 7.5mm" }],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
    }) + "\n```";

    const result = parseSpecResponse(fenced);
    expect(result.codeAssertions).toHaveLength(1);
    expect(result.codeAssertions[0].value).toBe(7.5);
  });
});
