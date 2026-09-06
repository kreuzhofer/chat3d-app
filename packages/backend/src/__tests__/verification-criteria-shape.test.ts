/**
 * Verification criteria must survive enrichment with their shape intact
 * (issue #33).
 *
 * Spec generation emits `{ text, visibility }`; enrichment used to return bare
 * strings, and the eval orchestrator then mapped `.text` over them. Because
 * `undefined.visibility !== "code"` and `DIMENSION_PATTERN.test(undefined)`
 * tests the literal string "undefined", every item passed the filter and became
 * `undefined` — and, worse, this OVERWROTE the perfectly good plain checklist
 * that was already there. 58% of stored judge prompts read "1. undefined".
 */
import { describe, it, expect } from "vitest";
import { toAnnotatedCriteria, deriveVisualChecklist } from "../utils/verification-criteria.js";

const ANNOTATED = [
  { text: "Model has two arms meeting at a single elbow", visibility: "visual" as const },
  { text: "Each arm is 60mm long and 12mm wide", visibility: "code" as const },
  { text: "Arms meet at an obtuse angle", visibility: "both" as const },
];

describe("toAnnotatedCriteria", () => {
  it("passes annotated criteria through unchanged", () => {
    expect(toAnnotatedCriteria(ANNOTATED)).toEqual(ANNOTATED);
  });

  it("lifts bare strings to the annotated shape with an explicit default", () => {
    // Enrichment returns bare strings; they must not lose their text.
    expect(toAnnotatedCriteria(["Base is flat", "Lip protrudes outward"])).toEqual([
      { text: "Base is flat", visibility: "both" },
      { text: "Lip protrudes outward", visibility: "both" },
    ]);
  });

  it("drops entries with no usable text rather than yielding a placeholder", () => {
    expect(toAnnotatedCriteria([{ visibility: "visual" }, "", "  ", null, 42, { text: "  " }]))
      .toEqual([]);
  });

  it("returns an empty list for a non-array", () => {
    expect(toAnnotatedCriteria(undefined)).toEqual([]);
    expect(toAnnotatedCriteria("not a list")).toEqual([]);
  });
});

describe("deriveVisualChecklist", () => {
  const fallback = ["Does the model have two arms?", "Do the arms meet at an elbow?"];

  it("keeps visual and both criteria, drops code-only ones", () => {
    expect(deriveVisualChecklist(ANNOTATED, fallback)).toEqual([
      "Model has two arms meeting at a single elbow",
      "Arms meet at an obtuse angle",
    ]);
  });

  it("drops criteria carrying specific dimensions the judge cannot measure", () => {
    const withDims = [
      { text: "Base plate is present", visibility: "visual" as const },
      { text: "Hole diameter is 5mm", visibility: "visual" as const },
    ];
    expect(deriveVisualChecklist(withDims, fallback)).toEqual(["Base plate is present"]);
  });

  it("handles enrichment's bare strings without emitting placeholders", () => {
    // The regression: this used to produce [undefined, undefined].
    const result = deriveVisualChecklist(["Lip protrudes outward", "Base is flat"], fallback);
    expect(result).toEqual(["Lip protrudes outward", "Base is flat"]);
    expect(result.every(q => typeof q === "string" && q.length > 0)).toBe(true);
  });

  it("falls back to the plain checklist rather than overwriting it with nothing", () => {
    // The second half of the bug: a criteria list that filters down to empty
    // discarded a good checklist. Losing real questions is worse than ignoring
    // the annotation.
    const allCodeOnly = [{ text: "Wall is 2mm thick", visibility: "code" as const }];
    expect(deriveVisualChecklist(allCodeOnly, fallback)).toEqual(fallback);
    expect(deriveVisualChecklist([], fallback)).toEqual(fallback);
    expect(deriveVisualChecklist(undefined, fallback)).toEqual(fallback);
  });

  it("never yields a non-string entry, whatever it is given", () => {
    const junk = [{ visibility: "visual" }, null, 7, { text: null }];
    for (const q of deriveVisualChecklist(junk, fallback)) {
      expect(typeof q).toBe("string");
      expect(q.trim().length).toBeGreaterThan(0);
    }
  });
});

/**
 * End of the chain: even if a placeholder list somehow reaches the prompt
 * builder, the block must not be rendered.
 */
describe("visual eval prompt never renders a placeholder checklist", () => {
  const base = {
    userPrompt: "A simple bookend",
    categoryName: "Simple Everyday Objects",
    complexity: 2,
    constructionSpec: "",
  };

  it("omits the block for an all-empty checklist", async () => {
    const { buildEvaluationSystemPrompt } = await import("../services/visual-eval-prompt.service.js");

    const prompt = buildEvaluationSystemPrompt({ ...base, checklist: ["", "   "] });
    expect(prompt).not.toContain("Verification Checklist");
    expect(prompt).not.toMatch(/\d\.\s*$/m);
  });

  it("renders only the real questions when the list is mixed", async () => {
    const { buildEvaluationSystemPrompt } = await import("../services/visual-eval-prompt.service.js");
    const prompt = buildEvaluationSystemPrompt({
      ...base, checklist: ["Is the base flat?", "", "Does the lip protrude?"],
    });

    expect(prompt).toContain("1. Is the base flat?");
    expect(prompt).toContain("2. Does the lip protrude?");
    expect(prompt).not.toContain("undefined");
  });
});
