/**
 * Provenance for the judge's checklist (issue #34).
 *
 * Examples evaluated before #33 were scored against a checklist of literal
 * "undefined" placeholders. Those rows are not comparable with rows scored
 * against a real checklist, and anything that treats this corpus as a
 * reference set — judge benchmarking, a gold set, fine-tuning data — has to
 * know which side of the fix a row is on. Until now the only way to tell was
 * `vlm_system_prompt LIKE '%. undefined%'`, which is a string match against a
 * prompt template that is free to change.
 */
import { describe, it, expect } from "vitest";
import {
  classifyChecklist,
  classifyStoredPrompt,
  PLACEHOLDER_CHECKLIST_SQL_PATTERN,
} from "../utils/checklist-state.js";

describe("classifyChecklist (write path)", () => {
  it("calls a non-empty checklist real", () => {
    expect(classifyChecklist(["Does it have two arms?"])).toBe("real");
  });

  it("calls an absent or empty checklist empty", () => {
    expect(classifyChecklist([])).toBe("empty");
    expect(classifyChecklist(undefined)).toBe("empty");
  });

  it("still reports placeholder if the defect ever recurs", () => {
    // toAnnotatedCriteria drops textless criteria, so post-#33 this cannot
    // happen — but classifying it as "real" would hide a regression.
    expect(classifyChecklist(["undefined", "undefined"])).toBe("placeholder");
  });

  it("ignores blank entries when deciding emptiness", () => {
    expect(classifyChecklist(["   ", ""])).toBe("empty");
  });
});

describe("classifyStoredPrompt (backfill path)", () => {
  const placeholder =
    "Verification Checklist — answer each with pass, fail, or uncertain:\n1. undefined\n2. undefined";
  const real =
    "Verification Checklist — answer each with pass, fail, or uncertain:\n1. Is it a flat ring?\n2. Are the circles concentric?";

  it("detects the placeholder checklist", () => {
    expect(classifyStoredPrompt(placeholder)).toBe("placeholder");
  });

  it("detects a real checklist", () => {
    expect(classifyStoredPrompt(real)).toBe("real");
  });

  it("detects a prompt with no checklist block", () => {
    expect(classifyStoredPrompt("Evaluate these images of a bracket.")).toBe("empty");
  });

  it("returns null when there is no stored prompt to classify", () => {
    expect(classifyStoredPrompt(null)).toBeNull();
    expect(classifyStoredPrompt("")).toBeNull();
  });

  it("does not mistake the word undefined in prose for the defect", () => {
    const prose =
      "These are ALL VALID classes — do NOT flag them as undefined or unavailable.\n" +
      "Verification Checklist — answer each with pass, fail, or uncertain:\n1. Is it a ring?";
    expect(classifyStoredPrompt(prose)).toBe("real");
  });

  it("exposes the same rule as a SQL pattern, so the backfill cannot drift", () => {
    expect(PLACEHOLDER_CHECKLIST_SQL_PATTERN).toBe("%. undefined%");
  });
});
